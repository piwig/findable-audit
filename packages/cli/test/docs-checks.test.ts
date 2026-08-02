import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * On 2026-08-02 the catalogue held 138 checks while every README and both guides
 * still said 137: `llms-txt-lint` had shipped without its documentation. Like the
 * flag list before it (see docs-flags.test.ts), nobody noticed because nothing
 * looked. This is that missing look for the check catalogue: the per-check i18n
 * catalogue is compared against the guides that claim to document every check and
 * the READMEs that advertise the count.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const CATALOGUE = path.join(HERE, '..', 'src', 'report', 'check-i18n.ts');
const GUIDES = [path.join(ROOT, 'docs', 'guide.md'), path.join(ROOT, 'docs', 'guide.fr.md')];
const READMES = [path.join(ROOT, 'README.md'), path.join(HERE, '..', 'README.md')];
const CHECKS_DIR = path.join(HERE, '..', 'src', 'checks');

/** Check ids declared in the CHECK_I18N catalogue, read as text (importing is fine too, but this matches docs-flags style). */
function catalogueIds(source: string): string[] {
  const start = source.indexOf('export const CHECK_I18N');
  if (start < 0) throw new Error('CHECK_I18N not found in check-i18n.ts');
  return [...source.slice(start).matchAll(/^\s{2}"([a-z0-9-]+)":\s*\{\s*why:/gm)].map((m) => m[1]);
}

/** `### \`check-id\` (N pts)` headings of a guide. */
function guideIds(source: string): string[] {
  return [...source.matchAll(/^### `([a-z0-9-]+)`/gm)].map((m) => m[1]);
}

/** Check declarations (`id: '…', family: '…', evidence: '…'`) across src/checks. */
function declarations(): Map<string, 'measured' | 'heuristic'> {
  const out = new Map<string, 'measured' | 'heuristic'>();
  for (const file of fs.readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(CHECKS_DIR, file), 'utf8');
    for (const m of source.matchAll(
      /id: '([a-z0-9-]+)', family: '[a-z-]+', evidence: '(measured|heuristic)'/g,
    )) {
      if (out.has(m[1])) throw new Error(`check déclaré deux fois : ${m[1]}`);
      out.set(m[1], m[2] as 'measured' | 'heuristic');
    }
  }
  return out;
}

describe('the check catalogue, the guides and the advertised count agree', () => {
  const ids = catalogueIds(fs.readFileSync(CATALOGUE, 'utf8'));

  it('finds the catalogue at all, so a refactor cannot make this test vacuous', () => {
    expect(ids.length).toBeGreaterThan(100);
    expect(ids).toContain('llms-txt');
  });

  for (const guide of GUIDES) {
    const name = path.basename(guide);
    it(`documents every catalogued check in ${name}, and nothing else`, () => {
      const documented = guideIds(fs.readFileSync(guide, 'utf8'));
      const missing = ids.filter((id) => !documented.includes(id));
      const stale = documented.filter((id) => !ids.includes(id));
      expect(missing, `checks sans section dans ${name} : ${missing.join(', ')}`).toEqual([]);
      expect(stale, `sections de ${name} sans check au catalogue : ${stale.join(', ')}`).toEqual([]);
      expect(documented.length).toBe(ids.length);
    });
  }

  const decls = declarations();
  const measured = [...decls.values()].filter((e) => e === 'measured').length;
  const heuristic = decls.size - measured;

  it('declares exactly the catalogued checks in src/checks, with an evidence kind each', () => {
    expect([...decls.keys()].sort()).toEqual([...ids].sort());
  });

  for (const readme of [...READMES, ...GUIDES]) {
    const name = path.relative(ROOT, readme);
    it(`advertises the real check count in ${name}`, () => {
      const text = fs.readFileSync(readme, 'utf8');
      // "NNN checks grade against …" advertises the measured split, not the total.
      const claims = [...text.matchAll(/(\d+) checks(?!\s+grade\s+against)/g)]
        .map((m) => Number(m[1]))
        .filter((n) => n > 100); // ignore unrelated small counts ("5 checks failed" prose)
      expect(claims.length, `${name} ne mentionne aucun compte de checks`).toBeGreaterThan(0);
      const wrong = claims.filter((n) => n !== ids.length);
      expect(wrong, `${name} annonce ${wrong.join(', ')} au lieu de ${ids.length}`).toEqual([]);
    });

    it(`advertises the real measured/heuristic split in ${name}, when it mentions one`, () => {
      const text = fs.readFileSync(readme, 'utf8');
      const measuredClaims = [
        ...text.matchAll(/(\d+) checks grade against/g),
        ...text.matchAll(/(\d+) (?:are measured|sont mesurés)/g),
      ].map((m) => Number(m[1]));
      const heuristicClaims = [
        ...text.matchAll(/(\d+) (?:are heuristics|heuristics?\b|heuristiques?\b)/g),
      ].map((m) => Number(m[1]));
      expect(measuredClaims.filter((n) => n !== measured), `${name}: mesurés ≠ ${measured}`).toEqual([]);
      expect(heuristicClaims.filter((n) => n !== heuristic), `${name}: heuristiques ≠ ${heuristic}`).toEqual([]);
    });
  }
});
