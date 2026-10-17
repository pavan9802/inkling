# ADR-0001: Monorepo split — core / extension / eval

- Status: Accepted
- Date: 2026-10-17

## Context
We need the completion logic to be unit-testable and benchmarkable without a running VS Code instance, and we want the benchmark to exercise the *same* prompt-building and post-processing code the extension uses — otherwise the gates measure something other than what ships.

## Decision
Use an npm-workspaces monorepo with three packages:
- **`core`** — pure TypeScript, **forbidden from importing `vscode`**. Holds context assembly, prompt building + FIM registry, backend clients, post-processing, language profiles, config resolution, metrics types.
- **`extension`** — the only package that imports `vscode`. Provider, UI, settings binding, and VS Code-backed `ContextRetriever`s.
- **`eval`** — headless Node CLI importing `core`, with filesystem-backed `ContextRetriever`s over a sample repo.

## Consequences
- + The eval harness and unit tests run in plain Node; gates measure the real path.
- + Backends and context sources are swappable without touching the extension.
- − A monorepo adds minor build/tooling overhead (acceptable; npm workspaces keep it light).
- Enforcement: a lint rule / CI check that `core` has no `vscode` import.
