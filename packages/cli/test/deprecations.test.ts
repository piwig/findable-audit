import { describe, it, expect } from 'vitest';
import { buildChecks } from '../src/checks/index.js';
import { DEPRECATIONS, deprecation, deprecationsForCheck, deprecatedCheckIds } from '../src/deprecations.js';
import { CHECK_TITLES } from '../src/report/check-i18n.js';

/**
 * A116 — The registry is only worth having if it cannot drift from the product.
 * These tests hold it to the two things prose could never guarantee: every
 * record names checks that really exist, and every record is dated and sourced.
 */
describe('registre des obsolescences (A116)', () => {
  const ids = new Set(buildChecks().map((c) => c.id));

  it('ne cite que des checks reellement enregistres', () => {
    for (const d of DEPRECATIONS) {
      expect(d.checks.length, `${d.id} ne cite aucun check`).toBeGreaterThan(0);
      for (const checkId of d.checks) {
        expect(ids.has(checkId), `${d.id} cite un check inconnu : ${checkId}`).toBe(true);
      }
    }
  });

  it('date et source chaque retrait, de facon re-verifiable', () => {
    for (const d of DEPRECATIONS) {
      expect(d.since, `${d.id}`).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(new Date(`${d.since.length === 7 ? `${d.since}-01` : d.since}T00:00:00Z`).getTime()).not.toBeNaN();
      expect(d.source, `${d.id}`).toMatch(/^https:\/\/\S+$/);
    }
  });

  it('dit toujours ce que le balisage vaut ENCORE, sans formule vague', () => {
    for (const d of DEPRECATIONS) {
      // Un retrait n'est presque jamais un « ca ne sert plus a rien » : le dire
      // precisement est la difference entre un audit honnete et un argument de peur.
      expect(d.stillWorth.length, `${d.id} : justification trop courte`).toBeGreaterThan(80);
      expect(d.stillWorth).not.toMatch(/\bTODO\b|\ba definir\b/i);
    }
  });

  it('a des identifiants uniques et des checks connus du catalogue de titres', () => {
    expect(new Set(DEPRECATIONS.map((d) => d.id)).size).toBe(DEPRECATIONS.length);
    for (const checkId of deprecatedCheckIds()) {
      expect(CHECK_TITLES[checkId], `${checkId} absent de CHECK_TITLES`).toBeTruthy();
    }
  });

  it('couvre les deux retraits que le produit documentait deja en prose', () => {
    // Ils vivaient dans un commentaire de rich-results.ts et un texte `why` de
    // check-i18n.ts : le fond etait juste, la source unique manquait.
    expect(deprecation('sitelinks-searchbox')?.checks).toContain('sd-website-searchaction');
    expect(deprecationsForCheck('sd-faq').map((d) => d.id)).toContain('faq-rich-results');
  });

  it('rend undefined pour un identifiant inconnu, sans lever', () => {
    expect(deprecation('nexiste-pas')).toBeUndefined();
    expect(deprecationsForCheck('nexiste-pas')).toEqual([]);
  });
});
