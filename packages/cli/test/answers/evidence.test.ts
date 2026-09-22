import { describe, expect, it } from 'vitest';
import { buildAnswerMatrix } from '../../src/answers/matrix.js';
import { renderAnswersMarkdown, renderAnswersJson } from '../../src/report/answers.js';
import type { FetchedResource } from '../../src/types.js';

const page = (main: string): FetchedResource => ({ status: 200, ok: true, contentType: 'text/html', headers: {}, finalUrl: 'https://example.org/prices', body: `<html lang="fr"><script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme","areaServed":"Rennes","hasOfferCatalog":{"itemListElement":[{"itemOffered":{"@type":"Service","name":"Plomberie"}}]}}</script><main>${main}</main></html>` });

describe('answer evidence', () => {
  it('keeps identity markup distinct from contact affordances without exposing form field values', () => {
    const resource = page('<h2>Plomberie</h2><p>Plomberie à Rennes.</p><form><input type="hidden" value="private-token"><button>Envoyer</button></form>');
    resource.body = resource.body.replace('"name":"Acme"', '"name":"Acme","sameAs":["https://example.net/acme"]');
    const matrix = buildAnswerMatrix([resource]);
    expect(matrix.cells.find(c => c.intent === 'identity')?.proof).toMatchObject({ kind: 'markup' });
    expect(matrix.cells.find(c => c.intent === 'contact')?.proof).toMatchObject({ kind: 'affordance' });
    expect(JSON.stringify(matrix)).not.toContain('private-token');
  });

  it('keeps the actual answer and its heading, capped, without a proof for missing answers', () => {
    const matrix = buildAnswerMatrix([page('<h2>Tarifs</h2><p>La plomberie à Rennes coûte 89 € par intervention. ' + 'Une intervention comprend le déplacement et les pièces. '.repeat(12) + '</p>')]);
    const price = matrix.cells.find(c => c.intent === 'price');
    expect(price?.proof).toMatchObject({ kind: 'prose', heading: 'Tarifs' });
    expect(price?.proof?.excerpt).toContain('89 €');
    expect(price!.proof!.excerpt.length).toBeLessThanOrEqual(320);
    expect(matrix.cells.filter(c => c.state === 'missing').every(c => !c.proof)).toBe(true);
  });

  it('renders extracted evidence as inert Markdown and JSON text', () => {
    const matrix = buildAnswerMatrix([page('<h2>Tarifs</h2><p>La plomberie à Rennes coûte 89 € par intervention.</p>')]);
    matrix.cells[0].proof = { kind: 'prose', excerpt: '<img src=x onerror=alert(1)> [clic](javascript:x) | x', heading: '<script>x</script>' };
    const ctx = { sampledPages: ['/prices'], capped: false, lang: 'fr' as const };
    const md = renderAnswersMarkdown(matrix, ctx);
    expect(md).toContain('&lt;img');
    expect(md).not.toContain('<img');
    expect(md).not.toContain('[clic](javascript:x)');
    expect(JSON.parse(renderAnswersJson(matrix, ctx)).cells[0].proof.excerpt).toContain('<img');
  });
});
