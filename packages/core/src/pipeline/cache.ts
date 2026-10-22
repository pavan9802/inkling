/**
 * In-memory LRU completion cache with TTL and typed-through detection.
 *
 * Keys are (prefix, suffix) pairs. The cache is bounded by `maxSize` entries;
 * oldest entries are evicted on overflow. `tryTypedThrough` handles the
 * common case where the user accepts the first character of a suggestion —
 * the tail of the completion is returned without a backend round-trip.
 */
export class CompletionCache {
  private readonly store = new Map<string, { text: string; expiresAt: number }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {}

  private key(prefix: string, suffix: string): string {
    // \x00 is a safe separator: it cannot appear in valid source code, so
    // `prefix + suffix` concatenations can never produce a false key collision.
    return `${prefix}\x00${suffix}`;
  }

  get(prefix: string, suffix: string): string | undefined {
    const k = this.key(prefix, suffix);
    const entry = this.store.get(k);
    if (!entry) return undefined;
    // Lazy TTL eviction on read — avoids a background setInterval that would
    // keep the extension active when the editor is idle.
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      return undefined;
    }
    return entry.text;
  }

  set(prefix: string, suffix: string, completion: string): void {
    const k = this.key(prefix, suffix);
    // Only evict when the key is genuinely new — overwriting an existing entry
    // does not increase the store size, so no eviction is needed.
    if (this.store.size >= this.maxSize && !this.store.has(k)) {
      // Map preserves insertion order, so keys().next() is always the oldest.
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(k, { text: completion, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Typed-through detection: if the user typed exactly one character that
   * matches the first character of the cached completion for `oldPrefix`, return
   * the trimmed remainder. Returns `undefined` if the conditions aren't met.
   *
   * The caller (pipeline) stores the result under `(newPrefix, suffix)` so that
   * subsequent keystrokes can chain further typed-through detections.
   */
  tryTypedThrough(newPrefix: string, oldPrefix: string, suffix: string): string | undefined {
    // Guard: exactly one new character, same base, same suffix.
    if (newPrefix.length !== oldPrefix.length + 1) return undefined;
    if (!newPrefix.startsWith(oldPrefix)) return undefined;
    const char = newPrefix[oldPrefix.length];
    const cached = this.get(oldPrefix, suffix);
    if (cached === undefined || char !== cached[0]) return undefined;
    return cached.slice(1);
  }
}
