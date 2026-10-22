import type { CompletionBackend, CompletionParams, CompletionResult } from './types.js';

export interface OllamaOptions {
  readonly endpoint: string;
  readonly model: string;
  /** Keeps the model resident to avoid reload latency, e.g. '30m'. */
  readonly keepAlive: string;
}

interface TagsResponse {
  models: Array<{ name: string }>;
}

interface GenerateResponse {
  response: string;
  done_reason: string;
}

interface GenerateStreamChunk {
  response: string;
  done: boolean;
}

/**
 * Ollama backend. Talks to `/api/generate` with `raw: true` so our own FIM
 * prompt bypasses server-side templating (ADR-0002).
 */
export class OllamaBackend implements CompletionBackend {
  readonly id = 'ollama';

  constructor(private readonly opts: OllamaOptions) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.endpoint}/api/tags`);
      if (!res.ok) return false;
      const data = (await res.json()) as TagsResponse;
      return data.models.some((m) => m.name === this.opts.model);
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    // Throws on failure — unlike isAvailable() which returns false. The caller
    // (pickModel command) decides whether to show an error to the user.
    const res = await fetch(`${this.opts.endpoint}/api/tags`);
    if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`);
    const data = (await res.json()) as TagsResponse;
    return data.models.map((m) => m.name);
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const res = await fetch(`${this.opts.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: params.signal,
      body: JSON.stringify({
        model: this.opts.model,
        prompt: params.prompt,
        raw: true,
        stream: false,
        keep_alive: this.opts.keepAlive,
        options: {
          temperature: params.temperature,
          num_predict: params.maxTokens,
          stop: params.stop,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama /api/generate failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GenerateResponse;
    return {
      text: data.response,
      stoppedEarly: data.done_reason === 'stop',
    };
  }

  async *stream(params: CompletionParams): AsyncIterable<string> {
    // One HTTP request, one open connection. `stream: true` is an Ollama body
    // param — it tells Ollama to flush each token to the response body as it's
    // generated rather than buffering the full completion. Fetch resolves as
    // soon as the response headers arrive (the 200 OK); the body stays open.
    const res = await fetch(`${this.opts.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: params.signal,
      body: JSON.stringify({
        model: this.opts.model,
        prompt: params.prompt,
        raw: true,   // bypass server-side prompt template (ADR-0002)
        stream: true, // Ollama param: send tokens incrementally, not all at once
        keep_alive: this.opts.keepAlive,
        options: {
          temperature: params.temperature,
          num_predict: params.maxTokens,
          stop: params.stop,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama /api/generate stream failed: ${res.status} ${res.statusText}`);
    }

    // res.body is a ReadableStream<Uint8Array>. Each reader.read() suspends
    // until the next batch of bytes arrives over the wire — effectively
    // `await nextTokenBatchFromOllama()`. Ollama sends one JSON line per token
    // (or small token group), terminated by \n, using chunked transfer encoding.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // Network chunks don't align with JSON lines — one read() can contain
    // multiple lines or end mid-line. Buffer the tail and prepend it next time.
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Last element is empty (line ended with \n) or an incomplete line — keep it.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const chunk = JSON.parse(trimmed) as GenerateStreamChunk;
          // Skip the final done chunk whose response is always an empty string.
          if (chunk.response) yield chunk.response;
          // done: true is Ollama's signal that generation has finished.
          if (chunk.done) return;
        }
      }
    } finally {
      // Always release the lock so the stream can be GC'd even if the caller
      // breaks out of the for-await early (e.g. stop sequence matched).
      reader.releaseLock();
    }
  }
}
