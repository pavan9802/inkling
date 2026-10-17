import * as vscode from 'vscode';
import { notImplemented, type CompletionRequest, type ContextRetriever, type ScoredSnippet } from '@inkling/core';

/**
 * Phase-1 context source: snippets from other open editors, ranked by lexical
 * overlap with the text around the cursor. Language-agnostic.
 *
 * Phase 0: implements the `ContextRetriever` seam; retrieval is stubbed.
 */
export class OpenTabsRetriever implements ContextRetriever {
  readonly id = 'open-tabs';
  readonly priority = 10;

  async retrieve(_req: CompletionRequest, _deadlineMs: number, _signal: AbortSignal): Promise<ScoredSnippet[]> {
    // TODO(phase-1): read vscode.window.visibleTextEditors / tabGroups,
    // window the cursor context, score other docs by token overlap, return top-k.
    void vscode;
    return notImplemented('OpenTabsRetriever.retrieve');
  }
}
