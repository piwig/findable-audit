import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import { titleDescription, canonical, openGraph, httpsCheck, viewport, isLocalOrPrivateHost } from '../../src/checks/fundamentals.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

/** ctx whose homepage lands on the given final URL after redirects. */
const finalCtx = (finalUrl: string) =>
  stubCtx({ '/': { contentType: 'text/html', body: '<html></html>', finalUrl } }, 'http://entry.example/');

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
  it('https evaluates the protocol of the FINAL url', async () => {
    expect((await httpsCheck.run(finalCtx('https://example.com/'))).status).toBe('pass');
    expect((await httpsCheck.run(finalCtx('http://example.com/'))).status).toBe('fail');
  });
  it('https skips local and private final hosts', async () => {
    for (const u of ['http://localhost/', 'http://app.localhost/', 'http://127.0.0.1/', 'http://127.8.9.10/',
      'http://[::1]/', 'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/']) {
      expect((await httpsCheck.run(finalCtx(u))).status, u).toBe('skip');
    }
  });
  it('isLocalOrPrivateHost rejects public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '11.0.0.1']) {
      expect(isLocalOrPrivateHost(h), h).toBe(false);
    }
  });
  it('viewport fails when absent', async () => {
    const c = await ctx('blocked-ai');
    expect((await viewport.run(c)).status).toBe('fail');
  });
});
