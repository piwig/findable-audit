import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { serveFixture } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import {
  sitemapCheck, indexnowCheck, parseSitemapEntries,
  sitemapLastmod, sitemapUrlsValid, sitemapIndexLimits, sitemapOrphans,
} from '../../src/checks/sitemap.js';

const SBASE = 'https://sm.example/';

function smPage(pathname: string, body = '', extra: Partial<FetchedResource> = {}): FetchedResource {
  return { status: 200, ok: true, body, contentType: 'text/html', finalUrl: new URL(pathname, SBASE).toString(), headers: {}, ...extra };
}

/** ctx serving a sitemap.xml (+ optional pages/resources) with a sample, for the sitemap-* checks. */
function siteCtx(sitemapXml: string, pages: FetchedResource[] = [], extra: Record<string, FetchedResource> = {}): CrawlContext {
  const byPath = new Map<string, FetchedResource>();
  for (const p of pages) byPath.set(new URL(p.finalUrl).pathname, p);
  byPath.set('/sitemap.xml', { status: 200, ok: true, body: sitemapXml, contentType: 'application/xml', finalUrl: `${SBASE}sitemap.xml`, headers: {} });
  for (const [k, v] of Object.entries(extra)) byPath.set(k, v);
  return {
    baseUrl: new URL(SBASE),
    async fetch(p: string) {
      const url = new URL(p, SBASE);
      return byPath.get(url.pathname) ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
    sample: pages.length ? { pages, source: 'sitemap' } : undefined,
  };
}

const urlset = (entries: string) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function ctx(name: string, opts: { spaFallback?: boolean } = {}) {
  const srv = await serveFixture(path.join(fixtures, name), opts);
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('sitemap + indexnow', () => {
  it('sitemap passes when valid and referenced in robots (relative Sitemap resolved)', async () => {
    const c = await ctx('sitemap-ok');
    expect((await sitemapCheck.run(c)).status).toBe('pass');
  });
  it('sitemap passes with an absolute Sitemap URL in robots.txt', async () => {
    const c = await ctx('perfect-site');
    expect((await sitemapCheck.run(c)).status).toBe('pass');
  });
  it('sitemap fails when absent everywhere', async () => {
    const c = await ctx('mini');
    expect((await sitemapCheck.run(c)).status).toBe('fail');
  });
  it('discovers /sitemap_index.xml as a fallback and warns (not referenced)', async () => {
    const c = await ctx('sitemap-underscore');
    const r = await sitemapCheck.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('not referenced');
  });
  it('fails on XML without urlset/sitemapindex root or without <loc>', async () => {
    const noRoot = stubCtx({
      '/sitemap.xml': { contentType: 'application/xml', body: '<?xml version="1.0"?><foo><loc>https://x/</loc></foo>' },
    });
    expect((await sitemapCheck.run(noRoot)).status).toBe('fail');
    const noLoc = stubCtx({
      '/sitemap.xml': { contentType: 'application/xml', body: '<?xml version="1.0"?><urlset></urlset>' },
    });
    expect((await sitemapCheck.run(noLoc)).status).toBe('fail');
  });
  it('fails on malformed XML', async () => {
    const c = stubCtx({
      '/sitemap.xml': { contentType: 'application/xml', body: '<urlset><loc>https://x/</urlset>' },
    });
    expect((await sitemapCheck.run(c)).status).toBe('fail');
  });
  it('rejects a text/html SPA fallback served at /sitemap.xml', async () => {
    const c = await ctx('spa-fallback', { spaFallback: true });
    expect((await sitemapCheck.run(c)).status).toBe('fail');
  });
  it('indexnow skips without a key', async () => {
    const c = await ctx('sitemap-ok');
    expect((await indexnowCheck().run(c)).status).toBe('skip');
  });
  it('indexnow passes when key file matches', async () => {
    const c = await ctx('sitemap-ok');
    expect((await indexnowCheck('k12345').run(c)).status).toBe('pass');
  });
  it('indexnow fails when key file missing', async () => {
    const c = await ctx('sitemap-ok');
    expect((await indexnowCheck('missing').run(c)).status).toBe('fail');
  });
  it('indexnow fails on an HTML SPA fallback for the key file', async () => {
    const c = await ctx('spa-fallback', { spaFallback: true });
    expect((await indexnowCheck('anykey').run(c)).status).toBe('fail');
  });
});

describe('parseSitemapEntries', () => {
  it('extracts loc + optional lastmod per <url>', () => {
    const xml = urlset('<url><loc>https://sm.example/a</loc><lastmod>2026-01-02</lastmod></url><url><loc>https://sm.example/b</loc></url>');
    expect(parseSitemapEntries(xml)).toEqual([
      { loc: 'https://sm.example/a', lastmod: '2026-01-02' },
      { loc: 'https://sm.example/b', lastmod: undefined },
    ]);
  });
});

describe('sitemap-lastmod', () => {
  const future = `${new Date().getUTCFullYear() + 1}-01-01`;
  it('passes with valid, varied, non-future lastmods', async () => {
    const c = siteCtx(urlset('<url><loc>https://sm.example/a</loc><lastmod>2026-05-12</lastmod></url><url><loc>https://sm.example/b</loc><lastmod>2025-11-30</lastmod></url>'));
    expect((await sitemapLastmod.run(c)).status).toBe('pass');
  });
  it('warns when no entry carries a lastmod', async () => {
    const c = siteCtx(urlset('<url><loc>https://sm.example/a</loc></url><url><loc>https://sm.example/b</loc></url>'));
    expect((await sitemapLastmod.run(c)).status).toBe('warn');
  });
  it('fails when every lastmod is future-dated', async () => {
    const c = siteCtx(urlset(`<url><loc>https://sm.example/a</loc><lastmod>${future}</lastmod></url>`));
    expect((await sitemapLastmod.run(c)).status).toBe('fail');
  });
  it('skips when no sitemap exists', async () => {
    expect((await sitemapLastmod.run(stubCtx({}))).status).toBe('skip');
  });
});

describe('sitemap-urls-valid', () => {
  it('passes when listed URLs are 200, same-origin and self-canonical', async () => {
    const c = siteCtx(
      urlset('<url><loc>https://sm.example/</loc></url><url><loc>https://sm.example/a</loc></url>'),
      [smPage('/', '<link rel="canonical" href="https://sm.example/">'), smPage('/a', '<link rel="canonical" href="https://sm.example/a">')],
    );
    expect((await sitemapUrlsValid.run(c)).status).toBe('pass');
  });
  it('fails when a listed URL 404s', async () => {
    const c = siteCtx(urlset('<url><loc>https://sm.example/gone</loc></url>'));
    const r = await sitemapUrlsValid.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/gone');
  });
});

describe('sitemap-index-limits', () => {
  it('skips a plain urlset sitemap', async () => {
    expect((await sitemapIndexLimits.run(siteCtx(urlset('<url><loc>https://sm.example/</loc></url>')))).status).toBe('skip');
  });
  it('passes when every index child is a valid same-origin sitemap', async () => {
    const index = '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://sm.example/child.xml</loc></sitemap></sitemapindex>';
    const child: FetchedResource = { status: 200, ok: true, body: urlset('<url><loc>https://sm.example/a</loc></url>'), contentType: 'application/xml', finalUrl: `${SBASE}child.xml`, headers: {} };
    expect((await sitemapIndexLimits.run(siteCtx(index, [], { '/child.xml': child }))).status).toBe('pass');
  });
  it('fails on a cross-origin index child', async () => {
    const index = '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://other.example/child.xml</loc></sitemap></sitemapindex>';
    expect((await sitemapIndexLimits.run(siteCtx(index))).status).toBe('fail');
  });
});

describe('sitemap-orphans', () => {
  it('passes when the sitemap and internal links agree (perfect-site)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const c = new Crawler(srv.url);
    c.sample = await (await import('../../src/sampler.js')).samplePages(c, 10);
    expect((await sitemapOrphans.run(c)).status).toBe('pass');
  });
  it('warns when a linked page is missing from the sitemap', async () => {
    const c = siteCtx(
      urlset('<url><loc>https://sm.example/</loc></url>'),
      [smPage('/', '<a href="/a">a</a>'), smPage('/a', '<a href="/">home</a>')],
    );
    const r = await sitemapOrphans.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('divergence');
  });
});
