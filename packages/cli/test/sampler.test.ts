import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { Crawler } from '../src/crawler.js';
import { samplePages } from '../src/sampler.js';

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
});
