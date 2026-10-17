import { notImplemented, type CompletionRequest, type ContextRetriever, type ScoredSnippet } from '@inkling/core';

/**
 * Eval-side context source: reads sibling files from disk instead of VS Code
 * editors, implementing the same `ContextRetriever` interface the extension
 * uses. This is what lets the benchmark exercise the real prompt-building path
 * (ADR-0001 / ADR-0003).
 */
export class FilesystemContextRetriever implements ContextRetriever {
  readonly id = 'filesystem';
  readonly priority = 10;

  constructor(private readonly repoRoot: string) {}

  async retrieve(_req: CompletionRequest, _deadlineMs: number, _signal: AbortSignal): Promise<ScoredSnippet[]> {
    // TODO(phase-0 corpus): walk this.repoRoot, score files by overlap with the
    // cursor window, return top-k. Mirrors OpenTabsRetriever's scoring.
    void this.repoRoot;
    return notImplemented('FilesystemContextRetriever.retrieve');
  }
}
