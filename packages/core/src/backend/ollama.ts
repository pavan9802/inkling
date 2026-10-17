import { notImplemented } from '../util/errors.js';
import type { CompletionBackend, CompletionParams, CompletionResult } from './types.js';

export interface OllamaOptions {
  readonly endpoint: string;
  readonly model: string;
  /** Keeps the model resident to avoid reload latency, e.g. '30m'. */
  readonly keepAlive: string;
}

/**
 * Ollama backend. Talks to `/api/generate` with `raw: true` so our own FIM
 * prompt bypasses server-side templating (ADR-0002).
 *
 * Phase 0: interface only. Phase 1 implements `complete`/`isAvailable`.
 */
export class OllamaBackend implements CompletionBackend {
  readonly id = 'ollama';

  constructor(private readonly opts: OllamaOptions) {}

  async isAvailable(): Promise<boolean> {
    // TODO(phase-1): GET {endpoint}/api/tags and check the model is present.
    return notImplemented('OllamaBackend.isAvailable');
  }

  async complete(_params: CompletionParams): Promise<CompletionResult> {
    // TODO(phase-1): POST {endpoint}/api/generate with
    //   { model, prompt, raw: true, stream: false, keep_alive,
    //     options: { temperature, num_predict: maxTokens, stop } }
    // bridging `signal` to fetch for cancellation.
    return notImplemented('OllamaBackend.complete');
  }
}
