import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { editSimilarity, exactMatch, lineExact } from './metrics.js';

export interface HoleCase {
  readonly file: string;
  readonly prefix: string;
  readonly suffix: string;
  /** The text that was removed — the ground truth. */
  readonly expected: string;
}

export interface CaseResult {
  readonly file: string;
  readonly exact: boolean;
  readonly lineExact: boolean;
  readonly similarity: number;
  readonly latencyMs: number;
}

export interface EvalReport {
  readonly count: number;
  readonly exactMatchRate: number;
  readonly lineExactRate: number;
  readonly meanSimilarity: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
}

/** Score one produced completion against its ground truth. */
export function scoreCase(c: HoleCase, produced: string, latencyMs: number): CaseResult {
  return {
    file: c.file,
    exact: exactMatch(produced, c.expected),
    lineExact: lineExact(produced, c.expected),
    similarity: editSimilarity(produced, c.expected),
    latencyMs,
  };
}

/** Aggregate per-case results into the report the phase gates read. */
export function aggregate(results: readonly CaseResult[]): EvalReport {
  if (results.length === 0) {
    return { count: 0, exactMatchRate: 0, lineExactRate: 0, meanSimilarity: 0, p50LatencyMs: 0, p95LatencyMs: 0 };
  }
  const n = results.length;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
  return {
    count: n,
    exactMatchRate: results.filter((r) => r.exact).length / n,
    lineExactRate: results.filter((r) => r.lineExact).length / n,
    meanSimilarity: results.reduce((s, r) => s + r.similarity, 0) / n,
    p50LatencyMs: pct(50),
    p95LatencyMs: pct(95),
  };
}

/**
 * Load hole cases from a fixture corpus directory. Each `.json` file must be a
 * serialised `HoleCase` — see `packages/eval/fixtures/` for examples.
 */
export async function loadCases(corpusDir: string): Promise<HoleCase[]> {
  const entries = await readdir(corpusDir);
  const jsons = entries.filter((f) => f.endsWith('.json'));
  const cases = await Promise.all(
    jsons.map(async (f) => {
      const raw = await readFile(join(corpusDir, f), 'utf-8');
      return JSON.parse(raw) as HoleCase;
    }),
  );
  return cases;
}
