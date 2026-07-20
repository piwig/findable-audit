import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { Crawler } from '../src/crawler.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mini');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

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
});
