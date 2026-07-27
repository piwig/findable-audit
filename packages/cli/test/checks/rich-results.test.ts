import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { richResultEligibility, GOOGLE_RICH_RESULT_RULES } from '../../src/checks/rich-results.js';

const BASE = 'http://stub.example/';

function page(pathname: string, body: string): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

function ctxFromPages(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map(pages.map((p) => [new URL(p.finalUrl).pathname, p]));
  return {
    baseUrl: new URL(BASE),
    async fetch(path: string) {
      const url = new URL(path, BASE);
      return byPath.get(url.pathname) ?? {
        status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {},
      };
    },
    sample: { pages, source: 'links' },
  };
}

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const html = (head: string, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;
const one = (node: Record<string, unknown>) => ctxFromPages([page('/', html(ld({ '@context': 'https://schema.org', ...node })))]);
const run = (node: Record<string, unknown>) => richResultEligibility.run(one(node));

describe('the Google rule table', () => {
  it('names a source and a review date for every feature', () => {
    for (const rule of GOOGLE_RICH_RESULT_RULES) {
      expect(rule.source, rule.feature).toMatch(/^https:\/\/developers\.google\.com\/search\/docs\//);
      expect(rule.reviewed, rule.feature).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rule.types.length, rule.feature).toBeGreaterThan(0);
    }
  });

  it('does not encode the sitelinks search box, which Google no longer documents', () => {
    const types = GOOGLE_RICH_RESULT_RULES.flatMap((r) => r.types);
    expect(types).not.toContain('WebSite');
  });

  it('keeps Article free of required fields, as Google states', () => {
    const article = GOOGLE_RICH_RESULT_RULES.find((r) => r.feature === 'Article')!;
    expect(article.required).toEqual([]);
  });
});

describe('rich-result-eligibility', () => {
  it('skips when no page carries a type Google documents', async () => {
    const ctx = one({ '@type': 'WebSite', url: 'https://x.example/', name: 'X' });
    expect((await richResultEligibility.run(ctx)).status).toBe('skip');
  });

  it('skips when there is no JSON-LD at all', async () => {
    const ctx = ctxFromPages([page('/', html(''))]);
    expect((await richResultEligibility.run(ctx)).status).toBe('skip');
  });

  // --- Article: recommended only, so it can never fail -----------------------

  it('warns, never fails, on an Article missing recommended fields', async () => {
    const r = await run({ '@type': 'Article', headline: 'A post' });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Article recommends');
  });

  it('passes a complete Article', async () => {
    const r = await run({
      '@type': 'Article', headline: 'A post', image: 'https://x.example/a.jpg',
      datePublished: '2026-01-02', dateModified: '2026-01-03',
      author: { '@type': 'Person', name: 'Jane', url: 'https://x.example/jane' },
    });
    expect(r.status).toBe('pass');
  });

  it('treats an unparseable recommended date as a gap, not as present', async () => {
    const r = await run({
      '@type': 'Article', headline: 'A post', image: 'https://x.example/a.jpg',
      datePublished: 'last tuesday', dateModified: '2026-01-03',
      author: { '@type': 'Person', name: 'Jane', url: 'https://x.example/jane' },
    });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('datePublished (invalid)');
  });

  // --- Product: snippet vs merchant listing ---------------------------------

  it('fails a Product with neither offers, review nor aggregateRating', async () => {
    const r = await run({ '@type': 'Product', name: 'Widget' });
    expect(r.status).toBe('fail');
    // The report names the alternatives, not just the first path of the rule.
    expect(r.message).toContain('Product snippet needs review, aggregateRating or offers');
  });

  it('grades an offer-less Product as a product snippet, not a merchant listing', async () => {
    const r = await run({
      '@type': 'Product', name: 'Widget',
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 12, bestRating: 5, worstRating: 1 },
      review: {
        '@type': 'Review', author: { '@type': 'Person', name: 'Jane' }, datePublished: '2026-01-01',
        reviewRating: { '@type': 'Rating', ratingValue: 5, bestRating: 5, worstRating: 1 },
      },
    });
    expect(r.status).toBe('pass');
    expect(r.message).not.toContain('Merchant listing');
  });

  it('fails a merchant listing missing image and priceCurrency', async () => {
    const r = await run({
      '@type': 'Product', name: 'Widget',
      offers: { '@type': 'Offer', price: '19.90' },
    });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('Merchant listing needs');
    expect(r.message).toContain('image');
  });

  it('accepts priceSpecification as the alternative Google documents', async () => {
    const r = await run({
      '@type': 'Product', name: 'Widget', image: 'https://x.example/w.jpg',
      brand: { '@type': 'Brand', name: 'Acme' }, description: 'A widget.', sku: 'W-1',
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 12, bestRating: 5, worstRating: 1 },
      review: { '@type': 'Review', author: { name: 'Jane' }, reviewRating: { ratingValue: 5, bestRating: 5, worstRating: 1 }, datePublished: '2026-01-01' },
      offers: {
        '@type': 'Offer', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition',
        priceValidUntil: '2027-01-01', url: 'https://x.example/widget',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: '19.90', priceCurrency: 'EUR' },
      },
    });
    expect(r.status).toBe('pass');
  });

  it('rejects a priceCurrency that is not a three-letter code', async () => {
    const r = await run({
      '@type': 'Product', name: 'Widget', image: 'https://x.example/w.jpg',
      offers: { '@type': 'Offer', price: '19.90', priceCurrency: 'euros' },
    });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('priceCurrency (invalid)');
  });

  // --- Breadcrumb -----------------------------------------------------------

  it('passes a BreadcrumbList whose last item has a name but no item URL', async () => {
    const r = await run({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://x.example/' },
        { '@type': 'ListItem', position: 2, name: 'Contact' },
      ],
    });
    expect(r.status).toBe('pass');
  });

  it('fails a BreadcrumbList whose items have no position', async () => {
    const r = await run({
      '@type': 'BreadcrumbList',
      itemListElement: [{ '@type': 'ListItem', name: 'Home', item: 'https://x.example/' }],
    });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('itemListElement[].position');
  });

  it('accepts a ListItem that carries its name on a Thing item', async () => {
    const r = await run({
      '@type': 'BreadcrumbList',
      itemListElement: [{ '@type': 'ListItem', position: 1, item: { '@id': 'https://x.example/', name: 'Home' } }],
    });
    expect(r.status).toBe('pass');
  });

  // --- Event ----------------------------------------------------------------

  it('fails an Event whose location carries no address', async () => {
    const r = await run({
      '@type': 'Event', name: 'Bread workshop', startDate: '2026-09-01T10:00',
      location: { '@type': 'VirtualLocation', url: 'https://x.example/live' },
    });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('location.address');
  });

  it('does not report offers sub-properties on an Event that has no offers', async () => {
    const r = await run({
      '@type': 'Event', name: 'Bread workshop', startDate: '2026-09-01T10:00',
      location: { '@type': 'Place', name: 'The bakery', address: '1 Main St, Springfield' },
      description: 'A morning of sourdough.', endDate: '2026-09-01T12:00', eventStatus: 'https://schema.org/EventScheduled',
      image: 'https://x.example/w.jpg',
      organizer: { '@type': 'Organization', name: 'Example Bakery', url: 'https://x.example/' },
      performer: { '@type': 'Person', name: 'Jane' },
    });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('offers');
    expect(r.message).not.toContain('offers.price');
  });

  // --- Video ----------------------------------------------------------------

  it('fails a VideoObject without uploadDate', async () => {
    const r = await run({ '@type': 'VideoObject', name: 'Baking', thumbnailUrl: 'https://x.example/t.jpg' });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('uploadDate');
  });

  it('passes a VideoObject with the fields Google requires and recommends', async () => {
    const r = await run({
      '@type': 'VideoObject', name: 'Baking', thumbnailUrl: 'https://x.example/t.jpg',
      uploadDate: '2026-01-02T09:00:00+01:00', description: 'How we bake.',
      contentUrl: 'https://x.example/v.mp4', duration: 'PT4M30S',
    });
    expect(r.status).toBe('pass');
  });

  // --- Review / AggregateRating and Google's nested exemption ---------------

  it('does not require itemReviewed on a review nested in the item it reviews', async () => {
    const r = await run({
      '@type': 'Product', name: 'Widget', image: 'https://x.example/w.jpg',
      brand: { '@type': 'Brand', name: 'Acme' }, description: 'A widget.', sku: 'W-1',
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 12, bestRating: 5, worstRating: 1 },
      review: {
        '@type': 'Review', author: { '@type': 'Person', name: 'Jane' },
        reviewRating: { '@type': 'Rating', ratingValue: 5, bestRating: 5, worstRating: 1 },
        datePublished: '2026-01-01',
      },
      offers: {
        '@type': 'Offer', price: '19.90', priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/NewCondition', priceValidUntil: '2027-01-01', url: 'https://x.example/widget',
      },
    });
    expect(r.status).toBe('pass');
  });

  it('does require itemReviewed on a standalone Review node', async () => {
    const r = await run({
      '@type': 'Review', author: { '@type': 'Person', name: 'Jane' },
      reviewRating: { '@type': 'Rating', ratingValue: 5 },
    });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('itemReviewed');
  });

  it('fails an aggregateRating with neither ratingCount nor reviewCount', async () => {
    const r = await run({
      '@type': 'Product', name: 'Widget',
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5 },
    });
    expect(r.status).toBe('fail');
    expect(r.message).toContain('ratingCount');
  });

  // --- Graph plumbing -------------------------------------------------------

  it('follows @id references when reading a property', async () => {
    const ctx = ctxFromPages([page('/', html(ld({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Article', headline: 'A post', image: 'https://x.example/a.jpg', datePublished: '2026-01-02', dateModified: '2026-01-03', author: { '@id': 'https://x.example/#jane' } },
        { '@type': 'Person', '@id': 'https://x.example/#jane', name: 'Jane', url: 'https://x.example/jane' },
      ],
    })))]);
    expect((await richResultEligibility.run(ctx)).status).toBe('pass');
  });

  it('rolls several pages up into one verdict and names the offenders', async () => {
    const good = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://x.example/' }] };
    const bad = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', name: 'Home' }] };
    const ctx = ctxFromPages([page('/', html(ld(good))), page('/a', html(ld(bad)))]);
    const r = await richResultEligibility.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/a');
    expect(r.message).not.toMatch(/(^|[\s,])\/(,|\s|$)/);
  });
});
