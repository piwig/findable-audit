# Multi-Page Crawl, New Checks & Plugin Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit a deterministic sample of pages (homepage + sitemap/link-discovered pages) and add 7 new checks plus the 3 missing plugin skills, per `docs/superpowers/specs/2026-07-20-new-checks-design.md`.

**Architecture:** A `samplePages()` sampler runs once in `runAudit` and attaches a `PageSample` to the `CrawlContext` (optional field — zero breaking change). New checks read `ctx.sample` via a `pagesOf()` helper that falls back to the homepage. Scoring stays auto-normalized by the runner; no rebalance of existing checks.

**Tech Stack:** Node >= 20, TypeScript ESM (imports end in `.js`), `node-html-parser`, `fast-xml-parser` (already deps), vitest.

## Global Constraints

- Node `>=20`, `"type": "module"` — all relative imports use the `.js` suffix.
- No new npm dependencies (only `fast-xml-parser`, `node-html-parser`, `picocolors`).
- NEVER call `process.exit()` after the audit runs (Windows libuv crash — see comment in `packages/cli/src/index.ts`); set `process.exitCode`.
- All shell commands below run from `C:\Users\pieri\dev\findable-audit\packages\cli` unless stated otherwise.
- Test fixtures may use `{{ORIGIN}}` — the test server (`test/helpers/server.ts`) substitutes its own origin in text/xml/html bodies.
- `makeResult(check, status, message, fix?)` computes points: pass = maxPoints, warn = floor(maxPoints/2), fail/skip = 0. Skips are excluded from scoring.
- The e2e contract must hold: `perfect-site` fixture scores **100/100** with zero warn/fail.

---

### Task 1: Types + aggregation helper

**Files:**
- Modify: `src/types.ts` (add `PageSample`, extend `CrawlContext`)
- Create: `src/checks/aggregate.ts`
- Test: `test/checks/aggregate.test.ts`

**Interfaces:**
- Consumes: existing `CrawlContext`, `FetchedResource` from `src/types.ts`.
- Produces (used by Tasks 2–5):
  - `types.ts`: `interface PageSample { pages: FetchedResource[]; source: 'sitemap' | 'links' | 'homepage-only' }`; `CrawlContext` gains optional `sample?: PageSample`.
  - `aggregate.ts`: `pagesOf(ctx: CrawlContext): Promise<FetchedResource[]>`, `pathOf(res: FetchedResource): string`, `aggregate(total: number, offenders: string[], warnRatio?: number): { status: 'pass' | 'warn' | 'fail'; detail: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/checks/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregate, pagesOf, pathOf } from '../../src/checks/aggregate.js';
import type { CrawlContext, FetchedResource, PageSample } from '../../src/types.js';

const page = (finalUrl: string): FetchedResource =>
  ({ status: 200, ok: true, body: '', contentType: 'text/html', finalUrl, headers: {} });

describe('aggregate', () => {
  it('passes when there are no offenders', () => {
    expect(aggregate(4, [])).toEqual({ status: 'pass', detail: '' });
  });
  it('warns at >= 80% conform', () => {
    expect(aggregate(10, ['/a']).status).toBe('warn'); // 9/10 conform
    expect(aggregate(5, ['/a']).status).toBe('warn'); // 4/5 = 80% conform
  });
  it('fails below the warn ratio and truncates the detail to 3 entries', () => {
    const agg = aggregate(5, ['/a', '/b', '/c', '/d']);
    expect(agg.status).toBe('fail');
    expect(agg.detail).toBe('/a, /b, /c (+1 more)');
  });
});

describe('pathOf', () => {
  it('returns the pathname of finalUrl', () => {
    expect(pathOf(page('http://x.test/a/b.html'))).toBe('/a/b.html');
  });
  it('falls back to "/" on an unparsable finalUrl', () => {
    expect(pathOf(page(''))).toBe('/');
  });
});

describe('pagesOf', () => {
  const home = page('http://x.test/');
  const bare = (): CrawlContext => ({
    baseUrl: new URL('http://x.test/'),
    fetch: async () => home,
  });
  it('returns the sample pages when present', async () => {
    const ctx = bare();
    ctx.sample = { pages: [home, page('http://x.test/a')], source: 'sitemap' } satisfies PageSample;
    expect(await pagesOf(ctx)).toHaveLength(2);
  });
  it('falls back to the homepage without a sample', async () => {
    expect(await pagesOf(bare())).toEqual([home]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/checks/aggregate.test.ts`
Expected: FAIL — `Cannot find module` for `src/checks/aggregate.js` (and TS error on `sample` property).

- [ ] **Step 3: Modify `src/types.ts`**

Insert after the `FetchedResource`-related helpers (after `isXml`, before `CrawlContext`):

```ts
/** A deterministic sample of same-origin HTML pages, homepage included. */
export interface PageSample {
  pages: FetchedResource[];
  source: 'sitemap' | 'links' | 'homepage-only';
}
```

Replace the `CrawlContext` interface with:

```ts
export interface CrawlContext {
  baseUrl: URL;
  fetch(path: string): Promise<FetchedResource | null>;
  /** Sampled pages (homepage included). Attached by the runner; absent in unit tests. */
  sample?: PageSample;
}
```

- [ ] **Step 4: Create `src/checks/aggregate.ts`**

```ts
import type { CrawlContext, FetchedResource } from '../types.js';

/** Pages to audit: the runner-attached sample when present, else the homepage alone. */
export async function pagesOf(ctx: CrawlContext): Promise<FetchedResource[]> {
  if (ctx.sample && ctx.sample.pages.length > 0) return ctx.sample.pages;
  const home = await ctx.fetch('/');
  return home?.status === 200 ? [home] : [];
}

/** Pathname of a fetched page, for compact offender lists. */
export function pathOf(res: FetchedResource): string {
  try { return new URL(res.finalUrl).pathname; } catch { return '/'; }
}

export interface Aggregate {
  status: 'pass' | 'warn' | 'fail';
  /** Up to 3 offenders, then "(+N more)". Empty string on pass. */
  detail: string;
}

/**
 * Spec §2.3: pass = 100% conform, warn = conform ratio >= warnRatio (default 0.8), fail below.
 */
export function aggregate(total: number, offenders: string[], warnRatio = 0.8): Aggregate {
  if (offenders.length === 0) return { status: 'pass', detail: '' };
  const conform = (total - offenders.length) / total;
  const shown = offenders.slice(0, 3).join(', ');
  const more = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
  return { status: conform >= warnRatio ? 'warn' : 'fail', detail: `${shown}${more}` };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/checks/aggregate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full suite to prove no regression**

Run: `npx vitest run`
Expected: all existing tests still PASS (the `CrawlContext.sample` field is optional).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/checks/aggregate.ts test/checks/aggregate.test.ts
git commit -m "feat: PageSample type and per-page aggregation helper"
```

---

### Task 2: Page sampler

**Files:**
- Modify: `src/checks/sitemap.ts` (export `discoverSitemap`)
- Create: `src/sampler.ts`
- Create: `test/fixtures/multi-page/{robots.txt,sitemap.xml,index.html,a.html,b.html,deep/nested/page.html}`
- Create: `test/fixtures/links-fallback/{index.html,one.html,two.html}`
- Test: `test/sampler.test.ts`

**Interfaces:**
- Consumes: `discoverSitemap(ctx)` (made `export`), `CrawlContext`, `PageSample`, `mediaType` from Task 1's `types.ts`, `Crawler`, `serveFixture`.
- Produces: `samplePages(ctx: CrawlContext, maxPages: number): Promise<PageSample>` (used by Tasks 3–5).

- [ ] **Step 1: Create the fixtures**

`test/fixtures/multi-page/robots.txt`:

```
User-agent: *
Disallow:

Sitemap: {{ORIGIN}}/sitemap.xml
```

`test/fixtures/multi-page/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{{ORIGIN}}/</loc></url>
  <url><loc>{{ORIGIN}}/deep/nested/page.html</loc></url>
  <url><loc>{{ORIGIN}}/b.html</loc></url>
  <url><loc>{{ORIGIN}}/a.html</loc></url>
  <url><loc>https://elsewhere.example/x.html</loc></url>
</urlset>
```

`test/fixtures/multi-page/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <title>Duplicate Title</title>
  <meta name="description" content="The very same description reused on two different pages of this site.">
</head>
<body>
<h1>Home</h1>
<img src="/one.png">
<img src="/two.png">
<a href="/a.html">A</a>
<a href="/missing.html">Missing</a>
</body>
</html>
```

`test/fixtures/multi-page/a.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <title>Duplicate Title</title>
  <meta name="description" content="The very same description reused on two different pages of this site.">
  <meta name="robots" content="noindex, follow">
</head>
<body>
<img src="/three.png" alt="labelled image">
<a href="/">Home</a>
</body>
</html>
```

`test/fixtures/multi-page/b.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <title>Unique page B</title>
  <meta name="description" content="A perfectly distinct description that only page B carries on this site.">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"B"}</script>
</head>
<body><p>B</p></body>
</html>
```

`test/fixtures/multi-page/deep/nested/page.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <title>Deep nested page</title>
  <meta name="description" content="A page buried three levels deep, listed by the sitemap all the same.">
</head>
<body><p>Deep</p></body>
</html>
```

`test/fixtures/links-fallback/index.html`:

```html
<!doctype html>
<html lang="en">
<head><title>Links only</title></head>
<body>
<a href="/one.html">One</a>
<a href="/two.html#section">Two</a>
<a href="https://external.example/x">External</a>
<a href="/style.css">Stylesheet</a>
</body>
</html>
```

`test/fixtures/links-fallback/one.html`:

```html
<!doctype html><html lang="en"><head><title>One</title></head><body><p>1</p></body></html>
```

`test/fixtures/links-fallback/two.html`:

```html
<!doctype html><html lang="en"><head><title>Two</title></head><body><p>2</p></body></html>
```

`test/fixtures/links-fallback/style.css` (must exist: the sampler excludes it from *sampling* via `NON_PAGE_EXT`, but Task 4's `broken-internal-links` check still fetches it as a plain `<a>` target and it must resolve 200):

```css
body { margin: 0; }
```

- [ ] **Step 2: Write the failing test**

Create `test/sampler.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { Crawler } from '../src/crawler.js';
import { samplePages } from '../src/sampler.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function crawler(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}
const paths = (s: { pages: { finalUrl: string }[] }) => s.pages.map((p) => new URL(p.finalUrl).pathname);

describe('samplePages', () => {
  it('samples sitemap URLs deterministically: depth asc, then lexicographic', async () => {
    const s = await samplePages(await crawler('multi-page'), 10);
    expect(s.source).toBe('sitemap');
    expect(paths(s)).toEqual(['/', '/a.html', '/b.html', '/deep/nested/page.html']);
  });
  it('caps at maxPages, homepage included', async () => {
    const s = await samplePages(await crawler('multi-page'), 2);
    expect(paths(s)).toEqual(['/', '/a.html']);
  });
  it('maxPages=1 keeps the current homepage-only behavior', async () => {
    const s = await samplePages(await crawler('multi-page'), 1);
    expect(s.source).toBe('homepage-only');
    expect(paths(s)).toEqual(['/']);
  });
  it('falls back to same-origin homepage links without a sitemap', async () => {
    const s = await samplePages(await crawler('links-fallback'), 10);
    expect(s.source).toBe('links');
    expect(paths(s)).toEqual(['/', '/one.html', '/two.html']); // external + .css excluded, #fragment stripped
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/sampler.test.ts`
Expected: FAIL — `Cannot find module` for `src/sampler.js`.

- [ ] **Step 4: Export `discoverSitemap`**

In `src/checks/sitemap.ts`, change:

```ts
async function discoverSitemap(ctx: CrawlContext): Promise<{ res: FetchedResource; fromRobots: boolean } | null> {
```

to:

```ts
export async function discoverSitemap(ctx: CrawlContext): Promise<{ res: FetchedResource; fromRobots: boolean } | null> {
```

- [ ] **Step 5: Create `src/sampler.ts`**

```ts
import { parse } from 'node-html-parser';
import type { CrawlContext, FetchedResource, PageSample } from './types.js';
import { mediaType } from './types.js';
import { discoverSitemap } from './checks/sitemap.js';

/** Extensions that are never HTML pages worth sampling. */
const NON_PAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|mp4|webm|css|js|json|xml|txt)$/i;
const MAX_CHILD_SITEMAPS = 2;

function isHtml(res: FetchedResource | null): res is FetchedResource {
  if (res === null || res.status !== 200) return false;
  const ct = mediaType(res);
  return ct === '' || ct === 'text/html';
}

function locsOf(xml: string): string[] {
  return [...xml.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
}

/** Candidate URLs from the sitemap; follows a <sitemapindex> one level (bounded cost). */
async function sitemapUrls(ctx: CrawlContext): Promise<string[]> {
  const found = await discoverSitemap(ctx);
  if (!found) return [];
  let entries = locsOf(found.res.body);
  if (/<sitemapindex[\s>]/i.test(found.res.body)) {
    const children = entries.slice(0, MAX_CHILD_SITEMAPS);
    entries = [];
    for (const child of children) {
      const res = await ctx.fetch(child);
      if (res?.status === 200) entries.push(...locsOf(res.body));
    }
  }
  return entries;
}

/** Fallback: raw <a href> values from the homepage (normalized by the caller). */
function homepageLinks(home: FetchedResource): string[] {
  const out: string[] = [];
  for (const a of parse(home.body).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href) out.push(href);
  }
  return out;
}

function depthOf(url: string): number {
  return new URL(url).pathname.split('/').filter(Boolean).length;
}

/**
 * Homepage + up to (maxPages - 1) same-origin HTML pages.
 * Deterministic: candidates sorted by path depth, then lexicographically.
 */
export async function samplePages(ctx: CrawlContext, maxPages: number): Promise<PageSample> {
  const home = await ctx.fetch('/');
  const pages: FetchedResource[] = isHtml(home) ? [home] : [];
  if (maxPages <= 1 || pages.length === 0) return { pages, source: 'homepage-only' };

  let source: PageSample['source'] = 'sitemap';
  let raw = await sitemapUrls(ctx);
  if (raw.length === 0) {
    source = 'links';
    raw = homepageLinks(pages[0]);
  }

  const seen = new Set([new URL('/', ctx.baseUrl).toString()]);
  const candidates: string[] = [];
  for (const c of raw) {
    let u: URL;
    try { u = new URL(c, ctx.baseUrl); } catch { continue; }
    if (u.origin !== ctx.baseUrl.origin || NON_PAGE_EXT.test(u.pathname)) continue;
    u.hash = '';
    const s = u.toString();
    if (!seen.has(s)) { seen.add(s); candidates.push(s); }
  }
  if (candidates.length === 0) return { pages, source: 'homepage-only' };

  candidates.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
  for (const url of candidates) {
    if (pages.length >= maxPages) break;
    const res = await ctx.fetch(url);
    if (isHtml(res)) pages.push(res);
  }
  return { pages, source };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/sampler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full suite + commit**

Run: `npx vitest run` — Expected: all PASS.

```bash
git add src/sampler.ts src/checks/sitemap.ts test/sampler.test.ts test/fixtures/multi-page test/fixtures/links-fallback
git commit -m "feat: deterministic page sampler (sitemap with link fallback)"
```

---

### Task 3: Multi-page content checks (noindex, unique titles, images alt, schema coverage)

**Files:**
- Create: `src/checks/multi-page.ts`
- Test: `test/checks/multi-page.test.ts`

**Interfaces:**
- Consumes: `pagesOf`, `pathOf`, `aggregate` (Task 1), `samplePages` (Task 2), `extractJsonLd` from `src/checks/structured-data.ts`, `makeResult`/`Check` from `src/types.ts`.
- Produces: `metaRobotsNoindex`, `uniqueTitles`, `imagesAlt`, `schemaCoverage` — all `Check` (registered in Task 5).

- [ ] **Step 1: Write the failing test**

Create `test/checks/multi-page.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { samplePages } from '../../src/sampler.js';
import { metaRobotsNoindex, uniqueTitles, imagesAlt, schemaCoverage } from '../../src/checks/multi-page.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function sampled(name: string, maxPages = 10) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  const c = new Crawler(srv.url);
  c.sample = await samplePages(c, maxPages);
  return c;
}

describe('meta-robots-noindex', () => {
  it('fails and names the offending page', async () => {
    const r = await metaRobotsNoindex.run(await sampled('multi-page'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/a.html');
  });
  it('passes on a clean sample', async () => {
    expect((await metaRobotsNoindex.run(await sampled('links-fallback'))).status).toBe('pass');
  });
});

describe('unique-titles', () => {
  it('fails when half the sample shares title and description', async () => {
    // "/" and "/a.html" duplicate both -> 2/4 conform = 50% < 80%
    expect((await uniqueTitles.run(await sampled('multi-page'))).status).toBe('fail');
  });
  it('skips with fewer than 2 sampled pages', async () => {
    expect((await uniqueTitles.run(await sampled('multi-page', 1))).status).toBe('skip');
  });
});

describe('images-alt', () => {
  it('fails when only 1 of 3 images has an alt attribute', async () => {
    const r = await imagesAlt.run(await sampled('multi-page'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('1/3');
  });
  it('passes when there are no images at all', async () => {
    expect((await imagesAlt.run(await sampled('links-fallback'))).status).toBe('pass');
  });
});

describe('schema-coverage', () => {
  it('warns when only 1 of 4 pages carries JSON-LD', async () => {
    expect((await schemaCoverage.run(await sampled('multi-page'))).status).toBe('warn');
  });
  it('skips with fewer than 2 sampled pages', async () => {
    expect((await schemaCoverage.run(await sampled('multi-page', 1))).status).toBe('skip');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/checks/multi-page.test.ts`
Expected: FAIL — `Cannot find module` for `src/checks/multi-page.js`.

- [ ] **Step 3: Create `src/checks/multi-page.ts`**

```ts
import { parse } from 'node-html-parser';
import type { Check, FetchedResource } from '../types.js';
import { makeResult } from '../types.js';
import { extractJsonLd } from './structured-data.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';

function hasNoindex(res: FetchedResource): boolean {
  const header = res.headers['x-robots-tag'] ?? '';
  const meta = parse(res.body).querySelector('meta[name="robots"]')?.getAttribute('content') ?? '';
  return [header, meta].some((v) => /\b(noindex|none)\b/i.test(v));
}

export const metaRobotsNoindex: Check = {
  id: 'meta-robots-noindex', family: 'seo-fundamentals', maxPoints: 6,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const offenders = pages.filter(hasNoindex).map(pathOf);
    if (offenders.length === 0) return makeResult(this, 'pass', `no noindex on ${pages.length} sampled page(s)`);
    // Any noindexed sampled page is a hard fail: it is invisible to search and AI crawlers.
    const shown = offenders.slice(0, 3).join(', ');
    const more = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
    return makeResult(this, 'fail', `noindex found on: ${shown}${more}`,
      'Remove noindex/none from meta robots or the X-Robots-Tag header on pages that should be discoverable.');
  },
};

export const uniqueTitles: Check = {
  id: 'unique-titles', family: 'seo-fundamentals', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length < 2) return makeResult(this, 'skip', 'fewer than 2 sampled pages');
    const byTitle = new Map<string, string[]>();
    const byDesc = new Map<string, string[]>();
    const add = (map: Map<string, string[]>, key: string, page: string) => {
      if (key) map.set(key, [...(map.get(key) ?? []), page]);
    };
    for (const p of pages) {
      const root = parse(p.body);
      add(byTitle, root.querySelector('title')?.textContent.trim() ?? '', pathOf(p));
      add(byDesc, root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '', pathOf(p));
    }
    const offenders = new Set<string>();
    for (const map of [byTitle, byDesc]) {
      for (const group of map.values()) {
        if (group.length > 1) for (const p of group) offenders.add(p);
      }
    }
    if (offenders.size === 0) return makeResult(this, 'pass', `titles and descriptions unique across ${pages.length} pages`);
    const agg = aggregate(pages.length, [...offenders]);
    return makeResult(this, agg.status, `duplicated <title>/description on: ${agg.detail}`,
      'Give every page a unique <title> and meta description so results and AI citations are distinguishable.');
  },
};

export const imagesAlt: Check = {
  id: 'images-alt', family: 'llm-content', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let withAlt = 0;
    for (const p of pages) {
      for (const img of parse(p.body).querySelectorAll('img')) {
        total += 1;
        if (img.getAttribute('alt') !== undefined) withAlt += 1;
      }
    }
    if (total === 0) return makeResult(this, 'pass', 'no <img> elements on sampled pages');
    const ratio = withAlt / total;
    const msg = `${withAlt}/${total} images have an alt attribute (${Math.round(ratio * 100)}%)`;
    if (ratio >= 0.9) return makeResult(this, 'pass', msg);
    return makeResult(this, ratio >= 0.7 ? 'warn' : 'fail', msg,
      'Add descriptive alt text (alt="" for purely decorative images) so LLMs and screen readers understand the images.');
  },
};

export const schemaCoverage: Check = {
  id: 'schema-coverage', family: 'structured-data', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length < 2) {
      return makeResult(this, 'skip', 'fewer than 2 sampled pages (homepage JSON-LD is covered by the json-ld check)');
    }
    const covered = pages.filter((p) => extractJsonLd(p.body).length > 0).length;
    const ratio = covered / pages.length;
    const msg = `${covered}/${pages.length} sampled pages carry valid JSON-LD`;
    if (ratio >= 0.5) return makeResult(this, 'pass', msg);
    return makeResult(this, ratio > 0 ? 'warn' : 'fail', msg,
      'Add page-appropriate JSON-LD (Article for posts, Product for product pages, BreadcrumbList for sections).');
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/checks/multi-page.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/checks/multi-page.ts test/checks/multi-page.test.ts
git commit -m "feat: multi-page checks - noindex, unique titles, images alt, schema coverage"
```

---

### Task 4: Link checks (broken internal links, redirect hygiene, hreflang)

**Files:**
- Create: `src/checks/links.ts`
- Create: `test/fixtures/hreflang/{index.html,fr.html}`
- Create: `test/fixtures/hreflang-broken/index.html`
- Test: `test/checks/links.test.ts`

**Interfaces:**
- Consumes: `pagesOf`, `aggregate` (Task 1), `samplePages` (Task 2), `isLocalOrPrivateHost` from `src/checks/fundamentals.ts` (already exported), `makeResult`/`Check`/`FetchedResource` from `src/types.ts`.
- Produces: `brokenInternalLinks`, `redirectHygiene`, `hreflang` — all `Check` (registered in Task 5).

- [ ] **Step 1: Create the hreflang fixtures**

`test/fixtures/hreflang/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <title>Hreflang home EN</title>
  <link rel="alternate" hreflang="en" href="{{ORIGIN}}/">
  <link rel="alternate" hreflang="fr" href="{{ORIGIN}}/fr.html">
</head>
<body><p>EN</p></body>
</html>
```

`test/fixtures/hreflang/fr.html`:

```html
<!doctype html>
<html lang="fr">
<head>
  <title>Hreflang accueil FR</title>
  <link rel="alternate" hreflang="fr" href="{{ORIGIN}}/fr.html">
  <link rel="alternate" hreflang="en" href="{{ORIGIN}}/">
</head>
<body><p>FR</p></body>
</html>
```

`test/fixtures/hreflang-broken/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <title>Hreflang broken</title>
  <link rel="alternate" hreflang="de" href="{{ORIGIN}}/de.html">
</head>
<body><p>EN only, /de.html does not exist</p></body>
</html>
```

- [ ] **Step 2: Write the failing test**

Create `test/checks/links.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { samplePages } from '../../src/sampler.js';
import { brokenInternalLinks, redirectHygiene, hreflang } from '../../src/checks/links.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function sampled(name: string, maxPages = 10) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  const c = new Crawler(srv.url);
  c.sample = await samplePages(c, maxPages);
  return c;
}

describe('broken-internal-links', () => {
  it('fails and names the dead link', async () => {
    // Links across the sample: "/", "/a.html", "/missing.html" -> 1 of 3 broken (66% < 80%)
    const r = await brokenInternalLinks.run(await sampled('multi-page'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/missing.html');
  });
  it('passes when every internal link resolves', async () => {
    // Links: /one.html, /two.html, /style.css — all exist in the fixture and return 200.
    expect((await brokenInternalLinks.run(await sampled('links-fallback'))).status).toBe('pass');
  });
});

describe('redirect-hygiene', () => {
  it('skips on local hosts (fixtures run on 127.0.0.1)', async () => {
    expect((await redirectHygiene.run(await sampled('multi-page'))).status).toBe('skip');
  });
});

describe('hreflang', () => {
  it('skips when no hreflang annotations exist', async () => {
    expect((await hreflang.run(await sampled('multi-page'))).status).toBe('skip');
  });
  it('passes on reachable, reciprocal alternates', async () => {
    expect((await hreflang.run(await sampled('hreflang'))).status).toBe('pass');
  });
  it('fails when an alternate 404s', async () => {
    const r = await hreflang.run(await sampled('hreflang-broken'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/de.html');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/checks/links.test.ts`
Expected: FAIL — `Cannot find module` for `src/checks/links.js`.

- [ ] **Step 4: Create `src/checks/links.ts`**

```ts
import { parse } from 'node-html-parser';
import type { Check, FetchedResource } from '../types.js';
import { makeResult } from '../types.js';
import { isLocalOrPrivateHost } from './fundamentals.js';
import { pagesOf, aggregate } from './aggregate.js';

const MAX_LINKS = 30;
const MAX_HREFLANG = 5;

/** Distinct same-origin <a href> targets across the sampled pages (bounded). */
function internalLinks(pages: FetchedResource[], baseUrl: URL): string[] {
  const seen = new Set<string>();
  for (const p of pages) {
    for (const a of parse(p.body).querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      try {
        const u = new URL(href, p.finalUrl || baseUrl);
        if (u.origin !== baseUrl.origin) continue;
        u.hash = '';
        seen.add(u.toString());
      } catch { /* invalid href ignored */ }
    }
  }
  return [...seen].slice(0, MAX_LINKS);
}

export const brokenInternalLinks: Check = {
  id: 'broken-internal-links', family: 'seo-fundamentals', maxPoints: 8,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const links = internalLinks(pages, ctx.baseUrl);
    if (links.length === 0) return makeResult(this, 'skip', 'no internal links on sampled pages');
    const offenders: string[] = [];
    for (const link of links) {
      const res = await ctx.fetch(link);
      if (res === null || res.status >= 400) offenders.push(new URL(link).pathname);
    }
    const agg = aggregate(links.length, offenders);
    if (agg.status === 'pass') return makeResult(this, 'pass', `${links.length} internal link(s) resolve`);
    return makeResult(this, agg.status, `broken internal links: ${agg.detail}`,
      'Fix or remove links returning >= 400 so crawlers do not waste budget on dead ends.');
  },
};

export const redirectHygiene: Check = {
  id: 'redirect-hygiene', family: 'seo-fundamentals', maxPoints: 4,
  async run(ctx) {
    if (isLocalOrPrivateHost(ctx.baseUrl.hostname)) {
      return makeResult(this, 'skip', 'local host — redirect check skipped');
    }
    const res = await ctx.fetch(`http://${ctx.baseUrl.host}/`);
    if (res === null) {
      return makeResult(this, 'warn', 'http:// version unreachable (nothing listens on port 80)',
        'Serve a permanent redirect from http:// to https:// so legacy links land on the canonical origin.');
    }
    const final = new URL(res.finalUrl || `http://${ctx.baseUrl.host}/`);
    if (final.protocol === 'https:') return makeResult(this, 'pass', 'http:// redirects to https://');
    return makeResult(this, 'fail', 'http:// does not redirect to https://',
      'Add a 301 redirect from HTTP to HTTPS.');
  },
};

interface AlternateRef { href: string; }

/** Distinct hreflang alternate URLs declared on the sampled pages (bounded). */
function hreflangRefs(pages: FetchedResource[], baseUrl: URL): AlternateRef[] {
  const seen = new Set<string>();
  const out: AlternateRef[] = [];
  for (const p of pages) {
    for (const l of parse(p.body).querySelectorAll('link')) {
      if (l.getAttribute('rel') !== 'alternate' || !l.getAttribute('hreflang')) continue;
      const href = l.getAttribute('href');
      if (!href) continue;
      try {
        const u = new URL(href, p.finalUrl || baseUrl).toString();
        if (!seen.has(u)) { seen.add(u); out.push({ href: u }); }
      } catch { /* invalid href ignored */ }
    }
  }
  return out.slice(0, MAX_HREFLANG);
}

/** true when the page body declares at least one hreflang alternate (reciprocity). */
function declaresHreflang(body: string): boolean {
  return parse(body).querySelectorAll('link')
    .some((l) => l.getAttribute('rel') === 'alternate' && !!l.getAttribute('hreflang'));
}

export const hreflang: Check = {
  id: 'hreflang', family: 'seo-fundamentals', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const refs = hreflangRefs(pages, ctx.baseUrl);
    if (refs.length === 0) return makeResult(this, 'skip', 'no hreflang annotations (single-language site)');
    const offenders: string[] = [];
    for (const ref of refs) {
      const res = await ctx.fetch(ref.href);
      if (res?.status !== 200 || !declaresHreflang(res.body)) {
        try { offenders.push(new URL(ref.href).pathname); } catch { offenders.push(ref.href); }
      }
    }
    if (offenders.length === 0) {
      return makeResult(this, 'pass', `${refs.length} hreflang alternate(s) reachable and reciprocal`);
    }
    return makeResult(this, 'fail', `broken or non-reciprocal hreflang alternates: ${offenders.slice(0, 3).join(', ')}`,
      'Every hreflang alternate must return 200 and declare hreflang links back to its language variants.');
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/checks/links.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/checks/links.ts test/checks/links.test.ts test/fixtures/hreflang test/fixtures/hreflang-broken
git commit -m "feat: link checks - broken internal links, redirect hygiene, hreflang"
```

---

### Task 5: Wiring — runner, CLI `--max-pages`, check registry, perfect-site at 100

**Files:**
- Modify: `src/runner.ts`
- Modify: `src/crawler.ts` (declare `sample` property)
- Modify: `src/checks/index.ts`
- Modify: `src/index.ts` (CLI flag + USAGE)
- Modify: `test/fixtures/perfect-site/sitemap.xml`, `test/fixtures/perfect-site/index.html`
- Create: `test/fixtures/perfect-site/about.html`
- Modify: `test/e2e.test.ts`

**Interfaces:**
- Consumes: `samplePages` (Task 2), all 7 checks (Tasks 3–4), `PageSample` (Task 1).
- Produces: `AuditOptions { timeoutMs?: number; maxPages?: number }`, `AuditReport` gains `sampledPages: string[]` (serialized automatically by `renderJson`), CLI flag `--max-pages <n>` (default 10).

- [ ] **Step 1: Extend the e2e test (failing first)**

In `test/e2e.test.ts`, inside the existing `it('scores 100 and renders both reports', ...)`, after `expect(report.score).toBe(100);` add:

```ts
    expect(report.sampledPages).toEqual(['/', '/about.html']);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/e2e.test.ts`
Expected: FAIL — `sampledPages` is undefined (TS error first: property does not exist on `AuditReport`).

- [ ] **Step 3: Declare `sample` on the Crawler**

In `src/crawler.ts`, change the import line and class head:

```ts
import type { CrawlContext, FetchedResource, PageSample } from './types.js';
```

and inside `export class Crawler implements CrawlContext {` add, right after `baseUrl: URL;`:

```ts
  /** Sampled pages, attached by the runner after the homepage fetch. */
  sample?: PageSample;
```

- [ ] **Step 4: Wire the sampler into `src/runner.ts`**

Replace the whole file with:

```ts
import { Crawler } from './crawler.js';
import { samplePages } from './sampler.js';
import type { Check, CheckResult } from './types.js';
import { makeResult } from './types.js';

export class UnreachableSiteError extends Error {}

export interface AuditReport {
  url: string;
  score: number;
  /** Pathnames of the sampled pages (homepage first). */
  sampledPages: string[];
  results: CheckResult[];
}

export interface AuditOptions {
  timeoutMs?: number;
  /** Max pages sampled (homepage included). 1 = homepage only. Default 10. */
  maxPages?: number;
}

export async function runAudit(url: string, checks: Check[], opts: AuditOptions = {}): Promise<AuditReport> {
  const crawler = new Crawler(url, opts.timeoutMs);
  const home = await crawler.fetch('/');
  if (home === null) throw new UnreachableSiteError(`Cannot reach ${url}`);
  crawler.sample = await samplePages(crawler, opts.maxPages ?? 10);
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      results.push(await check.run(crawler));
    } catch (err) {
      // A crashing check must not affect the score: mark it skipped.
      results.push(makeResult(check, 'skip', `check crashed: ${(err as Error).message}`));
    }
  }
  const scored = results.filter((r) => r.status !== 'skip');
  const max = scored.reduce((s, r) => s + r.maxPoints, 0);
  const earned = scored.reduce((s, r) => s + r.points, 0);
  const sampledPages = crawler.sample.pages.map((p) => {
    try { return new URL(p.finalUrl).pathname; } catch { return '/'; }
  });
  return { url: crawler.baseUrl.toString(), score: max === 0 ? 0 : Math.round((earned / max) * 100), sampledPages, results };
}
```

- [ ] **Step 5: Register the checks in `src/checks/index.ts`**

Replace the whole file with:

```ts
import type { Check } from '../types.js';
import { robotsExists, aiCrawlersAllowed, homepageOk, robotsDirectives } from './ai-access.js';
import { llmsTxt, llmsFullTxt, contentWithoutJs } from './llm-content.js';
import { jsonLd, jsonLdEntity } from './structured-data.js';
import { sitemapCheck, indexnowCheck } from './sitemap.js';
import { titleDescription, canonical, openGraph, httpsCheck, viewport } from './fundamentals.js';
import { metaRobotsNoindex, uniqueTitles, imagesAlt, schemaCoverage } from './multi-page.js';
import { brokenInternalLinks, redirectHygiene, hreflang } from './links.js';

export function buildChecks(opts: { indexnowKey?: string } = {}): Check[] {
  return [
    robotsExists, aiCrawlersAllowed, homepageOk, robotsDirectives,
    llmsTxt, llmsFullTxt, contentWithoutJs, imagesAlt,
    jsonLd, jsonLdEntity, schemaCoverage, sitemapCheck, indexnowCheck(opts.indexnowKey),
    titleDescription, canonical, openGraph, httpsCheck, viewport,
    metaRobotsNoindex, uniqueTitles, brokenInternalLinks, redirectHygiene, hreflang,
  ];
}
```

- [ ] **Step 6: CLI flag `--max-pages`**

In `src/index.ts`:

1. Update `USAGE`:

```ts
const USAGE = `Usage: findable <url> [--json] [--report <file.md>] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--indexnow-key <key>]

Audits a website's readiness for AI search (GEO) and technical SEO.
Samples up to --max-pages pages (default 10, homepage + sitemap/link-discovered pages; 1 = homepage only).
--report writes a Markdown report to the given file, in addition to the terminal/JSON output.
Exit codes: 0 = score >= min-score, 1 = below, 2 = unreachable/error.`;
```

2. In `parseCliArgs` options, after `timeout`:

```ts
      'max-pages': { type: 'string', default: '10' },
```

3. After the `timeoutMs` validation block:

```ts
const maxPages = Number(values['max-pages']);
if (values['max-pages'].trim() === '' || !Number.isInteger(maxPages) || maxPages < 1) {
  console.error(`findable-audit: invalid --max-pages value "${values['max-pages']}" (expected an integer >= 1)\n\n${USAGE}`);
  process.exit(2);
}
```

(`process.exit` is fine here — no fetch has run yet; the libuv constraint applies only after the audit.)

4. Pass it through:

```ts
  const report = await runAudit(targetUrl,
    buildChecks({ indexnowKey: values['indexnow-key'] }), { timeoutMs, maxPages });
```

- [ ] **Step 7: Upgrade the perfect-site fixture**

Replace `test/fixtures/perfect-site/sitemap.xml` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{{ORIGIN}}/</loc></url>
  <url><loc>{{ORIGIN}}/about.html</loc></url>
</urlset>
```

In `test/fixtures/perfect-site/index.html`, inside `<body>` after the `<p>...</p>`, add:

```html
<img src="/storefront.jpg" alt="Example Bakery storefront in downtown Springfield">
<nav><a href="/about.html">About us</a></nav>
```

Create `test/fixtures/perfect-site/about.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>About Example Bakery — our story since 1998</title>
  <meta name="description" content="How a small Springfield family bakery grew from one sourdough oven in 1998 to the downtown counter you know today.">
  <link rel="canonical" href="https://example.com/about.html">
</head>
<body>
<h1>Our story</h1>
<p>Example Bakery opened in 1998 with a single oven and a sourdough starter. Today we still bake every loaf by hand each morning.</p>
<a href="/">Back to the homepage</a>
</body>
</html>
```

Why this keeps 100/100: sample = `['/', '/about.html']`; `meta-robots-noindex` pass, `unique-titles` pass (distinct titles/descriptions), `images-alt` pass (1/1), `schema-coverage` pass (1/2 = 50%), `broken-internal-links` pass (`/` and `/about.html` both 200; `/storefront.jpg` is an `<img>`, not an `<a>`, so it is not checked), `redirect-hygiene` skip (127.0.0.1), `hreflang` skip (none declared).

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: ALL PASS, including e2e (`score === 100`, `sampledPages === ['/', '/about.html']`, zero warn/fail).

- [ ] **Step 9: Type-check the build**

Run: `npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 10: Manual smoke test**

Run: `node dist/index.js example.com --json | head -40` (or against any live site).
Expected: JSON contains `"sampledPages": [...]` and the new check ids (`meta-robots-noindex`, `unique-titles`, `images-alt`, `schema-coverage`, `broken-internal-links`, `redirect-hygiene`, `hreflang`).

- [ ] **Step 11: Commit**

```bash
git add src/runner.ts src/crawler.ts src/checks/index.ts src/index.ts test/e2e.test.ts test/fixtures/perfect-site
git commit -m "feat: wire sampler into runner, add --max-pages, register 7 new checks"
```

---

### Task 6: Plugin skills

**Files:**
- Create: `plugin/skills/audit-site/SKILL.md`
- Create: `plugin/skills/implement-geo/SKILL.md`
- Create: `plugin/skills/fix-technical-seo/SKILL.md`

(Paths are relative to the repo root `C:\Users\pieri\dev\findable-audit`, not `packages/cli`.)

**Interfaces:**
- Consumes: the CLI contract from Task 5 (`findable <url> [--json] [--report <file.md>] [--max-pages <n>] [--indexnow-key <key>]`, exit codes 0/1/2) and the check ids/families from Tasks 3–5.
- Produces: three skills auto-discovered by the plugin loader from `plugin/skills/<name>/SKILL.md` (`plugin/.claude-plugin/plugin.json` stays unchanged).

- [ ] **Step 1: Create `plugin/skills/audit-site/SKILL.md`**

```markdown
---
name: audit-site
description: Run a findable-audit GEO/SEO audit against a URL and interpret the report. Use when the user asks to audit, score, or diagnose a site's visibility to AI assistants (GEO) or its technical SEO.
---

# Audit a site

## Run

```bash
npx findable-audit <url> --json --max-pages 10 [--indexnow-key <key>]
```

Exit codes: 0 = score >= min-score (default 60), 1 = below, 2 = site unreachable or bad arguments.
Add `--report audit.md` to also write a Markdown report.

## Interpret

The JSON report has `score` (0-100), `sampledPages` (audited pages) and `results`
(one entry per check: `id`, `family`, `status` pass/warn/fail/skip, `points`,
`maxPoints`, `message`, `fix`).

Families: `ai-access` (robots/AI crawlers), `llm-content` (llms.txt, JS-free
content, image alt), `structured-data` (JSON-LD), `seo-fundamentals`
(title/canonical/sitemap/links/redirects/hreflang).

## Prioritize

1. `fail` results ordered by `maxPoints` descending.
2. Then `warn` results, same order.
3. Quote each result's `fix` line and name the offending pages from `message`.
4. Offer to apply fixes via the `implement-geo` (AI visibility) or
   `fix-technical-seo` (technical SEO) skills.
```

- [ ] **Step 2: Create `plugin/skills/implement-geo/SKILL.md`**

```markdown
---
name: implement-geo
description: Implement GEO (AI-search visibility) fixes flagged by findable-audit - llms.txt, llms-full.txt, JSON-LD entities with NAP, robots.txt rules for AI crawlers, sitemap and IndexNow. Use when the user wants their site cited by ChatGPT, Claude, Perplexity or other AI assistants.
---

# Implement GEO fixes

Work from the audit report (run the `audit-site` skill first). Fix `fail`s
before `warn`s.

## llms.txt / llms-full.txt (checks: llms-txt, llms-full-txt)

Serve `/llms.txt`: an H1 with the site name, a one-line summary blockquote,
then Markdown link sections pointing to the key pages. Serve `/llms-full.txt`
with the full plain-text content of those pages. Both as `text/plain`.

## JSON-LD entity (checks: json-ld, json-ld-entity, schema-coverage)

On the homepage, one `<script type="application/ld+json">` block declaring the
main entity (LocalBusiness subtype, Organization or WebSite). For local
businesses always include NAP: `name`, `address` (PostalAddress), `telephone`.
On inner pages add page-appropriate types (Article, Product, BreadcrumbList)
until at least half the sampled pages carry JSON-LD.

## AI crawler access (checks: robots-exists, ai-crawlers-allowed, robots-directives)

robots.txt must not block GPTBot, ClaudeBot, PerplexityBot, Google-Extended &
co. unless the user explicitly wants to. Never `Disallow: /` for `*`.

## Discovery (checks: sitemap, indexnow)

Reference the sitemap from robots.txt (`Sitemap: <absolute-url>`). For
IndexNow, publish `/<key>.txt` containing exactly the key, then pass
`--indexnow-key <key>` when re-auditing.

## Verify

Re-run the audit; the touched checks must be `pass` and the score must not
regress anywhere else.
```

- [ ] **Step 3: Create `plugin/skills/fix-technical-seo/SKILL.md`**

```markdown
---
name: fix-technical-seo
description: Fix technical SEO findings from findable-audit - titles and meta descriptions, canonical, Open Graph, viewport, noindex, redirect hygiene, broken internal links, duplicate titles, hreflang. Use when the user wants to fix SEO errors or improve their audit score.
---

# Fix technical SEO

Work from the audit report (run the `audit-site` skill first). Fix `fail`s
before `warn`s.

## Per-check fixes

- **title-description / unique-titles**: every page gets a unique `<title>`
  (10-70 chars) and meta description (50-160 chars).
- **canonical**: `<link rel="canonical" href="...">` with the absolute
  preferred URL on every page (self-referencing).
- **open-graph**: `og:title` + `og:description` at minimum.
- **viewport**: `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **meta-robots-noindex**: remove `noindex`/`none` (meta robots and
  `X-Robots-Tag` header) from pages that should rank; keep it only on
  genuinely private pages and exclude those from the sitemap.
- **https / redirect-hygiene**: serve over HTTPS with a single 301 from
  `http://` to `https://` (no chains).
- **broken-internal-links**: fix or remove every internal `<a href>` that
  returns >= 400; the audit message lists the dead paths.
- **images-alt**: descriptive `alt` on informative images, `alt=""` on
  decorative ones.
- **hreflang**: each language variant returns 200 and declares reciprocal
  `<link rel="alternate" hreflang="...">` tags, itself included.

## Verify

Re-run `npx findable-audit <url>`; the touched checks must be `pass` and the
overall score must improve.
```

- [ ] **Step 4: Verify skill layout**

Run (from the repo root): `ls plugin/skills/*/SKILL.md`
Expected: the three files listed; each starts with `---` frontmatter containing `name` and `description`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills
git commit -m "feat(plugin): audit-site, implement-geo and fix-technical-seo skills"
```

---

## Self-Review (done while writing)

1. **Spec coverage:** §2 sampler → Task 2; §2.2 CrawlContext → Task 1; §2.3 aggregation → Task 1; §3 all 7 checks → Tasks 3–4; §4 CLI/runner/JSON `sampledPages` → Task 5; §5 fixtures/tests → Tasks 2–5; §6 skills → Task 6. Non-goals respected (no new deps, no JS rendering, no parallel fetch, external links unchecked).
2. **Placeholder scan:** every code step carries the full content; the one intentionally corrected test in Task 1 Step 1 is spelled out.
3. **Type consistency:** `samplePages(ctx, maxPages)` used identically in Tasks 2/3/4/5; `pagesOf/pathOf/aggregate` signatures match Task 1; `PageSample` lives in `types.ts` only; check exports match the Task 5 registry imports.
