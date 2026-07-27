import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import {
  outboundLinkHealth, collectOutboundLinks, pickProbeTargets, MAX_OUTBOUND_LINKS,
} from '../../src/checks/outbound-links.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';

const BASE = 'https://acme.example/';

function page(pathname: string, body: string): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

function doc(body: string): string {
  return `<!doctype html><html lang="en"><head><title>Acme</title></head><body>${body}</body></html>`;
}

/**
 * A context whose outbound probes are scripted per URL: a `number` is the status
 * that URL answers with, `null` is "we could not find out" (timeout, DNS, guard
 * refusal) — exactly what the real `fetchOutbound` returns in that case.
 */
function ctxWith(pages: FetchedResource[], probes?: Record<string, number | null>): CrawlContext {
  const ctx = stubCtx({}, BASE);
  ctx.sample = { pages, source: 'links' };
  if (probes) {
    ctx.fetchOutbound = async (url: string) => {
      const status = url in probes ? probes[url] : 200;
      if (status === null) return null;
      return { status, ok: status < 400, body: '', contentType: 'text/html', finalUrl: url, headers: {} };
    };
  }
  return ctx;
}

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

describe('collectOutboundLinks', () => {
  it('keeps only off-origin http(s) links, main content first', () => {
    const body = doc('<nav><a href="https://footer.example/x">chrome</a></nav>'
      + '<main><a href="https://cite.example/paper">paper</a>'
      + '<a href="mailto:x@y.z">mail</a><a href="/local/">self</a></main>');
    const links = collectOutboundLinks([page('/', body)], new URL(BASE));
    expect(links.map((l) => l.host)).toEqual(['cite.example', 'footer.example']);
  });

  it('records rel="nofollow"/"sponsored"/"ugc" as a declared link', () => {
    const body = doc('<main><a href="https://a.example/" rel="sponsored">ad</a>'
      + '<a href="https://b.example/">plain</a></main>');
    const links = collectOutboundLinks([page('/', body)], new URL(BASE));
    expect(links.map((l) => l.declared)).toEqual([true, false]);
  });
});

describe('pickProbeTargets', () => {
  it('takes one URL per host and stops at the budget', () => {
    const body = doc(`<main>${Array.from({ length: 20 }, (_, i) => `<a href="https://h${i}.example/">${i}</a>`).join('')}
      <a href="https://h0.example/second">again</a></main>`);
    const targets = pickProbeTargets(collectOutboundLinks([page('/', body)], new URL(BASE)));
    expect(targets).toHaveLength(MAX_OUTBOUND_LINKS);
    expect(new Set(targets.map((t) => t.host)).size).toBe(MAX_OUTBOUND_LINKS);
  });
});

describe('outbound-link-health', () => {
  it('skips without --check-outbound, so the default audit stays on-origin', async () => {
    const ctx = ctxWith([page('/', doc('<main><a href="https://cite.example/">c</a></main>'))]);
    const r = await outboundLinkHealth.run(ctx);
    expect(r.status).toBe('skip');
    expect(r.message).toContain('--check-outbound');
  });

  it('skips when the sampled pages link nowhere off-origin', async () => {
    const ctx = ctxWith([page('/', doc('<main><a href="/local/">self</a></main>'))], {});
    const r = await outboundLinkHealth.run(ctx);
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no outbound links on sampled pages');
  });

  it('passes and reports how many links declare a rel', async () => {
    const body = doc('<main><a href="https://a.example/" rel="nofollow">a</a>'
      + '<a href="https://b.example/">b</a></main>');
    const r = await outboundLinkHealth.run(ctxWith([page('/', body)], {}));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('2/2 outbound link(s) resolve');
    expect(r.message).toContain('1 declaring rel');
  });

  it('reports a 404 as dead, with the host and path a reader can find', async () => {
    const body = doc('<main><a href="https://a.example/gone">a</a>'
      + '<a href="https://b.example/">b</a><a href="https://c.example/">c</a></main>');
    const r = await outboundLinkHealth.run(ctxWith([page('/', body)], { 'https://a.example/gone': 404 }));
    expect(['warn', 'fail']).toContain(r.status);
    expect(r.message).toContain('a.example/gone');
  });

  it('counts 410 Gone too — the other status that means "not there"', async () => {
    const body = doc('<main><a href="https://a.example/x">a</a></main>');
    const r = await outboundLinkHealth.run(ctxWith([page('/', body)], { 'https://a.example/x': 410 }));
    expect(r.status).toBe('fail');
  });

  it('never blames the site for a host it could not reach', async () => {
    const body = doc('<main><a href="https://down.example/">down</a><a href="https://up.example/">up</a></main>');
    const r = await outboundLinkHealth.run(ctxWith([page('/', body)], { 'https://down.example/': null }));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('1 unverifiable');
  });

  it('never blames the site for a bot wall (403/429) or a server error either', async () => {
    const body = doc('<main><a href="https://wall.example/">w</a><a href="https://busy.example/">b</a>'
      + '<a href="https://boom.example/">e</a></main>');
    const r = await outboundLinkHealth.run(ctxWith([page('/', body)], {
      'https://wall.example/': 403, 'https://busy.example/': 429, 'https://boom.example/': 503,
    }));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('3 unverifiable');
  });
});

describe('crawler fetchOutbound', () => {
  async function listen(handler: http.RequestListener): Promise<{ url: string; port: string }> {
    const server = http.createServer(handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
    return { url: `http://127.0.0.1:${port}/`, port: String(port) };
  }

  it('is absent unless asked for, and --verify-profiles does not grant it', () => {
    expect(new Crawler(BASE).fetchOutbound).toBeUndefined();
    expect(new Crawler(BASE, 1000, undefined, { verifyProfiles: true }).fetchOutbound).toBeUndefined();
    expect(new Crawler(BASE, 1000, undefined, { checkOutbound: true }).fetchOutbound).toBeDefined();
  });

  it('probes with HEAD, and falls back to a ranged GET when HEAD is refused', async () => {
    const seen: Array<{ method: string; range?: string }> = [];
    const srv = await listen((req, res) => {
      seen.push({ method: req.method ?? '', range: req.headers.range as string | undefined });
      if (req.method === 'HEAD') { res.writeHead(405); res.end(); return; }
      res.writeHead(206, { 'content-type': 'text/html' });
      res.end('x');
    });
    // The guard is forced on for outbound, so a loopback target needs the same
    // seams crawler-guard.test.ts uses; the real block is covered there.
    const c = new Crawler(BASE, 2000, undefined, {
      checkOutbound: true, isBlocked: () => false, allowPort: (p) => p === srv.port,
    });
    const res = await c.fetchOutbound!(srv.url);
    expect(res?.status).toBe(206);
    expect(seen.map((s) => s.method)).toEqual(['HEAD', 'GET']);
    expect(seen[1].range).toBe('bytes=0-0');
  });

  it('does not re-request a URL it already probed', async () => {
    let hits = 0;
    const srv = await listen((_req, res) => { hits++; res.writeHead(200); res.end(); });
    const c = new Crawler(BASE, 2000, undefined, {
      checkOutbound: true, isBlocked: () => false, allowPort: (p) => p === srv.port,
    });
    await c.fetchOutbound!(srv.url);
    await c.fetchOutbound!(srv.url);
    expect(hits).toBe(1);
  });

  it('refuses non-http(s) schemes without connecting', async () => {
    const c = new Crawler(BASE, 1000, undefined, { checkOutbound: true });
    expect(await c.fetchOutbound!('javascript:alert(1)')).toBeNull();
    expect(await c.fetchOutbound!('not a url')).toBeNull();
  });

  it('(real guard) refuses a loopback target even though the CLI does not block private hosts', async () => {
    const srv = await listen((_req, res) => { res.writeHead(200); res.end('reached'); });
    const c = new Crawler(BASE, 2000, undefined, { checkOutbound: true });
    expect(await c.fetchOutbound!(srv.url)).toBeNull();
  });
});
