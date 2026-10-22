import { describe, it, expect } from 'bun:test';
import { CompletionPipeline } from '../src/pipeline/index.js';
import type { CompletionBackend, CompletionParams } from '../src/backend/types.js';
import type { CompletionRequest } from '../src/context/types.js';
import type { ResolvedConfig } from '../src/config/types.js';
import { ContextAssembler } from '../src/context/assembler.js';
import { defaultConfigForProfile } from '../src/config/profiles.js';

// Minimal config: qwen model so detectFimFamily works, multiline always.
function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...defaultConfigForProfile('fast'), model: 'qwen2.5-coder:3b', multiline: 'always', ...overrides };
}

// Backend whose stream() yields each string in `chunks` as a separate token.
function mockStreamBackend(chunks: string[]): CompletionBackend {
  return {
    id: 'mock',
    isAvailable: async () => true,
    complete: async () => ({ text: chunks.join(''), stoppedEarly: false }),
    async *stream(_params: CompletionParams): AsyncIterable<string> {
      for (const c of chunks) yield c;
    },
  };
}

// Backend with no stream() method — tests the fallback path.
function mockNonStreamBackend(text: string): CompletionBackend {
  return {
    id: 'mock-no-stream',
    isAvailable: async () => true,
    complete: async () => ({ text, stoppedEarly: false }),
  };
}

const assembler = new ContextAssembler([]);
const signal = new AbortController().signal;

const REQ: CompletionRequest = {
  uri: 'test.ts',
  languageId: 'typescript',
  prefix: 'function add(a: number, b: number) {\n',
  suffix: '}\n',
};

// Collect all yielded values from an AsyncIterable.
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('CompletionPipeline.stream()', () => {
  it('falls back to run() when backend has no stream method', async () => {
    const backend = mockNonStreamBackend('  return a + b;');
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig());
    const results = await collect(pipeline.stream(REQ, signal));
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('  return a + b;');
    expect(results[0].fromCache).toBe(false);
  });

  it('yields cache hit immediately without calling backend', async () => {
    const backend = mockStreamBackend(['SHOULD_NOT_APPEAR']);
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig());

    // Prime the cache via run()
    await pipeline.run(
      { ...REQ, prefix: 'cached_prefix' },
      signal,
    );

    // Now stream with the same prefix — should be a direct cache hit.
    // (We manually store in cache by running once with a fresh backend.)
    const noCalls = mockNonStreamBackend('  return a + b;');
    const seeded = new CompletionPipeline(assembler, noCalls, () => makeConfig());
    // Run once to populate cache
    await seeded.run({ ...REQ, prefix: 'seed' }, signal);

    const cacheHitBackend = { ...mockStreamBackend(['SHOULD_NOT_APPEAR']) };
    const pipeline2 = new CompletionPipeline(assembler, cacheHitBackend, () => makeConfig());
    await pipeline2.run({ ...REQ, prefix: 'x' }, signal); // populate cache with 'x'
    const results = await collect(pipeline2.stream({ ...REQ, prefix: 'x' }, signal));
    expect(results[0].fromCache).toBe(true);
    expect(results[0].latencyMs).toBe(0);
  });

  it('single-line mode: yields once with the complete line (no \\n in result)', async () => {
    const backend = mockStreamBackend(['  return', ' a', ' +', ' b;']);
    // multiline: off → stopSequences: ['\n'] → truncateAtStop fires at \n
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig({ multiline: 'off' }));
    const results = await collect(pipeline.stream(REQ, signal));
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('  return a + b;');
  });

  it('multiline mode: yields intermediate result after each completed line', async () => {
    const backend = mockStreamBackend([
      '  return',
      ' a + b;\n',  // first line completes here
      '  // done',
      '\n',         // second line completes here
    ]);
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig({ multiline: 'always' }));
    const results = await collect(pipeline.stream(REQ, signal));

    // At minimum two intermediate yields (one per '\n') plus the final yield.
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Last result is the fully accumulated final text.
    // The trailing '\n' from the last chunk is preserved — enforceLineLimit
    // splits on '\n' and re-joins, so the trailing '\n' is kept.
    const last = results[results.length - 1];
    expect(last.text).toBe('  return a + b;\n  // done\n');
  });

  it('stops at stop sequence and trims accumulated text', async () => {
    const backend = mockStreamBackend(['  return a;\n', '\n', 'MORE']);
    // stopSequences for 'always' with typescript profile = ['\n\n']
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig({ multiline: 'always' }));
    const results = await collect(pipeline.stream(REQ, signal));
    const last = results[results.length - 1];
    // '\n\n' stop sequence should cut the completion before 'MORE'
    expect(last.text).not.toContain('MORE');
    expect(last.text).toBe('  return a;');
  });

  it('stores the full completion in cache after streaming completes', async () => {
    const backend = mockStreamBackend(['  return a + b;']);
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig({ multiline: 'off' }));
    await collect(pipeline.stream(REQ, signal));

    // Second call with the same request should be a cache hit.
    const results2 = await collect(pipeline.stream(REQ, signal));
    expect(results2[0].fromCache).toBe(true);
  });

  it('pre-populates cache for the next-block pattern', async () => {
    const backend = mockStreamBackend(['  return a + b;\n  // comment']);
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig({ multiline: 'always' }));
    await collect(pipeline.stream(REQ, signal));

    // The key for the pre-populated entry is prefix + firstLine.
    // After accepting "  return a + b;", the user presses '\n', triggering typed-through.
    // The next invocation's prefix will be REQ.prefix + "  return a + b;" (then "\n" via typed-through).
    const results = await collect(
      pipeline.stream({ ...REQ, prefix: REQ.prefix + '  return a + b;' }, signal),
    );
    // Typed-through should fire on the '\n' char — but we can at least verify the
    // pre-populated cache key exists by checking that run() returns a cache hit.
    const hit = await pipeline.run(
      { ...REQ, prefix: REQ.prefix + '  return a + b;' },
      signal,
    );
    expect(hit?.fromCache).toBe(true);
    expect(hit?.text).toBe('\n  // comment');
  });

  it('discards low-value completions (pure whitespace)', async () => {
    const backend = mockStreamBackend(['   ', '  ']);
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig({ multiline: 'off' }));
    const results = await collect(pipeline.stream(REQ, signal));
    expect(results).toHaveLength(0);
  });

  it('throws for an unknown FIM model family', async () => {
    const backend = mockStreamBackend(['anything']);
    const pipeline = new CompletionPipeline(assembler, backend, () => makeConfig({ model: 'llava:7b' }));
    await expect(collect(pipeline.stream(REQ, signal))).rejects.toThrow('Unknown FIM family');
  });
});
