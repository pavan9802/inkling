import { describe, expect, test } from 'bun:test';
import {
  enforceSingleLine,
  isLowValue,
  trimSuffixOverlap,
  truncateAtStop,
} from '../src/postprocess/index.js';

describe('post-processing', () => {
  test('truncateAtStop cuts at the earliest stop', () => {
    expect(truncateAtStop('abc\n\ndef', ['\n\n'])).toBe('abc');
    expect(truncateAtStop('no stop here', ['\n\n'])).toBe('no stop here');
  });

  test('trimSuffixOverlap removes a duplicated suffix tail', () => {
    expect(trimSuffixOverlap('foo);', ');')).toBe('foo');
    expect(trimSuffixOverlap('standalone', ');')).toBe('standalone');
  });

  test('enforceSingleLine keeps only the first line', () => {
    expect(enforceSingleLine('one\ntwo')).toBe('one');
  });

  test('isLowValue flags whitespace-only output', () => {
    expect(isLowValue('  \n ')).toBe(true);
    expect(isLowValue('x')).toBe(false);
  });
});
