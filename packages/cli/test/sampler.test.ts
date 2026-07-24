import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { Crawler } from '../src/crawler.js';
import { samplePages } from '../src/sampler.js';

/**
 * Inline server (serveFixture is static-only, no redirect support) modelling a
 * localized site: `/` 302-redirects to `/en/`, and the sitemap lists both
 * localized landings. The homepage document is therefore reachable under TWO
 * request URLs (`/` and `/en/`) that share one final URL.
 */
async function serveRedirectedHome(): Promise<{ url: string; close(): Promise<void> }> {
  const page = (name: string) =>
    `<!doctype html><html><head><title>${name}</title></head><body><h1>${name}</h1></body></html>`;
  let origin = '';
  const server = http.createServer((req, res) => {
    const p = (req.url ?? '/').split('?')[0];
    if (p === '/') { res.writeHead(302, { location: '/en/' }); res.end(); return; }
    if (p === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>${origin}/en/</loc></url><url><loc>${origin}/fr/</loc></url></urlset>`);
      return;
    }
    if (p === '/en/' || p === '/fr/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page(p));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { url: origin, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function crawler(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}
const paths = (s: { pages: { finalUrl: string }[] }) => s.pages.map((p) => new URL(p.finalUrl).pathname);

describe('samplePages', () => {
  it('samples sitemap URLs deterministically: depth asc, then lexicographic', async () => {
    const s = await samplePages(await crawler('multi-page'), 10);
    expect(s.source).toBe('sitemap');
    expect(paths(s)).toEqual(['/', '/a.html', '/b.html', '/deep/nested/page.html']);
  });
  it('caps at maxPages, homepage included', async () => {
    const s = await samplePages(await crawler('multi-page'), 2);
    expect(paths(s)).toEqual(['/', '/a.html']);
  });
  it('maxPages=1 keeps the current homepage-only behavior', async () => {
    const s = await samplePages(await crawler('multi-page'), 1);
    expect(s.source).toBe('homepage-only');
    expect(paths(s)).toEqual(['/']);
  });
  it('falls back to same-origin homepage links without a sitemap', async () => {
    const s = await samplePages(await crawler('links-fallback'), 10);
    expect(s.source).toBe('links');
    expect(paths(s)).toEqual(['/', '/one.html', '/two.html']); // external + .css excluded, #fragment stripped
  });
  it('dedupes by post-redirect final URL: / -> /en/ is sampled once', async () => {
    const srv = await serveRedirectedHome();
    closers.push(srv.close);
    const s = await samplePages(new Crawler(srv.url), 10);
    expect(s.source).toBe('sitemap');
    expect(paths(s)).toEqual(['/en/', '/fr/']); // NOT ['/en/', '/en/', '/fr/']
  });
});
