import * as vscode from 'vscode';
import { ContextAssembler, OllamaBackend } from '@inkling/core';
import { resolveConfigFromVsCode } from './config/from-vscode.js';
import { OpenTabsRetriever } from './retrievers/open-tabs.js';
import { InlineProvider } from './provider/inline-provider.js';
import { StatusBar } from './ui/status-bar.js';

/**
 * Activation wiring only — no business logic lives here (ADR-0001 keeps the
 * logic in @inkling/core). Phase 0 assembles the object graph; the provider
 * returns nothing until Phase 1.
 */
export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const assembler = new ContextAssembler([new OpenTabsRetriever()]);

  const getConfig = () => resolveConfigFromVsCode();
  let config = getConfig();

  const backend = new OllamaBackend({
    endpoint: config.endpoint,
    model: config.model,
    keepAlive: '30m',
  });

  statusBar.update(config.enabled, config.model);

  const provider = new InlineProvider(getConfig, assembler, backend);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('inkling.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('inkling');
      await cfg.update('enabled', !cfg.get<boolean>('enabled', true), true);
      config = getConfig();
      statusBar.update(config.enabled, config.model);
    }),
    vscode.commands.registerCommand('inkling.pickModel', async () => {
      // TODO(phase-1): query {endpoint}/api/tags and offer a QuickPick.
      void vscode.window.showInformationMessage('Inkling: model picker arrives in Phase 1.');
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('inkling')) return;
      config = getConfig();
      statusBar.update(config.enabled, config.model);
    }),
  );
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions.
}
