import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { Crawler } from '../src/crawler.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const dir = path.join(fixtures, 'mini');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${port}`;
}

describe('Crawler', () => {
  it('fetches and caches a resource', async () => {
    const srv = await serveFixture(dir); closers.push(srv.close);
    const crawler = new Crawler(srv.url);
    const res = await crawler.fetch('/robots.txt');
    expect(res?.status).toBe(200);
    expect(res?.body).toContain('User-agent');
    const again = await crawler.fetch('/robots.txt');
    expect(again).toBe(res); // same cached object
  });
  it('returns null on unreachable host', async () => {
    const crawler = new Crawler('http://127.0.0.1:1', 500);
    expect(await crawler.fetch('/')).toBeNull();
  });
  it('returns 404 resources (not null)', async () => {
    const srv = await serveFixture(dir); closers.push(srv.close);
    const crawler = new Crawler(srv.url);
    const res = await crawler.fetch('/nope.txt');
    expect(res?.status).toBe(404);
  });
  it('rebuilds baseUrl from the final origin after a redirect on /', async () => {
    const target = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(target.close);
    // Entry server: redirects ONLY '/' to the target origin, 404 elsewhere.
    const entryUrl = await listen(http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(301, { location: `${target.url}/` });
        res.end();
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not here');
      }
    }));
    const crawler = new Crawler(entryUrl);
    const home = await crawler.fetch('/');
    expect(home?.status).toBe(200);
    expect(crawler.baseUrl.origin).toBe(new URL(target.url).origin);
    // robots.txt only exists on the FINAL origin — proves later fetches use it.
    const robots = await crawler.fetch('/robots.txt');
    expect(robots?.status).toBe(200);
    expect(robots?.body).toContain('User-agent');
  });
  it('caps response bodies at 5 MB', async () => {
    const big = 'x'.repeat(6 * 1024 * 1024); // 6 MB
    const bigUrl = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(big);
    }));
    const crawler = new Crawler(bigUrl);
    const res = await crawler.fetch('/');
    expect(res?.status).toBe(200);
    expect(res!.body.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(res!.body.length).toBeGreaterThan(0);
  });
  it('exposes response headers', async () => {
    const srv = await serveFixture(dir); closers.push(srv.close);
    const crawler = new Crawler(srv.url);
    const res = await crawler.fetch('/robots.txt');
    expect(res?.headers['content-type']).toBe('text/plain');
  });
  it('sends the default user-agent, and an override when provided', async () => {
    const seen: string[] = [];
    const url = await listen(http.createServer((req, res) => {
      seen.push(req.headers['user-agent'] ?? '');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    }));
    await new Crawler(url).fetch('/');
    await new Crawler(url, undefined, 'GPTBot/1.0').fetch('/');
    expect(seen[0]).toMatch(/^findable-audit/);
    expect(seen[1]).toBe('GPTBot/1.0');
  });

  describe('fetchWithUA', () => {
    it('sends the given UA header, independent of the constructor default', async () => {
      const seen: string[] = [];
      const url = await listen(http.createServer((req, res) => {
        seen.push(req.headers['user-agent'] ?? '');
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      }));
      const crawler = new Crawler(url); // default UA, never overridden per-call
      const res = await crawler.fetchWithUA('/', 'GPTBot/1.2 (+https://openai.com/gptbot)');
      expect(res?.status).toBe(200);
      expect(seen[0]).toBe('GPTBot/1.2 (+https://openai.com/gptbot)');
    });

    it('caches per (userAgent, url): a second call for the same UA makes no request', async () => {
      let hits = 0;
      const url = await listen(http.createServer((_req, res) => {
        hits++;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      }));
      const crawler = new Crawler(url);
      const first = await crawler.fetchWithUA('/', 'GPTBot/1.2');
      const second = await crawler.fetchWithUA('/', 'GPTBot/1.2');
      expect(hits).toBe(1);
      expect(second).toBe(first); // same cached object, no second request
    });

    it('does not share or evict the default-UA fetch() cache (separate Map)', async () => {
      let hits = 0;
      const url = await listen(http.createServer((_req, res) => {
        hits++;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      }));
      const crawler = new Crawler(url);
      await crawler.fetch('/'); // populates the default-UA cache: 1 request
      await crawler.fetchWithUA('/', 'GPTBot/1.2'); // different cache: 1 more request
      expect(hits).toBe(2);
      await crawler.fetch('/'); // still cached
      await crawler.fetchWithUA('/', 'GPTBot/1.2'); // still cached
      await crawler.fetchWithUA('/', 'ClaudeBot/1.0'); // new UA -> new request
      expect(hits).toBe(3);
    });

    it('returns null on a transport error (unreachable host)', async () => {
      const crawler = new Crawler('http://127.0.0.1:1', 500);
      expect(await crawler.fetchWithUA('/', 'GPTBot/1.2')).toBeNull();
    });

    it('does not cache a non-2xx response, so a retry re-requests (finding #3)', async () => {
      let hits = 0;
      const url = await listen(http.createServer((_req, res) => {
        hits++;
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('busy');
      }));
      const crawler = new Crawler(url);
      const a = await crawler.fetchWithUA('/', 'GPTBot/1.2');
      const b = await crawler.fetchWithUA('/', 'GPTBot/1.2');
      expect(a?.status).toBe(503);
      expect(b?.status).toBe(503);
      expect(hits).toBe(2); // the failed response was NOT cached; the second call re-requested
    });

    it('refuses an absolute cross-origin path without fetching it (same-origin contract, finding #8)', async () => {
      let otherHits = 0;
      const other = await listen(http.createServer((_req, res) => {
        otherHits++;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('secret');
      }));
      const base = await listen(http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      }));
      const crawler = new Crawler(base);
      const res = await crawler.fetchWithUA(`${other}/`, 'GPTBot/1.2');
      expect(res).toBeNull();          // cross-origin input refused
      expect(otherHits).toBe(0);       // and never actually fetched
    });

    it('does NOT re-pin baseUrl to a redirect target origin (unlike fetch())', async () => {
      const target = await serveFixture(path.join(fixtures, 'perfect-site'));
      closers.push(target.close);
      const entryUrl = await listen(http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(301, { location: `${target.url}/` });
          res.end();
        } else {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('not here');
        }
      }));
      const crawler = new Crawler(entryUrl);
      const res = await crawler.fetchWithUA('/', 'GPTBot/1.2');
      expect(res?.status).toBe(200); // redirect still followed for this one call
      expect(crawler.baseUrl.origin).toBe(new URL(entryUrl).origin); // but NOT re-pinned
    });

    it('enforces the SSRF guard in guarded mode: a blocked target -> null, never fetched', async () => {
      let hits = 0;
      const target = await listen(http.createServer((_req, res) => {
        hits++;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('reached');
      }));
      const targetPort = new URL(target).port;
      // Same seam pattern as crawler-guard.test.ts: neutralise the real loopback
      // block, then use allowPort as the "is this host blocked" decision so the
      // target's own port is refused.
      const crawler = new Crawler(target, 2000, undefined, {
        blockPrivateHosts: true,
        isBlocked: () => false,
        allowPort: (p) => p !== targetPort,
      });
      const res = await crawler.fetchWithUA('/', 'GPTBot/1.2');
      expect(res).toBeNull();
      expect(hits).toBe(0); // guard rejected before any connection was made
    });

    it('guarded mode allows a permitted target through, under the given UA', async () => {
      const seen: string[] = [];
      const target = await listen(http.createServer((req, res) => {
        seen.push(req.headers['user-agent'] ?? '');
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('reached');
      }));
      const crawler = new Crawler(target, 2000, undefined, {
        blockPrivateHosts: true,
        isBlocked: () => false,
        allowPort: () => true,
      });
      const res = await crawler.fetchWithUA('/', 'ClaudeBot/1.0');
      expect(res?.status).toBe(200);
      expect(seen[0]).toBe('ClaudeBot/1.0');
    });
  });
});
