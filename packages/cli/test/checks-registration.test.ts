import { describe, it, expect } from 'vitest';
import { buildChecks } from '../src/checks/index.js';
import type { Check } from '../src/types.js';

/**
 * A88(a) — anti-regression net for the A74 bug class: a check module that is
 * imported (or merely present in src/checks/) but never registered in
 * buildChecks() silently disappears from every audit.
 *
 * Strategy: dynamically import every module under src/checks/ (except the
 * registry itself), collect every export shaped like a Check
 * (id + family + run + maxPoints), and assert each one is present in the
 * maximal buildChecks() output (all opt-in flags enabled).
 */

// Eager glob: resolved at transform time by vite/vitest, so a new file under
// src/checks/ is automatically covered without touching this test.
const checkModules = import.meta.glob('../src/checks/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

function isCheckShaped(v: unknown): v is Check {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Check).id === 'string' &&
    typeof (v as Check).family === 'string' &&
    typeof (v as Check).maxPoints === 'number' &&
    typeof (v as Check).run === 'function'
  );
}

describe('checks registration (A88a)', () => {
  it('every Check-shaped export in src/checks/ is registered in buildChecks()', async () => {
    const registered = new Set(
      buildChecks({ indexnowKey: 'test-key', agentStandards: true }).map((c) => c.id),
    );
    expect(registered.size).toBeGreaterThan(0);

    const entries = Object.entries(checkModules).filter(
      ([path]) => !path.endsWith('/index.ts'),
    );
    expect(entries.length).toBeGreaterThan(0);

    const missing: string[] = [];
    let discovered = 0;
    for (const [path, mod] of entries) {
      for (const [name, value] of Object.entries(mod)) {
        if (!isCheckShaped(value)) continue;
        discovered++;
        if (!registered.has(value.id)) missing.push(`${path}:${name} (id=${value.id})`);
      }
    }

    // Sanity: the discovery mechanism itself must find a substantial set,
    // otherwise a refactor of the Check shape would quietly void this test.
    expect(discovered).toBeGreaterThanOrEqual(registered.size / 2);
    expect(missing, `Check exports never registered in buildChecks(): ${missing.join(', ')}`).toEqual([]);
  });

  it('buildChecks() ids are unique', () => {
    const ids = buildChecks({ indexnowKey: 'test-key', agentStandards: true }).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
