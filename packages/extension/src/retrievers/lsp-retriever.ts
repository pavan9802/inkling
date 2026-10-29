import * as vscode from 'vscode';
import { isSecretFile, type CompletionRequest, type ContextRetriever, type ScoredSnippet } from '@inkling/core';

/**
 * Retrieves definition snippets from the active language server.
 * Scored 1.0 (semantically exact) and priority 20 (above open-tabs: 10) so
 * LSP snippets are preferred under budget pressure but don't starve open-tabs.
 */
export class LspRetriever implements ContextRetriever {
  readonly id = 'lsp';
  readonly priority = 20;

  async retrieve(req: CompletionRequest, deadlineMs: number, signal: AbortSignal): Promise<ScoredSnippet[]> {
    if (signal.aborted) return [];

    // Skip if the cursor isn't on an identifier — definition provider returns
    // nothing useful for whitespace or punctuation positions.
    if (!lastIdentifier(req.prefix)) return [];

    // Open the document so VS Code can resolve its language server.
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.uri));
    } catch {
      return [];
    }

    if (signal.aborted) return [];

    // req.prefix.length is the byte offset from document start to the cursor.
    // positionAt converts it to the (line, character) pair the LSP expects.
    const position = doc.positionAt(req.prefix.length);

    // Race the LSP call against the deadline (ADR-0003) — a slow language
    // server must never block a completion. Resolve-with-empty on timeout,
    // consistent with how ContextAssembler handles slow retrievers.
    const timeout = new Promise<(vscode.Location | vscode.LocationLink)[]>((resolve) =>
      setTimeout(() => resolve([]), deadlineMs),
    );

    let defs: (vscode.Location | vscode.LocationLink)[];
    try {
      defs = await Promise.race([
        vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
          'vscode.executeDefinitionProvider',
          doc.uri,
          position,
        ),
        timeout,
      ]) ?? [];
    } catch {
      return [];
    }

    if (signal.aborted) return [];

    const snippets: ScoredSnippet[] = [];

    // Cap at 3 definitions — beyond that, the context budget fills with
    // less-relevant snippets and squeezes out open-tabs context.
    for (const def of defs.slice(0, 3)) {
      // LocationLink (modern API) has targetUri/targetRange;
      // Location (legacy) has uri/range. Handle both.
      const targetUri = 'targetUri' in def ? def.targetUri : def.uri;
      const targetRange = 'targetRange' in def ? def.targetRange : def.range;

      if (isSecretFile(targetUri.fsPath)) continue;

      let targetDoc: vscode.TextDocument;
      try {
        targetDoc = await vscode.workspace.openTextDocument(targetUri);
      } catch {
        continue;
      }

      // ±20 lines centred on the definition — enough to show the full
      // signature, doc comment, and a few lines of body for context.
      const startLine = Math.max(0, targetRange.start.line - 20);
      const endLine = Math.min(targetDoc.lineCount - 1, targetRange.end.line + 20);
      const text = targetDoc.getText(
        new vscode.Range(startLine, 0, endLine, targetDoc.lineAt(endLine).text.length),
      );

      snippets.push({
        text,
        // 1.0: definition snippets are semantically exact — not a probabilistic
        // similarity score — so they always rank above open-tabs snippets.
        score: 1.0,
        sourcePath: targetUri.fsPath,
        kind: 'lsp',
      });
    }

    return snippets;
  }
}

// Returns the last identifier token in the prefix, or '' if the cursor is on
// whitespace or punctuation. Used to skip the LSP call at non-identifier positions.
function lastIdentifier(prefix: string): string {
  return /[a-zA-Z_$][a-zA-Z0-9_$]*$/.exec(prefix)?.[0] ?? '';
}
