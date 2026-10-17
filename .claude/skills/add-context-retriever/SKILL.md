---
name: add-context-retriever
description: Use when adding a new source of cross-file context to Inkling (open tabs, LSP, imports, workspace index, embeddings). Implements the ContextRetriever seam and registers it into the assembler. This is the main extension point for completion quality.
---

# Add a context retriever

Context sources are the project's primary quality lever and its key seam
(ADR-0003). Everything flows through one interface, so adding a source never
touches the provider or prompt builder.

## Decide where it runs
- **Needs the VS Code API** (open editors, LSP, workspace fs) → implement in
  `packages/extension/src/retrievers/`.
- **Reads the filesystem for the benchmark** → implement in
  `packages/eval/src/retrievers/` so the harness exercises the same path.

Both implement the identical `ContextRetriever` interface from `@inkling/core`.

## Steps

1. **Implement the interface** (`packages/core/src/context/types.ts`):
   ```ts
   export class MyRetriever implements ContextRetriever {
     readonly id = 'my-source';
     readonly priority = 20; // higher = assembled first, preferred under budget
     async retrieve(req, deadlineMs, signal): Promise<ScoredSnippet[]> { ... }
   }
   ```
   - **Honor `deadlineMs` and `signal`.** A slow retriever must never block a
     completion. The assembler also races a timeout, but cooperate: bail early
     when `signal.aborted`.
   - Return `ScoredSnippet`s with `score` in `0..1`, a real `sourcePath`, and the
     right `kind`. The assembler dedupes, ranks by `(priority, score)`, and fills
     the character budget — don't pre-truncate to the budget yourself.

2. **Register it** in the assembler:
   - Extension: add to the `new ContextAssembler([...])` array in
     `packages/extension/src/extension.ts`.
   - Eval: add to the assembler the harness constructs.

3. **Add a config toggle** (if user-switchable):
   - Add the field to `RetrieverToggles` in `packages/core/src/config/types.ts`.
   - Default it in both profiles in `packages/core/src/config/profiles.ts`.
   - Map it in `packages/extension/src/config/from-vscode.ts` and add a
     `contributes.configuration` property in `packages/extension/package.json`.

4. **Test** the scoring/ranking with fakes, mirroring
   `packages/core/test/assembler.test.ts`. Then `bun run typecheck && bun test`.

## Priority guidance (current)
`open-tabs` = 10. Put precise sources (LSP, imports) higher (20–30), broad
lexical sources (index) around 10, semantic (embeddings) lower unless proven.

## Guardrails
- Keep pure scoring logic in `core` where practical so it is unit-testable; keep
  only the VS Code/fs access in the retriever itself (ADR-0001).
