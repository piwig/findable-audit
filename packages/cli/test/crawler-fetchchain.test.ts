import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { Crawler } from '../src/crawler.js';

// fetchChain is the manual, no-follow fetch used by www-consolidation,
// trailing-slash, redirect-chains and soft-404. These tests exercise the hop
// mechanics against bespoke servers, and prove the SSRF guard re-runs on EVERY
// redirect hop (a redirect Location pointing at a blocked host is refused).

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

async function listen(server: http.Server): Promise<{ url: string; port: string }> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { url: `http://127.0.0.1:${port}/`, port: String(port) };
}

describe('Crawler.fetchChain (no-follow hop list)', () => {
  it('records a single terminal hop for a 200', async () => {
    const srv = await listen(http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); }));
    const chain = await new Crawler(srv.url).fetchChain('/');
    expect(chain?.hops).toHaveLength(1);
    expect(chain?.hops[0].status).toBe(200);
    expect(chain?.finalStatus).toBe(200);
  });

  it('records each redirect hop with its status + Location, then the terminal hop', async () => {
    const srv = await listen(http.createServer((req, res) => {
      if (req.url === '/') { res.writeHead(301, { location: '/step2' }); res.end(); }
      else if (req.url === '/step2') { res.writeHead(302, { location: '/final' }); res.end(); }
      else { res.writeHead(200); res.end('done'); }
    }));
    const chain = await new Crawler(srv.url).fetchChain('/');
    expect(chain?.hops.map((h) => h.status)).toEqual([301, 302, 200]);
    expect(chain?.hops[0].location).toBe('/step2');
    expect(chain?.finalStatus).toBe(200);
    expect(new URL(chain!.finalUrl).pathname).toBe('/final');
  });

  it('stops on a redirect loop, reporting a still-redirecting terminal status', async () => {
    const srv = await listen(http.createServer((req, res) => {
      if (req.url === '/a') { res.writeHead(302, { location: '/b' }); res.end(); }
      else { res.writeHead(302, { location: '/a' }); res.end(); }
    }));
    const chain = await new Crawler(srv.url).fetchChain('/a');
    expect(chain).not.toBeNull();
    expect(chain!.finalStatus).toBeGreaterThanOrEqual(300);
    expect(chain!.finalStatus).toBeLessThan(400); // never reached a terminal 2xx/4xx
  });

  it('returns null on an unreachable host', async () => {
    const chain = await new Crawler('http://127.0.0.1:1/', 500).fetchChain('/');
    expect(chain).toBeNull();
  });
});

describe('Crawler.fetchChain SSRF guard (blockPrivateHosts)', () => {
  it('refuses a redirect Location pointing at a blocked host (guard runs on every hop)', async () => {
    let targetHits = 0;
    const target = await listen(http.createServer((_req, res) => { targetHits++; res.writeHead(200); res.end('SECRET'); }));
    const entry = await listen(http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target.port}/` });
      res.end();
    }));
    // Allow only the entry port; the redirect target's port stands in for a blocked host.
    const crawler = new Crawler(entry.url, 2000, undefined, {
      blockPrivateHosts: true,
      isBlocked: () => false,
      allowPort: (p) => p === entry.port,
    });
    const chain = await crawler.fetchChain('/');
    expect(chain).toBeNull();        // the whole chain is refused
    expect(targetHits).toBe(0);      // the blocked target was never contacted
  });

  it('(real guard) refuses a plain 127.0.0.1 target end-to-end', async () => {
    const srv = await listen(http.createServer((_req, res) => { res.writeHead(200); res.end('reached'); }));
    // No seams: real isBlockedAddress(127.0.0.1) + real port policy block it.
    const guarded = new Crawler(srv.url, 2000, undefined, { blockPrivateHosts: true });
    expect(await guarded.fetchChain('/')).toBeNull();
  });

  it('follows a redirect to an ALLOWED target under the guard (control)', async () => {
    const target = await listen(http.createServer((_req, res) => { res.writeHead(200); res.end('final'); }));
    const entry = await listen(http.createServer((_req, res) => {
      res.writeHead(301, { location: `http://127.0.0.1:${target.port}/` });
      res.end();
    }));
    const crawler = new Crawler(entry.url, 2000, undefined, {
      blockPrivateHosts: true,
      isBlocked: () => false,
      allowPort: () => true, // both hops allowed
    });
    const chain = await crawler.fetchChain('/');
    expect(chain?.hops.map((h) => h.status)).toEqual([301, 200]);
    expect(chain?.finalStatus).toBe(200);
  });
});
