/**
 * Predicate for files that should never receive completions or be used as
 * context snippets. Lives in `core` so both `GateChecker` and
 * `OpenTabsRetriever` share the same logic without importing `vscode`.
 */

// Anchored patterns prevent false positives: /^\.env(\..+)?$/ will not match
// `dotenv.ts` or `my.envelope.ts`, and `secret` / `credential` are substring
// matches intentionally — `aws_credentials`, `SECRETS.yaml`, etc. all qualify.
const DEFAULT_PATTERNS: readonly RegExp[] = [
  /^\.env(\..+)?$/, // .env, .env.local, .env.production, …
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa$/,
  /^id_ed25519$/,
  /secret/i,
  /credential/i,
];

// We test only the basename, not the full path. A directory named `secrets/`
// in the path should not suppress completions for ordinary files inside it.
function basename(filePath: string): string {
  return filePath.replace(/.*[\\/]/, '');
}

// We avoid importing `node:path` so this module is portable across both the
// VS Code extension host and bun/Node without environment differences.
function globToRegex(pattern: string): RegExp {
  // Escape all regex metacharacters first, then restore * as .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Returns `true` when the file should be excluded from completions and context.
 * Phase 2 passes `config.secretPatterns` as `extraPatterns`.
 */
export function isSecretFile(filePath: string, extraPatterns?: readonly string[]): boolean {
  const name = basename(filePath);
  if (DEFAULT_PATTERNS.some((re) => re.test(name))) return true;
  if (extraPatterns?.some((p) => globToRegex(p).test(name))) return true;
  return false;
}
