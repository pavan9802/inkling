import { describe, expect, test } from 'bun:test';
import { ContextAssembler } from '../src/context/assembler.js';
import type { ContextRetriever, ScoredSnippet } from '../src/context/types.js';

const req = { uri: 'f.ts', languageId: 'typescript', prefix: 'a', suffix: 'b' };

function fakeRetriever(id: string, priority: number, snippets: ScoredSnippet[]): ContextRetriever {
  return { id, priority, retrieve: async () => snippets };
}

const snip = (text: string, score: number): ScoredSnippet => ({
  text,
  score,
  sourcePath: `${text}.ts`,
  kind: 'open-tab',
});

describe('ContextAssembler', () => {
  test('ranks by priority then score', async () => {
    const a = fakeRetriever('a', 1, [snip('low-pri', 0.9)]);
    const b = fakeRetriever('b', 5, [snip('hi-pri', 0.1)]);
    const out = await new ContextAssembler([a, b]).assemble(req, {
      deadlineMs: 50,
      budgetChars: 1000,
      signal: new AbortController().signal,
    });
    expect(out[0]?.text).toBe('hi-pri');
  });

  test('respects the character budget', async () => {
    const r = fakeRetriever('a', 1, [snip('0123456789', 0.9), snip('abcdefghij', 0.8)]);
    const out = await new ContextAssembler([r]).assemble(req, {
      deadlineMs: 50,
      budgetChars: 10,
      signal: new AbortController().signal,
    });
    expect(out).toHaveLength(1);
  });

  test('a slow retriever does not block (deadline wins)', async () => {
    const slow: ContextRetriever = {
      id: 'slow',
      priority: 9,
      retrieve: () => new Promise((resolve) => setTimeout(() => resolve([snip('late', 1)]), 500)),
    };
    const fast = fakeRetriever('fast', 1, [snip('ontime', 0.5)]);
    const started = Date.now();
    const out = await new ContextAssembler([slow, fast]).assemble(req, {
      deadlineMs: 40,
      budgetChars: 1000,
      signal: new AbortController().signal,
    });
    expect(Date.now() - started).toBeLessThan(300);
    expect(out.map((s) => s.text)).toContain('ontime');
    expect(out.map((s) => s.text)).not.toContain('late');
  });

  test('a throwing retriever contributes nothing', async () => {
    const bad: ContextRetriever = {
      id: 'bad',
      priority: 1,
      retrieve: async () => {
        throw new Error('boom');
      },
    };
    const out = await new ContextAssembler([bad]).assemble(req, {
      deadlineMs: 50,
      budgetChars: 1000,
      signal: new AbortController().signal,
    });
    expect(out).toHaveLength(0);
  });
});
