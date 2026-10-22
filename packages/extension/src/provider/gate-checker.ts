import * as vscode from 'vscode';
import { isSecretFile, type ResolvedConfig } from '@inkling/core';

/**
 * Guards the completion pipeline. Checks run in cheapest-first order so we
 * bail out before doing any I/O when a fast check disqualifies the request.
 */
export class GateChecker {
  check(
    config: ResolvedConfig,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): boolean {
    // Order matters: each check is cheaper than the one after it.
    if (!config.enabled) return false;
    if (isSecretFile(document.uri.fsPath)) return false;
    // Explicit false check — a missing key means "no override", not "disabled".
    if (config.perLanguage[document.languageId]?.enabled === false) return false;

    // Only the current line up to the cursor is needed for the position heuristic.
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (!isSensiblePosition(linePrefix)) return false;

    return true;
  }
}

/**
 * Heuristic: skip positions that are clearly inside a comment or a string
 * literal, where a model completion would be noise rather than signal.
 */
function isSensiblePosition(linePrefix: string): boolean {
  const trimmed = linePrefix.trimStart();

  // Skip comment lines (JS/TS block and line comments, Python/shell hash).
  if (/^(\/\/|\/\*|\* |#)/.test(trimmed)) return false;

  // Skip mid-string positions. A naive `split('"').length % 2` fails on escaped
  // quotes like `"it's a \"test\""`, so we track the escape flag explicitly.
  for (const q of ['"', "'", '`']) {
    let count = 0;
    let escaped = false;
    for (const ch of linePrefix) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === q) count++;
    }
    // An odd count means the cursor is inside an open string of this quote type.
    if (count % 2 !== 0) return false;
  }

  return true;
}
