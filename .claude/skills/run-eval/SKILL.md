---
name: run-eval
description: Use when measuring Inkling's completion quality and latency — to set the Phase-0 baseline, to check a phase gate before advancing, or to compare models/settings. Produces the numbers the gates (ADR-0005) are judged on.
---

# Run the eval harness

The eval harness is how phases are judged objectively (ADR-0005). It punches FIM
holes in a fixture corpus, runs them through the **real** `core` pipeline against
a live Ollama, and reports quality + latency.

## Prerequisites
1. **Ollama running** with the model pulled:
   `ollama pull qwen2.5-coder:3b` (or the model under test).
2. **Fixtures present** in `packages/eval/fixtures/` — small Java / TS / React
   files representative of real code. Keep them stable so runs are comparable.

## Run
```sh
bun run --cwd packages/eval eval -- --corpus ./fixtures --model qwen2.5-coder:3b
```
Keep `temperature` low (default 0.1) so runs are near-deterministic and
comparable. Run on the **reference profile (3B/Mac)** when setting or checking the
latency gate, since the budget is defined there.

## Output (an `EvalReport`, JSON)
- `exactMatchRate`, `lineExactRate`, `meanSimilarity` — quality
- `p50LatencyMs`, `p95LatencyMs` — performance

## Interpreting against the gates
- **Latency gate:** `p95LatencyMs` must stay within the frozen Phase-0 baseline
  × 1.15. Record the Phase-0 baseline in `docs/DESIGN.md` §14 once measured.
- **Quality gate:** a phase passes if `meanSimilarity` (or `lineExactRate`)
  improves over the previous phase by ≥ 2 points, with no latency-gate failure.

## Comparing model routing (planned, ADR-0008)
Adaptive model routing is judged against a **fixed-model baseline** on the same
fixtures, budgets and temperature. Once the CLI supports it:
- Run the fixed baseline per candidate model, then the routed configuration.
- Read results per model, language and fixture `category`, not just the overall
  mean — a router can win on average while regressing one category.
- Check p95 against the active profile's latency target, and record how often
  each model was chosen and how often a fallback fired.
- Feed the per-model stats back into the routing candidates' `stats`.

## If the CLI is still stubbed
The Phase-0 CLI (`packages/eval/src/cli.ts`) is a stub. Implement before first
use: parse flags → `loadCases(corpus)` → for each case build the prompt
(`buildCompletionPrompt`) → `backend.complete` → post-process → `scoreCase` →
`aggregate` → print JSON. The scoring/aggregation (`harness.ts`, `metrics.ts`) is
already implemented and tested.
