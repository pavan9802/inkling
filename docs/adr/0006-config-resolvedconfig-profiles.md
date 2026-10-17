# ADR-0006: Config via ResolvedConfig + profiles

- Status: Accepted
- Date: 2026-10-17

## Context
We default to a "fast" experience but want a configurable "quality" mode, and we want to add new settings over time without those additions rippling through core logic.

## Decision
All tuning is resolved into a single immutable `ResolvedConfig` object consumed only by `core`. Two adapters produce it: the extension (VS Code settings → config) and eval (JSON/CLI → config). Ship named **profiles**:
- `fast` (default): open-tabs context only, tight budgets, single-line-leaning, aggressive deadline.
- `quality`: more retrievers, larger budget, multi-line allowed, higher deadline.
- `custom`: user overrides.

Per-machine model selection uses VS Code `machine`-scoped settings (3B on the Mac, 7B on the GPU box) with no code difference.

## Consequences
- + Adding a setting = add a field + map it in two adapters; core reads config only.
- + Profiles give a one-switch fast/quality trade without exposing dozens of knobs.
- + Eval and extension share identical config semantics → gates are faithful.
- − One more indirection between raw settings and logic. Accepted for extensibility.
