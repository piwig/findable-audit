import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { samplePages } from '../../src/sampler.js';
import { brokenInternalLinks, redirectHygiene, hreflang } from '../../src/checks/links.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function sampled(name: string, maxPages = 10) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  const c = new Crawler(srv.url);
  c.sample = await samplePages(c, maxPages);
  return c;
}

describe('broken-internal-links', () => {
  it('fails and names the dead link', async () => {
    // Links across the sample: "/", "/a.html", "/missing.html" -> 1 of 3 broken (66% < 80%)
    const r = await brokenInternalLinks.run(await sampled('multi-page'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/missing.html');
  });
  it('passes when every internal link resolves', async () => {
    // Links: /one.html, /two.html, /style.css — all exist in the fixture and return 200.
    // The fixture also links /cdn-cgi/l/email-protection, but /cdn-cgi/ is excluded
    // from the internal-link check (see the next test), so it does not affect this pass.
    expect((await brokenInternalLinks.run(await sampled('links-fallback'))).status).toBe('pass');
  });
  it('ignores Cloudflare /cdn-cgi/ links instead of reporting them broken', async () => {
    // links-fallback links to /cdn-cgi/l/email-protection, which does not exist
    // as a page; it must NOT be counted as a broken internal link.
    expect((await brokenInternalLinks.run(await sampled('links-fallback'))).status).toBe('pass');
  });
});

describe('redirect-hygiene', () => {
  it('skips on local hosts (fixtures run on 127.0.0.1)', async () => {
    expect((await redirectHygiene.run(await sampled('multi-page'))).status).toBe('skip');
  });
});

describe('hreflang', () => {
  it('skips when no hreflang annotations exist', async () => {
    expect((await hreflang.run(await sampled('multi-page'))).status).toBe('skip');
  });
  it('passes on reachable, reciprocal alternates', async () => {
    expect((await hreflang.run(await sampled('hreflang'))).status).toBe('pass');
  });
  it('fails when an alternate 404s', async () => {
    const r = await hreflang.run(await sampled('hreflang-broken'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/de.html');
  });
  it('fails when an alternate 200s but does not declare a back-reference', async () => {
    const r = await hreflang.run(await sampled('hreflang-nonreciprocal'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/fr.html');
  });
});
