import type { CompletionRequest, ContextRetriever, ScoredSnippet } from './types.js';

export interface AssembleOptions {
  readonly deadlineMs: number;
  readonly budgetChars: number;
  readonly signal: AbortSignal;
}

interface Ranked extends ScoredSnippet {
  readonly priority: number;
}

/**
 * Runs all registered retrievers in parallel under a hard deadline, dedupes,
 * ranks by (priority, score), and fills a character budget. This orchestration
 * is pure (it only calls injected retrievers), so it is unit-tested with fakes.
 *
 * The returned snippets are ordered best-first; the prompt builder formats them
 * into the cache-stable context region (ADR-0004).
 */
export class ContextAssembler {
  constructor(private readonly retrievers: readonly ContextRetriever[]) {}

  async assemble(req: CompletionRequest, opts: AssembleOptions): Promise<ScoredSnippet[]> {
    const gathered = await Promise.all(
      this.retrievers.map((r) => this.runWithDeadline(r, req, opts.deadlineMs, opts.signal)),
    );

    const ranked = dedupeByText(gathered.flat());
    ranked.sort((a, b) => b.priority - a.priority || b.score - a.score);

    const chosen: ScoredSnippet[] = [];
    let used = 0;
    for (const snippet of ranked) {
      if (used + snippet.text.length > opts.budgetChars) continue;
      used += snippet.text.length;
      chosen.push(toSnippet(snippet));
    }
    return chosen;
  }

  /** A throwing or slow retriever contributes nothing rather than blocking. */
  private async runWithDeadline(
    retriever: ContextRetriever,
    req: CompletionRequest,
    deadlineMs: number,
    signal: AbortSignal,
  ): Promise<Ranked[]> {
    const timeout = new Promise<ScoredSnippet[]>((resolve) => {
      setTimeout(() => resolve([]), deadlineMs);
    });
    try {
      const snippets = await Promise.race([retriever.retrieve(req, deadlineMs, signal), timeout]);
      return snippets.map((s) => ({ ...s, priority: retriever.priority }));
    } catch {
      return [];
    }
  }
}

function toSnippet(r: Ranked): ScoredSnippet {
  return { text: r.text, score: r.score, sourcePath: r.sourcePath, kind: r.kind };
}

function dedupeByText(snippets: readonly Ranked[]): Ranked[] {
  const seen = new Set<string>();
  const out: Ranked[] = [];
  for (const s of snippets) {
    const key = s.text.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
