# ADR-0008: Adaptive model routing via a pure, sticky `ModelRouter`

- Status: Proposed
- Date: 2026-10-21

## Context
Today one completion request uses one model: `ResolvedConfig.model`, bound into a single `OllamaBackend` at activation. Requests differ in what they need. An automatic single-line completion while typing is extremely latency-sensitive and usually easy. An explicitly invoked or multi-line block completion tolerates more latency and benefits from a stronger model. We want to pick a locally hosted model per request to improve the quality/latency trade-off, without an extra LLM call and without breaking the existing seams.

Constraints that shape the design:
- **The model determines the prompt.** The FIM family (ADR-0002), stop tokens and safe context budget all depend on the model, so the choice must be made *before* the prompt is built, not just before `complete()`.
- **Switching models is expensive locally.** Each resident model costs memory. On the 16GB Mac, two models pinned with `keep_alive` risk eviction, and a cold load (seconds) erases any p95 gain. Ollama's prompt cache is per model, so alternating models also throws away the benefit of cache-stable ordering (ADR-0004).
- **Context assembly has a hard deadline** (ADR-0003); routing must not eat into it.
- **There is no shared pipeline in `core` yet.** The provider is a stub and the eval CLI hand-rolls the pipeline. Routing must live in one place that both use, or eval stops being a faithful gate (ADR-0005).

## Decision

### 1. A pure `ModelRouter` seam in `core`
Add `packages/core/src/routing/`. The router is a synchronous, side-effect-free function of its input:

```ts
interface ModelRouter {
  route(input: RoutingInput): RoutingDecision;      // sync, no I/O
}

interface RoutingInput {
  readonly signals: RequestSignals;                  // cheap, request-only (see §3)
  readonly candidates: readonly ModelCandidate[];
  readonly runtime: RuntimeSnapshot;                 // resident models, recent latencies, last model used
  readonly profile: Profile;
}

interface RoutingDecision {
  readonly candidate: ModelCandidate;
  readonly reason: RoutingReason;                    // enum code, never free text
  readonly fallback?: ModelCandidate;
}
```

Anything that changes over time (which models are resident, observed latency) is gathered outside the router and passed in as a `RuntimeSnapshot`. This keeps routing deterministic, unit-testable, replayable in eval, and makes routing overhead negligible by construction.

**Routing disabled is a `FixedRouter`** with a single candidate built from `ResolvedConfig.model`. There is one code path, not an `if (routing)` branch, and existing behaviour is preserved exactly.

### 2. Route to a `ModelCandidate`, not a model string
A candidate bundles everything that changes with the model:

```ts
interface ModelCandidate {
  readonly id: string;
  readonly model: string;
  readonly fimFamily: FimFamily;                     // explicit, not guessed from the tag
  readonly backend: CompletionBackend;               // one instance per model
  readonly contextWindowTokens: number;
  readonly languages?: readonly string[];
  readonly stats?: MeasuredStats;                    // produced by eval, not hand-written
}
```

`CompletionBackend` is **unchanged** (ADR-0007 holds). Multiple models are served by multiple backend instances. `ResolvedConfig` holds plain candidate descriptors (`ModelCandidateConfig`: everything above except `backend`); the extension and eval adapters turn each descriptor into a `ModelCandidate` by constructing its backend. Routing never sees Ollama specifics.

### 3. Route first, on cheap signals
Pipeline order becomes: **gate → debounce → cache → route → assemble (with the candidate's budgets) → prompt (with the candidate's FIM family) → complete → post-process**.

Routing on the size of the assembled context would be circular (budgets depend on the model) and would consume the context deadline, so the router uses only request-level signals:
- **Trigger kind:** explicit invoke vs. automatic. This is expected to be the strongest signal.
- **Single-line vs. multi-line** position, from the language profile heuristic (§7.1 of the design doc).
- **Language**, compared against the candidate's measured per-language quality.
- Prefix/suffix length and cursor location (import line, block opener) as minor adjustments, never as hard gates.

No single heuristic is treated as a definitive measure of difficulty.

### 4. Eligibility, then a sticky policy
1. **Filter.** Drop candidates that cannot serve the request: unknown FIM family, language excluded, context window too small, outside the active profile's latency limits.
2. **Select.** Choose with a deterministic rule-based policy that **defaults to the last-used model** (hysteresis) and switches only on a strong signal. Candidates that are not resident are treated as very expensive.

Policy logic lives in code. Thresholds and the candidate list live in `ResolvedConfig` (ADR-0006). A rule language in settings is out of scope until there are more rules than code can comfortably express.

Profiles:
- `fast` — routing **off by default**. When enabled, only candidates within the fast latency limits are eligible.
- `quality` — routing allowed, with larger models eligible subject to the profile's latency limit.
- `custom` — user-specified candidates and limits.

### 5. Narrow fallback
- Fall back **only on fast failures** (connection refused, model not found), and only to `decision.fallback`, which must meet the same profile constraints.
- **Never** fall back on timeout or cancellation: the latency budget is spent, or the user has moved on.
- Never run several models in parallel or as a cascade.

### 6. Measured data over hand-written assumptions
- The eval CLI runs the **same** router and pipeline as the extension.
- Fixtures gain a `category` label (e.g. single-line, block, import, argument) so results can be broken down per category and per language.
- Eval writes a model-stats file (quality, p50/p95 per language × category per model). Adapters load it into `ModelCandidate.stats`.
- Eval compares routing against a fixed-model baseline with identical fixtures and generation settings.

### 7. Observable, privacy-safe
`RoutingDecision.reason` is a small enum (`fixed`, `sticky-current`, `explicit-invoke`, `multiline-block`, `fallback-unavailable`, …). It is recorded on `CompletionEvent` next to the existing `model` field and shown in the status-bar tooltip. Codes aggregate cleanly and guarantee no source text enters metrics.

### 8. Prerequisite: a shared core pipeline
Before routing is integrated, the Phase-1 pipeline (assemble → prompt → complete → post-process) moves into one `core` function that both the provider and the eval CLI call. Routing is then added inside that function.

## Consequences
- + One extra seam alongside `ContextRetriever`, `CompletionBackend` and `ResolvedConfig`. Routing policies change without touching the provider, prompt builder or backends.
- + `FixedRouter` keeps current behaviour as the default path; manual model selection still works.
- + Pure routing is trivially unit-tested and replayed in eval; overhead is negligible.
- + Explicit `fimFamily` on candidates removes reliance on model-tag string matching for routed models.
- − More config surface (candidates, limits) and one backend instance per model in the adapters.
- − Real gains depend on hardware headroom: on a 16GB machine keeping two models resident may not be viable, and routing may only pay off on the GPU box. This is why it is off by default on `fast`.
- − Switching models defeats per-model prompt caching (ADR-0004); stickiness mitigates but does not remove this cost.
- − Requires a larger, category-labelled, multi-language fixture corpus before the policy can be tuned meaningfully.

## Alternatives considered
- **Add `model` to `CompletionParams` and use one backend.** Simpler wiring, but changes the ADR-0007 interface and pushes model identity into every backend call. Rejected in favour of one backend per candidate.
- **Route after context assembly on assembled size.** Circular with per-model budgets and eats the context deadline (ADR-0003). Rejected.
- **LLM- or ML-based classifier.** Adds an inference call or training data we do not have. Deferred until deterministic routing shows measurable value.
- **Speculative/cascade execution (small model first, escalate).** Doubles compute and memory pressure on local hardware. Rejected.

## Rollout
1. **Baseline:** benchmark candidate models per language × category on both reference machines.
2. **Abstraction:** `ModelRouter`, `ModelCandidate`, `FixedRouter`, rule-based policy, config fields; unit tests.
3. **Integration:** route inside the shared core pipeline, preserving cancellation, streaming, error handling and profiles.
4. **Evaluation:** routing vs. fixed baseline; tune thresholds from measured results.
5. **Adaptive:** performance-based or learned routing only after step 4 shows value.

Success requires: no extra inference call to select a model; p95 within the profile's target; no material quality regression; at least one configuration with a measurable quality/latency improvement. Exact thresholds are set after step 1.
