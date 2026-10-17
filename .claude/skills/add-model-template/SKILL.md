---
name: add-model-template
description: Use when adding support for a new code-model FAMILY whose fill-in-the-middle sentinel tokens Inkling doesn't yet know (e.g. a new base model). Not needed for a new tag of an existing family — that's just a config change.
---

# Add a FIM model template

Inkling builds raw FIM prompts itself (ADR-0002), so each model *family* needs
its sentinel tokens registered. A new *tag* of a known family (e.g.
`qwen2.5-coder:7b` when `qwen` is already supported) needs **no code** — the user
just sets `inkling.model`.

## When this is actually needed
Only when `detectFimFamily(modelId)` would return `undefined` for the new model,
i.e. its family (qwen / starcoder2 / deepseek / codellama) isn't in the registry.

## Steps (all in `packages/core/src/prompt/fim-registry.ts`)

1. **Find the real tokens.** Verify against the model's own tokenizer — do not
   guess. Check the model card, `tokenizer_config.json`, or run
   `ollama show <model> --modelfile`. Note exact strings, ordering, and any
   required whitespace (CodeLlama is whitespace-sensitive).

2. **Extend the union:** add the family to `FimFamily`.

3. **Add tokens** to the `TOKENS` record:
   ```ts
   myfamily: { family: 'myfamily', a: '<PRE>', b: '<SUF>', c: '<MID>' },
   ```

4. **Add detection** in `detectFimFamily` (a substring match on the model tag).

5. **Add a `case`** in `fillFimTemplate` that assembles the prompt in the family's
   exact order/spacing. The model continues after the final sentinel `c`.

6. **Test** in `packages/core/test/fim.test.ts`: a detection assertion and a
   `fillFimTemplate` assertion with known-good output. Then
   `bun run typecheck && bun test`.

## Guardrails
- An unknown family must surface in the UI as "FIM template unknown" rather than
  produce garbage — keep `detectFimFamily` returning `undefined` for anything not
  registered.
