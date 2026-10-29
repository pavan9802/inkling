import * as vscode from 'vscode';
import {
  ContextAssembler,
  OllamaBackend,
  CompletionPipeline,
  FixedRouter,
  RequestRouter,
  type ModelCandidate,
  type ResolvedConfig,
} from '@inkling/core';
import { resolveConfigFromVsCode } from './config/from-vscode.js';
import { OpenTabsRetriever } from './retrievers/open-tabs.js';
import { LspRetriever } from './retrievers/lsp-retriever.js';
import { InlineProvider } from './provider/inline-provider.js';
import { StatusBar } from './ui/status-bar.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Inkling');
  context.subscriptions.push(output);

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const getConfig = () => resolveConfigFromVsCode();
  let config = getConfig();

  // assembler, router, and pipeline are all `let` — onDidChangeConfiguration
  // rebuilds them so retriever toggles (e.g. lsp: false → true on profile switch)
  // take effect without re-registering the provider.
  let assembler = buildAssembler(config);
  let router = buildRouter(config);
  let pipeline = new CompletionPipeline(assembler, router, getConfig);

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
      const models = await router.listModels?.();
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
      // Rebuild all three so retriever toggles, model changes, and endpoint
      // changes all take effect immediately. Rebuilding the pipeline also
      // discards the cache — stale completions from the old model are irrelevant.
      assembler = buildAssembler(config);
      router = buildRouter(config);
      pipeline = new CompletionPipeline(assembler, router, getConfig);
      statusBar.update(config.enabled, config.model);
    }),
  );
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions.
}

// Constructs the router from the routing section of the config.
// Called on activate and on every config change so model and budget changes
// take effect immediately (ADR-0008).
function buildRouter(config: ResolvedConfig) {
  const { routing } = config;
  const fastBackend = new OllamaBackend({ endpoint: config.endpoint, model: routing.fastModel, keepAlive: '30m' });
  const fast: ModelCandidate = { model: routing.fastModel, backend: fastBackend };

  if (routing.budget === 'latency') return new FixedRouter(fast);

  const qualityBackend = new OllamaBackend({ endpoint: config.endpoint, model: routing.qualityModel, keepAlive: '30m' });
  const quality: ModelCandidate = { model: routing.qualityModel, backend: qualityBackend };

  if (routing.budget === 'quality') return new FixedRouter(quality);

  // 'auto': RequestRouter picks per-request based on complexity and p50 guard.
  return new RequestRouter(fast, quality);
}

// Constructs the assembler with the correct retriever set for the given config.
// Called on activate and on every config change so retriever toggles take effect.
function buildAssembler(config: ResolvedConfig): ContextAssembler {
  const retrievers = [];
  if (config.retrievers.openTabs) retrievers.push(new OpenTabsRetriever());
  // LspRetriever is only active on quality profile or when explicitly enabled —
  // it adds an extra LSP round-trip per completion which is unnecessary for fast.
  if (config.retrievers.lsp) retrievers.push(new LspRetriever());
  return new ContextAssembler(retrievers);
}
