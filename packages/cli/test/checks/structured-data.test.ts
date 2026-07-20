import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import {
  extractJsonLd, jsonLd, jsonLdEntity, twitterCard,
  jsonLdValid, sdOrganization, sdEntityGrounding, sdLocalBusiness,
  sdWebsiteSearchAction, sdVideo, sdSpecialTypes, sdGraphIntegrity, sdConsistency,
} from '../../src/checks/structured-data.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('extractJsonLd', () => {
  it('parses valid blocks and skips broken ones', () => {
    const html = `<script type="application/ld+json">{"@type":"Bakery","name":"X"}</script>
      <script type="application/ld+json">{broken</script>`;
    const blocks = extractJsonLd(html);
    expect(blocks).toHaveLength(1);
  });
});

describe('structured-data checks', () => {
  it('json-ld fails without any block', async () => {
    const c = await ctx('blocked-ai');
    expect((await jsonLd.run(c)).status).toBe('fail');
  });
  it('json-ld-entity warns on incomplete NAP', async () => {
    const c = await ctx('jsonld-bad'); // Bakery without telephone
    expect((await jsonLdEntity.run(c)).status).toBe('warn');
  });
});

describe('twitter-card', () => {
  const withHead = (head: string) => stubCtx({ '/': { contentType: 'text/html', body: `<html><head>${head}</head></html>` } });

  it('passes with a complete twitter:card set', async () => {
    const c = withHead(
      '<meta name="twitter:card" content="summary_large_image">'
      + '<meta name="twitter:title" content="Example Bakery">'
      + '<meta name="twitter:description" content="Sourdough bread in Springfield.">'
      + '<meta name="twitter:image" content="https://example.com/storefront.jpg">',
    );
    expect((await twitterCard.run(c)).status).toBe('pass');
  });
  it('passes with no twitter:card when Open Graph fully covers title/description/image', async () => {
    const c = withHead(
      '<meta property="og:title" content="Example Bakery">'
      + '<meta property="og:description" content="Sourdough bread in Springfield.">'
      + '<meta property="og:image" content="https://example.com/storefront.jpg">',
    );
    expect((await twitterCard.run(c)).status).toBe('pass');
  });
  it('fails with no twitter:card and no usable Open Graph fallback', async () => {
    const c = withHead('');
    expect((await twitterCard.run(c)).status).toBe('fail');
  });
  it('warns on a non-standard card type', async () => {
    const c = withHead('<meta name="twitter:card" content="photo">');
    expect((await twitterCard.run(c)).status).toBe('warn');
  });
  it('warns when twitter:card is set but title/description/image are incomplete', async () => {
    const c = withHead('<meta name="twitter:card" content="summary">');
    expect((await twitterCard.run(c)).status).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// Batch 3: rich structured-data checks (single-homepage)
// ---------------------------------------------------------------------------

/** Wraps one JSON-LD object into a <script type="application/ld+json"> block. */
const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
/** Stub ctx whose homepage body is the given HTML string. */
const homeCtx = (body: string) => stubCtx({ '/': { contentType: 'text/html', body } });

describe('json-ld-valid', () => {
  it('passes for a valid @context + @type block', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Test Org' })}</head></html>`);
    expect((await jsonLdValid.run(c)).status).toBe('pass');
  });
  it('fails when no JSON-LD block is present', async () => {
    const c = homeCtx('<html><head></head></html>');
    expect((await jsonLdValid.run(c)).status).toBe('fail');
  });
  it('fails on a JSON parse error', async () => {
    const c = homeCtx('<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"</script></head></html>');
    const r = await jsonLdValid.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/parse error/);
  });
  it('fails when @context is missing/non-schema.org', async () => {
    const c = homeCtx(`<html><head>${ld({ '@type': 'Organization', name: 'X' })}</head></html>`);
    const r = await jsonLdValid.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/@context/);
  });
  it('fails when a node has no @type', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', name: 'X' })}</head></html>`);
    const r = await jsonLdValid.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/@type/);
  });
});

describe('sd-organization', () => {
  it('fails when no Organization/LocalBusiness entity is found', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Hi' })}</head></html>`);
    expect((await sdOrganization.run(c)).status).toBe('fail');
  });
  it('warns when the entity is missing logo/sameAs', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme', url: 'https://acme.example/',
    })}</head></html>`);
    expect((await sdOrganization.run(c)).status).toBe('warn');
  });
  it('passes with name/url/absolute-https-logo/sameAs all present', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme', url: 'https://acme.example/',
      logo: 'https://acme.example/logo.png', sameAs: ['https://www.facebook.com/acme'],
    })}</head></html>`);
    expect((await sdOrganization.run(c)).status).toBe('pass');
  });
});

describe('sd-entity-grounding', () => {
  it('fails with zero sameAs URLs', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' })}</head></html>`);
    expect((await sdEntityGrounding.run(c)).status).toBe('fail');
  });
  it('warns with only 1 sameAs profile', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'Organization', sameAs: ['https://www.facebook.com/acme'],
    })}</head></html>`);
    expect((await sdEntityGrounding.run(c)).status).toBe('warn');
  });
  it('warns with 2+ sameAs but no Wikipedia/Wikidata anchor', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'Organization',
      sameAs: ['https://www.facebook.com/acme', 'https://twitter.com/acme'],
    })}</head></html>`);
    expect((await sdEntityGrounding.run(c)).status).toBe('warn');
  });
  it('passes with 2+ sameAs including a Wikipedia/Wikidata anchor', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'Organization',
      sameAs: ['https://www.facebook.com/acme', 'https://en.wikipedia.org/wiki/Acme'],
    })}</head></html>`);
    expect((await sdEntityGrounding.run(c)).status).toBe('pass');
  });
});

describe('sd-localbusiness', () => {
  it('skips when no LocalBusiness-shaped entity is present', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' })}</head></html>`);
    expect((await sdLocalBusiness.run(c)).status).toBe('skip');
  });
  it('fails without a structured address', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100',
    })}</head></html>`);
    expect((await sdLocalBusiness.run(c)).status).toBe('fail');
  });
  it('fails without a telephone', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Town', postalCode: '12345', addressCountry: 'US' },
    })}</head></html>`);
    expect((await sdLocalBusiness.run(c)).status).toBe('fail');
  });
  it('warns when address/telephone are present but geo/hours are missing', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Town', postalCode: '12345', addressCountry: 'US' },
    })}</head></html>`);
    expect((await sdLocalBusiness.run(c)).status).toBe('warn');
  });
  it('passes with NAP + geo + opening hours complete', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Biz', telephone: '+1-555-0100',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Town', postalCode: '12345', addressCountry: 'US' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 1 },
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday'], opens: '09:00', closes: '17:00' }],
    })}</head></html>`);
    expect((await sdLocalBusiness.run(c)).status).toBe('pass');
  });
});

describe('sd-website-searchaction', () => {
  it('skips when there is no WebSite entity', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' })}</head></html>`);
    expect((await sdWebsiteSearchAction.run(c)).status).toBe('skip');
  });
  it('warns when WebSite has no SearchAction', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'WebSite', url: 'https://acme.example/' })}</head></html>`);
    expect((await sdWebsiteSearchAction.run(c)).status).toBe('warn');
  });
  it('warns when the SearchAction target/query-input is incomplete', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'WebSite', url: 'https://acme.example/',
      potentialAction: { '@type': 'SearchAction', target: 'https://acme.example/search?q=x', 'query-input': 'required name=search_term_string' },
    })}</head></html>`);
    expect((await sdWebsiteSearchAction.run(c)).status).toBe('warn');
  });
  it('passes with a complete SearchAction', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'WebSite', url: 'https://acme.example/',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: 'https://acme.example/search?q={search_term_string}' },
        'query-input': 'required name=search_term_string',
      },
    })}</head></html>`);
    expect((await sdWebsiteSearchAction.run(c)).status).toBe('pass');
  });
});

describe('sd-video', () => {
  it('skips when there is no video content', async () => {
    const c = homeCtx('<html><head></head><body><p>No video here.</p></body></html>');
    expect((await sdVideo.run(c)).status).toBe('skip');
  });
  it('fails when a video embed has no VideoObject markup', async () => {
    const c = homeCtx('<html><head></head><body><video src="https://example.com/video.mp4"></video></body></html>');
    expect((await sdVideo.run(c)).status).toBe('fail');
  });
  it('fails when VideoObject is missing required fields', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'VideoObject', name: 'Demo' })}</head></html>`);
    expect((await sdVideo.run(c)).status).toBe('fail');
  });
  it('warns when required fields are complete but bonus fields are missing', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'VideoObject', name: 'Demo', description: 'A demo video.',
      thumbnailUrl: 'https://example.com/thumb.jpg', uploadDate: '2024-01-01',
    })}</head></html>`);
    expect((await sdVideo.run(c)).status).toBe('warn');
  });
  it('passes with a complete VideoObject', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'VideoObject', name: 'Demo', description: 'A demo video.',
      thumbnailUrl: 'https://example.com/thumb.jpg', uploadDate: '2024-01-01',
      contentUrl: 'https://example.com/video.mp4', duration: 'PT1M30S',
    })}</head></html>`);
    expect((await sdVideo.run(c)).status).toBe('pass');
  });
});

describe('sd-special-types', () => {
  it('skips when no HowTo/Event/Recipe is present', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' })}</head></html>`);
    expect((await sdSpecialTypes.run(c)).status).toBe('skip');
  });
  it('fails when the HowTo is missing required fields', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'HowTo', name: 'Make bread' })}</head></html>`);
    expect((await sdSpecialTypes.run(c)).status).toBe('fail');
  });
  it('passes with a complete HowTo', async () => {
    const c = homeCtx(`<html><head>${ld({
      '@context': 'https://schema.org', '@type': 'HowTo', name: 'Make bread',
      step: [{ '@type': 'HowToStep', text: 'Mix flour and water.' }, { '@type': 'HowToStep', text: 'Bake for an hour.' }],
    })}</head></html>`);
    expect((await sdSpecialTypes.run(c)).status).toBe('pass');
  });
});

describe('sd-graph-integrity', () => {
  it('skips when no @id is used', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' })}</head></html>`);
    expect((await sdGraphIntegrity.run(c)).status).toBe('skip');
  });
  it('fails on a dangling @id reference', async () => {
    const c = homeCtx(`<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': 'https://acme.example/#org', name: 'Acme' },
        { '@type': 'WebSite', publisher: { '@id': 'https://acme.example/#missing' } },
      ],
    })}</script></head></html>`);
    expect((await sdGraphIntegrity.run(c)).status).toBe('fail');
  });
  it('warns on a duplicated @id', async () => {
    const c = homeCtx(`<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': 'https://acme.example/#org', name: 'Acme One' },
        { '@type': 'Organization', '@id': 'https://acme.example/#org', name: 'Acme Two' },
      ],
    })}</script></head></html>`);
    expect((await sdGraphIntegrity.run(c)).status).toBe('warn');
  });
  it('passes with a resolvable @graph and no dangling/duplicated @id', async () => {
    const c = homeCtx(`<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': 'https://acme.example/#org', name: 'Acme' },
        { '@type': 'WebSite', publisher: { '@id': 'https://acme.example/#org' } },
      ],
    })}</script></head></html>`);
    expect((await sdGraphIntegrity.run(c)).status).toBe('pass');
  });
});

describe('sd-consistency', () => {
  it('passes vacuously when there are no name/price/rating values to verify', async () => {
    const c = homeCtx('<html><head></head><body><p>Nothing to see here.</p></body></html>');
    expect((await sdConsistency.run(c)).status).toBe('pass');
  });
  it('passes when the JSON-LD value is visible on the page', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Test Bakery' })}</head><body><h1>Test Bakery</h1></body></html>`);
    expect((await sdConsistency.run(c)).status).toBe('pass');
  });
  it('warns when the JSON-LD value is not visible anywhere on the page', async () => {
    const c = homeCtx(`<html><head>${ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Ghost Corp' })}</head><body><h1>Something else entirely</h1></body></html>`);
    expect((await sdConsistency.run(c)).status).toBe('warn');
  });
});
