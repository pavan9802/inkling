# Inkling

Local-first inline code completion for VS Code, powered by a self-hosted LLM (Ollama). FIM-first, privacy-first, language-agnostic.

> **Status: Phase 0 (foundation).** Interfaces and the monorepo skeleton exist; product behavior is being built. See [`docs/DESIGN.md`](docs/DESIGN.md) and [`docs/adr/`](docs/adr/).

## Layout

| Package | Purpose |
|---|---|
| `packages/core` | Pure TS brain. Never imports `vscode`. Context assembly, FIM prompts, backends, post-processing, config. |
| `packages/extension` | VS Code glue. The only package that imports `vscode`. |
| `packages/eval` | Headless benchmark CLI that measures quality + latency (the phase gate). |

## Develop

```sh
bun install
bun run typecheck
bun test
```

Requires [Bun](https://bun.sh) and a running [Ollama](https://ollama.com) with a FIM-capable model (default `qwen2.5-coder:3b`).

## License

MIT
