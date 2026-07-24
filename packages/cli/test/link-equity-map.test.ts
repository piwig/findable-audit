import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrawlContext, FetchedResource } from '../src/types.js';
import type { LinkGraph } from '../src/checks/link-graph.js';
import { inDegree, pagerank } from '../src/checks/link-graph.js';
import { linkEquityMap } from '../src/checks/technical-seo.js';
import { serveFixture } from './helpers/server.js';
import { Crawler } from '../src/crawler.js';
import { samplePages } from '../src/sampler.js';

const BASE = 'https://stub.example/';
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

function page(pathname: string, body = '', extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

function makeCtx(pages: FetchedResource[], base = BASE): CrawlContext {
  const byPath = new Map<string, FetchedResource>();
  for (const p of pages) byPath.set(new URL(p.finalUrl).pathname, p);
  return {
    baseUrl: new URL(base),
    async fetch(p: string) {
      const url = new URL(p, base);
      return byPath.get(url.pathname) ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
    sample: { pages, source: 'links' },
  };
}

async function sampledFixture(name: string, maxPages = 10): Promise<Crawler> {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  const c = new Crawler(srv.url);
  c.sample = await samplePages(c, maxPages);
  return c;
}

// ---------------------------------------------------------------------------
// inDegree (pure helper)
// ---------------------------------------------------------------------------

describe('inDegree', () => {
  it('counts inbound edges per target URL over the adjacency, excluding self-links', () => {
    const graph: LinkGraph = {
      pageUrls: ['https://x/', 'https://x/a', 'https://x/b'],
      outLinks: new Map([
        ['https://x/', new Set(['https://x/a', 'https://x/b'])],
        ['https://x/a', new Set(['https://x/', 'https://x/a'])], // self-link on /a
        ['https://x/b', new Set(['https://x/'])],
      ]),
      depth: new Map(),
    };
    const deg = inDegree(graph);
    expect(deg.get('https://x/')).toBe(2); // from /a and /b
    expect(deg.get('https://x/a')).toBe(1); // from home only — the self-link is excluded
    expect(deg.get('https://x/b')).toBe(1); // from home
  });

  it('counts targets that lie outside the sample too', () => {
    const graph: LinkGraph = {
      pageUrls: ['https://x/'],
      outLinks: new Map([['https://x/', new Set(['https://x/never-crawled'])]]),
      depth: new Map(),
    };
    expect(inDegree(graph).get('https://x/never-crawled')).toBe(1);
  });

  it('returns no entry for a URL nothing links to', () => {
    const graph: LinkGraph = {
      pageUrls: ['https://x/'],
      outLinks: new Map([['https://x/', new Set()]]),
      depth: new Map(),
    };
    expect(inDegree(graph).has('https://x/unreferenced')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pagerank (pure helper)
// ---------------------------------------------------------------------------

describe('pagerank', () => {
  // A hub linked from three leaves; the hub links back to only one of them.
  // Non-bipartite-avoidance note: this graph does oscillate briefly (the
  // hub<->leaf1 2-cycle). At 20 iterations the residual period-2 oscillation
  // still leaves only a ~3.5% margin; the fixed 50-iteration default (finding
  // #6) damps it much further, so the hub's structural advantage (3 inbound vs
  // 1) dominates comfortably — verified numerically.
  const hubGraph = (): LinkGraph => ({
    pageUrls: ['hub', 'leaf1', 'leaf2', 'leaf3'],
    outLinks: new Map([
      ['hub', new Set(['leaf1'])],
      ['leaf1', new Set(['hub'])],
      ['leaf2', new Set(['hub'])],
      ['leaf3', new Set(['hub'])],
    ]),
    depth: new Map(),
  });

  it('ranks a well-linked hub above a leaf that only one page links to (default 50 iterations)', () => {
    const ranks = pagerank(hubGraph());
    expect(ranks.get('hub')!).toBeGreaterThan(ranks.get('leaf1')!);
  });

  it('is deterministic across independent runs on the same graph', () => {
    const g = hubGraph();
    const r1 = pagerank(g);
    const r2 = pagerank(g);
    expect(Object.fromEntries(r1)).toEqual(Object.fromEntries(r2));
  });

  it('produces ranks that sum to approximately 1', () => {
    const ranks = pagerank(hubGraph());
    const total = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('handles a dangling node (no outlinks) without losing rank mass', () => {
    const graph: LinkGraph = {
      pageUrls: ['a', 'b'],
      outLinks: new Map([['a', new Set(['b'])], ['b', new Set()]]),
      depth: new Map(),
    };
    const ranks = pagerank(graph);
    const total = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(ranks.get('b')!).toBeGreaterThan(0);
  });

  it('includes discovered targets outside the sample as nodes (no NaN / lost mass)', () => {
    const graph: LinkGraph = {
      pageUrls: ['home', 'a'],
      outLinks: new Map([['home', new Set(['a', 'never-crawled'])], ['a', new Set(['home'])]]),
      depth: new Map(),
    };
    const ranks = pagerank(graph);
    expect(ranks.get('never-crawled')).toBeGreaterThan(0);
    const total = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('runs a fixed 50 iterations by default — differs materially from a single iteration', () => {
    const g = hubGraph();
    const oneIter = pagerank(g, 0.85, 1);
    const fiftyIter = pagerank(g, 0.85, 50);
    const defaultIter = pagerank(g);
    expect(oneIter.get('hub')).not.toBeCloseTo(fiftyIter.get('hub')!, 2);
    expect(defaultIter.get('hub')).toBeCloseTo(fiftyIter.get('hub')!, 10);
  });
});

// ---------------------------------------------------------------------------
// link-equity-map check
// ---------------------------------------------------------------------------

describe('link-equity-map', () => {
  it('passes on a well-linked sample and names the top-3 pages with their share', async () => {
    const ctx = await sampledFixture('perfect-site');
    const r = await linkEquityMap.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('/about.html');
    expect(r.message).toContain('/contact.html');
    expect(r.message).toMatch(/\d+\.\d{2}%/); // 2-decimal share formatting
  });

  it('flags an orphan sampled page (nothing links to it) but caps at warn (sampling uncertainty)', async () => {
    const ctx = makeCtx([
      page('/', '<a href="/about">about</a>'),
      page('/about', '<a href="/">home</a>'),
      page('/orphan', '<a href="/about">about</a>'), // has an outlink, so not a dead-end
    ]);
    const r = await linkEquityMap.run(ctx);
    // One orphan out of three pages is below the 0.8 conform threshold, so the
    // raw aggregate would FAIL — but with only orphans (no dead-ends) present,
    // finding #2 caps the verdict at warn because a sitemap-sampled page's real
    // in-degree is unknowable when its linking hub wasn't sampled.
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/orphan');
    expect(r.message).toContain('orphan');
  });

  it('does not false-orphan a page whose inbound link 301s to a trailing-slash final URL', async () => {
    // Home links to "/about" (no slash); that page's final URL is "/about/"
    // (a 301 added the slash). In-degree must be matched by canonical identity
    // (finding #1), exactly like internal-linking, so this is NOT an orphan.
    const ctx = makeCtx([
      page('/', '<a href="/about">about</a><a href="/blog">blog</a>'),
      page('/about/', '<a href="/">home</a>'), // final URL carries the trailing slash
      page('/blog', '<a href="/">home</a><a href="/about">about</a>'),
    ]);
    const r = await linkEquityMap.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).not.toContain('orphan');
  });

  it('still caps orphan-only offenders at warn even well below the fail threshold', async () => {
    // 3 orphans out of 5 pages → conform 0.4, far below 0.8 (raw = fail), but no
    // dead-ends → capped at warn (finding #2).
    const ctx = makeCtx([
      page('/', '<a href="/hub">hub</a>'),
      page('/hub', '<a href="/">home</a>'),
      page('/a', '<a href="/hub">hub</a>'),
      page('/b', '<a href="/hub">hub</a>'),
      page('/c', '<a href="/hub">hub</a>'),
    ]);
    const r = await linkEquityMap.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('orphan');
    // No offender is labeled a dead-end (the "orphan/dead-end page(s):" prefix
    // is fixed text; an actual dead-end offender would read "… (dead-end)").
    expect(r.message).not.toContain('dead-end)');
  });

  it('flags a dead-end page (zero internal outlinks)', async () => {
    const ctx = makeCtx([
      page('/', '<a href="/about">about</a><a href="/deadend">dead end</a>'),
      page('/about', '<a href="/">home</a>'),
      page('/deadend', '<p>no internal links here</p>'), // linked FROM home, so not an orphan
    ]);
    const r = await linkEquityMap.run(ctx);
    // A dead-end is observed directly on the page (zero outlinks), no sampling
    // uncertainty — so the fail verdict is NOT capped (finding #2).
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/deadend');
    expect(r.message).toContain('dead-end');
  });

  it('renormalizes the printed top-page shares over the sampled pages (finding #9)', async () => {
    // Home also links to a never-sampled page, so raw PageRank leaks mass off the
    // sample and the sampled pages' raw shares sum to < 100%. The printed shares
    // are renormalized within the sample, so the top-3 (= all 3 sampled pages)
    // sum back to ~100% rather than the smaller raw total.
    const ctx = makeCtx([
      page('/', '<a href="/about">a</a><a href="/contact">c</a><a href="/external-only">x</a>'),
      page('/about', '<a href="/">h</a><a href="/contact">c</a>'),
      page('/contact', '<a href="/">h</a><a href="/about">a</a>'),
    ]);
    const r = await linkEquityMap.run(ctx);
    expect(r.status).toBe('pass');
    const pcts = [...r.message.matchAll(/(\d+\.\d{2})%/g)].map((m) => Number(m[1]));
    expect(pcts).toHaveLength(3);
    const sum = pcts.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(99.9);
    expect(sum).toBeLessThanOrEqual(100.05);
  });

  it('skips when fewer than 3 pages are sampled', async () => {
    const ctx = makeCtx([
      page('/', '<a href="/about">about</a>'),
      page('/about', '<a href="/">home</a>'),
    ]);
    expect((await linkEquityMap.run(ctx)).status).toBe('skip');
  });

  it('is deterministic: running the check twice yields the same message', async () => {
    const ctx = makeCtx([
      page('/', '<a href="/about">about</a><a href="/contact">contact</a><a href="/blog">blog</a>'),
      page('/about', '<a href="/">home</a>'),
      page('/contact', '<a href="/">home</a>'),
      page('/blog', '<a href="/">home</a><a href="/about">about</a>'),
    ]);
    const r1 = await linkEquityMap.run(ctx);
    const r2 = await linkEquityMap.run(ctx);
    expect(r1.message).toBe(r2.message);
    expect(r1.status).toBe(r2.status);
  });
});
