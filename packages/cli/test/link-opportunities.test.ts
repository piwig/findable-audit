import { describe, it, expect } from 'vitest';
import { buildLinkOpportunities } from '../src/links/opportunities.js';
import type { FetchedResource } from '../src/types.js';

function page(path: string, html: string): FetchedResource {
  return { finalUrl: `https://example.com${path}`, status: 200, headers: { 'content-type': 'text/html' }, body: html } as FetchedResource;
}
const target = page('/presence/', '<html lang="fr"><head><title>Présence numérique | PB</title></head><body><main><h1>Présence numérique</h1><p>Une prestation.</p></main></body></html>');

describe('existing anchor link opportunities', () => {
  it('suggests a real, nonlinked text phrase with its source context', () => {
    const from = page('/article/', '<main><h1>Notre guide</h1><p>Nous pouvons améliorer votre présence numérique avec des contenus utiles.</p></main>');
    const result = buildLinkOpportunities([from, target], new URL('https://example.com'));
    expect(result).toEqual([{ sourcePath: '/article/', targetPath: '/presence/', anchor: 'présence numérique', excerpt: 'Nous pouvons améliorer votre présence numérique avec des contenus utiles.', basis: 'existing-anchor', reviewRequired: true }]);
  });
  it('abstains for an existing target link, an already-linked phrase, navigation and partial words', () => {
    const bodies = [
      '<main><p>Notre présence numérique.</p><a href="/presence/#faq">Voir</a></main>',
      '<main><p>Notre <a href="/other/">présence numérique</a>.</p></main>',
      '<main><p>Notre présence <a href="/other/">autre texte</a>numérique.</p></main>',
      '<main><a href="/other/"><p>Notre présence numérique.</p></a></main>',
      '<nav>Présence numérique</nav><main><p>Un contenu sans relation.</p></main>',
      '<main><p>Notre omniprésence numériques est une autre expression.</p></main>',
    ];
    for (const body of bodies) expect(buildLinkOpportunities([page('/article/', body), target], new URL('https://example.com'))).toEqual([]);
  });
  it('ignores nonindexable, redirected off-origin and vague one-word destinations', () => {
    const from = page('/article/', '<main><p>La présence numérique et les services sont utiles.</p></main>');
    const hidden = page('/hidden/', '<meta name="robots" content="noindex"><main><h1>Présence numérique</h1></main>');
    const outside = { ...target, finalUrl: 'https://other.test/presence/' };
    const vague = page('/services/', '<main><h1>Services</h1></main>');
    const duplicate = page('/presence/?page=2', '<link rel="canonical" href="/presence/?page=1"><main><h1>Présence numérique</h1></main>');
    expect(buildLinkOpportunities([from, hidden, outside, vague, duplicate], new URL('https://example.com'))).toEqual([]);
  });
  it('does not match script/style/hidden copy and limits deterministic suggestions', () => {
    const from = page('/article/', '<main><script>présence numérique</script><p hidden>présence numérique</p><p aria-hidden="true">présence numérique</p><p>Notre <span aria-hidden="TRUE">présence numérique</span>.</p></main>');
    expect(buildLinkOpportunities([from, target], new URL('https://example.com'))).toEqual([]);
    const pages = Array.from({ length: 25 }, (_, n) => page(`/guide-${n}/`, '<main><p>Notre présence numérique est utile.</p></main>'));
    const result = buildLinkOpportunities([...pages, target], new URL('https://example.com'));
    expect(result).toHaveLength(20);
    expect(result.every(item => item.excerpt.length <= 320)).toBe(true);
  });
});
