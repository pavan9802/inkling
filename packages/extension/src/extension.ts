import * as vscode from 'vscode';
import { ContextAssembler, OllamaBackend, CompletionPipeline } from '@inkling/core';
import { resolveConfigFromVsCode } from './config/from-vscode.js';
import { OpenTabsRetriever } from './retrievers/open-tabs.js';
import { InlineProvider } from './provider/inline-provider.js';
import { StatusBar } from './ui/status-bar.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Inkling');
  context.subscriptions.push(output);

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  // assembler is const — the retriever list doesn't change at runtime.
  const assembler = new ContextAssembler([new OpenTabsRetriever()]);

  const getConfig = () => resolveConfigFromVsCode();
  let config = getConfig();

  // backend and pipeline are `let` because onDidChangeConfiguration rebuilds
  // them when the model or endpoint changes. The provider captures them through
  // the `() => pipeline` closure, so it always uses the current instance.
  let backend = new OllamaBackend({ endpoint: config.endpoint, model: config.model, keepAlive: '30m' });
  let pipeline = new CompletionPipeline(assembler, backend, getConfig);

  statusBar.update(config.enabled, config.model);

  const provider = new InlineProvider(getConfig, () => pipeline);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider),
  );

  context.subscriptions.push(
    // Acceptance telemetry seam — currently logs to the output channel.
    // Phase 2 replaces the log line with a structured event emitter behind the
    // same command ID, so the InlineCompletionItem.command wiring never changes.
    vscode.commands.registerCommand('inkling.accepted', (meta: { model: string; latencyMs: number; languageId: string }) => {
      output.appendLine(`[accepted] model=${meta.model} latency=${meta.latencyMs}ms lang=${meta.languageId}`);
    }),

    vscode.commands.registerCommand('inkling.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('inkling');
      await cfg.update('enabled', !cfg.get<boolean>('enabled', true), true);
      config = getConfig();
      statusBar.update(config.enabled, config.model);
    }),

    vscode.commands.registerCommand('inkling.pickModel', async () => {
      // Optional-call: non-Ollama backends that omit listModels show a warning
      // rather than throwing, so adding a new backend never requires implementing
      // model enumeration.
      const models = await backend.listModels?.();
      if (!models) {
        void vscode.window.showWarningMessage('Inkling: this backend does not support model listing.');
        return;
      }
      const picked = await vscode.window.showQuickPick(models, {
        placeHolder: 'Select a model',
        title: 'Inkling: Pick Model',
      });
      if (!picked) return;
      // Global scope writes to machine-scoped settings so the Mac and a GPU box
      // can carry different models while sharing the same user settings.
      await vscode.workspace.getConfiguration('inkling').update(
        'model',
        picked,
        vscode.ConfigurationTarget.Global,
      );
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('inkling')) return;
      config = getConfig();
      // Rebuild backend and pipeline so the new model/endpoint takes effect.
      // Rebuilding the pipeline also discards the cache — stale completions from
      // the old model are irrelevant to the new one.
      backend = new OllamaBackend({ endpoint: config.endpoint, model: config.model, keepAlive: '30m' });
      pipeline = new CompletionPipeline(assembler, backend, getConfig);
      statusBar.update(config.enabled, config.model);
    }),
  );
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions.
}
