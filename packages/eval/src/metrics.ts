/**
 * Quality metrics for the eval harness (ADR-0005). Pure functions — the
 * numeric basis for the phase gates, so they are unit-tested.
 */

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}

/** 1.0 == identical, 0.0 == maximally different. */
export function editSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function exactMatch(a: string, b: string): boolean {
  return a === b;
}

/** True if the first lines match — the common "did we get the line right" check. */
export function lineExact(a: string, b: string): boolean {
  return (a.split('\n')[0] ?? '') === (b.split('\n')[0] ?? '');
}
