import { describe, it, expect } from 'vitest';
import type { FetchedResource } from '../../src/types.js';
import { buildAnswerMatrix, coverageRatio } from '../../src/answers/matrix.js';

/**
 * §12.1 of the design — the separation gate.
 *
 * Two twin corpora carrying THE SAME FACTS: one stated the way a retriever can use
 * (declared markup, descriptive headings, self-contained paragraphs), the other buried in
 * a single unheaded blob that opens on back-references. If the matrix cannot tell them
 * apart, the predicates are not measuring anything and no threshold will rescue them.
 *
 * This gate replaces the criterion first proposed for this feature ("weak should be the
 * majority"), which was a distribution target: it pushed toward tuning the instrument
 * until the picture looked good rather than until it was true. A good site SHOULD come
 * out mostly covered — that is a success, not an instrument failure.
 */

const GRAPH = JSON.stringify([{
  '@type': 'LocalBusiness',
  name: 'Acme Plomberie',
  areaServed: [{ '@type': 'City', name: 'Rennes' }],
  address: { '@type': 'PostalAddress', addressLocality: 'Rennes', postalCode: '35000' },
  sameAs: ['https://fr.wikipedia.org/wiki/Acme'],
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', opens: '08:00', closes: '18:00' }],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    itemListElement: [{ '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Plomberie' } }],
  },
}]);

function corpus(main: string, extraBody = ''): FetchedResource[] {
  const body = `<html lang="fr"><head><script type="application/ld+json">${GRAPH}</script></head>`
    + `<body><main>${main}</main>${extraBody}</body></html>`;
  return [{ status: 200, ok: true, body, contentType: 'text/html', finalUrl: 'https://stub.example/', headers: {} }];
}

const CONTACT_LINK = '<footer><a href="tel:+33299000000">02 99 00 00 00</a></footer>';

/** Same facts, written so each answer stands on its own under a heading that names it. */
const RICH = corpus(
  '<h2>Prix d une intervention de plomberie à Rennes</h2>'
  + '<p>Une intervention de plomberie à Rennes coûte 89 € pour le déplacement et la première heure. '
  + 'Le montant est annoncé avant le début des travaux et ne change pas ensuite.</p>'
  + '<h2>Horaires de la plomberie à Rennes</h2>'
  + '<p>L atelier de plomberie de Rennes est ouvert du lundi au vendredi, 8h - 18h, et le samedi 9h - 12h.</p>'
  + '<h2>Zone couverte pour la plomberie</h2>'
  + '<p>Nos équipes de plomberie interviennent dans tout Rennes et sa première couronne, sans supplément de déplacement.</p>'
  + '<h2>Comment se passe une intervention de plomberie</h2>'
  + '<p>Étape 1 : vous décrivez la panne au téléphone. Étape 2 : nous annonçons un prix ferme. Étape 3 : nous intervenons.</p>',
  CONTACT_LINK,
);

/** The same facts, in one unheaded blob whose sentences point back at each other. */
const POOR = corpus(
  '<p>Bienvenue chez Acme. Celui-ci, pour la plomberie à Rennes, est de 89 € et il ne bouge pas ensuite. '
  + 'Elle est ouverte du lundi au vendredi, 8h - 18h. Ceux-ci interviennent dans tout Rennes pour la plomberie. '
  + 'Cela se passe en trois temps : 1. l appel. 2. le prix. 3. l intervention.</p>',
  CONTACT_LINK,
);

describe('§12.1 — separation gate', () => {
  it('both corpora generate the same questions, so the comparison is fair', () => {
    const rich = buildAnswerMatrix(RICH);
    const poor = buildAnswerMatrix(POOR);
    expect(poor.cells.map((c) => c.question)).toEqual(rich.cells.map((c) => c.question));
    expect(rich.cells.length).toBeGreaterThan(0);
  });

  // Measured over the PROSE cells only. Cells settled by markup or by an affordance are
  // identical between the twins by construction — that is what makes them twins — so
  // including them would dilute the very signal the gate exists to measure.
  it('separates a retrievable corpus from a buried one by at least 40 points', () => {
    const prose = (pages: typeof RICH) => {
      const cells = buildAnswerMatrix(pages).cells.filter((c) => c.evidence === 'prose');
      return cells.length === 0 ? 0 : Math.round((cells.filter((c) => c.state === 'covered').length / cells.length) * 100);
    };
    const rich = prose(RICH);
    const poor = prose(POOR);
    expect(rich - poor, `couverture en prose : riche ${rich}% vs pauvre ${poor}%`).toBeGreaterThanOrEqual(40);
  });

  it('still reports an overall coverage ratio, prose and markup together', () => {
    expect(coverageRatio(buildAnswerMatrix(RICH))).toBeGreaterThan(coverageRatio(buildAnswerMatrix(POOR)));
  });

  // §12.2 — the survival half must do work of its own. The buried corpus holds every
  // fact, so anything it loses was lost to extractability, not to absence.
  it('the buried corpus still holds the evidence, it simply cannot be quoted', () => {
    const poor = buildAnswerMatrix(POOR);
    expect(poor.cells.some((c) => c.state === 'weak')).toBe(true);
  });
});
