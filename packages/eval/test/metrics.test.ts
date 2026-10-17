import { describe, expect, test } from 'bun:test';
import { aggregate } from '../src/harness.js';
import { editSimilarity, exactMatch, levenshtein, lineExact } from '../src/metrics.js';

describe('metrics', () => {
  test('levenshtein basics', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  test('editSimilarity is 1 for identical, 0 for empty-vs-full relative', () => {
    expect(editSimilarity('abc', 'abc')).toBe(1);
    expect(editSimilarity('', '')).toBe(1);
    expect(editSimilarity('abcd', 'abce')).toBeCloseTo(0.75, 5);
  });

  test('exactMatch and lineExact', () => {
    expect(exactMatch('a', 'a')).toBe(true);
    expect(lineExact('foo\nbar', 'foo\nbaz')).toBe(true);
    expect(lineExact('foo', 'bar')).toBe(false);
  });
});

describe('aggregate', () => {
  test('computes rates and percentiles', () => {
    const report = aggregate([
      { file: 'a', exact: true, lineExact: true, similarity: 1, latencyMs: 100 },
      { file: 'b', exact: false, lineExact: true, similarity: 0.5, latencyMs: 300 },
    ]);
    expect(report.count).toBe(2);
    expect(report.exactMatchRate).toBe(0.5);
    expect(report.lineExactRate).toBe(1);
    expect(report.meanSimilarity).toBeCloseTo(0.75, 5);
    expect(report.p95LatencyMs).toBe(300);
  });

  test('empty input is safe', () => {
    expect(aggregate([]).count).toBe(0);
  });
});
