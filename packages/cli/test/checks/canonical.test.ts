import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { canonical } from '../../src/checks/fundamentals.js';
import { extractCanonicals, isSelfReferential, canonicalsFromLinkHeader } from '../../src/checks/canonical.js';

const BASE = 'https://stub.example/';

function page(pathname: string, body: string, extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

function ctxFromPages(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map(pages.map((p) => [new URL(p.finalUrl).pathname, p]));
  return {
    baseUrl: new URL(BASE),
    async fetch(path: string) {
      const url = new URL(path, BASE);
      return byPath.get(url.pathname) ?? { status: 404, ok: false, body: '', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
    sample: { pages, source: 'links' },
  };
}

const withCanonical = (p: string, href: string) => page(p, `<html><head><link rel="canonical" href="${href}"></head><body></body></html>`);

describe('canonical (upgraded MP)', () => {
  it('passes when every sampled page is self-referential and absolute https', async () => {
    const ctx = ctxFromPages([
      withCanonical('/', 'https://stub.example/'),
      withCanonical('/about', 'https://stub.example/about'),
    ]);
    expect((await canonical.run(ctx)).status).toBe('pass');
  });

  it('honors a canonical delivered via the HTTP Link header (no tag)', async () => {
    const ctx = ctxFromPages([
      page('/page', '<html><head></head><body>no tag</body></html>', {
        headers: { link: '<https://stub.example/other>; rel="preload", <https://stub.example/page>; rel="canonical"' },
      }),
    ]);
    expect((await canonical.run(ctx)).status).toBe('pass');
  });

  it('fails when a page has no canonical at all', async () => {
    const ctx = ctxFromPages([page('/', '<html><head></head><body></body></html>')]);
    const r = await canonical.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('missing');
  });

  it('fails when a page declares two different canonicals', async () => {
    const ctx = ctxFromPages([
      page('/', '<html><head><link rel="canonical" href="https://stub.example/"><link rel="canonical" href="https://stub.example/x"></head></html>'),
    ]);
    const r = await canonical.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('multiple');
  });

  it('fails when every page canonicalizes to the homepage', async () => {
    const ctx = ctxFromPages([
      withCanonical('/', 'https://stub.example/'),
      withCanonical('/about', 'https://stub.example/'),
    ]);
    const r = await canonical.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('homepage');
  });

  it('flags a cross-origin canonical as non-self', async () => {
    const ctx = ctxFromPages([withCanonical('/', 'https://evil.example/')]);
    expect((await canonical.run(ctx)).status).toBe('fail');
  });
});

describe('canonical helpers', () => {
  it('extractCanonicals reads both the tag and the Link header, de-duplicated', () => {
    const res: FetchedResource = {
      status: 200, ok: true, contentType: 'text/html', finalUrl: 'https://x.test/p',
      body: '<link rel="canonical" href="/p">',
      headers: { link: '<https://x.test/p>; rel="canonical"' },
    };
    expect(extractCanonicals(res)).toEqual(['https://x.test/p']);
  });

  it('canonicalsFromLinkHeader picks only rel=canonical entries', () => {
    const header = '<https://x.test/a>; rel="alternate", <https://x.test/c>; rel="canonical"';
    expect(canonicalsFromLinkHeader(header, 'https://x.test/')).toEqual(['https://x.test/c']);
  });

  it('isSelfReferential ignores tracking params and a trailing slash', () => {
    expect(isSelfReferential('https://x.test/p', 'https://x.test/p/?utm_source=nl')).toBe(true);
    expect(isSelfReferential('https://x.test/p', 'https://x.test/q')).toBe(false);
  });
});
