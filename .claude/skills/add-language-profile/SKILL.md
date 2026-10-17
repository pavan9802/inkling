---
name: add-language-profile
description: Use when adding or tuning Inkling's support for a programming language — comment syntax, block-opener detection, stop sequences, and multi-line limits. Languages without a profile already work via the generic fallback; this skill is for making a specific language behave better.
---

# Add a language profile

Language profiles keep `core` generic: a language is data, not a code path. An
unknown language already falls back to the `generic` profile, so use this skill
to *improve* a language, not to make it work at all.

## Steps

1. **Find the VS Code language id.** It must match exactly (e.g. `typescript`,
   `typescriptreact`, `java`, `go`, `python`, `rust`). When unsure, check the
   language selector in VS Code's status bar.

2. **Add an entry** to `PROFILES` in `packages/core/src/language/profiles.ts`.
   For a C-style language use the `cStyle(id, overrides)` helper; otherwise
   construct a full `LanguageProfile` (see `packages/core/src/language/types.ts`):
   - `lineComment` — used to delimit cross-file context snippets in the prompt.
   - `blockOpeners` — trailing tokens that signal a multi-line block may follow
     (drives the single-vs-multi-line heuristic). E.g. `['{', '(', '[']`.
   - `stopSequences` — sequences that always end a completion (e.g. `['\n\n']`).
   - `maxMultilineLines` — upper bound for a multi-line completion.

   ```ts
   python: { id: 'python', lineComment: '#', blockOpeners: [':'],
             stopSequences: ['\n\n'], maxMultilineLines: 8 },
   ```

3. **No extension or config change is needed** — `getLanguageProfile(id)` resolves
   it automatically.

4. **Verify:** `bun run typecheck && bun test`. If the language has non-obvious
   comment or block rules, add a small assertion to a `core` test.

## Guardrails
- `core` must stay free of `vscode` imports (ADR-0001).
- Keep profiles minimal and data-only; behavior belongs in the post-processor
  and prompt builder, which read these fields.
