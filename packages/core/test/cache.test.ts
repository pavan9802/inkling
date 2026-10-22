import { describe, expect, test } from 'bun:test';
import { CompletionCache } from '../src/pipeline/cache.js';

describe('CompletionCache', () => {
  test('set and get round-trip', () => {
    const cache = new CompletionCache(10, 60_000);
    cache.set('prefix', 'suffix', 'completion');
    expect(cache.get('prefix', 'suffix')).toBe('completion');
  });

  test('miss returns undefined', () => {
    const cache = new CompletionCache(10, 60_000);
    expect(cache.get('missing', '')).toBeUndefined();
  });

  test('different suffix is a different entry', () => {
    const cache = new CompletionCache(10, 60_000);
    cache.set('p', 'a', 'one');
    cache.set('p', 'b', 'two');
    expect(cache.get('p', 'a')).toBe('one');
    expect(cache.get('p', 'b')).toBe('two');
  });

  test('TTL eviction', async () => {
    const cache = new CompletionCache(10, 1); // 1 ms TTL
    cache.set('p', 's', 'text');
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get('p', 's')).toBeUndefined();
  });

  test('oldest entry evicted when maxSize reached', () => {
    const cache = new CompletionCache(2, 60_000);
    cache.set('a', '', '1');
    cache.set('b', '', '2');
    cache.set('c', '', '3'); // evicts 'a'
    expect(cache.get('a', '')).toBeUndefined();
    expect(cache.get('b', '')).toBe('2');
    expect(cache.get('c', '')).toBe('3');
  });

  describe('tryTypedThrough', () => {
    test('returns remainder when first char matches', () => {
      const cache = new CompletionCache(10, 60_000);
      cache.set('prefix', 'suffix', 'completion');
      expect(cache.tryTypedThrough('prefixc', 'prefix', 'suffix')).toBe('ompletion');
    });

    test('returns undefined on character mismatch', () => {
      const cache = new CompletionCache(10, 60_000);
      cache.set('prefix', 'suffix', 'completion');
      expect(cache.tryTypedThrough('prefixx', 'prefix', 'suffix')).toBeUndefined();
    });

    test('returns undefined when old prefix not in cache', () => {
      const cache = new CompletionCache(10, 60_000);
      expect(cache.tryTypedThrough('prefixc', 'prefix', 'suffix')).toBeUndefined();
    });

    test('returns undefined when newPrefix is more than one char longer', () => {
      const cache = new CompletionCache(10, 60_000);
      cache.set('prefix', 'suffix', 'completion');
      expect(cache.tryTypedThrough('prefixco', 'prefix', 'suffix')).toBeUndefined();
    });

    test('returns empty string when user typed the only char of the completion', () => {
      const cache = new CompletionCache(10, 60_000);
      cache.set('p', 's', 'x');
      expect(cache.tryTypedThrough('px', 'p', 's')).toBe('');
    });
  });
});
