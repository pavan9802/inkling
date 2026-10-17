# ADR-0002: FIM prompt built in-house via a per-family template registry

- Status: Accepted
- Date: 2026-10-17

## Context
Completion quality requires fill-in-the-middle (FIM). Each code-model family (Qwen2.5-Coder, StarCoder2, DeepSeek-Coder, CodeLlama) uses different FIM sentinel tokens and repo-level formats. Ollama offers a server-side `suffix` parameter that applies the model's own FIM template, which is simpler but opaque and Ollama-specific.

## Decision
Build the FIM prompt ourselves and send it raw (`raw: true`). Maintain a **template registry** mapping model-id pattern → family → sentinel tokens + repo-context format. Unknown families are surfaced in the UI rather than silently mishandled.

## Consequences
- + Full control over *where* cross-file context is placed (enables ADR-0004 ordering).
- + Portable across backends (llama.cpp, OpenAI-compatible) — the template logic lives in `core`, not the server.
- + Can use repo-level FIM formats (`<|file_sep|>`, `<|repo_name|>`).
- − We own correctness of token strings; they must be verified against each model's tokenizer at implementation time and can change across model versions.
- Rejected alternative: Ollama `suffix` param (simpler, but opaque, non-portable, and no control over context placement).
