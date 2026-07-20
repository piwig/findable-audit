import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { sdArticle, sdProduct, sdFaq, sdBreadcrumb, napConsistency } from '../../src/checks/structured-data-mp.js';

const BASE = 'http://stub.example/';

function page(pathname: string, body: string, extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

/** CrawlContext backed by an in-memory page list, mirroring test/checks/on-page.test.ts's helper. */
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

describe('sd-article', () => {
  it('skips when no Article/NewsArticle/BlogPosting page is in the sample', async () => {
    const ctx = ctxFromPages([page('/', html(ld({ '@context': 'https://schema.org', '@type': 'WebSite', url: 'https://x.example/' })))]);
    expect((await sdArticle.run(ctx)).status).toBe('skip');
  });
  it('fails when the Article has no headline', async () => {
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/blog/post.html', html(ld({ '@context': 'https://schema.org', '@type': 'Article', datePublished: '2024-01-01' }))),
    ]);
    expect((await sdArticle.run(ctx)).status).toBe('fail');
  });
  it('warns when the Article is missing author/dateModified/image/publisher.logo', async () => {
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/blog/post.html', html(ld({
        '@context': 'https://schema.org', '@type': 'Article', headline: 'A Great Post', datePublished: '2024-01-01',
      }))),
    ]);
    expect((await sdArticle.run(ctx)).status).toBe('warn');
  });
  it('passes with a complete Article', async () => {
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/blog/post.html', html(ld({
        '@context': 'https://schema.org', '@type': 'Article', headline: 'A Great Post',
        datePublished: '2024-01-01', dateModified: '2024-01-02',
        author: { '@type': 'Person', name: 'Jane Doe' },
        image: { '@type': 'ImageObject', url: 'https://x.example/img.jpg', width: 1200 },
        publisher: { '@type': 'Organization', name: 'Pub', logo: 'https://x.example/logo.png' },
      }))),
    ]);
    expect((await sdArticle.run(ctx)).status).toBe('pass');
  });
});

describe('sd-product', () => {
  it('skips when no Product page is in the sample', async () => {
    const ctx = ctxFromPages([page('/', html(''))]);
    expect((await sdProduct.run(ctx)).status).toBe('skip');
  });
  it('fails when the Product has no offers', async () => {
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/shop/widget.html', html(ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Widget' }))),
    ]);
    expect((await sdProduct.run(ctx)).status).toBe('fail');
  });
  it('warns when offers are valid but name/image/availability/brand/rating/identifier are missing', async () => {
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/shop/widget.html', html(ld({
        '@context': 'https://schema.org', '@type': 'Product',
        offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'USD' },
      }))),
    ]);
    expect((await sdProduct.run(ctx)).status).toBe('warn');
  });
  it('passes with a complete Product offer', async () => {
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/shop/widget.html', html(ld({
        '@context': 'https://schema.org', '@type': 'Product', name: 'Widget', image: 'https://x.example/widget.jpg',
        brand: { '@type': 'Brand', name: 'Acme' }, gtin13: '1234567890123',
        offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '10' },
      }))),
    ]);
    expect((await sdProduct.run(ctx)).status).toBe('pass');
  });
});

describe('sd-faq', () => {
  it('skips when there is no FAQ-shaped content', async () => {
    const ctx = ctxFromPages([page('/', html('', '<h2>About Us</h2><p>We are a bakery.</p>'))]);
    expect((await sdFaq.run(ctx)).status).toBe('skip');
  });
  it('warns when FAQ-shaped content has no FAQPage schema backing it', async () => {
    const body = '<details><summary>What is this?</summary><p>This is an answer to the question.</p></details>'
      + '<details><summary>How does it work?</summary><p>It works like this, in detail.</p></details>';
    const ctx = ctxFromPages([page('/', html('', body))]);
    expect((await sdFaq.run(ctx)).status).toBe('warn');
  });
  it('passes when FAQ content is backed by FAQPage/QAPage schema', async () => {
    const head = ld({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: 'What is this?', acceptedAnswer: { '@type': 'Answer', text: 'This is an answer.' } },
        { '@type': 'Question', name: 'How does it work?', acceptedAnswer: { '@type': 'Answer', text: 'It works like this.' } },
      ],
    });
    const ctx = ctxFromPages([page('/', html(head))]);
    expect((await sdFaq.run(ctx)).status).toBe('pass');
  });
});

describe('sd-breadcrumb', () => {
  it('skips on a homepage-only sample', async () => {
    const ctx = ctxFromPages([page('/', html(''))]);
    expect((await sdBreadcrumb.run(ctx)).status).toBe('skip');
  });
  it('warns when an interior page has no breadcrumb schema or nav', async () => {
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/about.html', html('', '<p>About us.</p>')),
    ]);
    expect((await sdBreadcrumb.run(ctx)).status).toBe('warn');
  });
  it('passes when the interior page has a valid BreadcrumbList', async () => {
    const head = ld({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://x.example/' },
        { '@type': 'ListItem', position: 2, name: 'About' },
      ],
    });
    const ctx = ctxFromPages([
      page('/', html('')),
      page('/about.html', html(head, '<p>About us.</p>')),
    ]);
    expect((await sdBreadcrumb.run(ctx)).status).toBe('pass');
  });
});

describe('nap-consistency', () => {
  it('skips when there is no NAP (phone) anywhere', async () => {
    const ctx = ctxFromPages([page('/', html(''))]);
    expect((await napConsistency.run(ctx)).status).toBe('skip');
  });
  it('passes with JSON-LD NAP present and no page footer phone to cross-check', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100' });
    const ctx = ctxFromPages([page('/', html(head))]);
    expect((await napConsistency.run(ctx)).status).toBe('pass');
  });
  it('passes when footer phones match the JSON-LD NAP across pages', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100' });
    const footer = '<footer><p>Biz — <a href="tel:+15550100">+1-555-0100</a></p></footer>';
    const ctx = ctxFromPages([
      page('/', html(head, footer)),
      page('/contact.html', html('', footer)),
    ]);
    expect((await napConsistency.run(ctx)).status).toBe('pass');
  });
  it('fails when a page footer phone mismatches the JSON-LD NAP', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100' });
    const footerGood = '<footer><p>Biz — <a href="tel:+15550100">+1-555-0100</a></p></footer>';
    const footerBad = '<footer><p>Biz — <a href="tel:+15559999">+1-555-9999</a></p></footer>';
    const ctx = ctxFromPages([
      page('/', html(head, footerGood)),
      page('/contact.html', html('', footerBad)),
    ]);
    expect((await napConsistency.run(ctx)).status).toBe('fail');
  });
});
