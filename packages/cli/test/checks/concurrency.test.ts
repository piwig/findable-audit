import { describe, it, expect } from 'vitest';
import { mapProbes, PROBE_CONCURRENCY } from '../../src/checks/concurrency.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('mapProbes', () => {
  it('returns results in input order, whatever order they finish in', async () => {
    const out = await mapProbes([50, 10, 30, 0], async (ms) => { await tick(ms); return ms; });
    expect(out).toEqual([50, 10, 30, 0]);
  });

  it('never runs more probes at once than the limit — a small site is not a target', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapProbes(Array.from({ length: 30 }, (_, i) => i), async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(5);
      inFlight--;
    }, 4);
    expect(peak).toBe(4);
  });

  it('is faster than sequential, which is the whole point', async () => {
    const started = Date.now();
    await mapProbes(Array.from({ length: 12 }, () => 30), (ms) => tick(ms), 4);
    const elapsed = Date.now() - started;
    // 12 probes × 30ms is 360ms sequentially; at 4 at a time it is ~90ms.
    expect(elapsed).toBeLessThan(280);
  });

  it('handles an empty list and a list shorter than the limit', async () => {
    expect(await mapProbes([], async (x) => x)).toEqual([]);
    expect(await mapProbes([1, 2], async (x) => x * 2, 10)).toEqual([2, 4]);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    await expect(mapProbes([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('probe exploded');
      return n;
    })).rejects.toThrow('probe exploded');
  });

  it('defaults to a polite concurrency', () => {
    expect(PROBE_CONCURRENCY).toBeGreaterThan(1);
    expect(PROBE_CONCURRENCY).toBeLessThanOrEqual(6);
  });
});
