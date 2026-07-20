import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { titleDescription, canonical, openGraph, httpsCheck, viewport } from '../../src/checks/fundamentals.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('seo fundamentals', () => {
  it('title-description fails without meta description', async () => {
    const c = await ctx('blocked-ai');
    expect((await titleDescription.run(c)).status).toBe('fail');
  });
  it('canonical fails when absent', async () => {
    const c = await ctx('blocked-ai');
    expect((await canonical.run(c)).status).toBe('fail');
  });
  it('open-graph fails when absent', async () => {
    const c = await ctx('blocked-ai');
    expect((await openGraph.run(c)).status).toBe('fail');
  });
  it('https skips on local host', async () => {
    const c = await ctx('mini');
    expect((await httpsCheck.run(c)).status).toBe('skip');
  });
  it('viewport fails when absent', async () => {
    const c = await ctx('blocked-ai');
    expect((await viewport.run(c)).status).toBe('fail');
  });
});
