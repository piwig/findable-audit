import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { FetchedResource } from '../../src/types.js';
import { buildAnswerMatrix, type Cell } from '../../src/answers/matrix.js';

/**
 * §12.3 of the design — the ground-truth gate, and the one that decides whether the matrix
 * may ship a `missing` verdict at all.
 *
 * Three real sites, captured offline (`test/fixtures/answers-gold/`), two schema.org
 * buckets, and a French local-services site — the case the feature exists for, and the one
 * our own site does not represent. Framework bundles and stylesheets were stripped from the
 * captures: the matrix never reads them, and a 240 KB chunk in the repository is noise
 * nobody can review. JSON-LD and body copy are verbatim.
 *
 * The two errors are not symmetric, so the assertions are not either:
 *
 *   - a false `missing` is what destroys trust — the client opens the page and reads the
 *     answer we called absent. Zero tolerance.
 *   - a false `covered` tells them they are fine when they are not. Zero tolerance.
 *   - `weak` vs `covered` is a judgement on extractability. Tolerated.
 *
 * Every label below was verified by reading the captured page, not by accepting the
 * matrix's own output. Two defects were found that way and fixed before this file existed:
 * subjects were picking up language switchers and marketing taglines, and a `location` cell
 * was reported covered because a subject and an area co-occurred in one 512-token window
 * three hundred tokens apart, asserting nothing.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'answers-gold');

function corpus(site: string): FetchedResource[] {
  const dir = path.join(FIXTURES, site);
  return fs.readdirSync(dir).map((f) => ({
    status: 200,
    ok: true,
    contentType: 'text/html',
    headers: {},
    finalUrl: `https://${site}.example/${f === 'home.html' ? '' : f.replace('.html', '')}`,
    body: fs.readFileSync(path.join(dir, f), 'utf8'),
  }));
}

/** `answered` = a human reading the capture finds the answer. `unanswered` = it is not there. */
type Truth = 'answered' | 'unanswered';

interface Label { site: string; intent: string; subject: string; zone?: string; truth: Truth; why: string }

const GOLD: Label[] = [
  // --- masse-motoculture — retailer, LocalBusiness, FR ------------------------
  { site: 'masse', intent: 'location', subject: 'Magasins', zone: "Val d'Izé", truth: 'answered', why: '"Deux magasins en Ille-et-Vilaine : Val d Ize, le siege, pres de Vitre, et Liffre"' },
  { site: 'masse', intent: 'location', subject: 'Magasins', zone: 'Ille-et-Vilaine', truth: 'answered', why: '"entreprise familiale d Ille-et-Vilaine : deux magasins, un atelier integre"' },
  { site: 'masse', intent: 'hours', subject: 'Services', truth: 'answered', why: 'openingHoursSpecification declare dans le JSON-LD' },
  { site: 'masse', intent: 'contact', subject: 'Services', truth: 'answered', why: 'lien tel: present sur la page' },
  { site: 'masse', intent: 'identity', subject: 'Services', truth: 'answered', why: 'Organization nommee avec sameAs' },
  { site: 'masse', intent: 'price', subject: 'Services', zone: "Val d'Izé", truth: 'unanswered', why: 'aucun montant dans le contenu principal des deux pages capturees' },
  { site: 'masse', intent: 'price', subject: 'Marques', zone: 'Ille-et-Vilaine', truth: 'unanswered', why: 'idem — un revendeur ne publie pas ses prix sur ces pages' },
  { site: 'masse', intent: 'location', subject: 'Occasion', zone: "Val d'Izé", truth: 'unanswered', why: 'aucune phrase ne relie l occasion a cette commune' },

  // --- pb-ot.fr — services company, LocalBusiness by address, FR --------------
  { site: 'pb-ot', intent: 'location', subject: 'Intelligence artificielle', zone: 'Bretagne', truth: 'answered', why: '"partenaire technique des PME de Bretagne : integration de l intelligence artificielle"' },
  { site: 'pb-ot', intent: 'location', subject: 'Logiciels libres', zone: 'Bretagne', truth: 'answered', why: 'meme phrase, "deploiement de logiciels libres"' },
  { site: 'pb-ot', intent: 'identity', subject: 'Intelligence artificielle', truth: 'answered', why: 'Organization avec sameAs declare' },
  { site: 'pb-ot', intent: 'price', subject: 'Intelligence artificielle', zone: 'Rennes', truth: 'unanswered', why: 'aucun montant sur les deux pages capturees' },
  { site: 'pb-ot', intent: 'hours', subject: 'Méthode', truth: 'unanswered', why: 'aucune plage horaire, ni en prose ni en balisage' },
  { site: 'pb-ot', intent: 'process', subject: 'Méthode', truth: 'unanswered', why: 'aucun marqueur d etape sur les pages capturees' },

  // --- findable.bordebat.fr — product site, not a local business, FR ---------
  { site: 'findable', intent: 'identity', subject: 'À propos de findable-audit', truth: 'answered', why: 'Organization avec sameAs' },
  { site: 'findable', intent: 'contact', subject: 'À propos de findable-audit', truth: 'unanswered', why: 'ni tel: ni mailto: ni formulaire soumettable sur les deux pages capturees' },
];

const matrices = new Map(['masse', 'pb-ot', 'findable'].map((s) => [s, buildAnswerMatrix(corpus(s))]));

function find(l: Label): Cell | undefined {
  return matrices.get(l.site)!.cells.find((c) => c.intent === l.intent
    && c.subject.label === l.subject
    && (l.zone === undefined || c.zone?.label === l.zone));
}

describe('§12.3 — ground truth on three real sites', () => {
  it('covers at least three sites and two schema.org buckets', () => {
    expect(matrices.size).toBe(3);
    expect(new Set([...matrices.values()].map((m) => m.bucket)).size).toBeGreaterThanOrEqual(2);
  });

  it('every labelled cell exists in the matrix', () => {
    expect(GOLD.filter((l) => !find(l)).map((l) => `${l.site}/${l.intent}/${l.subject}`)).toEqual([]);
  });

  // Blocking. If this ever fails, the fix is the predicate, never the label.
  it('never reports an answered question as missing', () => {
    const wrong = GOLD.filter((l) => l.truth === 'answered' && find(l)?.state === 'missing');
    expect(wrong.map((l) => `${l.site}/${l.intent}/${l.subject} — ${l.why}`)).toEqual([]);
  });

  // Blocking.
  it('never reports an unanswered question as covered', () => {
    const wrong = GOLD.filter((l) => l.truth === 'unanswered' && find(l)?.state === 'covered');
    expect(wrong.map((l) => `${l.site}/${l.intent}/${l.subject} — ${l.why}`)).toEqual([]);
  });

  it('carries enough labels to mean something', () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(15);
  });
});
