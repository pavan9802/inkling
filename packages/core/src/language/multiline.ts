import type { LanguageProfile } from './types.js';
import type { MultilineMode } from '../config/types.js';

export interface CompletionMode {
  readonly multiline: boolean;
  // Passed directly to the backend's stop parameter AND used as a safety
  // truncation in post-processing — two independent enforcement points.
  readonly stopSequences: readonly string[];
  readonly maxLines: number;
}

/**
 * Decide between single-line and multi-line completion mode.
 *
 * `always` / `off` override the heuristic. `auto` inspects the trailing
 * non-whitespace of `prefix`: if it ends with a `profile.blockOpeners` entry
 * the model is likely entering a block → multiline; otherwise → single-line.
 */
export function resolveCompletionMode(
  prefix: string,
  profile: LanguageProfile,
  configMode: MultilineMode,
): CompletionMode {
  // Explicit overrides are checked first — no heuristic needed.
  if (configMode === 'always') {
    return { multiline: true, stopSequences: profile.stopSequences, maxLines: profile.maxMultilineLines };
  }
  if (configMode === 'off') {
    return { multiline: false, stopSequences: ['\n'], maxLines: 1 };
  }

  // auto: trimEnd() is required — the cursor line often ends with a newline,
  // so a bare endsWith('{') would fail on `function foo() {\n`.
  const tail = prefix.trimEnd();
  const isBlock = profile.blockOpeners.some((opener) => tail.endsWith(opener));
  if (isBlock) {
    return { multiline: true, stopSequences: profile.stopSequences, maxLines: profile.maxMultilineLines };
  }
  return { multiline: false, stopSequences: ['\n'], maxLines: 1 };
}
