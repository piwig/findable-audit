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
  // Regression (2026-07-26): the question-heading test was English-only, so a
  // French FAQ was invisible here and the check silently skipped instead of
  // asking for FAQPage markup.
  it('detects a French heading FAQ with no question mark', async () => {
    const body = '<h3>Comment fonctionne le score</h3><p>Chaque contrôle rapporte des points.</p>'
      + '<h3>Pourquoi auditer son site</h3><p>Pour être trouvé et cité par les IA.</p>';
    const ctx = ctxFromPages([page('/', html('', body))]);
    expect((await sdFaq.run(ctx)).status).toBe('warn');
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
  it('aggregate-warns when footer addresses mostly agree but one page diverges', async () => {
    const head = ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Springfield' },
    });
    const footerGood = '<footer><p>Biz — 1 Main St, Springfield</p></footer>';
    const footerBad = '<footer><p>Biz — 99 Other Ave, Shelbyville</p></footer>';
    const ctx = ctxFromPages([
      page('/', html(head, footerGood)),
      page('/a.html', html('', footerGood)),
      page('/b.html', html('', footerGood)),
      page('/c.html', html('', footerGood)),
      page('/d.html', html('', footerBad)),
    ]);
    expect((await napConsistency.run(ctx)).status).toBe('warn');
  });
  it('warns when footer addresses agree with each other but conflict with the JSON-LD address', async () => {
    const head = ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Springfield' },
    });
    const footer = '<footer><p>Biz — 42 Elm Street, Shelbyville</p></footer>';
    const ctx = ctxFromPages([
      page('/', html(head, footer)),
      page('/a.html', html('', footer)),
    ]);
    expect((await napConsistency.run(ctx)).status).toBe('warn');
  });
  // A31: name dimension from the footer copyright line.
  it('passes when the copyright-line name matches the JSON-LD org name (case/noise-insensitive)', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Acme Bakery', telephone: '+1-555-0100' });
    const footer = '<footer><p>© 2026 ACME BAKERY. All rights reserved. — <a href="tel:+15550100">+1-555-0100</a></p></footer>';
    const ctx = ctxFromPages([
      page('/', html(head, footer)),
      page('/contact.html', html('', footer)),
    ]);
    expect((await napConsistency.run(ctx)).status).toBe('pass');
  });
  it('warns when the copyright-line name consistently differs from the JSON-LD org name', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Acme Holdings LLC', telephone: '+1-555-0100' });
    const footer = '<footer><p>© 2026 Acme Bakery — <a href="tel:+15550100">+1-555-0100</a></p></footer>';
    const ctx = ctxFromPages([
      page('/', html(head, footer)),
      page('/a.html', html('', footer)),
    ]);
    const result = await napConsistency.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('name');
  });
  it('ignores a copyright line with no name ("© 2026" alone)', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100' });
    const footer = '<footer><p>© 2026 — <a href="tel:+15550100">+1-555-0100</a></p></footer>';
    const ctx = ctxFromPages([page('/', html(head, footer))]);
    expect((await napConsistency.run(ctx)).status).toBe('pass');
  });
  // A31: semantic <address> element extraction (contact pages without a footer NAP string).
  it('passes when a contact-page <address> matches the JSON-LD address', async () => {
    const head = ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Springfield' },
    });
    const contact = '<main><address>1 Main St, Springfield<br>+1-555-0100</address></main>';
    const ctx = ctxFromPages([
      page('/', html(head)),
      page('/contact.html', html('', contact)),
    ]);
    expect((await napConsistency.run(ctx)).status).toBe('pass');
  });
  it('fails when the <address> element conflicts with the footer address on other pages', async () => {
    const head = ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Springfield' },
    });
    const footerGood = '<footer><p>Biz — 1 Main St, Springfield</p></footer>';
    const contactBad = '<main><address>99 Other Ave, Shelbyville</address></main>';
    const ctx = ctxFromPages([
      page('/', html(head, footerGood)),
      page('/contact.html', html('', contactBad)),
    ]);
    expect((await napConsistency.run(ctx)).status).toBe('fail');
  });
  it('does not treat a phone-only <address> as a postal address', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100' });
    const contact = '<main><address><a href="tel:+15550100">+1-555-0100</a></address></main>';
    const ctx = ctxFromPages([page('/', html(head, contact))]);
    // Address dimension stays inactive: status driven by phone only.
    expect((await napConsistency.run(ctx)).status).toBe('pass');
  });
});
