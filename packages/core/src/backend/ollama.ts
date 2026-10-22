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
}
