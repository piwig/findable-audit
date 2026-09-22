import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../src/types.js';
import { tableCaption, sourcesSection, ambiguousDates, ambiguousDateCount } from '../src/checks/geo-advanced.js';

// A162 — « citabilité documentaire » : caption on tables, Sources section on
// pillar pages, dates that cannot be misread. Same makeCtx pattern as
// geo-advanced.test.ts.

const BASE = 'https://stub.example/';

function page(pathname: string, body = ''): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

function makeCtx(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map<string, FetchedResource>();
  for (const p of pages) byPath.set(new URL(p.finalUrl).pathname, p);
  const ctx: CrawlContext = {
    baseUrl: new URL(BASE),
    async fetch(p: string) {
      const url = new URL(p, BASE);
      return byPath.get(url.pathname) ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
  };
  ctx.sample = { pages, source: 'links' };
  return ctx;
}

/** A long (> 40 words), digit-free, month-free prose paragraph. */
function longPara(): string {
  return '<p>Fresh sourdough bread baked with patience and care by our neighbourhood bakers using stone ovens and slow overnight fermentation for deep flavour in every single loaf we sell across the whole town every morning without any exception whatsoever.</p>';
}

function filler(min: number): string {
  let out = '';
  for (let i = 0; i < Math.ceil(min / 40); i += 1) out += longPara();
  return out;
}

const TABLE = '<table><tr><th>Offer</th><th>Price</th></tr><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table>';

describe('table-caption', () => {
  it('skips when no sampled table has 3 rows', async () => {
    const r = await tableCaption.run(makeCtx([page('/', `<main><h1>T</h1>${filler(160)}<table><tr><td>x</td></tr></table></main>`)]));
    expect(r.status).toBe('skip');
  });

  it('passes with a <caption>, an aria-label or a heading right before the table', async () => {
    const body = `<main><h1>T</h1><table><caption>Prices</caption>${TABLE.slice(7)}<h2>Compared</h2>${TABLE}<table aria-label="Sizes">${TABLE.slice(7)}</main>`;
    const r = await tableCaption.run(makeCtx([page('/', body)]));
    expect(r.status).toBe('pass');
  });

  it('warns on an untitled table and names the page', async () => {
    const r = await tableCaption.run(makeCtx([page('/pricing', `<main><h1>T</h1><p>Intro.</p>${TABLE}</main>`)]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/pricing (1 untitled)');
    expect(r.points).toBe(1);
  });

  it('requires aria-labelledby to resolve to nonempty text', async () => {
    const missing = TABLE.replace('<table>', '<table aria-labelledby="missing">');
    expect((await tableCaption.run(makeCtx([page('/', `<main><p>Intro</p>${missing}</main>`)]))).status).toBe('warn');
    const named = TABLE.replace('<table>', '<table aria-labelledby="label">');
    expect((await tableCaption.run(makeCtx([page('/', `<main><p id="label">Prices</p>${named}</main>`)]))).status).toBe('pass');
  });
});

describe('sources-section', () => {
  it('skips without a pillar page', async () => {
    const r = await sourcesSection.run(makeCtx([page('/', `<main><h1>T</h1>${filler(160)}</main>`)]));
    expect(r.status).toBe('skip');
  });

  it('passes when a Sources/Références heading is followed by an outbound link', async () => {
    const en = page('/a', `<main><h1>T</h1>${filler(320)}<h2>Sources</h2><ul><li><a href="https://example.org/study">Study</a></li></ul></main>`);
    const fr = page('/b', `<main><h1>T</h1>${filler(320)}<h3>Références</h3><p><a href="https://insee.fr/x">INSEE</a></p><h2>Suite</h2></main>`);
    const r = await sourcesSection.run(makeCtx([en, fr]));
    expect(r.status).toBe('pass');
  });

  it('warns when the section is missing or only links to the same host', async () => {
    const self = page('/a', `<main><h1>T</h1>${filler(320)}<h2>Sources</h2><p><a href="/about">us</a></p></main>`);
    const none = page('/b', `<main><h1>T</h1>${filler(320)}</main>`);
    const r = await sourcesSection.run(makeCtx([self, none]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('2/2');
  });

  it('recognizes an outbound source link directly following its heading', async () => {
    expect((await sourcesSection.run(makeCtx([page('/', `<main>${filler(320)}<h2>Sources</h2><a href="https://example.org/study">Study</a></main>`)]))).status).toBe('pass');
  });
});

describe('ambiguous-dates', () => {
  it('counts dd/mm/yyyy, dd.mm.yy and mm-dd-yyyy but not ISO dates or fractions', () => {
    expect(ambiguousDateCount('le 02/03/2026, puis 28.02.26 et 12-31-2025')).toBe(3);
    expect(ambiguousDateCount('2026-02-28 and 3/4 of a cup and 1/2/3/4')).toBe(0);
  });

  it('skips without a substantial page', async () => {
    const r = await ambiguousDates.run(makeCtx([page('/', '<main><h1>T</h1><p>Short. 02/03/2026</p></main>')]));
    expect(r.status).toBe('skip');
  });

  it('passes when the page spells a month out somewhere, or has no numeric date', async () => {
    const mixed = page('/a', `<main><h1>T</h1>${filler(160)}<p>Mis à jour le 28 février 2026 (v. 02/03/2026).</p></main>`);
    const clean = page('/b', `<main><h1>T</h1>${filler(160)}</main>`);
    const r = await ambiguousDates.run(makeCtx([mixed, clean]));
    expect(r.status).toBe('pass');
  });

  it('warns on numeric-only dates and names the page with its count', async () => {
    const r = await ambiguousDates.run(makeCtx([page('/news', `<main><h1>T</h1>${filler(160)}<p>Publié le 02/03/2026, modifié le 04/03/2026.</p></main>`)]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/news (2)');
  });
});
