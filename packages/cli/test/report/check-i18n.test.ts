import { describe, it, expect } from 'vitest';
import { buildChecks } from '../../src/checks/index.js';
import { CHECK_I18N, checkWhy, checkFix, checkTitle } from '../../src/report/check-i18n.js';

describe('CHECK_I18N catalogue', () => {
  it('gives every registered check a human title in both languages', () => {
    for (const check of buildChecks({ agentStandards: true })) {
      expect(checkTitle(check.id, 'en')).not.toBe(check.id);
      expect(checkTitle(check.id, 'fr')).not.toBe(check.id);
    }
  });
  const ids = buildChecks({ indexnowKey: 'k' }).map((c) => c.id);

  it('covers every check with a non-empty, bilingual "why"', () => {
    const missing = ids.filter((id) => !CHECK_I18N[id]);
    expect(missing).toEqual([]); // every shipped check must be documented
    for (const id of ids) {
      const e = CHECK_I18N[id];
      expect(e.why.en.length).toBeGreaterThan(10);
      expect(e.why.fr.length).toBeGreaterThan(10);
      expect(e.why.en).not.toBe(e.why.fr); // actually translated, not shared
    }
  });

  it('checkFix keeps the English fix as-is on EN reports, translates on FR', () => {
    expect(checkFix('llms-txt', 'en', 'ORIGINAL')).toBe('ORIGINAL'); // EN = check source of truth
    const fr = checkFix('llms-txt', 'fr', 'ORIGINAL');
    expect(fr).not.toBe('ORIGINAL');
    expect(fr).toMatch(/llms\.txt/);
  });

  it('checkWhy returns the requested language, undefined for unknown checks', () => {
    expect(checkWhy('llms-txt', 'fr')).toMatch(/llms\.txt/);
    expect(checkWhy('not-a-real-check', 'en')).toBeUndefined();
  });
});
