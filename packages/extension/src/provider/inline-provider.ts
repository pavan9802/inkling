import * as vscode from 'vscode';
import type { ContextAssembler, ResolvedConfig, CompletionBackend } from '@inkling/core';

/**
 * The VS Code inline completion provider. In Phase 0 it wires the pipeline's
 * shape but returns nothing; Phase 1 fills in the steps noted below.
 */
export class InlineProvider implements vscode.InlineCompletionItemProvider {
  constructor(
    private readonly getConfig: () => ResolvedConfig,
    private readonly assembler: ContextAssembler,
    private readonly backend: CompletionBackend,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = this.getConfig();
    if (!config.enabled) return undefined;

    // TODO(phase-1) pipeline:
    //   1. gate (language enabled, not a secret file, sensible position)
    //   2. debounce + bridge CancellationToken -> AbortController
    //   3. completion cache lookup (prefix/suffix hash)
    //   4. this.assembler.assemble(...) under config.deadlineMs
    //   5. buildCompletionPrompt(...) via the FIM registry
    //   6. this.backend.complete(...) with stop/maxTokens/temperature
    //   7. post-process, then return [new vscode.InlineCompletionItem(text)]
    void document;
    void position;
    void this.assembler;
    void this.backend;
    return undefined;
  }
}
