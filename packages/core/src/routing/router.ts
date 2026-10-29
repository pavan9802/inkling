import type { CompletionBackend } from '../backend/types.js';
import type { CompletionRequest } from '../context/types.js';
import type { ResolvedConfig } from '../config/types.js';

/**
 * Runtime snapshot passed into every selectCandidate() call.
 * Keeps the router pure (no I/O, no mutable state) while still letting it
 * react to live system conditions like latency degradation (ADR-0008).
 */
export interface RouterContext {
  /** Rolling p50 of recent non-cached completion latencies in ms. 0 if unknown. */
  readonly recentP50Ms: number;
}

/** A model + the backend instance that owns it. */
export interface ModelCandidate {
  readonly model: string;
  readonly backend: CompletionBackend;
}

export interface ModelRouter {
  /**
   * Pure, synchronous — same inputs always produce the same output.
   * Called before context assembly so the FIM family is known before the
   * prompt is built (ADR-0002, ADR-0008).
   */
  selectCandidate(req: CompletionRequest, config: ResolvedConfig, ctx: RouterContext): ModelCandidate;
  /** Enumerate available models; delegates to an underlying backend. */
  listModels?(): Promise<string[]>;
}

/**
 * Always returns the same candidate. Used for budget 'latency' and 'quality'.
 * "Routing disabled = FixedRouter on the configured model, not a special-case
 * branch" (ADR-0008) — callers never need to check whether routing is active.
 */
export class FixedRouter implements ModelRouter {
  constructor(private readonly candidate: ModelCandidate) {}

  selectCandidate(): ModelCandidate {
    return this.candidate;
  }

  listModels(): Promise<string[]> {
    // FixedRouter owns exactly one backend — delegate directly.
    return this.candidate.backend.listModels?.() ?? Promise.resolve([]);
  }
}

/**
 * Inspects the request to pick between fast and quality candidates.
 * Used for budget 'auto'. Two signals, checked in priority order:
 *
 * 1. Latency guard — if the quality model's recent p50 exceeds 1 500 ms the
 *    user experience is worse than just using the fast model. Fall back.
 * 2. Complexity — a long prefix means more context to reason about; the
 *    quality model produces meaningfully better completions here.
 */
export class RequestRouter implements ModelRouter {
  private static readonly LATENCY_GUARD_MS = 1500;

  constructor(
    private readonly fast: ModelCandidate,
    private readonly quality: ModelCandidate,
  ) {}

  selectCandidate(req: CompletionRequest, config: ResolvedConfig, ctx: RouterContext): ModelCandidate {
    // Guard first: protect perceived latency before checking quality signals.
    if (ctx.recentP50Ms > RequestRouter.LATENCY_GUARD_MS) return this.fast;

    // Complexity: a prefix longer than the threshold is likely inside a large
    // function or class body where the quality model earns its extra latency.
    const lineCount = req.prefix.split('\n').length;
    if (lineCount > config.routing.complexityThreshold) return this.quality;

    return this.fast;
  }

  listModels(): Promise<string[]> {
    // /api/tags on Ollama lists all models regardless of which is configured —
    // either backend works, fast is always available.
    return this.fast.backend.listModels?.() ?? Promise.resolve([]);
  }
}
