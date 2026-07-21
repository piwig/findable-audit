import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrawlContext, FetchedResource, FetchHop, FetchChainResult } from '../../src/types.js';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import {
  canonicalResolves, wwwConsolidation, trailingSlash, redirectChains, soft404, custom404,
  urlStructure, paginationCanonical, metaRefresh, hreflangXDefault, internalLinking,
} from '../../src/checks/technical-seo.js';

const BASE = 'https://stub.example/';
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

function page(pathname: string, body = '', extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

interface CtxOpts {
  pages?: FetchedResource[];
  base?: string;
  chains?: Record<string, FetchChainResult>;
  extra?: Record<string, FetchedResource>;
}

function makeCtx(opts: CtxOpts = {}): CrawlContext {
  const { pages = [], base = BASE, chains, extra = {} } = opts;
  const byPath = new Map<string, FetchedResource>();
  for (const p of pages) byPath.set(new URL(p.finalUrl).pathname, p);
  for (const [k, v] of Object.entries(extra)) byPath.set(k, v);
  const ctx: CrawlContext = {
    baseUrl: new URL(base),
    async fetch(p: string) {
      const url = new URL(p, base);
      return byPath.get(url.pathname) ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
    sample: { pages, source: 'links' },
  };
  if (chains) {
    ctx.fetchChain = async (p: string) => {
      let full: string;
      try { full = new URL(p, base).toString(); } catch { full = p; }
      return chains[full] ?? chains[p] ?? chains['*'] ?? null;
    };
  }
  return ctx;
}

const H = (status: number, location?: string): FetchHop => ({ url: 'https://stub.example/hop', status, location });
const chainOf = (finalStatus: number, hops: FetchHop[], finalUrl = 'https://stub.example/'): FetchChainResult => ({ hops, finalStatus, finalUrl });

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  return `http://127.0.0.1:${port}`;
}

// ---------------------------------------------------------------------------

describe('canonical-resolves', () => {
  const canon = (p: string, href: string) => page(p, `<link rel="canonical" href="${href}">`);
  it('passes when every declared canonical returns 200 with no redirect', async () => {
    const ctx = makeCtx({ pages: [canon('/', 'https://stub.example/'), canon('/about', 'https://stub.example/about')] });
    expect((await canonicalResolves.run(ctx)).status).toBe('pass');
  });
  it('fails when a canonical target 404s', async () => {
    const ctx = makeCtx({ pages: [canon('/', 'https://stub.example/missing')] });
    const r = await canonicalResolves.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/missing');
  });
  it('warns when a canonical target redirects', async () => {
    const ctx = makeCtx({
      pages: [canon('/', 'https://stub.example/red')],
      extra: { '/red': { status: 200, ok: true, body: '', contentType: 'text/html', finalUrl: 'https://stub.example/final', headers: {} } },
    });
    expect((await canonicalResolves.run(ctx)).status).toBe('warn');
  });
  it('skips when no canonical is declared', async () => {
    expect((await canonicalResolves.run(makeCtx({ pages: [page('/')] }))).status).toBe('skip');
  });
});

describe('www-consolidation', () => {
  it('passes when one host serves 200 and the other 301s to it', async () => {
    const ctx = makeCtx({
      chains: {
        'https://stub.example/': chainOf(200, [H(200)]),
        'https://www.stub.example/': chainOf(200, [H(301, 'https://stub.example/'), H(200)]),
      },
    });
    expect((await wwwConsolidation.run(ctx)).status).toBe('pass');
  });
  it('fails when both www and apex serve 200', async () => {
    const ctx = makeCtx({
      chains: {
        'https://stub.example/': chainOf(200, [H(200)]),
        'https://www.stub.example/': chainOf(200, [H(200)]),
      },
    });
    expect((await wwwConsolidation.run(ctx)).status).toBe('fail');
  });
  it('warns when the non-canonical host uses a 302', async () => {
    const ctx = makeCtx({
      chains: {
        'https://stub.example/': chainOf(200, [H(200)]),
        'https://www.stub.example/': chainOf(200, [H(302, 'https://stub.example/'), H(200)]),
      },
    });
    expect((await wwwConsolidation.run(ctx)).status).toBe('warn');
  });
  it('skips on a local/IP host', async () => {
    const c = new Crawler('http://127.0.0.1:8080/');
    expect((await wwwConsolidation.run(c)).status).toBe('skip');
  });
});

describe('trailing-slash', () => {
  it('passes when the slash-toggled variant 301s', async () => {
    const ctx = makeCtx({
      pages: [page('/about')],
      chains: { 'https://stub.example/about/': chainOf(200, [H(301, 'https://stub.example/about'), H(200)]) },
    });
    expect((await trailingSlash.run(ctx)).status).toBe('pass');
  });
  it('fails when both slash variants serve 200 (duplicate)', async () => {
    const ctx = makeCtx({
      pages: [page('/about')],
      chains: { 'https://stub.example/about/': chainOf(200, [H(200)]) },
    });
    expect((await trailingSlash.run(ctx)).status).toBe('fail');
  });
  it('skips on a local host', async () => {
    const c = new Crawler('http://127.0.0.1:8080/');
    expect((await trailingSlash.run(c)).status).toBe('skip');
  });
});

describe('redirect-chains', () => {
  it('passes when sampled URLs resolve without redirects', async () => {
    const ctx = makeCtx({ pages: [page('/')], chains: { 'https://stub.example/': chainOf(200, [H(200)]) } });
    expect((await redirectChains.run(ctx)).status).toBe('pass');
  });
  it('fails on a multi-hop chain', async () => {
    const ctx = makeCtx({ pages: [page('/')], chains: { 'https://stub.example/': chainOf(200, [H(301, '/x'), H(301, '/y'), H(200)]) } });
    expect((await redirectChains.run(ctx)).status).toBe('fail');
  });
  it('fails on a redirect loop (never reaches a terminal status)', async () => {
    const ctx = makeCtx({ pages: [page('/')], chains: { 'https://stub.example/': chainOf(302, [H(302, '/a'), H(302, '/')]) } });
    expect((await redirectChains.run(ctx)).status).toBe('fail');
  });
  it('warns on a single temporary (302) hop', async () => {
    const ctx = makeCtx({ pages: [page('/')], chains: { 'https://stub.example/': chainOf(200, [H(302, '/x'), H(200)]) } });
    expect((await redirectChains.run(ctx)).status).toBe('warn');
  });
  it('skips on a local host', async () => {
    const c = new Crawler('http://127.0.0.1:8080/');
    expect((await redirectChains.run(c)).status).toBe('skip');
  });
});

describe('soft-404 (real crawler)', () => {
  it('passes when a missing route returns 404', async () => {
    const url = await listen(http.createServer((_req, res) => { res.writeHead(404); res.end('nope'); }));
    expect((await soft404.run(new Crawler(url))).status).toBe('pass');
  });
  it('fails when a missing route returns 200 (soft-404)', async () => {
    const url = await listen(http.createServer((_req, res) => { res.writeHead(200); res.end('<html>home</html>'); }));
    expect((await soft404.run(new Crawler(url))).status).toBe('fail');
  });
  it('fails when a missing route 301s to the homepage', async () => {
    const url = await listen(http.createServer((req, res) => {
      if (req.url === '/') { res.writeHead(200); res.end('home'); }
      else { res.writeHead(301, { location: '/' }); res.end(); }
    }));
    const r = await soft404.run(new Crawler(url));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('homepage');
  });
});

describe('custom-404 (real crawler)', () => {
  async function ctx(name: string) {
    const srv = await serveFixture(path.join(fixtures, name));
    closers.push(srv.close);
    return new Crawler(srv.url);
  }
  it('passes when the 404 body offers links/nav', async () => {
    expect((await custom404.run(await ctx('perfect-site'))).status).toBe('pass');
  });
  it('warns when the 404 body is a bare error', async () => {
    expect((await custom404.run(await ctx('mini'))).status).toBe('warn');
  });
});

describe('url-structure', () => {
  it('passes on clean lowercase hyphenated URLs', async () => {
    const ctx = makeCtx({ pages: [page('/', '<a href="/about">a</a><a href="/contact-us">c</a>')] });
    expect((await urlStructure.run(ctx)).status).toBe('pass');
  });
  it('flags session/tracking params in link targets', async () => {
    const ctx = makeCtx({ pages: [page('/', '<a href="/a?sessionid=abc123">x</a>')] });
    expect((await urlStructure.run(ctx)).status).toBe('fail');
  });
});

describe('pagination-canonical', () => {
  it('skips when no pagination is present', async () => {
    expect((await paginationCanonical.run(makeCtx({ pages: [page('/')] }))).status).toBe('skip');
  });
  it('fails when page 2 canonicalizes to page 1', async () => {
    const ctx = makeCtx({ pages: [page('/?page=2', '<link rel="canonical" href="https://stub.example/">')] });
    expect((await paginationCanonical.run(ctx)).status).toBe('fail');
  });
  it('passes when a paginated page is self-canonical', async () => {
    const ctx = makeCtx({ pages: [page('/?page=2', '<link rel="canonical" href="https://stub.example/?page=2">')] });
    expect((await paginationCanonical.run(ctx)).status).toBe('pass');
  });
});

describe('meta-refresh', () => {
  it('passes when no meta-refresh redirect exists', async () => {
    expect((await metaRefresh.run(makeCtx({ pages: [page('/', '<p>hi</p>')] }))).status).toBe('pass');
  });
  it('fails on a meta-refresh redirect', async () => {
    const ctx = makeCtx({ pages: [page('/', '<meta http-equiv="refresh" content="0; url=/elsewhere">')] });
    expect((await metaRefresh.run(ctx)).status).toBe('fail');
  });
});

describe('hreflang-x-default', () => {
  const alt = (lang: string, href: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
  it('skips a single-language site', async () => {
    expect((await hreflangXDefault.run(makeCtx({ pages: [page('/')] }))).status).toBe('skip');
  });
  it('passes with x-default, a self hreflang, valid codes and absolute hrefs', async () => {
    const body = alt('en', 'https://stub.example/') + alt('fr', 'https://stub.example/fr') + alt('x-default', 'https://stub.example/');
    expect((await hreflangXDefault.run(makeCtx({ pages: [page('/', body)] }))).status).toBe('pass');
  });
  it('warns when x-default is missing', async () => {
    const body = alt('en', 'https://stub.example/') + alt('fr', 'https://stub.example/fr');
    expect((await hreflangXDefault.run(makeCtx({ pages: [page('/', body)] }))).status).toBe('warn');
  });
  it('fails on an invalid BCP-47 code', async () => {
    const body = alt('english', 'https://stub.example/') + alt('x-default', 'https://stub.example/');
    expect((await hreflangXDefault.run(makeCtx({ pages: [page('/', body)] }))).status).toBe('fail');
  });
});

describe('internal-linking', () => {
  it('skips with fewer than 2 sampled pages', async () => {
    expect((await internalLinking.run(makeCtx({ pages: [page('/')] }))).status).toBe('skip');
  });
  it('passes when pages link each other within 3 clicks', async () => {
    const ctx = makeCtx({ pages: [page('/', '<a href="/about">about</a>'), page('/about', '<a href="/">home</a>')] });
    expect((await internalLinking.run(ctx)).status).toBe('pass');
  });
  it('flags an orphan page with no inbound or outbound links', async () => {
    const ctx = makeCtx({
      pages: [page('/', '<a href="/a">a</a>'), page('/a', '<a href="/">home</a>'), page('/orphan', '<p>no links</p>')],
    });
    const r = await internalLinking.run(ctx);
    expect(r.status).not.toBe('pass');
    expect(r.message).toContain('/orphan');
  });
});
