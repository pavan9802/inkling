import * as vscode from 'vscode';
import { type CompletionRequest, type CompletionPipeline, type ResolvedConfig } from '@inkling/core';
import { Debouncer } from './debouncer.js';
import { GateChecker } from './gate-checker.js';

export class InlineProvider implements vscode.InlineCompletionItemProvider {
  private readonly debouncer = new Debouncer();
  private readonly gate = new GateChecker();

  constructor(
    private readonly getConfig: () => ResolvedConfig,
    // Getter rather than a direct reference so extension.ts can swap the
    // pipeline on config changes without re-registering the provider.
    private readonly getPipeline: () => CompletionPipeline,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = this.getConfig();

    // Stage 1 — gate: enabled check, secret-file check, position heuristic.
    if (!this.gate.check(config, document, position)) return undefined;

    // Stage 2 — debounce: wait debounceMs, abort any prior in-flight request.
    // The resolved signal is threaded through the pipeline into fetch() so
    // cancellation reaches the network layer, not just the JS promise chain.
    let signal: AbortSignal;
    try {
      signal = await this.debouncer.debounce(config.debounceMs, token);
    } catch {
      return undefined;
    }

    // Stage 3 — build the request with budget-trimmed prefix/suffix.
    // Math.max(0, …) guards against documents shorter than prefixChars.
    const fullText = document.getText();
    const offset = document.offsetAt(position);
    const prefix = fullText.slice(Math.max(0, offset - config.budgets.prefixChars), offset);
    const suffix = fullText.slice(offset, offset + config.budgets.suffixChars);

    const req: CompletionRequest = {
      uri: document.uri.fsPath,
      languageId: document.languageId,
      prefix,
      suffix,
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    };

    // Stage 4 — pipeline: cache → assemble → prompt → complete → post-process.
    // Any backend exception (network, unknown model family) returns undefined
    // rather than surfacing an error to the user mid-typing.
    let result;
    try {
      result = await this.getPipeline().run(req, signal);
    } catch {
      return undefined;
    }

    if (!result) return undefined;

    const item = new vscode.InlineCompletionItem(result.text);
    return [item];
  }

  dispose(): void {
    this.debouncer.dispose();
  }
}
