import * as vscode from 'vscode';
import { isSecretFile, type CompletionRequest, type ContextRetriever, type ScoredSnippet } from '@inkling/core';

/**
 * Scores every open editor against ±50 lines centred on the cursor by lexical
 * Jaccard overlap, returns the top-5 chunks that score above the 0.05 floor.
 */
export class OpenTabsRetriever implements ContextRetriever {
  readonly id = 'open-tabs';
  readonly priority = 10;

  async retrieve(req: CompletionRequest, _deadlineMs: number, signal: AbortSignal): Promise<ScoredSnippet[]> {
    if (signal.aborted) return [];

    // Build a token set from ±50 lines around the cursor. We reuse the already-
    // trimmed prefix/suffix from the request rather than re-reading the document.
    const querySet = buildQuerySet(req.prefix, req.suffix);
    if (querySet.size === 0) return [];

    const results: { snippet: ScoredSnippet; score: number }[] = [];

    for (const doc of vscode.workspace.textDocuments) {
      if (signal.aborted) break;
      // Skip the active document — it's already the prefix/suffix in the request.
      if (doc.uri.fsPath === req.uri) continue;
      // Skip virtual documents (output channels, git diffs, untitled buffers).
      if (doc.uri.scheme !== 'file') continue;
      if (isSecretFile(doc.uri.fsPath)) continue;

      const text = doc.getText();
      let best = 0;
      let bestChunk = '';

      // Slide a 200-char window at 50% overlap and keep the highest-scoring chunk.
      // 200 chars ≈ 5–8 lines — small enough to stay focused, large enough to
      // carry a meaningful code pattern.
      for (const chunk of windowChunks(text, 200, 100)) {
        const chunkSet = tokenize(chunk);
        const score = jaccard(querySet, chunkSet);
        if (score > best) {
          best = score;
          bestChunk = chunk;
        }
      }

      // 0.05 floor filters documents that share only incidental tokens (common
      // keywords, short identifiers). Below this threshold the snippet adds noise.
      if (best >= 0.05) {
        results.push({
          score: best,
          snippet: { text: bestChunk, score: best, sourcePath: doc.uri.fsPath, kind: 'open-tab' },
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 5).map((r) => r.snippet);
  }
}

// Tokens < 3 chars (a, i, of, to, …) are common across all files and add noise
// to Jaccard scores without providing semantic signal.
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of text.split(/\W+/)) {
    if (t.length >= 3) tokens.add(t.toLowerCase());
  }
  return tokens;
}

function buildQuerySet(prefix: string, suffix: string): Set<string> {
  const prefixWindow = prefix.split('\n').slice(-50).join('\n');
  const suffixWindow = suffix.split('\n').slice(0, 50).join('\n');
  return tokenize(`${prefixWindow}\n${suffixWindow}`);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  // Iterate the smaller set for O(min(|a|, |b|)) membership checks.
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Generator keeps memory flat — chunks are not all materialised at once.
function* windowChunks(text: string, size: number, step: number): Iterable<string> {
  for (let i = 0; i < text.length; i += step) {
    yield text.slice(i, i + size);
  }
}
