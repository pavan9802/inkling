# ADR-0004: Cache-stable prompt ordering

- Status: Accepted
- Date: 2026-10-17

## Context
Prefill cost dominates latency, especially on Apple Silicon with a large context. llama.cpp/Ollama reuse the longest common *prefix* of the token stream between consecutive requests (prompt cache). Typing changes the prompt at the cursor each keystroke.

## Decision
Order the prompt as: **[cross-file context] → [current-file prefix] → FIM middle → [suffix]**. Keep the large, slow-changing cross-file context at the head so it stays byte-identical between keystrokes; only the tail of the file-prefix changes. Recompute cross-file context on file switch / idle, not per keystroke, to preserve this stability.

## Consequences
- + Maximizes prompt-cache reuse → much lower prefill cost per keystroke.
- + Pairs with ADR-0002 (we control placement because we build the prompt).
- − Context is slightly less "fresh" within an editing burst. Acceptable: cross-file context rarely changes mid-burst.
- − If a retriever's output changes, cache benefit is lost for that cycle (expected and rare).
