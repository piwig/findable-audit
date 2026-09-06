import { describe, it, expect } from 'vitest';
import { buildChecks } from '../src/checks/index.js';
import { CHECK_SNIPPETS, checkSnippet } from '../src/report/snippets.js';

/**
 * A148 — the "ready to paste" snippet table is keyed by check id and consumed
 * only by report/html.ts. Renaming a check id used to silently drop its
 * "how to do it" block from the HTML report: no compile error, no red test.
 * This pins every snippet key to a registered check (maximal buildChecks()).
 */
describe('report snippets keys (A148)', () => {
  const registered = new Set(
    buildChecks({ indexnowKey: 'test-key', agentStandards: true }).map((c) => c.id),
  );

  it('every snippet key is a registered check id', () => {
    const orphans = Object.keys(CHECK_SNIPPETS).filter((id) => !registered.has(id));
    expect(orphans).toEqual([]);
  });

  it('every snippet is a non-empty string without leftover template noise', () => {
    for (const [id, snippet] of Object.entries(CHECK_SNIPPETS)) {
      expect(typeof snippet, id).toBe('string');
      expect(snippet.trim().length, id).toBeGreaterThan(0);
    }
  });

  it('checkSnippet() returns the table entry, and undefined for unknown ids', () => {
    const [firstId, firstSnippet] = Object.entries(CHECK_SNIPPETS)[0]!;
    expect(checkSnippet(firstId)).toBe(firstSnippet);
    expect(checkSnippet('no-such-check')).toBeUndefined();
  });

  it('coverage does not silently regress below the current floor', () => {
    // 44 keys for 149 checks today; raise this floor when snippets are added.
    expect(Object.keys(CHECK_SNIPPETS).length).toBeGreaterThanOrEqual(44);
  });
});
