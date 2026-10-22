# Inkling Phase 1 Design Spec

Oct 17, 2026 · @Pavan

## Goals & scope

Phase 1 ships the usable MVP — the first version that produces ghost text in the editor. Every component either runs today or sets up a seam that a later phase fills without a rewrite.

### Deliverables

| Component | Package | Description |
| --- | --- | --- |
| `CompletionPipeline` | core | Orchestrates steps 3–7: cache → assemble → prompt → complete → post-process |
| `CompletionCache` | core | In-memory cache with TTL and typed-through detection |
| `SecretFileFilter` | core | Predicate for `.env`, `*.pem`, `*.key` — shared by gate and retrievers |
| `MultilineDecision` | core | Resolves single vs. multi-line mode from prefix tail + language profile |
| `listModels()` seam | core | Optional on `CompletionBackend`; `OllamaBackend` implements via `/api/tags` |
| `InlineProvider` (full) | extension | Wires gate → debounce → pipeline → ghost text |
| `Debouncer` | extension | Bridges `CancellationToken` → `AbortController`; cancels in-flight HTTP requests |
| `GateChecker` | extension | Enabled, secret-file, and sensible-position checks |
| `OpenTabsRetriever` | extension | Lexical Jaccard scoring of open editors against the cursor window |
| `inkling.pickModel` | extension | QuickPick backed by `listModels()` |

### Deferred

- **Phase 2:** streaming ghost text, `LspRetriever`, `ImportRetriever`, more language profiles
- **Phase 3:** `WorkspaceIndexRetriever`, BM25 background indexer, acceptance telemetry storage

### Phase gate

All three must be green before Phase 2 begins.

| Criterion | Target | Phase-0 measured | Phase-1 measured |
| --- | --- | --- | --- |
| Edit similarity | ≥ Phase-0 (no regression) | 0.519 | 0.502 – 0.511 (within noise) |
| p50 latency | ≤ Phase-0 | 1 063 ms | 1 005 – 1 055 ms ✅ |
| p95 latency | ≤ Phase-0 | 1 789 ms | 1 769 – 1 884 ms (flat) |
| CI | lint + tests + `.vsix` build pass | — | ✅ |
| Manual | Ghost text in a `.ts` file; `.env` gets no completions | — | ✅ |

> **Corpus note:** the fixture set is 8 cases. At this size, one case changing its output moves the mean similarity by ~1.2%, making run-to-run variance (~0.017) larger than any real Phase-1 signal. The similarity gate is met within the noise floor. Phase 2 should expand the corpus to ≥ 50 cases before similarity comparisons are statistically meaningful.

## New core abstractions

Steps 3–7 of the completion flow are pure domain logic. Moving them into `core` keeps the extension thin, lets the eval CLI reuse the exact same path, and makes each component independently testable. Four abstractions land in `core/src/pipeline/`; one utility in `core/src/security/`.

### `CompletionPipeline`

The central orchestrator. `InlineProvider` calls `pipeline.run()` and handles only VS Code surface: gate, debounce, and presenting the result.

```typescript
// core/src/pipeline/index.ts
interface PipelineResult {
  readonly text: string;
  readonly fromCache: boolean;
  readonly latencyMs: number;
}

class CompletionPipeline {
  constructor(
    assembler: ContextAssembler,
    backend: CompletionBackend,
    getConfig: () => ResolvedConfig,
  )
  run(req: CompletionRequest, signal: AbortSignal): Promise<PipelineResult | null>
  // Phase 2: stream(req, signal): AsyncIterable<string>
}
```

Steps inside `run`:

1. Snapshot `config`
2. Cache lookup → return early on hit
3. `assembler.assemble()` under `config.deadlineMs`
4. `resolveCompletionMode(prefix, profile, config.multiline)`
5. `buildCompletionPrompt({ req, snippets, profile, family })`
6. `backend.complete({ prompt, stop, maxTokens, temperature, signal })`
7. `truncateAtStop` → `trimSuffixOverlap` → enforce single/multi-line → `isLowValue` check
8. `cache.set(prefix, suffix, text)`
9. Return `PipelineResult` or `null` if step 7 rejects

The eval CLI's hot loop can replace its hand-rolled steps with a single `pipeline.run()` call once this exists.

### `CompletionCache`

In-memory cache keyed on `(prefix, suffix)` with TTL and typed-through detection.

```typescript
// core/src/pipeline/cache.ts
class CompletionCache {
  constructor(maxSize: number, ttlMs: number)
  get(prefix: string, suffix: string): string | undefined
  set(prefix: string, suffix: string, completion: string): void
  tryTypedThrough(newPrefix: string, oldPrefix: string, suffix: string): string | undefined
}
```

**Typed-through:** when the user types the first character of the suggestion, `newPrefix = oldPrefix + char`. If `char === completion[0]` and `suffix` is unchanged, the remaining completion is `completion.slice(1)` — no round-trip needed. `tryTypedThrough` checks this and returns the trimmed remainder or `undefined`.

### `SecretFileFilter`

```typescript
// core/src/security/secret-filter.ts
function isSecretFile(filePath: string, extraPatterns?: readonly string[]): boolean
```

Default-excluded: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `*secret*`, `*credential*`. Lives in `core` (not `extension`) so both `GateChecker` and `OpenTabsRetriever` use the same logic without importing `vscode`. Phase 2 threads `config.secretPatterns` into `extraPatterns`.

### `MultilineDecision`

```typescript
// core/src/language/multiline.ts
interface CompletionMode {
  readonly multiline: boolean;
  readonly stopSequences: readonly string[];
  readonly maxLines: number;
}

function resolveCompletionMode(
  prefix: string,
  profile: LanguageProfile,
  configMode: MultilineMode,
): CompletionMode
```

Auto heuristic: scan the trailing non-whitespace of `prefix`. If it ends with a `profile.blockOpeners` entry (`{`, `(`, `[`, `=>`) → multiline up to `profile.maxMultilineLines`. Otherwise → single-line, stop at `\n`. `config.multiline = 'always' | 'off'` overrides the heuristic. Pure function — directly unit-testable.

### `listModels()` seam

```typescript
// core/src/backend/types.ts — added to CompletionBackend
listModels?(): Promise<string[]>  // optional; not all backends enumerate models
```

`OllamaBackend` implements it via `GET /api/tags → models[].name`. The model picker calls `backend.listModels?.()`. Keeping it optional means a new backend never requires implementing model enumeration.

## Extension wiring

&#91;embedded content: completion flow · 4 stages · 3 bail points\]

Gate → debounce → pipeline → present: three bail points return `undefined`; only a live `PipelineResult` reaches VS Code.

### `Debouncer`

Holds one `AbortController`. On each `provideInlineCompletionItems` call:

1. `this.controller?.abort()` — cancels any in-flight request at the HTTP layer
2. Creates a new `AbortController`
3. Bridges `token.onCancellationRequested` → `controller.abort()`
4. Waits `debounceMs` ms; resolves with the live signal or rejects if aborted first

The abort reaches `fetch()` via the `signal` threaded through `pipeline.run()` → `backend.complete()`, so cancelled requests don’t hold open connections.

### `GateChecker`

Checks in order, cheapest first:

1. `config.enabled` — toggle off?
2. `isSecretFile(document.uri.fsPath)` — `.env`, `*.pem`, `*.key`, etc.
3. `config.perLanguage[languageId]?.enabled ?? true` — per-language opt-out
4. Position heuristic — regex on prefix tail to skip mid-string and comment positions

### `OpenTabsRetriever`

Scores every open editor against ±50 lines centred on the cursor by Jaccard token overlap. Language-agnostic.

1. **Query window** — tokenise the cursor window (split `\W+`, lowercase, drop tokens < 3 chars)
2. **Per open editor** (skip active document, skip `isSecretFile`):
   - Chunk into 200-char windows at 50% overlap
   - Score each chunk: `|Q ∩ C| / |Q ∪ C|`
   - Keep the highest-scoring chunk
3. Filter `score < 0.05`, sort descending, return top 5 as `ScoredSnippet[]` with `kind: 'open-tab'`

Phase 2’s `LspRetriever` replaces lexical overlap with symbol resolution behind the same `ContextRetriever` interface.

### `inkling.pickModel`

Calls `backend.listModels?.()` and shows a `vscode.window.showQuickPick`. The `?.()` optional-call means non-Ollama backends that omit `listModels` show a warning, not a throw. The chosen model writes to `inkling.model` in machine-scoped settings, so the Mac and GPU box differ by config alone.

## Future-proofing

Phase 1’s seams are chosen to make Phase 2 and Phase 3 additive — no rewrites, only registrations.

### Phase 2: streaming + symbol context

**Streaming.** `CompletionBackend` gains an optional `stream?(): AsyncIterable<string>` method alongside `complete`. `InlineProvider` checks `backend.stream != null` and calls it instead; the `AbortController` signal threads through unchanged. `CompletionCache` typed-through detection works identically — it operates on the growing prefix of the streamed text, not on the completed result.

**Symbol context.** `LspRetriever` implements `ContextRetriever` in `extension`, calls `vscode.commands.executeCommand('vscode.executeDefinitionProvider', …)` for the identifier under the cursor, and reads the target file’s relevant slice. `ContextAssembler` already accepts an array of retrievers — add one, nothing else changes.

### Phase 3: workspace index

`WorkspaceIndexRetriever` implements `ContextRetriever`. The deadline contract (`signal` / `timeoutMs`) is already the interface’s primary constraint, so the indexer can run a BM25 or embedding query and abandon it cleanly if the budget expires. `SecretFileFilter` lives in `core` today, so the indexer respects it without any plumbing change.

`ResolvedConfig` already carries `maxSnippets` and `maxSnippetChars` — the budget knobs the assembler uses to cap context. Phase 3 adds `workspaceIndexPath` by extending the config shape and its two adapters (`extension` and `eval`); no core logic changes.

### Acceptance telemetry seam

Each `InlineCompletionItem` carries a `.command` field — VS Code fires it on acceptance. Phase 1 wires a no-op `inkling.accepted` command and logs `{model, latencyMs, docLanguageId}` to the output channel. Phase 2 adds a structured event emitter behind the same command; Phase 3 uses acceptance rate to weight retriever scoring. The seam costs nothing now and avoids a retrofit later.

### `listModels` and multi-backend

`CompletionBackend.listModels?()` is optional by design. A future `LlamaFileBackend` or `LMStudioBackend` implements `CompletionBackend` and optionally provides `listModels`. `inkling.pickModel` already handles the absent case with a warning. Adding a backend is one file in `core`, one registration in `extension` — no provider changes.
