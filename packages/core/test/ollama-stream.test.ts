import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OllamaBackend } from '../src/backend/ollama.js';
import type { CompletionParams } from '../src/backend/types.js';

const PARAMS: CompletionParams = {
  prompt: '<fim_prefix>fn hello() {<fim_suffix>}<fim_middle>',
  stop: ['\n\n'],
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
};

// Build a Response whose body streams newline-delimited JSON chunks.
function makeStreamResponse(chunks: Array<{ response: string; done: boolean }>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

// Build a Response that arrives as a single network chunk containing all lines.
// This tests that the line-splitting logic handles partial-chunk boundaries.
function makeSplitStreamResponse(lines: string[], splitAt: number): Response {
  const encoder = new TextEncoder();
  const joined = lines.map((l) => l + '\n').join('');
  const part1 = joined.slice(0, splitAt);
  const part2 = joined.slice(splitAt);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(part1));
      controller.enqueue(encoder.encode(part2));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OllamaBackend.stream()', () => {
  it('yields tokens in order and stops at done: true', async () => {
    globalThis.fetch = async () =>
      makeStreamResponse([
        { response: 'return', done: false },
        { response: ' 42', done: false },
        { response: ';', done: false },
        { response: '', done: true },
      ]);

    const backend = new OllamaBackend({ endpoint: 'http://localhost:11434', model: 'qwen2.5-coder:3b', keepAlive: '30m' });
    const chunks: string[] = [];
    for await (const chunk of backend.stream!(PARAMS)) {
      chunks.push(chunk);
    }

    // Empty-response done chunk is skipped (response === '')
    expect(chunks).toEqual(['return', ' 42', ';']);
  });

  it('stops immediately when done: true arrives with a non-empty response', async () => {
    globalThis.fetch = async () =>
      makeStreamResponse([
        { response: 'hello', done: false },
        { response: ' world', done: true }, // last real token + done in same chunk
        { response: 'SHOULD_NOT_APPEAR', done: false },
      ]);

    const backend = new OllamaBackend({ endpoint: 'http://localhost:11434', model: 'qwen2.5-coder:3b', keepAlive: '30m' });
    const chunks: string[] = [];
    for await (const chunk of backend.stream!(PARAMS)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['hello', ' world']);
  });

  it('handles a chunk boundary that splits a JSON line', async () => {
    const lines = [
      JSON.stringify({ response: 'foo', done: false }),
      JSON.stringify({ response: 'bar', done: false }),
      JSON.stringify({ response: '', done: true }),
    ];
    // Split the stream right in the middle of the second JSON line.
    globalThis.fetch = async () => makeSplitStreamResponse(lines, lines[0].length + 5);

    const backend = new OllamaBackend({ endpoint: 'http://localhost:11434', model: 'qwen2.5-coder:3b', keepAlive: '30m' });
    const chunks: string[] = [];
    for await (const chunk of backend.stream!(PARAMS)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['foo', 'bar']);
  });

  it('throws on a non-OK HTTP status', async () => {
    globalThis.fetch = async () => new Response('Model not found', { status: 404, statusText: 'Not Found' });

    const backend = new OllamaBackend({ endpoint: 'http://localhost:11434', model: 'missing', keepAlive: '30m' });
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of backend.stream!(PARAMS)) { /* drain */ }
    }).toThrow('404');
  });

  it('sends stream: true and raw: true in the request body', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      return makeStreamResponse([{ response: '', done: true }]);
    };

    const backend = new OllamaBackend({ endpoint: 'http://localhost:11434', model: 'qwen2.5-coder:3b', keepAlive: '30m' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of backend.stream!(PARAMS)) { /* drain */ }

    expect(capturedBody?.stream).toBe(true);
    expect(capturedBody?.raw).toBe(true);
  });
});
