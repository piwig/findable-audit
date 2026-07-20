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
});
