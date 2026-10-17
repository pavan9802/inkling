# ADR-0007: Backend abstraction; Ollama first

- Status: Accepted
- Date: 2026-10-17

## Context
The author runs Ollama on both machines (Metal on the Mac, ROCm on the 7900 XTX). Others may run llama.cpp's server, LM Studio, or vLLM (OpenAI-compatible). We don't want the completion path coupled to one server.

## Decision
Define a `CompletionBackend` interface (`complete(request, signal) → text | stream`). Implement **Ollama first** against `/api/generate` with `raw: true`, `stop`, `num_predict`, low `temperature`, and `keep_alive` to pin the model. Future implementations (llama.cpp server, OpenAI-compatible) are additive.

## Consequences
- + Metal vs. ROCm is entirely inside Ollama — Inkling needs no per-GPU code.
- + New backends don't touch the provider or prompt logic.
- + Streaming (Phase 2) is expressed once in the interface.
- − Each backend must map our raw FIM prompt + stop/stream semantics correctly; covered by `core` tests.
