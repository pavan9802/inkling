/**
 * Language profiles keep the core generic. A new language is a new profile
 * object, not a code change. Unknown languages fall back to a generic profile.
 */
export interface LanguageProfile {
  /** Matches VS Code's language id, e.g. `typescriptreact`. */
  readonly id: string;
  readonly lineComment: string;
  /** Trailing tokens that suggest a multi-line block may follow. */
  readonly blockOpeners: readonly string[];
  /** Sequences that should always end a completion. */
  readonly stopSequences: readonly string[];
  /** Upper bound on lines for a multi-line completion. */
  readonly maxMultilineLines: number;
}
