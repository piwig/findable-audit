import { describe, it, expect } from 'vitest';
import type { FetchedResource } from '../../src/types.js';
import { buildAnswerMatrix } from '../../src/answers/matrix.js';
import { pickAnswersRenderer, renderAnswersJson, renderAnswersMarkdown } from '../../src/report/answers.js';

const GRAPH = JSON.stringify([{
  '@type': 'LocalBusiness',
  name: 'Acme Plomberie',
  areaServed: [{ '@type': 'City', name: 'Rennes' }],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    itemListElement: [{ '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Plomberie' } }],
  },
}]);

function corpus(main: string): FetchedResource[] {
  const body = `<html lang="fr"><head><script type="application/ld+json">${GRAPH}</script></head>`
    + `<body><main>${main}</main><footer><a href="tel:+33299000000">appeler</a></footer></body></html>`;
  return [{ status: 200, ok: true, body, contentType: 'text/html', finalUrl: 'https://stub.example/', headers: {} }];
}

const MATRIX = buildAnswerMatrix(corpus(
  '<h2>Prix de la plomberie à Rennes</h2><p>Une intervention de plomberie à Rennes coûte 89 € par déplacement.</p>',
));
const CTX = { sampledPages: ['/', '/tarifs/'], capped: false, lang: 'fr' as const };

describe('pickAnswersRenderer', () => {
  it('routes by extension and refuses anything it cannot write', () => {
    expect(pickAnswersRenderer('m.json')).toBe(renderAnswersJson);
    expect(pickAnswersRenderer('m.md')).toBe(renderAnswersMarkdown);
    expect(pickAnswersRenderer('m.html')).toBeNull();
    expect(pickAnswersRenderer('')).toBeNull();
  });
});

describe('renderAnswersJson', () => {
  it('carries the matrix and the sample it rests on', () => {
    const out = JSON.parse(renderAnswersJson(MATRIX, CTX));
    expect(out.generatedFrom.sampledPages).toEqual(['/', '/tarifs/']);
    expect(out.cells.length).toBe(MATRIX.cells.length);
    expect(out.subjects[0].label).toBe('Plomberie');
  });

  it('states the provenance of the questions in the file itself', () => {
    const out = JSON.parse(renderAnswersJson(MATRIX, CTX));
    expect(out.disclosure).toMatch(/déclare/);
  });
});

describe('renderAnswersMarkdown', () => {
  it('leads with the provenance disclosure, before any table', () => {
    const md = renderAnswersMarkdown(MATRIX, CTX);
    expect(md.indexOf('déclare')).toBeLessThan(md.indexOf('| Sujet'));
  });

  it('names the pages the matrix was built from', () => {
    expect(renderAnswersMarkdown(MATRIX, CTX)).toContain('/, /tarifs/');
  });

  // A gap found on a truncated crawl is not evidence of a gap on the site. Saying so is
  // the difference between a diagnosis and an accusation.
  it('warns when the crawl stopped at its page limit, and stays quiet otherwise', () => {
    expect(renderAnswersMarkdown(MATRIX, { ...CTX, capped: true })).toContain('⚠️');
    expect(renderAnswersMarkdown(MATRIX, CTX)).not.toContain('⚠️');
  });

  it('collapses the zone variants of one question into a single column', () => {
    const md = renderAnswersMarkdown(MATRIX, CTX);
    const rows = md.split('\n').filter((l) => l.startsWith('| Plomberie |'));
    expect(rows).toHaveLength(1);
  });

  it('says plainly when a site declares nothing to build questions from', () => {
    const empty = buildAnswerMatrix([{
      status: 200, ok: true, contentType: 'text/html', headers: {},
      finalUrl: 'https://stub.example/', body: '<html lang="fr"><body><p>Bonjour.</p></body></html>',
    }]);
    const md = renderAnswersMarkdown(empty, CTX);
    expect(md).toMatch(/ne déclare ni service ni zone/);
    expect(md).not.toContain('| Sujet');
  });

  it('is written in the report language, not the site language', () => {
    expect(renderAnswersMarkdown(MATRIX, { ...CTX, lang: 'en' })).toContain('Answer matrix');
    expect(renderAnswersMarkdown(MATRIX, CTX)).toContain('Matrice de réponses');
  });
});
