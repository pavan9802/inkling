# ADR-0005: Eval harness as a phase gate

- Status: Accepted
- Date: 2026-10-17

## Context
We want objective "should we move to the next phase?" decisions, not vibes. Quality and latency both matter and can trade off.

## Decision
Build an offline eval CLI (`eval` package) in **Phase 0**, before any user-facing feature. It punches synthetic FIM holes in a sample corpus (Java/TS/React fixtures) and scores quality (exact-match %, line-exact %, edit similarity) and performance (p50/p95 latency, tokens/sec). The Phase-0 run establishes baselines.

Phase gates:
1. No latency regression beyond the Phase-0 budget on the reference (3B/Mac) profile.
2. Measurable edit-similarity gain over the previous phase above a set threshold.
3. CI green (lint + tests + package).

A phase does not start until the prior gate is green.

## Consequences
- + Objective, repeatable phase transitions; prevents latency creep.
- + Lets us compare models/settings offline without manual testing.
- − Synthetic holes are an imperfect proxy for real typing; acceptance-rate telemetry (local, opt-in) supplements later.
- − Requires a representative fixture corpus to be assembled in Phase 0.
