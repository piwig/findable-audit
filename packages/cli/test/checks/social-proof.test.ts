import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { socialProof } from '../../src/checks/social-proof.js';

const BASE = 'http://stub.example/';

function page(pathname: string, body: string, extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

/** CrawlContext backed by an in-memory page list, mirroring test/checks/structured-data-mp.test.ts's helper. */
function ctxFromPages(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map(pages.map((p) => [new URL(p.finalUrl).pathname, p]));
  return {
    baseUrl: new URL(BASE),
    async fetch(path: string) {
      const url = new URL(path, BASE);
      const found = byPath.get(url.pathname);
      if (!found) {
        return { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
      }
      return found;
    },
    sample: { pages, source: 'links' },
  };
}

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const html = (head: string, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;

describe('social-proof (A8)', () => {
  it('skips when no relevant type is declared anywhere', async () => {
    const ctx = ctxFromPages([
      page('/', html(ld({ '@context': 'https://schema.org', '@type': 'WebSite', url: 'https://x.example/' }))),
      page('/blog/post.html', html(ld({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Post' }))),
    ]);
    expect((await socialProof.run(ctx)).status).toBe('skip');
  });

  it('warns when Product/LocalBusiness markup exists without any rating markup', async () => {
    const ctx = ctxFromPages([
      page('/', html(ld({ '@context': 'https://schema.org', '@type': 'Plumber', name: 'Pipes & Co' }))),
    ]);
    const res = await socialProof.run(ctx);
    expect(res.status).toBe('warn');
    expect(res.fix).toBeTruthy();
  });

  it('passes with a complete AggregateRating attached to a Product', async () => {
    const ctx = ctxFromPages([
      page('/shop/widget.html', html(ld({
        '@context': 'https://schema.org', '@type': 'Product', name: 'Widget',
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.4', reviewCount: 89 },
      }))),
    ]);
    expect((await socialProof.run(ctx)).status).toBe('pass');
  });

  it('passes with a complete standalone Review node', async () => {
    const ctx = ctxFromPages([
      page('/', html(ld({
        '@context': 'https://schema.org', '@type': 'Review',
        author: { '@type': 'Person', name: 'Jane' },
        reviewRating: { '@type': 'Rating', ratingValue: '5' },
        itemReviewed: { '@type': 'LocalBusiness', name: 'Shop' },
      }))),
    ]);
    expect((await socialProof.run(ctx)).status).toBe('pass');
  });

  it('warns when the only rating markup is incomplete (no ratingValue/count)', async () => {
    const ctx = ctxFromPages([
      page('/', html(ld({
        '@context': 'https://schema.org', '@type': 'Product', name: 'Widget',
        aggregateRating: { '@type': 'AggregateRating' },
      }))),
    ]);
    const res = await socialProof.run(ctx);
    expect(res.status).toBe('warn');
    expect(String(res.message)).toContain('unusable');
  });

  it('warns (not pass) when one page is complete but another declares unusable markup', async () => {
    const ctx = ctxFromPages([
      page('/a.html', html(ld({
        '@context': 'https://schema.org', '@type': 'Product', name: 'A',
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.0', ratingCount: 12 },
      }))),
      page('/b.html', html(ld({
        '@context': 'https://schema.org', '@type': 'Product', name: 'B',
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.9' },
      }))),
    ]);
    expect((await socialProof.run(ctx)).status).toBe('warn');
  });
});
