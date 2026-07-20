import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import { sitemapCheck, indexnowCheck } from '../../src/checks/sitemap.js';

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
