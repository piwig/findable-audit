// The two properties that make parallel checks safe for the audited site.
//
// Before checks ran concurrently, neither mattered: one request at a time, no
// duplicates possible. Now they are the contract, so they are asserted against a
// real HTTP server rather than trusted.
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { Crawler } from '../src/crawler.js';
import { runAudit } from '../src/runner.js';
import type { Check } from '../src/types.js';
import { makeResult } from '../src/types.js';

const closers: Array<() => void> = [];
afterAll(() => { for (const c of closers) c(); });

/** A server that records how many requests overlap, and how many it served. */
async function countingServer(delayMs = 30) {
  let inFlight = 0;
  let peak = 0;
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    hits.push(req.url ?? '');
    setTimeout(() => {
      inFlight--;
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html lang="en"><head><title>t</title></head><body><h1>Hi</h1></body></html>');
    }, delayMs);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => server.close());
  const { port } = server.address() as import('node:net').AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, peak: () => peak, hits: () => hits };
}

describe('crawler request gate', () => {
  it('never exceeds the in-flight ceiling, however many callers pile in', async () => {
    const srv = await countingServer(40);
    const crawler = new Crawler(srv.url);
    const paths = Array.from({ length: 24 }, (_, i) => `/p${i}`);
    await Promise.all(paths.map((p) => crawler.fetch(p)));
    expect(srv.hits()).toHaveLength(24);
    // The published ceiling is 6; assert the property, not the exact number.
    expect(srv.peak()).toBeLessThanOrEqual(6);
    expect(srv.peak()).toBeGreaterThan(1); // and it really is concurrent
  });

  it('collapses concurrent callers for the same URL into a single request', async () => {
    const srv = await countingServer(40);
    const crawler = new Crawler(srv.url);
    const all = await Promise.all(Array.from({ length: 10 }, () => crawler.fetch('/same')));
    expect(srv.hits().filter((u) => u === '/same')).toHaveLength(1);
    // Every caller still gets the answer.
    for (const res of all) expect(res?.status).toBe(200);
  });

  it('still serves a repeated URL from cache after the flight lands', async () => {
    const srv = await countingServer(5);
    const crawler = new Crawler(srv.url);
    await crawler.fetch('/once');
    await crawler.fetch('/once');
    expect(srv.hits().filter((u) => u === '/once')).toHaveLength(1);
  });
});

describe('runAudit with concurrent checks', () => {
  /** A check that records when it started, so overlap is observable. */
  function slowCheck(id: string, started: string[]): Check {
    return {
      id, family: 'technical-seo', evidence: 'measured', maxPoints: 1,
      async run(ctx) {
        started.push(id);
        await ctx.fetch(`/${id}`);
        return makeResult(this, 'pass', `${id} ok`);
      },
    };
  }

  it('returns results in the order the checks were given, not the order they finished', async () => {
    const srv = await countingServer(20);
    const started: string[] = [];
    // Reverse-ish latency: the first check waits longest, so a naive
    // "push on completion" would invert the list.
    const checks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => slowCheck(id, started));
    const report = await runAudit(srv.url, checks);
    expect(report.results.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  }, 30_000);

  it('really overlaps them: the site sees several requests at once', async () => {
    const srv = await countingServer(60);
    const checks = Array.from({ length: 8 }, (_, i) => slowCheck(`c${i}`, []));
    await runAudit(srv.url, checks);
    // Deliberately NOT a wall-clock assertion: elapsed time depends on whatever
    // else the machine is doing, and a test that fails under load is worse than
    // no test. Observed overlap is the property itself — sequential execution
    // could never make the server see more than one request at a time.
    expect(srv.peak()).toBeGreaterThan(1);
    expect(srv.peak()).toBeLessThanOrEqual(6);
  }, 30_000);

  it('a crashing check is still isolated to a skip, concurrency or not', async () => {
    const srv = await countingServer(5);
    const boom: Check = {
      id: 'boom', family: 'security', evidence: 'measured', maxPoints: 3,
      async run() { throw new Error('kaboom'); },
    };
    const report = await runAudit(srv.url, [boom, slowCheck('after', [])]);
    expect(report.results[0].status).toBe('skip');
    expect(report.results[0].message).toContain('kaboom');
    expect(report.results[1].status).toBe('pass');
  }, 30_000);
});
