import type { CompletionRequest, ScoredSnippet } from '../context/types.js';
import type { LanguageProfile } from '../language/types.js';
import { fillFimTemplate, type FimFamily } from './fim-registry.js';

/**
 * Format cross-file snippets into a comment-delimited block, using the
 * language's line-comment syntax so the model reads them as reference context.
 */
export function buildContextBlock(snippets: readonly ScoredSnippet[], profile: LanguageProfile): string {
  if (snippets.length === 0) return '';
  const c = profile.lineComment;
  return snippets.map((s) => `${c} source: ${s.sourcePath}\n${s.text}`).join('\n\n');
}

export interface BuildPromptArgs {
  readonly req: CompletionRequest;
  readonly snippets: readonly ScoredSnippet[];
  readonly profile: LanguageProfile;
  readonly family: FimFamily;
}

/**
 * Assemble the final raw FIM prompt with cache-stable ordering (ADR-0004):
 *   [cross-file context] + [current-file prefix]  <middle>  [suffix]
 * The context + the body of the prefix stay stable across keystrokes, so the
 * inference server can reuse its prompt cache.
 */
export function buildCompletionPrompt(args: BuildPromptArgs): string {
  const context = buildContextBlock(args.snippets, args.profile);
  const prefix = context ? `${context}\n\n${args.req.prefix}` : args.req.prefix;
  return fillFimTemplate(args.family, { prefix, suffix: args.req.suffix });
}
