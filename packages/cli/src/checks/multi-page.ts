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
