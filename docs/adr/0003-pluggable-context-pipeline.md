# ADR-0003: Pluggable context pipeline; index deferred, seam immediate

- Status: Accepted
- Date: 2026-10-17

## Context
Cross-file context is the biggest quality lever, and we want it "as good as possible." But a full workspace index is expensive to build and not needed for a useful MVP. We must avoid a situation where adding stronger context later is a rewrite.

## Decision
Define a single `ContextRetriever` interface and a budget-filling `ContextAssembler` in `core` from the first commit. Ship only the cheapest retriever (`OpenTabsRetriever`) in Phase 1. Every later source — LSP, imports, BM25 workspace index, embeddings — is a new implementation registered into the same assembler.

The assembler runs retrievers in parallel under a hard per-cycle deadline, dedupes, scores by (priority, relevance), and fills a token budget.

## Consequences
- + Phase 3 (workspace index) and beyond are "register a retriever," not a refactor.
- + A slow retriever (e.g. a cold language server) can never block a completion — the deadline bounds it.
- + The eval harness supplies its own filesystem-backed retrievers behind the same interface.
- − Slightly more upfront abstraction than a hardcoded Phase-1 context function would need. Accepted: this is the project's core principle (seams before implementations).
