import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../src/types.js';
import {
  freshnessCoherence, hedgingRate, answerUnits, chunkBoundary,
} from '../src/checks/geo-advanced.js';

const BASE = 'https://stub.example/';

function page(pathname: string, body = '', extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

interface CtxOpts {
  pages?: FetchedResource[];
  /** Extra fetchable resources (sitemap, robots) keyed by pathname, NOT part of the sample. */
  resources?: FetchedResource[];
  base?: string;
}

/** makeCtx pattern copied from test/csr-content-parity.test.ts. */
function makeCtx(opts: CtxOpts = {}): CrawlContext {
  const { pages = [], resources = [], base = BASE } = opts;
  const byPath = new Map<string, FetchedResource>();
  for (const p of [...pages, ...resources]) byPath.set(new URL(p.finalUrl).pathname, p);
  const ctx: CrawlContext = {
    baseUrl: new URL(base),
    async fetch(p: string) {
      const url = new URL(p, base);
      return byPath.get(url.pathname) ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
  };
  ctx.sample = { pages, source: 'links' };
  return ctx;
}

/** A long (> 40 words), hedge-free, digit-free prose paragraph — never an answer unit. */
function longPara(): string {
  const s = 'Fresh sourdough bread baked with patience and care by our neighbourhood bakers using stone ovens and slow overnight fermentation for deep flavour in every single loaf we sell across the town and beyond to hungry visitors who arrive early each weekend morning. ';
  return `<p>${s.trim()}</p>`;
}

/** Enough long paragraphs to push mainContent past `min` words. */
function filler(min: number): string {
  let out = '';
  for (let i = 0; i < Math.ceil(min / 42); i += 1) out += longPara();
  return out;
}

function sitemapXml(entries: Array<{ loc: string; lastmod?: string }>): FetchedResource {
  const urls = entries
    .map((e) => `<url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
    .join('');
  return {
    status: 200, ok: true, contentType: 'application/xml',
    body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    finalUrl: new URL('/sitemap.xml', BASE).toString(), headers: {},
  };
}

function jsonLdArticle(dateModified: string): string {
  return `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"X","dateModified":"${dateModified}"}</script>`;
}

// ---------------------------------------------------------------------------
// QW1 freshness-coherence
// ---------------------------------------------------------------------------

describe('freshness-coherence', () => {
  it('(a) skips when no sampled page has 2 of the 3 freshness sources', async () => {
    const ctx = makeCtx({ pages: [page('/', `<main><h1>T</h1>${filler(160)}</main>`)] });
    const r = await freshnessCoherence.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('(b) passes when Last-Modified is newer than sitemap lastmod (deploy touch is benign)', async () => {
    const home = page('/', `<main><h1>T</h1>${filler(160)}</main>`, { headers: { 'last-modified': 'Wed, 01 Jul 2026 10:00:00 GMT' } });
    const ctx = makeCtx({ pages: [home], resources: [sitemapXml([{ loc: `${BASE}`, lastmod: '2026-05-12' }])] });
    const r = await freshnessCoherence.run(ctx);
    expect(r.status).toBe('pass');
  });

  it('(c) warns when the claimed dateModified is >24h newer than Last-Modified', async () => {
    const home = page('/', `<main><h1>T</h1>${jsonLdArticle('2026-07-20T10:00:00Z')}${filler(160)}</main>`,
      { headers: { 'last-modified': 'Mon, 02 Feb 2026 10:00:00 GMT' } });
    const ctx = makeCtx({ pages: [home] });
    const r = await freshnessCoherence.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/');
  });

  it('(d) warns when dateModified and sitemap lastmod diverge by more than 24h', async () => {
    const home = page('/', `<main><h1>T</h1>${jsonLdArticle('2026-01-01T00:00:00Z')}${filler(160)}</main>`);
    const ctx = makeCtx({ pages: [home], resources: [sitemapXml([{ loc: `${BASE}`, lastmod: '2026-03-01' }])] });
    const r = await freshnessCoherence.run(ctx);
    expect(r.status).toBe('warn');
  });

  it('(e) fails when a claimed date is in the future (fake freshness)', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const home = page('/', `<main><h1>T</h1>${jsonLdArticle(future)}${filler(160)}</main>`,
      { headers: { 'last-modified': 'Wed, 01 Jul 2026 10:00:00 GMT' } });
    const ctx = makeCtx({ pages: [home] });
    const r = await freshnessCoherence.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message.toLowerCase()).toContain('future');
  });

  it('(f) passes when dateModified and sitemap lastmod agree within 24h', async () => {
    const home = page('/', `<main><h1>T</h1>${jsonLdArticle('2026-05-12T08:00:00Z')}${filler(160)}</main>`);
    const ctx = makeCtx({ pages: [home], resources: [sitemapXml([{ loc: `${BASE}`, lastmod: '2026-05-12' }])] });
    const r = await freshnessCoherence.run(ctx);
    expect(r.status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// QW2 hedging-rate
// ---------------------------------------------------------------------------

describe('hedging-rate', () => {
  it('(a) skips when no sampled page is substantial (>=150 words)', async () => {
    const ctx = makeCtx({ pages: [page('/', '<main><h1>T</h1><p>Short page.</p></main>')] });
    const r = await hedgingRate.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('(b) passes on a substantial page with a direct, hedge-free lead', async () => {
    const body = `<main><h1>T</h1><p>Our bakery sells 1200 loaves per week in Springfield.</p>${filler(160)}</main>`;
    const r = await hedgingRate.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(c) warns (never fails) with >=2 English hedges in the lead', async () => {
    const lead = '<p>Perhaps our bread is the best in town, although it seems opinions vary quite a bit among the many loyal customers.</p>';
    const body = `<main><h1>T</h1>${lead}${filler(160)}</main>`;
    const r = await hedgingRate.run(makeCtx({ pages: [page('/x', body)] }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/x');
  });

  it('(d) detects French hedges', async () => {
    const lead = '<p>Peut-être que notre pain est le meilleur de la ville, mais il semble que cela varie selon les gens du quartier.</p>';
    const body = `<main><h1>T</h1>${lead}${filler(160)}</main>`;
    const r = await hedgingRate.run(makeCtx({ pages: [page('/fr', body)] }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/fr');
  });

  it('(e) tolerates a single hedge in the lead', async () => {
    const lead = '<p>Our sourdough is probably the most popular bread we bake for the town each and every single morning.</p>';
    const body = `<main><h1>T</h1>${lead}${filler(160)}</main>`;
    const r = await hedgingRate.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(f) ignores hedges buried beyond the first two paragraphs', async () => {
    const deep = '<p>Maybe this could be seen differently, and perhaps it depends on the case entirely.</p>';
    const body = `<main><h1>T</h1>${longPara()}${longPara()}${filler(120)}${deep}</main>`;
    const r = await hedgingRate.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// QW3 answer-units
// ---------------------------------------------------------------------------

describe('answer-units', () => {
  it('(a) skips when no pillar page (>=300 words) exists', async () => {
    const ctx = makeCtx({ pages: [page('/', `<main><h1>T</h1>${filler(160)}</main>`)] });
    const r = await answerUnits.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('(b) passes when a pillar page carries a numeric answer unit', async () => {
    const unit = '<p>Our bakery produces 1200 sourdough loaves every week for the town of Springfield.</p>';
    const body = `<main><h1>T</h1>${unit}${filler(320)}</main>`;
    const r = await answerUnits.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(c) warns (never fails) when a pillar page has zero answer units', async () => {
    const body = `<main><h1>T</h1>${filler(340)}</main>`;
    const r = await answerUnits.run(makeCtx({ pages: [page('/pillar', body)] }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/pillar');
  });

  it('(d) rejects anaphoric openers as answer units', async () => {
    const notUnit = '<p>It produces 1200 sourdough loaves every week for the whole town nearby.</p>';
    const body = `<main><h1>T</h1>${notUnit}${filler(340)}</main>`;
    const r = await answerUnits.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('warn');
  });

  it('(e) accepts an answer unit inside a list item', async () => {
    const li = '<ul><li>Example Bakery opened its Springfield store in 1998 with a single stone oven.</li></ul>';
    const intro = '<p>Key milestones follow below.</p>';
    const body = `<main><h1>T</h1>${filler(320)}${intro}${li}</main>`;
    const r = await answerUnits.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(f) accepts an entity proxy (mid-sentence capitalized token) as the fact anchor', async () => {
    const unit = '<p>Example Bakery bakes slow sourdough loaves in downtown Springfield with local flour.</p>';
    const body = `<main><h1>T</h1>${unit}${filler(320)}</main>`;
    const r = await answerUnits.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(g) rejects hedged sentences as answer units', async () => {
    const hedged = '<p>Our bakery probably produces 1200 sourdough loaves every week for the town.</p>';
    const body = `<main><h1>T</h1>${hedged}${filler(340)}</main>`;
    const r = await answerUnits.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// QW4 chunk-boundary
// ---------------------------------------------------------------------------

const CLEAN_LIST = '<p>What comes out of the oven:</p><ul><li>Loaves</li><li>Tarts</li><li>Cakes</li></ul>';

describe('chunk-boundary', () => {
  it('(a) skips when no sampled page is substantial (>=150 words)', async () => {
    const ctx = makeCtx({ pages: [page('/', '<main><h1>T</h1><p>Tiny.</p></main>')] });
    const r = await chunkBoundary.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('(b) passes on a clean page (titled list, question heading answered by a paragraph)', async () => {
    const body = `<main><h1>T</h1>${filler(160)}<h2>What do we bake?</h2><p>Bread, tarts and cakes, every single day.</p>${CLEAN_LIST}</main>`;
    const r = await chunkBoundary.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(c) warns (never fails) on a long table without header cells', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<tr><td>row ${i}</td><td>x</td></tr>`).join('');
    const body = `<main><h1>T</h1>${filler(160)}<table>${rows}</table></main>`;
    const r = await chunkBoundary.run(makeCtx({ pages: [page('/t', body)] }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/t');
  });

  it('(d) does not flag a long table WITH a thead/th', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<tr><td>row ${i}</td><td>x</td></tr>`).join('');
    const body = `<main><h1>T</h1>${filler(160)}<table><thead><tr><th>Name</th><th>Value</th></tr></thead>${rows}</table></main>`;
    const r = await chunkBoundary.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(e) flags a question heading separated from its answer by decorative DOM', async () => {
    const faq = '<h2>How long does the dough rest?</h2><img src="/deco.jpg" alt="decorative dough picture"><p>The dough rests overnight, for at least twelve hours.</p>';
    const body = `<main><h1>T</h1>${filler(160)}${faq}</main>`;
    const r = await chunkBoundary.run(makeCtx({ pages: [page('/faq', body)] }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/faq');
  });

  it('(f) flags a list of 3+ items orphaned from any title', async () => {
    const orphan = '<hr><ul><li>Loaves and more loaves</li><li>Tarts of the season</li><li>Cakes to order</li></ul>';
    const body = `<main><h1>T</h1>${filler(160)}${orphan}</main>`;
    const r = await chunkBoundary.run(makeCtx({ pages: [page('/list', body)] }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/list');
  });

  it('(g) does not flag nested lists', async () => {
    const nested = '<p>Our menu has these families:</p><ul><li>Breads<ul><li>Sourdough</li><li>Rye</li><li>Spelt</li></ul></li><li>Tarts</li><li>Cakes</li></ul>';
    const body = `<main><h1>T</h1>${filler(160)}${nested}</main>`;
    const r = await chunkBoundary.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });
});
