// Tiny in-memory sliding-window rate limiter (no dependencies).
//
// Suitable for a single-process app behind nginx. State lives in memory, so it
// resets on restart and is not shared across processes — good enough as an
// abuse speed-bump, not a hard security boundary.

/**
 * @param {{ limit?: number, windowMs?: number, maxKeys?: number }} [opts]
 *   limit    - max allowed hits per window (default 6)
 *   windowMs - rolling window length in ms (default 60000)
 *   maxKeys  - hard cap on tracked keys, so spoofed/rotating client IPs cannot
 *              grow the map without bound (default 10000). When exceeded, the
 *              oldest bucket (Map insertion order) is evicted.
 */
export function createRateLimiter(opts = {}) {
  const limit = opts.limit ?? 6;
  const windowMs = opts.windowMs ?? 60_000;
  const maxKeys = opts.maxKeys ?? 10_000;
  /** @type {Map<string, number[]>} key -> sorted list of hit timestamps */
  const hits = new Map();

  /**
   * Record a hit for `key` and report whether it is allowed.
   * @param {string} key  typically the client IP
   * @param {number} [now]
   * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
   */
  function take(key, now = Date.now()) {
    const cutoff = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= limit) {
      const retryAfterMs = Math.max(0, recent[0] + windowMs - now);
      hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterMs };
    }
    // Bound memory before inserting a brand-new key.
    if (!hits.has(key) && hits.size >= maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    recent.push(now);
    hits.set(key, recent);
    return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 };
  }

  /** Drop stale entries so the map does not grow without bound. */
  function sweep(now = Date.now()) {
    const cutoff = now - windowMs;
    for (const [key, times] of hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }

  return { take, sweep, get size() { return hits.size; } };
}
