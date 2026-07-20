// Tiny bounded TTL cache for audit results (no dependencies).
//
// Two bounds keep memory from growing without limit under abuse:
//   - TTL: entries older than ttlMs are treated as absent and swept.
//   - maxEntries: an LRU-ish cap; on overflow the oldest (Map insertion order)
//     entry is evicted. set() reinserts a key as newest so hot URLs survive.

/**
 * @param {{ ttlMs?: number, maxEntries?: number }} [opts]
 */
export function createResultCache(opts = {}) {
  const ttlMs = opts.ttlMs ?? 60_000;
  const maxEntries = opts.maxEntries ?? 500;
  /** @type {Map<string, { at: number, value: any }>} */
  const map = new Map();

  function get(key, now = Date.now()) {
    const e = map.get(key);
    if (!e) return undefined;
    if (now - e.at >= ttlMs) {
      map.delete(key);
      return undefined;
    }
    return e.value;
  }

  function set(key, value, now = Date.now()) {
    map.delete(key); // reinsert so this key becomes the newest
    map.set(key, { at: now, value });
    sweep(now);
  }

  /** Drop expired entries, then evict oldest until within maxEntries. */
  function sweep(now = Date.now()) {
    for (const [k, e] of map) if (now - e.at >= ttlMs) map.delete(k);
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  return { get, set, sweep, get size() { return map.size; } };
}
