---
name: cut-release
description: Use when packaging or publishing a new version of the Inkling VS Code extension — building the .vsix, versioning, and publishing to the Marketplace and Open VSX. Gate the release on a green build first.
---

# Cut a release

The publishable artifact is the `extension` package; `core` and `eval` are
internal.

## 0. Gate first
A release only happens on green:
```sh
bun run lint && bun run typecheck && bun test
```
If the eval harness is wired, also confirm the latest `run-eval` meets the gates.

## 1. Version & changelog
- Bump `version` in `packages/extension/package.json` (semver).
- Update `CHANGELOG.md` (create it at repo root if absent) with the changes.

## 2. Build the bundle
```sh
bun run build:extension   # bun build -> dist/extension.js (CJS, vscode external)
```

## 3. Package the .vsix
```sh
bun run package           # bunx @vscode/vsce package --no-dependencies
```
`--no-dependencies` is correct because the extension is bundled; `@inkling/core`
is compiled into `dist/extension.js`, not shipped as a node_module.
Install locally to smoke-test: `code --install-extension inkling-<version>.vsix`.

## 4. Publish
- **Replace the placeholder publisher** `inkling-dev` in
  `packages/extension/package.json` with a real registered VS Code Marketplace
  publisher before publishing. (See the Marketplace publisher docs; needs an
  Azure DevOps PAT.)
- Marketplace: `bunx @vscode/vsce publish`
- Open VSX (for VSCodium/Cursor users): `bunx ovsx publish inkling-<version>.vsix`

## 5. Tag
```sh
git tag v<version> && git push --tags
```

## Guardrails
- Never publish with the `inkling-dev` placeholder publisher.
- Ensure `.vscodeignore` (add when first packaging) excludes `src/`, tests, and
  `node_modules` so the `.vsix` ships only `dist/` + manifest + README + LICENSE.
