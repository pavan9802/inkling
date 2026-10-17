/**
 * Post-processing: pure functions that clean raw model output before it is
 * shown as ghost text. Each is independently unit-tested and measured by eval.
 */

/** Cut the completion at the first occurrence of any stop sequence. */
export function truncateAtStop(text: string, stops: readonly string[]): string {
  let cut = text.length;
  for (const s of stops) {
    if (s.length === 0) continue;
    const i = text.indexOf(s);
    if (i >= 0 && i < cut) cut = i;
  }
  return text.slice(0, cut);
}

/**
 * Drop any tail of the completion that merely repeats the start of the text
 * following the cursor, so we don't duplicate what's already there.
 */
export function trimSuffixOverlap(completion: string, suffix: string): string {
  const max = Math.min(completion.length, suffix.length);
  for (let n = max; n > 0; n--) {
    if (completion.endsWith(suffix.slice(0, n))) {
      return completion.slice(0, completion.length - n);
    }
  }
  return completion;
}

/** Keep only the first line (used when the context calls for single-line). */
export function enforceSingleLine(text: string): string {
  const i = text.indexOf('\n');
  return i >= 0 ? text.slice(0, i) : text;
}

/** A completion worth showing must contain non-whitespace. */
export function isLowValue(text: string): boolean {
  return text.trim().length === 0;
}
