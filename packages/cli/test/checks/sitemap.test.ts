import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { sitemapCheck, indexnowCheck } from '../../src/checks/sitemap.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('sitemap + indexnow', () => {
  it('sitemap passes when valid and referenced in robots', async () => {
    const c = await ctx('sitemap-ok');
    expect((await sitemapCheck.run(c)).status).toBe('pass');
  });
  it('sitemap fails when absent', async () => {
    const c = await ctx('mini');
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
});
