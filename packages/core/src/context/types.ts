/**
 * Context pipeline (ADR-0003).
 *
 * Every cross-file context source — open tabs, LSP, workspace index, embeddings —
 * is a `ContextRetriever`. New sources are new implementations registered into
 * the `ContextAssembler`; nothing else in the pipeline changes.
 */

/** A backend-agnostic request to complete at a cursor position. */
export interface CompletionRequest {
  /** URI/path string of the active document. */
  readonly uri: string;
  /** Language id (see LanguageProfile.id). */
  readonly languageId: string;
  /** Text before the cursor (already budget-trimmed by the caller). */
  readonly prefix: string;
  /** Text after the cursor (already budget-trimmed by the caller). */
  readonly suffix: string;
  /** Workspace root, if the document belongs to one. */
  readonly workspaceRoot?: string;
}

export type SnippetKind = 'open-tab' | 'lsp' | 'import' | 'index' | 'embedding';

/** A relevant piece of cross-file context, scored 0..1. */
export interface ScoredSnippet {
  readonly text: string;
  readonly score: number;
  readonly sourcePath: string;
  readonly kind: SnippetKind;
}

export interface ContextRetriever {
  /** Stable identifier, e.g. `open-tabs`. */
  readonly id: string;
  /** Higher priority is assembled first and preferred under budget pressure. */
  readonly priority: number;
  /**
   * Return relevant snippets. MUST honor `deadlineMs` and `signal`: a slow
   * retriever must never block a completion (the assembler also races a timeout).
   */
  retrieve(req: CompletionRequest, deadlineMs: number, signal: AbortSignal): Promise<ScoredSnippet[]>;
}
