# CLAUDE.md — Inkling

Context for Claude Code (and humans) working in this repo. Read `docs/DESIGN.md` and the ADRs in `docs/adr/` before making architectural changes.

## What this is
Inkling is a VS Code extension providing **local-first inline (ghost-text) code completions** from a self-hosted LLM via **Ollama**. FIM-first. Privacy-first (nothing leaves the machine). Built to be publishable.

Primary stack targets: **Java, TypeScript, React (TSX/JSX)**; core is language-agnostic.

## Repo layout
```
packages/core/        Pure TS. MUST NOT import 'vscode'. The brain.
packages/extension/   VS Code glue. The ONLY package that imports 'vscode'.
packages/eval/        Headless benchmark CLI. Imports core.
docs/DESIGN.md        Source of truth for architecture.
docs/adr/             Decision records (numbered).
```

## Hard rules (do not violate without a new ADR)
1. **`core` never imports `vscode`.** Context sources that need VS Code live in `extension` and implement `core`'s `ContextRetriever` interface. (ADR-0001)
2. **Seams before implementations.** New context sources implement `ContextRetriever`; new inference servers implement `CompletionBackend`. Don't special-case them in the provider. (ADR-0003, ADR-0007)
3. **Build FIM prompts via the template registry**, never inline per model. (ADR-0002)
4. **Prompt order is [context] → [prefix] → middle → [suffix].** Don't reorder — it's a prompt-cache optimization. (ADR-0004)
5. **All tuning flows through `ResolvedConfig`.** Core reads config; only `extension` and `eval` produce it. (ADR-0006)
6. **A slow retriever must never block a completion** — everything in the context cycle respects the deadline. (ADR-0003)
7. **Model selection goes through `ModelRouter`** *(proposed)*. Routers are pure and synchronous (no I/O; runtime state is passed in as a snapshot). Routing disabled = `FixedRouter` on the configured model, not a special-case branch. Don't add a `model` field to `CompletionBackend` calls — route to a candidate that owns its backend. (ADR-0008)

## How to extend
- **Add a language:** add a `LanguageProfile` and register it. No core changes.
- **Add a context source:** implement `ContextRetriever` in `extension` (or `eval`), register it. No provider changes.
- **Add a model / FIM family:** add an entry to the FIM template registry (verify tokens against the model's tokenizer).
- **Add a backend:** implement `CompletionBackend`.
- **Add a routing rule or model candidate:** candidates and thresholds are config (`ResolvedConfig.routing`); policy logic is a `ModelRouter` implementation in `core/src/routing/`. Back every rule change with eval numbers broken down by category. (ADR-0008)
- **Add a setting:** add a field to `ResolvedConfig` + map it in both adapters. Core logic unchanged.

## Quality gates (see ADR-0005)
Before advancing a phase: (1) no latency regression vs. the Phase-0 baseline on the 3B/Mac profile; (2) measurable edit-similarity gain on the eval corpus; (3) CI green (lint + tests + `.vsix` build). Run the eval CLI (`packages/eval`) to check 1 and 2.

**Measured baselines (qwen2.5-coder:3b, Mac, 8-case corpus):**
- Phase-0: similarity 0.519 · p50 1 063 ms · p95 1 789 ms
- Phase-1: similarity 0.502–0.511 · p50 1 005–1 055 ms · p95 1 769–1 884 ms

The corpus is too small (8 cases) for stable similarity comparison — expand to ≥ 50 cases in Phase 2 before using similarity as a hard gate.

## Conventions
- TypeScript strict. Pure functions in `core` are unit-tested.
- Keep core logic free of side effects where practical (testability).
- Commit messages: conventional-commits style; reference the ADR when a change touches an architectural decision.
- **Comments:** write WHY comments (hidden constraints, invariants, non-obvious decisions) and short step-level flow labels inside complex functions. Never explain WHAT the code does — well-named identifiers do that. One line per comment; no multi-paragraph blocks.

## Planned dev skills (to be authored in Phase 0)
SKILL.md files for repeatable tasks: *add-language-profile*, *add-context-retriever*, *add-model-template*, *run-eval*, *cut-release* (package the `.vsix`).

## Defaults
- Endpoint: `http://localhost:11434`. Model: `qwen2.5-coder:3b` (Mac) / `:7b` (GPU box), `machine`-scoped.
- Profile: `fast` by default; `quality` is opt-in.
