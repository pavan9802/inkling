/**
 * Inference backend abstraction (ADR-0007). Ollama is the first implementation;
 * llama.cpp and OpenAI-compatible servers are future implementations behind
 * this same interface. Streaming is expressed here so it is never a retrofit.
 */

export interface CompletionParams {
  /** The raw FIM prompt (already assembled by the prompt builder). */
  readonly prompt: string;
  readonly stop: readonly string[];
  readonly maxTokens: number;
  readonly temperature: number;
  readonly signal: AbortSignal;
}

export interface CompletionResult {
  readonly text: string;
  /** True if generation ended on a stop sequence rather than the token cap. */
  readonly stoppedEarly: boolean;
}

export interface CompletionBackend {
  readonly id: string;
  /** Whether the server is reachable and the configured model is available. */
  isAvailable(): Promise<boolean>;
  complete(params: CompletionParams): Promise<CompletionResult>;
  /** Optional model enumeration; `inkling.pickModel` uses this when present. */
  listModels?(): Promise<string[]>;
  /** Optional progressive generation; Phase 2 may wire this to ghost text. */
  stream?(params: CompletionParams): AsyncIterable<string>;
}
