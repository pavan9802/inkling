# Phase 2 Design — Inkling

> **Implementation cadence:** each numbered step is implemented and verified independently before
> the next step begins. Do not batch steps.

## Context

Phase 1 shipped a working MVP: the extension produces ghost-text completions end-to-end. The core
pipeline, cache, gate, debouncer, and open-tabs retriever are all in place. The main limitations the
user directly felt after Phase 1 are:

1. **Latency** — ~875ms perceived, dominated by model inference. The debounce fix helped, but the
   real lever is showing the first line of ghost text in ~150ms rather than waiting for full
   generation (~800ms). That requires streaming.

2. **Context quality** — Open-tabs Jaccard scoring is lexical and language-agnostic. It can find
   related files but cannot answer "what does this symbol mean?" Symbol-level context from the LSP
   is the highest-quality signal available without a workspace index.

3. **Language coverage** — Only Java, TypeScript, TSX, JavaScript, JSX have profiles. Python, Go,
   and Rust fall back to the generic profile which has no language-specific block openers or comment
   syntax.

4. **Routing** — A single model is used for every request. ADR-0008 (just merged) specifies a
   `ModelRouter` that picks the fast (3b) or quality (7b) model based on the complexity of the
   request, so simple completions stay fast while complex ones get a better model when the budget
   allows.

5. **Eval corpus** — 8 fixture cases produce results with ±1.2% run-to-run variance, making
   similarity gates statistically meaningless. Phase 2 must expand to ≥ 50 cases before quality
   comparisons are reliable.

Phase 2 closes all five gaps. Everything deferred to Phase 3 (workspace index, BM25, telemetry
storage, ImportRetriever) requires the Phase 2 seams to already be stable — so Phase 2 is
intentionally scoped to avoid that work.

---

## What is in Phase 2

| # | Component | Package | Why now |
|---|---|---|---|
| 1 | Language profiles: Python, Go, Rust | core | 30-min wins; removes generic-fallback degradation for three major languages |
| 2 | Eval corpus expansion (≥ 50 cases) | eval | Required before any Phase 2 quality gate is meaningful |
| 3 | `OllamaBackend.stream()` | core | Implements the `stream?()` seam already in `CompletionBackend` |
| 4 | `CompletionPipeline.stream()` | core | Orchestrates streaming with the same post-processing as `run()` |
| 5 | Streaming `InlineProvider` path | extension | "First line in ~150ms, rest buffered" UX that addresses the felt latency |
| 6 | `LspRetriever` | extension | Highest-quality context source available without a workspace index |
| 7 | `ModelRouter` (ADR-0008) | core | Selects fast vs quality backend per request; config-driven |
| 8 | `ResolvedConfig.routing` field | core/extension/eval | Required config shape for ModelRouter; maps in both adapters |

### Deferred to Phase 3

| Component | Reason |
|---|---|
| `ImportRetriever` | Static import traversal adds moderate signal; LspRetriever gives higher quality with less complexity. Defer until LSP usage patterns are understood. |
| `WorkspaceIndexRetriever` | Requires a background BM25 indexer and file-watcher — Phase 3 scope per the design. |
| Acceptance telemetry storage | The `inkling.accepted` seam is already wired (no-op log). Phase 3 adds structured storage when retriever weighting is ready to use it. |
| Structured telemetry events | Depends on Phase 3 acceptance rate data to weight retriever scoring. |

---

## Step-by-step Implementation Guide

### Step 1 — Language profiles: Python, Go, Rust + Java refinement
**File:** `packages/core/src/language/profiles.ts`

Add three new entries to the `PROFILES` map and review the existing Java profile. No other file
changes needed — `getLanguageProfile()` already handles unknown IDs with the generic fallback, so
adding entries is purely additive.

**New languages:**
```
python:  lineComment '#'  blockOpeners [':', '(', '[']    stopSequences ['\n\n']  maxMultilineLines 12
go:      lineComment '//' blockOpeners ['{', '(', '[']    stopSequences ['\n\n']  maxMultilineLines 10
rust:    lineComment '//' blockOpeners ['{', '(', '[', '=>'] stopSequences ['\n\n'] maxMultilineLines 10
```

**Why Python uses `:`:** `def foo():`, `if x:`, `for i in ...:` all end with `:` as the block
opener — analogous to `{` in C-style languages. The `:` is the signal that an indented block follows.

**Why Python gets maxMultilineLines 12 vs 8 (generic):** Python functions tend to have longer bodies
with explicit return statements; cutting at 8 lines truncates most real functions.

**Java refinement:** Java already exists. Raise `maxMultilineLines` from 8 → 12 — Java method bodies
regularly exceed 8 lines due to verbosity (type annotations, getters/setters, try/catch blocks).

**Tests:** `packages/core/test/profiles.test.ts` — assert correct profiles for `'python'`, `'go'`,
`'rust'`, `'java'` and that `getLanguageProfile('unknown')` returns the generic fallback.

---

### Step 2 — Eval corpus expansion
**Directory:** `packages/eval/fixtures/`

Add ≥ 42 new fixture files (to reach ≥ 50 total). Each is a JSON `HoleCase`:
`{ file, prefix, suffix, expected }`.

Source cases from:
- The new Python/Go/Rust profiles: at least 5 cases each
- More TypeScript core files (the current 8 all come from `core/src/` — carve holes in
  `extension/` and `eval/` files too)
- Edge cases: empty suffix, long multi-line expected, single-char expected

**Why before streaming/LSP:** With 8 cases the error bar is ±1.2% per run. With 50 cases it drops
to ±0.5%, making regression detection meaningful. Running the eval before and after each remaining
step provides reliable signal.

---

### Step 3 — `OllamaBackend.stream()`
**File:** `packages/core/src/backend/ollama.ts`

Implement the `stream?()` seam declared in `CompletionBackend`:

```
POST /api/generate  with  stream: true
Response: newline-delimited JSON — each line is { response: string, done: boolean }
```

Read the response body as a `ReadableStream`, decode line-by-line, parse each JSON object, and
`yield data.response` for every chunk until `data.done === true`.

**Why `raw: true` stays:** We own the FIM prompt format and must bypass Ollama's server-side
templating (ADR-0002).

**Error handling:** Throw on non-OK HTTP (consistent with `listModels()`). The caller (pipeline)
handles it.

**Tests:** `packages/core/test/ollama-stream.test.ts` — mock fetch with a sequence of JSON lines,
assert the generator yields in order.

---

### Step 4 — `CompletionPipeline.stream()`
**File:** `packages/core/src/pipeline/index.ts`

Add a `stream(req, signal): AsyncIterable<PipelineResult>` method alongside `run()`.

Steps 1–6 are identical to `run()` (config snapshot, cache check, assemble, resolve mode, detect
family, build prompt). Step 6 calls `this.backend.stream()` instead of `complete()`.

**Streaming post-processing loop:**
- Accumulate chunks; yield after each one (trimmed, line-limited)
- If stop sequence found → post-process final text, yield once, return
- If line limit hit → yield capped text, return

**Cache pre-population:** After the stream completes, store the final text under
`(req.prefix + firstLine, req.suffix)` so the next invocation (after the user accepts the first
line) is an instant cache hit — the "next block ready" behaviour.

---

### Step 5 — Streaming `InlineProvider` path
**File:** `packages/extension/src/provider/inline-provider.ts`

After debounce, check `this.getPipeline().backend.stream != null`:

1. Call `pipeline.stream(req, signal)` → `AsyncIterable<PipelineResult>`
2. Await `gen.next()` → first result (first complete line, ~150ms)
3. Detached background IIFE drains the rest so cache pre-population runs to completion
4. Return the first result as the `InlineCompletionItem`

**Non-streaming fallback:** if `backend.stream` is absent, fall through to `run()` path unchanged.

**Why not update ghost text progressively:** VS Code's `InlineCompletionItemProvider` returns a
static list — there is no API to mutate current ghost text. Show first line fast, pre-cache rest,
let the next invocation deliver the rest instantly from cache.

---

### Step 6 — `LspRetriever`
**File:** `packages/extension/src/retrievers/lsp-retriever.ts`

Implements `ContextRetriever` with `id = 'lsp'` and `priority = 20`.

**Algorithm:**
1. Extract the word at cursor from the tail of `req.prefix`
2. Find the active `TextDocument` by `req.uri`
3. Compute position via `doc.positionAt(req.prefix.length)`
4. Call `vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, position)`
   — race against `setTimeout(deadlineMs)` (ADR-0003)
5. For each `LocationLink` (cap at 3): extract ±20 lines around the definition, push
   `ScoredSnippet` with `score: 1.0, kind: 'lsp'`

**Why score 1.0:** Definition snippets are semantically exact matches, not probabilistic.

**Why priority 20:** Ensures LSP gets first pick of the budget while open-tabs fills remaining space.

**Registration:** Add `new LspRetriever()` to the assembler in `extension.ts` only when
`config.retrievers.lsp === true`.

---

### Step 7 — `ModelRouter` (ADR-0008)
**New file:** `packages/core/src/routing/router.ts`

```typescript
interface ModelRouter {
  selectModel(req: CompletionRequest, config: ResolvedConfig): string;
}
```

**Three routing modes (via `config.routing.budget`):**

- `'latency'` → **FixedRouter** — always returns `fastModel`. Default for the fast profile.
- `'quality'` → **FixedRouter** — always returns `qualityModel`. For GPU boxes.
- `'auto'` → **RequestRouter** — inspects the request. Signals examined in order:
  1. **Prefix complexity** — if `req.prefix` line count > `complexityThreshold` (default 50), use quality model
  2. **Language signal** — Java and Go have more boilerplate, benefit more from quality model
  3. **Latency guard** — if rolling p50 of recent completions exceeds 1 500 ms, fall back to fast model

**Why in core, not extension:** Pure logic, no VS Code APIs. The eval CLI can also route, giving
accurate per-model benchmark numbers.

**Tests:** `packages/core/test/router.test.ts` — unit tests for all three budget modes, complexity
threshold boundary, and latency-guard fallback.

---

### Step 8 — `ResolvedConfig.routing` in both adapters

Add to `ResolvedConfig`:
```typescript
routing: {
  budget: 'latency' | 'quality' | 'auto';
  complexityThreshold: number;
  fastModel: string;
  qualityModel: string;
};
```

**`extension/src/config/from-vscode.ts`:** Read `inkling.routing.*` from VS Code settings and
merge onto the profile base.

**`eval/src/cli.ts`:** Accept `--routing-budget` and `--quality-model` CLI flags.

---

## Phase gate

| Criterion | Target | How to verify |
|---|---|---|
| Edit similarity | ≥ Phase-1 mean (0.511) on ≥ 50 cases | `bun run packages/eval/src/cli.ts --corpus fixtures --model qwen2.5-coder:3b` |
| First-token latency | ≤ 300 ms | Log `Date.now()` at first `gen.next()` in InlineProvider streaming path |
| p50 full latency | ≤ 1 100 ms (Phase-1 p50 + 10% tolerance) | Eval report |
| CI | lint + tests + `.vsix` build pass | `bun test && bun run --cwd packages/extension package` |
| Manual: streaming | Ghost text appears in < 400 ms on a `.ts` file | Open VS Code, type inside a function body |
| Manual: LSP | Definition snippet appears in output channel log | Enable trace in LspRetriever |
| Manual: routing | `inkling.routing.budget = 'quality'` selects 7b model | Set config, trigger completion, watch Ollama logs |

---

## File change map

| File | Change type |
|---|---|
| `packages/core/src/language/profiles.ts` | Add Python, Go, Rust; refine Java (maxMultilineLines 8 → 12) |
| `packages/core/src/config/types.ts` | Add `routing` to `ResolvedConfig` |
| `packages/core/src/config/profiles.ts` | Populate `routing` defaults |
| `packages/core/src/backend/ollama.ts` | Implement `stream()` |
| `packages/core/src/pipeline/index.ts` | Add `stream()` method + router call |
| `packages/core/src/routing/router.ts` | New: `ModelRouter` |
| `packages/core/src/index.ts` | Export new modules |
| `packages/extension/src/extension.ts` | Construct `LspRetriever`, `ModelRouter`; pass to pipeline |
| `packages/extension/src/provider/inline-provider.ts` | Add streaming path |
| `packages/extension/src/retrievers/lsp-retriever.ts` | New: `LspRetriever` |
| `packages/extension/src/config/from-vscode.ts` | Map `routing` fields |
| `packages/eval/src/cli.ts` | Accept routing flags |
| `packages/eval/fixtures/` | Add ≥ 42 new fixture JSON files |
| `packages/core/test/profiles.test.ts` | New: Python/Go/Rust/Java profile tests |
| `packages/core/test/ollama-stream.test.ts` | New: `stream()` mock test |
| `packages/core/test/router.test.ts` | New: routing logic tests |
| `docs/phase2-design.md` | This document |
