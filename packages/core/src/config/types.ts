/**
 * Configuration model (ADR-0006).
 *
 * All tuning in the system is resolved into a single immutable `ResolvedConfig`.
 * Only the `extension` and `eval` packages PRODUCE one; everything in `core`
 * only READS it. Adding a new setting later means adding a field here plus a
 * mapping in the two adapters — core logic never changes shape.
 */

export type Profile = 'fast' | 'quality' | 'custom';

export type MultilineMode = 'auto' | 'off' | 'always';

export interface Budgets {
  /** Max characters of the current file taken before the cursor. */
  readonly prefixChars: number;
  /** Max characters of the current file taken after the cursor. */
  readonly suffixChars: number;
  /** Max characters of cross-file context assembled into the prompt. */
  readonly contextChars: number;
  /** Max tokens the model may generate per completion. */
  readonly maxOutputTokens: number;
}

export interface RoutingConfig {
  /** 'latency' → always fast model. 'quality' → always quality model.
   *  'auto' → RequestRouter inspects the request and picks per-keystroke. */
  readonly budget: 'latency' | 'quality' | 'auto';
  /** Prefix line count above which auto routing picks the quality model. */
  readonly complexityThreshold: number;
  readonly fastModel: string;
  readonly qualityModel: string;
}

/** Which context retrievers are active. New sources add a field here. */
export interface RetrieverToggles {
  readonly openTabs: boolean;
  readonly lsp: boolean;
  readonly index: boolean;
}

export interface ResolvedConfig {
  readonly enabled: boolean;
  readonly profile: Profile;
  /** Inference server base URL. Non-localhost triggers a privacy warning. */
  readonly endpoint: string;
  /** Model tag, e.g. `qwen2.5-coder:3b`. Machine-scoped in VS Code settings. */
  readonly model: string;
  readonly budgets: Budgets;
  readonly retrievers: RetrieverToggles;
  readonly multiline: MultilineMode;
  /** Idle time after a keystroke before requesting a completion. */
  readonly debounceMs: number;
  /** Hard deadline for one context-assembly cycle (ADR-0003). */
  readonly deadlineMs: number;
  readonly temperature: number;
  readonly routing: RoutingConfig;
  /** Per-language overrides, keyed by language id. */
  readonly perLanguage: Readonly<Record<string, Partial<ResolvedConfig>>>;
}
