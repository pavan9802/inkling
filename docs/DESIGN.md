# Inkling — Design Document

> Local-first inline code completion for VS Code, powered by a self-hosted LLM (Ollama).
> Status: **pre-implementation** (architecture only). Last updated: 2026-10-21.

This document is the single source of truth for *why* Inkling is built the way it is.
Decisions with lasting consequences are captured as ADRs under `docs/adr/` and referenced inline.

---

## 1. Goals & non-goals

### Goals
- **Fast, private ghost-text completions** from a model running on the developer's own machine. No code leaves the machine.
- **Quality through context.** Completion quality is dominated by what the model sees, so cross-file context is a first-class concern, not a bolt-on.
- **Language-agnostic core** with first-class support for the author's stack: **Java, TypeScript, React (TSX/JSX)**. Adding a language is a small profile, not a code change.
- **Publishable quality from day one:** clean abstractions, documented decisions, tests, measurable quality gates, CI.
- **Runs on two very different machines** (16GB Apple Silicon; Ryzen 7000 + RX 7900 XTX / ROCm) with no code differences — only configuration.

### Non-goals (for now)
- Chat, agentic multi-file edits, or refactoring. (Possible future on the same backend.)
- Model training or fine-tuning.
- Cloud or hosted inference.

These non-goals are revisited in §13.

---

## 2. Core principle: seams before implementations

The guiding rule of the whole project:

> **Every capability we'll want later gets its interface defined now, even if only the cheapest implementation ships first.**

Concretely this means three seams exist from the first commit, with a fourth proposed:

1. **`ContextRetriever`** — anything that supplies cross-file context (open tabs → LSP → workspace index → embeddings) is just a new implementation behind one interface. See ADR-0003.
2. **`CompletionBackend`** — Ollama is first; llama.cpp and any OpenAI-compatible server are future implementations behind one interface. See ADR-0007.
3. **`ResolvedConfig` + profiles** — all tuning flows through one resolved config object, so new settings are additive and never ripple into core logic. See ADR-0006.
4. **`ModelRouter`** *(proposed)* — picks which model candidate serves a request. The default `FixedRouter` always returns the configured model; adaptive policies are new implementations behind the same interface. See ADR-0008 and §8.1.

Getting these seams right now is the difference between "add a feature" and "rewrite" later.

---

## 3. Architecture

### 3.1 Package split (ADR-0001)

A monorepo (npm workspaces) with a hard boundary:

```
packages/
  core/        Pure TypeScript. MUST NOT import 'vscode'. Runs in plain Node.
               The brain: context assembly, prompt building, backend clients,
               post-processing, language profiles, config resolution, metrics types.
  extension/   VS Code glue. The only package that imports 'vscode'.
               Provider, debounce/cancel, status bar, commands, settings binding,
               and the vscode-backed ContextRetrievers (open tabs, LSP).
  eval/        Headless CLI. Imports core. Provides filesystem-backed
               ContextRetrievers over a sample repo. Measures quality + latency.
```

The crucial consequence: **`core` is testable and benchmarkable without VS Code.** The eval harness exercises the *exact* prompt-building and post-processing path the extension uses, because both import it from `core`. Only the *source* of context differs (VS Code APIs vs. the filesystem), and both implement the same `ContextRetriever` interface.

```
          ┌─────────────────────────────────────────────┐
          │                   core                        │
          │  ContextAssembler · PromptBuilder · FIM reg.  │
          │  CompletionBackend · PostProcessor · Config   │
          │  ModelRouter (proposed, ADR-0008)             │
          └───────▲───────────────────────────▲──────────┘
                  │ implements                 │ implements
        ┌─────────┴─────────┐        ┌─────────┴──────────┐
        │     extension     │        │        eval        │
        │ vscode retrievers │        │ filesystem retrievers│
        │ provider / UI     │        │ benchmark CLI       │
        └───────────────────┘        └────────────────────┘
```

### 3.2 The completion flow

```
VS Code invokes InlineCompletionItemProvider
        │
        ▼
[1] Gate         language enabled? not a secret file? sensible position?    ──► bail early
        │
        ▼
[2] Debounce     wait out the configured idle window; cancel any in-flight request
        │
        ▼
[3] Cache        hash(prefix, suffix) → recent result? typed-through detection  ──► serve from cache
        │
        ▼
[4] Route        ModelRouter picks a model candidate from cheap request signals
                 (FixedRouter = configured model; adaptive routing is opt-in, ADR-0008)
        │
        ▼
[5] Context      ContextAssembler runs all retrievers in parallel under a hard deadline,
                 dedupes, scores, fills the candidate's token budget by priority → ordered context block
        │
        ▼
[6] Prompt       PromptBuilder emits a FIM prompt: [context] + [file prefix] + [suffix]
                 using the selected candidate's family template (FIM registry)
        │
        ▼
[7] Backend      the candidate's CompletionBackend (Ollama) → /api/generate with raw FIM prompt,
                 stop tokens, num_predict cap, low temperature, keep_alive
        │
        ▼
[8] Post-process trim suffix overlap · single/multi-line enforcement · bracket balance ·
                 dedent · drop empty/repetitive · truncate at stop
        │
        ▼
[9] Present      InlineCompletionItem (ghost text)
        │
        ▼
[10] Metrics     record latency, shown, selected model + routing reason;
                 acceptance recorded on accept command (local only)
```

Steps 4–8 live entirely in `core`, in one shared pipeline function that both the extension and the eval CLI call (so eval measures exactly what users get). Steps 1–3, 9 and the VS Code-backed half of 5 live in `extension`.

---

## 4. Fill-in-the-middle (FIM) strategy

Completion from the prefix alone is dramatically worse than FIM, which shows the model code on **both** sides of the cursor. Inkling is FIM-first. This requires **code base models trained for FIM** (Qwen2.5-Coder, StarCoder2, DeepSeek-Coder, CodeLlama) — general instruct models (Gemma, Llama-Instruct) are not suitable for the completion path.

### 4.1 Template registry (ADR-0002)

Each model family uses different FIM sentinel tokens. We build the prompt **ourselves** and send it raw (`raw: true`), rather than relying on Ollama's server-side `suffix` templating. This gives us: portability across backends, control over *where cross-file context goes*, and the ability to use repo-level FIM formats. The registry maps a model-id pattern → family → template.

Token formats (to be **verified against each model's tokenizer at implementation time** — these move):

| Family | Prefix / Suffix / Middle sentinels | Repo-level context |
|---|---|---|
| Qwen2.5-Coder | `<\|fim_prefix\|>` `<\|fim_suffix\|>` `<\|fim_middle\|>` | `<\|repo_name\|>`, `<\|file_sep\|>` segments |
| StarCoder2 | `<fim_prefix>` `<fim_suffix>` `<fim_middle>` | `<repo_name>`, `<file_sep>` |
| DeepSeek-Coder | `<｜fim▁begin｜>` `<｜fim▁hole｜>` `<｜fim▁end｜>` | file concatenation |
| CodeLlama | `<PRE>` `<SUF>` `<MID>` (whitespace-sensitive) | file concatenation |

File-level shape (Qwen example): `<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>` and the model continues from `<|fim_middle|>`.

A model whose family is unknown to the registry is flagged in the UI as "FIM template unknown" rather than silently producing garbage.

---

## 5. Context pipeline (ADR-0003)

The single biggest quality lever. Designed as pluggable sources behind one interface:

```ts
interface ContextRetriever {
  readonly id: string;
  readonly priority: number;        // higher = assembled first / preferred
  retrieve(req: CompletionRequest, deadlineMs: number,
           signal: AbortSignal): Promise<ScoredSnippet[]>;
}

interface ScoredSnippet {
  text: string;
  score: number;                    // 0..1 relevance
  sourcePath: string;
  kind: 'open-tab' | 'lsp' | 'index' | 'embedding' | 'import';
}
```

The **`ContextAssembler`** (in `core`):
1. Runs all registered retrievers **in parallel** with a **hard per-cycle deadline** — a slow language server can never block a completion; whatever is ready within the deadline is used.
2. Dedupes overlapping snippets.
3. Sorts by (priority, score) and **fills a token budget**, highest first.
4. Emits an ordered context block for the prompt builder.

### 5.1 Retriever roadmap

| Retriever | Phase | Adds | Language-agnostic? |
|---|---|---|---|
| `OpenTabsRetriever` (lexical overlap vs. cursor window) | 1 | Cheap, strong baseline | Yes |
| `LspRetriever` (definitions/signatures via VS Code commands) | 2 | Precise symbol context | Yes (uses installed language extensions) |
| `ImportRetriever` (resolve current file's imports) | 2 | Definitions of what you use | Mostly |
| `WorkspaceIndexRetriever` (BM25 lexical index) | 3 | Files you never opened | Yes |
| `EmbeddingRetriever` (local embed model via Ollama) | later | Semantic recall | Yes |

**Decision on workspace indexing timing:** the *pipeline and the cheapest retriever* ship in Phase 1; the index itself is Phase 3. Because the seam exists from the start, Phase 3 is "register a new retriever," not a refactor. See §2.

### 5.2 Recompute cadence
Cross-file context is recomputed on **file switch and after meaningful edits / idle**, not per keystroke — it's stable within an editing burst. This is both a cost and a cache-correctness decision (see §7).

---

## 6. Prompt assembly & cache-stable ordering (ADR-0004)

The context block is placed **before** the current-file prefix:

```
[ cross-file context snippets ]   ← stable across keystrokes
[ current file: prefix ]          ← changes only at its tail as you type
<FIM middle sentinel>
[ current file: suffix ]
```

**Why:** llama.cpp/Ollama reuse the longest common *prefix* of the token stream between requests (prompt cache). Keystrokes change the tail of the file-prefix, so keeping the large, stable cross-file context at the **head** maximizes cache reuse and slashes prefill cost — the dominant latency term on Apple Silicon. This ordering is free to design now and expensive to retrofit.

---

## 7. Latency architecture

Ghost text feels broken much above ~1s. Levers, in order of impact:

- **Keep the model resident** (`keep_alive`) so there's no reload penalty. On 16GB this is why we default small (3B): a model evicted under memory pressure feels broken.
- **Cache-stable prompt ordering** (§6) to reuse prefill.
- **Cap output**: `num_predict` small; **stop at newline** for single-line contexts.
- **Debounce + cancellation**: a VS Code `CancellationToken` is bridged to an `AbortController` so superseded requests are actually aborted at the HTTP layer, not just ignored.
- **Completion cache** keyed on `(prefixHash, suffixHash)` with typed-through detection (if the user types exactly what we suggested, don't re-request).
- **Streaming** (Phase 2): stream tokens from Ollama and update the inline item progressively to cut *perceived* latency for multi-line blocks.
- **Model stickiness** (ADR-0008): when adaptive routing is on, prefer the model that is already resident and was used last. A cold model load costs seconds, and Ollama's prompt cache is per model, so switching models undoes the two levers above. Switch only on a strong signal.

**Latency targets** (to be baselined in Phase 0 on the 3B/Mac profile, then held as a regression gate): **p50 < 300ms, p95 < 600ms** time-to-suggestion for single-line. These are targets to validate, not promises.

### 7.1 Single vs. multi-line
A mid-line cursor → single-line completion (stop at newline). A cursor at the end of a line after a block opener (`{`, `:`, `(`) → allow a bounded multi-line block. This heuristic lives in the language profile (§9) and strongly shapes how useful completions feel.

---

## 8. Configuration model (ADR-0006)

Built to grow. All tuning is resolved into a single immutable `ResolvedConfig` consumed only by `core`:

```ts
type Profile = 'fast' | 'quality' | 'custom';

interface ResolvedConfig {
  enabled: boolean;
  profile: Profile;
  endpoint: string;                 // default http://localhost:11434
  model: string;                    // default qwen2.5-coder:3b (per-machine scope)
  budgets: { prefixChars; suffixChars; contextTokens; maxOutputTokens };
  retrievers: { openTabs: boolean; lsp: boolean; index: boolean; /* ... */ };
  multiline: 'auto' | 'off' | 'always';
  debounceMs: number;
  deadlineMs: number;               // per context-assembly cycle
  temperature: number;
  perLanguage: Record<string, Partial<ResolvedConfig>>;
  routing: {                        // proposed, ADR-0008
    enabled: boolean;               // false → FixedRouter on `model`
    candidates: ModelCandidateConfig[];
    maxExpectedLatencyMs: number;   // per-profile eligibility limit
  };
}
```

- **`fast`** (default): open-tabs context only, tight budgets, single-line-leaning, aggressive deadline.
- **`quality`**: enables more retrievers, larger context budget, multi-line allowed, higher deadline.
- **`custom`**: user overrides any field.

**Adding a setting later** = add a field to the schema + `ResolvedConfig` + map it in the two adapters (VS Code settings → config; eval JSON → config). Core logic never changes shape. The extension and eval are the only two places that *produce* a `ResolvedConfig`; everything else just reads it.

**Per-machine model:** VS Code's `machine`-scoped settings let the 16GB Mac default to `qwen2.5-coder:3b` and the 7900 XTX box to `:7b` automatically, with no code difference (Metal vs. ROCm is entirely inside Ollama).

### 8.1 Adaptive model routing (proposed, ADR-0008)

Routing is optional. With it disabled (the default on `fast`), a `FixedRouter` returns the configured `model`, so behaviour is unchanged.

```ts
interface ModelRouter {
  route(input: RoutingInput): RoutingDecision;   // pure, synchronous, no I/O
}

interface ModelCandidate {
  id: string;
  model: string;
  fimFamily: FimFamily;             // explicit, not inferred from the tag
  backend: CompletionBackend;       // one instance per model; interface unchanged
  contextWindowTokens: number;
  languages?: string[];
  stats?: MeasuredStats;            // from eval, per language × category
}
```

- **When:** routing runs before context assembly, on cheap request signals only (trigger kind, single- vs. multi-line position, language, prefix/suffix length). The chosen candidate sets the budgets and FIM template.
- **How:** filter ineligible candidates (FIM family, language, context window, profile latency limit), then apply a deterministic, sticky rule-based policy that favours the resident, last-used model.
- **Fallback:** only on fast failures (server down, model missing), only to a candidate allowed by the same profile; never on timeout or cancellation.
- **Observability:** each decision carries an enum `reason`, recorded on `CompletionEvent` and shown in the status-bar tooltip. No source text is recorded.
- **Profiles:** `fast` keeps routing off by default and restricts candidates to the fast latency limit when on; `quality` permits larger models within its limit.

---

## 9. Language profiles

```ts
interface LanguageProfile {
  id: string;                       // 'java' | 'typescript' | 'typescriptreact' | ...
  lineComment: string;
  blockOpeners: string[];           // for multi-line heuristic
  stopSequences: string[];
  maxMultilineLines: number;
}
```

Phase 1: Java, TypeScript, TSX, JS, JSX, plus a **generic fallback profile** so unknown languages still get reasonable (single-line-biased) behavior — honoring the language-agnostic goal. A new language is a new profile object, registered in a map.

---

## 10. Post-processing

Raw model output is cleaned in `core` before display:
- **Suffix-overlap trimming** — don't re-emit text that already follows the cursor.
- **Single vs. multi-line enforcement** per §7.1.
- **Bracket/indent balancing** — avoid dangling/excess brackets; normalize indentation to the cursor.
- **Quality filters** — drop empty, pure-whitespace, or degenerate-repetition outputs.
- **Stop truncation** — cut at the first stop sequence.

Each is a pure function → directly unit-tested and measured by the eval harness.

---

## 11. Privacy & safety
- **Localhost by default.** A non-local `endpoint` triggers a one-time warning.
- **Secret-file exclusion**: never send `.env`, `*.pem`, `*.key`, credential files, or user-globbed patterns as context.
- **No telemetry.** Metrics (§12) are stored locally and are opt-in to even collect.

---

## 12. Testing & quality gates

- **Unit tests (`core`):** prompt builder, FIM registry, assembler budgeting/dedup, post-processor functions, similarity scoring.
- **Integration tests (`extension`):** provider returns items; gating; settings → `ResolvedConfig` mapping.
- **Eval harness (`eval`):** punches synthetic FIM holes in a sample corpus (Java/TS/React fixtures), scores:
  - quality: **exact-match %**, **line-exact %**, **edit similarity** (Levenshtein ratio),
  - performance: **p50/p95 latency**, tokens/sec.
  - routing (ADR-0008): results broken down per model, language and fixture `category`; routing compared against a fixed-model baseline with identical fixtures and generation settings. Eval can emit a model-stats file that feeds `ModelCandidate.stats`.
- **CI:** lint + unit/integration tests + `.vsix` package build on every push.

### 12.1 Phase gates
A phase does not begin until the previous gate is green:

| Gate | Criterion |
|---|---|
| **No latency regression** | p50/p95 stay within the Phase-0 baseline budget on the reference (3B/Mac) profile |
| **Measurable quality gain** | the new phase improves edit-similarity on the eval corpus over the previous phase by a threshold set once Phase 0 gives a baseline |
| **Green** | lint + tests + package build pass in CI |

---

## 13. Phasing

- **Phase 0 — Foundation & measurement.** Monorepo + all interfaces + FIM registry + eval CLI. Establishes baselines. Nothing user-facing.
- **Phase 1 — Usable MVP.** Ollama backend, `OpenTabsRetriever`, single/multi-line heuristic, debounce + cancel + cache, status bar, toggle, model picker, settings, secret-file exclusion, `fast`/`quality` profiles.
- **Phase 2 — LSP context + streaming.** `LspRetriever`, `ImportRetriever`, progressive ghost text, more language profiles.
- **Phase 3 — Workspace index.** BM25 index with incremental updates on save, behind the existing retriever seam.
- **Adaptive model routing (ADR-0008, proposed).** Starts once Phase 1 has delivered the shared core pipeline. Its own steps: (1) baseline candidate models per language × category on both machines; (2) `ModelRouter` + `FixedRouter` + rule-based policy + config; (3) integrate into the core pipeline; (4) evaluate against the fixed-model baseline and tune; (5) consider performance-based or learned routing only after (4) shows value. Each step is held to the §12.1 gates.
- **Later / revisit non-goals.** Embedding retriever, tree-sitter structural context, chat/inline-edit, Open VSX publishing.

---

## 14. Open questions
- Exact Phase-0 latency baseline numbers (measured, then frozen as the gate).
- Whether streaming inline updates are worth the API complexity in Phase 2 or can wait.
- Index storage format and invalidation strategy (Phase 3 detail).
- Minimum quality-gain thresholds per gate (set after Phase 0 baseline).
- Whether adaptive routing is viable on the 16GB Mac at all, given the memory cost of keeping two models resident (ADR-0008); measured in routing step 1.
- Fixture categories and corpus size needed to tune a routing policy with confidence.

---

## 15. Decision record index
- ADR-0001 — Monorepo: core / extension / eval split
- ADR-0002 — FIM prompt built in-house via a per-family template registry
- ADR-0003 — Pluggable context pipeline; index deferred, seam immediate
- ADR-0004 — Cache-stable prompt ordering
- ADR-0005 — Eval harness as a phase gate; metrics defined
- ADR-0006 — Config via `ResolvedConfig` + profiles for extensibility
- ADR-0007 — Backend abstraction; Ollama first
- ADR-0008 — Adaptive model routing via a pure, sticky `ModelRouter` *(proposed)*
