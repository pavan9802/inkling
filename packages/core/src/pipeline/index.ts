import type { CompletionRequest } from '../context/types.js';
import type { ContextAssembler } from '../context/assembler.js';
import type { CompletionBackend } from '../backend/types.js';
import type { ResolvedConfig } from '../config/types.js';
import type { CompletionMode } from '../language/multiline.js';
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

  /**
   * Shared setup for run() and stream(): cache checks, context assembly, and
   * prompt construction. Returns either an immediate cache result or everything
   * needed to call the backend. Extracted to avoid duplicating ~40 lines.
   */
  private async prepare(
    req: CompletionRequest,
    signal: AbortSignal,
  ): Promise<
    | { kind: 'cache'; result: PipelineResult }
    | { kind: 'ready'; config: ResolvedConfig; mode: CompletionMode; prompt: string; t0: number }
  > {
    const t0 = Date.now();
    // Step 1: snapshot config once — keeps all steps consistent even if VS
    // Code settings change mid-completion.
    const config = this.getConfig();

    // Step 2a: direct cache hit — fastest possible exit.
    const cached = this.cache.get(req.prefix, req.suffix);
    if (cached !== undefined) {
      this.lastPrefix = req.prefix;
      this.lastSuffix = req.suffix;
      return { kind: 'cache', result: { text: cached, fromCache: true, latencyMs: 0 } };
    }

    // Step 2b: typed-through — user accepted the first character of the last
    // suggestion. No round-trip needed; we trim and re-store so subsequent
    // keystrokes can chain further typed-through detections.
    if (this.lastPrefix !== undefined && this.lastSuffix !== undefined) {
      const typed = this.cache.tryTypedThrough(req.prefix, this.lastPrefix, req.suffix);
      if (typed !== undefined) {
        this.cache.set(req.prefix, req.suffix, typed);
        this.lastPrefix = req.prefix;
        this.lastSuffix = req.suffix;
        return { kind: 'cache', result: { text: typed, fromCache: true, latencyMs: 0 } };
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

    return { kind: 'ready', config, mode, prompt, t0 };
  }

  async run(req: CompletionRequest, signal: AbortSignal): Promise<PipelineResult | null> {
    const prepared = await this.prepare(req, signal);
    if (prepared.kind === 'cache') return prepared.result;

    const { config, mode, prompt, t0 } = prepared;

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

  /**
   * Streaming variant of run(). Yields results progressively as tokens arrive:
   * - Cache hits yield once immediately (same as run()).
   * - In multiline mode, yields after each completed line so the InlineProvider
   *   can show the first line of ghost text in ~150ms, then drain the rest in
   *   the background to pre-populate the cache (the "next block ready" pattern).
   * - In single-line mode, yields once when the line is complete.
   * - Falls back to run() if the backend has no stream() method.
   */
  async *stream(req: CompletionRequest, signal: AbortSignal): AsyncGenerator<PipelineResult> {
    const prepared = await this.prepare(req, signal);
    if (prepared.kind === 'cache') {
      yield prepared.result;
      return;
    }

    const { config, mode, prompt, t0 } = prepared;

    // Fallback: backend doesn't support streaming, delegate to run().
    if (!this.backend.stream) {
      const result = await this.run(req, signal);
      if (result) yield result;
      return;
    }

    // Step 6: stream from backend, accumulate tokens, yield on meaningful boundaries.
    let accumulated = '';

    for await (const chunk of this.backend.stream({
      prompt,
      stop: [...mode.stopSequences],
      maxTokens: config.budgets.maxOutputTokens,
      temperature: config.temperature,
      signal,
    })) {
      accumulated += chunk;

      // Safety net: backend stop param is the primary guard, but the model can
      // emit a continuation token before the server honours it.
      const truncated = truncateAtStop(accumulated, mode.stopSequences);
      if (truncated.length < accumulated.length) {
        accumulated = truncated;
        break;
      }

      // Multiline: yield after each completed line so the InlineProvider can
      // show partial results; stop when the line budget is exhausted.
      if (mode.multiline) {
        const completedLines = accumulated.split('\n').length - 1;
        if (completedLines >= mode.maxLines) {
          accumulated = enforceLineLimit(accumulated, mode.maxLines);
          break;
        }
        // chunk contains '\n' → a new line just finished; give the provider something to show.
        if (chunk.includes('\n')) {
          const text = trimSuffixOverlap(accumulated, req.suffix);
          if (!isLowValue(text)) {
            yield { text, fromCache: false, latencyMs: Date.now() - t0 };
          }
        }
      }
    }

    // Step 7: post-process the final accumulated text.
    let finalText = trimSuffixOverlap(accumulated, req.suffix);
    finalText = mode.multiline ? enforceLineLimit(finalText, mode.maxLines) : enforceSingleLine(finalText);

    if (isLowValue(finalText)) return;

    // Yield the final result. In single-line mode this is the only yield.
    // In multiline mode this supersedes any intermediate yields (it may be
    // identical to the last intermediate, which is fine — caller ignores dupes).
    yield { text: finalText, fromCache: false, latencyMs: Date.now() - t0 };

    // Step 8: store and update typed-through state.
    this.cache.set(req.prefix, req.suffix, finalText);
    this.lastPrefix = req.prefix;
    this.lastSuffix = req.suffix;

    // Pre-populate cache for the "next block after acceptance" pattern:
    // when the user accepts the first line and presses Enter, the next
    // invocation's typed-through check finds the rest in cache instantly.
    const firstLine = enforceSingleLine(finalText);
    if (firstLine !== finalText) {
      // Rest includes the leading '\n' so typed-through fires on the Enter keypress.
      const rest = finalText.slice(firstLine.length);
      if (!isLowValue(rest)) {
        this.cache.set(req.prefix + firstLine, req.suffix, rest);
      }
    }
  }
}
