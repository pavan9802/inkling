import type { CompletionRequest } from '../context/types.js';
import type { ContextAssembler } from '../context/assembler.js';
import type { CompletionBackend } from '../backend/types.js';
import type { ResolvedConfig } from '../config/types.js';
import { getLanguageProfile } from '../language/profiles.js';
import { resolveCompletionMode } from '../language/multiline.js';
import { detectFimFamily } from '../prompt/fim-registry.js';
import { buildCompletionPrompt } from '../prompt/prompt-builder.js';
import {
  truncateAtStop,
  trimSuffixOverlap,
  enforceSingleLine,
  enforceLineLimit,
  isLowValue,
} from '../postprocess/index.js';
import { CompletionCache } from './cache.js';

export interface PipelineResult {
  readonly text: string;
  readonly fromCache: boolean;
  // Measured from the start of run() — includes context assembly time, so it
  // reflects the wall-clock latency the user experiences.
  readonly latencyMs: number;
}

const CACHE_MAX_SIZE = 128;
const CACHE_TTL_MS = 30_000;

/**
 * Orchestrates the full completion lifecycle: cache → assemble → prompt →
 * complete → post-process. `InlineProvider` and the eval CLI both call
 * `pipeline.run()` so the path is identical in production and benchmarks.
 */
export class CompletionPipeline {
  private readonly cache = new CompletionCache(CACHE_MAX_SIZE, CACHE_TTL_MS);
  // Remembered across calls for typed-through detection (see step 2b below).
  private lastPrefix: string | undefined;
  private lastSuffix: string | undefined;

  constructor(
    private readonly assembler: ContextAssembler,
    private readonly backend: CompletionBackend,
    private readonly getConfig: () => ResolvedConfig,
  ) {}

  async run(req: CompletionRequest, signal: AbortSignal): Promise<PipelineResult | null> {
    const t0 = Date.now();
    // Step 1: snapshot config once — keeps all steps consistent even if VS
    // Code settings change mid-completion.
    const config = this.getConfig();

    // Step 2a: direct cache hit — fastest possible exit.
    const cached = this.cache.get(req.prefix, req.suffix);
    if (cached !== undefined) {
      this.lastPrefix = req.prefix;
      this.lastSuffix = req.suffix;
      return { text: cached, fromCache: true, latencyMs: 0 };
    }

    // Step 2b: typed-through — user accepted the first character of the last
    // suggestion. No round-trip needed; we trim the cached text and re-store
    // it so the next keystroke can chain another typed-through.
    if (this.lastPrefix !== undefined && this.lastSuffix !== undefined) {
      const typed = this.cache.tryTypedThrough(req.prefix, this.lastPrefix, req.suffix);
      if (typed !== undefined) {
        this.cache.set(req.prefix, req.suffix, typed);
        this.lastPrefix = req.prefix;
        this.lastSuffix = req.suffix;
        return { text: typed, fromCache: true, latencyMs: 0 };
      }
    }

    // Step 3: assemble cross-file context under the hard deadline (ADR-0003).
    // A slow or failing retriever contributes nothing rather than blocking.
    const snippets = await this.assembler.assemble(req, {
      deadlineMs: config.deadlineMs,
      budgetChars: config.budgets.contextChars,
      signal,
    });

    // Step 4: resolve single vs. multi-line mode from prefix tail + config.
    const profile = getLanguageProfile(req.languageId);
    const mode = resolveCompletionMode(req.prefix, profile, config.multiline);

    // Step 5: build the raw FIM prompt via the registry (ADR-0002, ADR-0004).
    // Throws for unknown model families — that's a configuration error, not a
    // low-value completion, so callers see it as an exception rather than null.
    const family = detectFimFamily(config.model);
    if (!family) throw new Error(`Unknown FIM family for model "${config.model}"`);

    const prompt = buildCompletionPrompt({ req, snippets, profile, family });

    // Step 6: call the backend. stop sequences come from mode, not the profile
    // directly — single-line positions stop at \n, not \n\n.
    const result = await this.backend.complete({
      prompt,
      stop: [...mode.stopSequences],
      maxTokens: config.budgets.maxOutputTokens,
      temperature: config.temperature,
      signal,
    });

    // Step 7: post-process — four transforms in sequence.
    // truncateAtStop and enforceLineLimit/enforceSingleLine are redundant with
    // the backend stop parameter but act as safety nets: the model can emit a
    // continuation token before the server honours the stop sequence.
    let text = truncateAtStop(result.text, mode.stopSequences);
    text = trimSuffixOverlap(text, req.suffix);
    text = mode.multiline ? enforceLineLimit(text, mode.maxLines) : enforceSingleLine(text);

    // Step 7 (cont): discard completions that are pure whitespace — showing
    // them would shift the cursor without producing visible ghost text.
    if (isLowValue(text)) return null;

    // Step 8: store and update typed-through state.
    this.cache.set(req.prefix, req.suffix, text);
    this.lastPrefix = req.prefix;
    this.lastSuffix = req.suffix;

    return { text, fromCache: false, latencyMs: Date.now() - t0 };
  }
}
