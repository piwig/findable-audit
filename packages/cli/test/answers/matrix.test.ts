import { describe, it, expect } from 'vitest';
import type { FetchedResource } from '../../src/types.js';
import { buildAnswerMatrix, coverageRatio } from '../../src/answers/matrix.js';

function page(body: string, pathname = '/'): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: `https://stub.example${pathname}`, headers: {},
  };
}

/** A LocalBusiness declaring one service and one area — the smallest gradable site. */
const DECLARED = {
  '@type': 'LocalBusiness',
  name: 'Acme',
  areaServed: [{ '@type': 'City', name: 'Rennes' }],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    itemListElement: [{ '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Plomberie' } }],
  },
};

function site(main: string, extraLd: Record<string, unknown> = {}): FetchedResource[] {
  const graph = JSON.stringify([{ ...DECLARED, ...extraLd }]);
  return [page(`<html><head><script type="application/ld+json">${graph}</script></head><body><main>${main}</main></body></html>`)];
}

const cell = (m: ReturnType<typeof buildAnswerMatrix>, intent: string) => m.cells.find((c) => c.intent === intent);

describe('buildAnswerMatrix', () => {
  it('produces no cells at all when the site declares nothing', () => {
    const m = buildAnswerMatrix([page('<html><body><p>Bienvenue.</p></body></html>')]);
    expect(m.cells).toEqual([]);
    expect(m.subjects).toEqual([]);
  });

  it('generates a question per declared subject and applicable intent', () => {
    const m = buildAnswerMatrix(site('<h2>Plomberie</h2><p>Nous intervenons.</p>'));
    expect(m.cells.length).toBeGreaterThan(0);
    expect(m.cells.every((c) => c.question.includes('Plomberie'))).toBe(true);
    expect(cell(m, 'price')?.question).toContain('Rennes');
  });

  it('marks a cell covered when a self-contained window carries the evidence', () => {
    const main = '<h2>Tarifs de plomberie à Rennes</h2>'
      + '<p>Le dépannage de plomberie à Rennes coûte 89 € pour un déplacement et la première heure. '
      + 'Le tarif est annoncé avant toute intervention, et il ne bouge pas après coup.</p>';
    expect(cell(buildAnswerMatrix(site(main)), 'price')?.state).toBe('covered');
  });

  // The most interesting state of the product: the answer exists but is not extractable.
  // Here the amount sits in a window that opens on "Celui-ci", whose antecedent stayed
  // behind — a retriever handing the model this window alone gives it nothing to quote.
  it('marks a cell weak when the evidence is there but the window cannot stand alone', () => {
    const main = '<h2>Nos tarifs</h2><p>Celui-ci, pour la plomberie à Rennes, est de 89 € et il ne bouge pas après coup.</p>';
    expect(cell(buildAnswerMatrix(site(main)), 'price')?.state).toBe('weak');
  });

  it('marks a cell missing when nothing answers it', () => {
    const m = buildAnswerMatrix(site('<h2>Plomberie</h2><p>Nous intervenons vite et bien.</p>'));
    expect(cell(m, 'price')?.state).toBe('missing');
  });

  it('records the page that carries the evidence, so the report can point at it', () => {
    const main = '<h2>Tarifs de plomberie à Rennes</h2><p>Le dépannage de plomberie à Rennes coûte 89 € par déplacement, annoncé avant intervention.</p>';
    expect(cell(buildAnswerMatrix(site(main)), 'price')?.path).toBe('/');
  });
});

describe('coverageRatio', () => {
  it('is the share of covered cells, and 0 when there are no cells', () => {
    expect(coverageRatio({ cells: [] } as never)).toBe(0);
    const cells = [{ state: 'covered' }, { state: 'weak' }, { state: 'missing' }, { state: 'covered' }];
    expect(coverageRatio({ cells } as never)).toBe(0.5);
  });
});
