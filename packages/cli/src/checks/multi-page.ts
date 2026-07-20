import { parse } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult } from '../types.js';
import { extractJsonLd } from './structured-data.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import { robotsDirectiveSet, hasDirectiveToken, directiveValue, type RobotsDirectiveSet } from '../robots.js';

/** Truncate an offender path list to 3 entries + "(+N more)", matching the rest of the MP checks. */
function offenderList(paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  const more = paths.length > 3 ? ` (+${paths.length - 3} more)` : '';
  return `${shown}${more}`;
}

function isNoindex(set: RobotsDirectiveSet): boolean {
  return hasDirectiveToken(set, 'noindex') || hasDirectiveToken(set, 'none');
}

function isNofollow(set: RobotsDirectiveSet): boolean {
  return hasDirectiveToken(set, 'nofollow');
}

/** Header and meta disagree on indexability: one explicitly says noindex/none, the other explicitly says index. */
function isConflict(set: RobotsDirectiveSet): boolean {
  if (!set.headerRaw || !set.metaRaw) return false;
  const headerNoindex = set.headerTokens.includes('noindex') || set.headerTokens.includes('none');
  const metaNoindex = set.metaTokens.includes('noindex') || set.metaTokens.includes('none');
  const headerIndex = set.headerTokens.includes('index');
  const metaIndex = set.metaTokens.includes('index');
  return (headerNoindex && metaIndex) || (metaNoindex && headerIndex);
}

type NoindexVerdict = 'noindex' | 'conflict' | 'nofollow' | 'clean';

/**
 * A conflicting header/meta pair is reported as a conflict (warn), taking
 * priority over the blunt noindex fail — the site owner needs to reconcile
 * the signals, but we can't be sure which one search engines will honor.
 */
function classifyNoindex(set: RobotsDirectiveSet): NoindexVerdict {
  if (isConflict(set)) return 'conflict';
  if (isNoindex(set)) return 'noindex';
  if (isNofollow(set)) return 'nofollow';
  return 'clean';
}

export const metaRobotsNoindex: Check = {
  id: 'meta-robots-noindex', family: 'ai-access', maxPoints: 6,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const rows = pages.map((p) => ({ path: pathOf(p), verdict: classifyNoindex(robotsDirectiveSet(p)) }));

    // Any unambiguously noindexed sampled page is a hard fail: it is invisible to search and AI crawlers.
    const noindexOffenders = rows.filter((r) => r.verdict === 'noindex').map((r) => r.path);
    if (noindexOffenders.length > 0) {
      return makeResult(this, 'fail', `noindex found on: ${offenderList(noindexOffenders)}`,
        'Remove noindex/none from meta robots or the X-Robots-Tag header on pages that should be discoverable.');
    }

    const conflictOffenders = rows.filter((r) => r.verdict === 'conflict').map((r) => r.path);
    if (conflictOffenders.length > 0) {
      return makeResult(this, 'warn', `X-Robots-Tag header and meta robots disagree on: ${offenderList(conflictOffenders)}`,
        'Make the X-Robots-Tag header and <meta name="robots"> agree on indexability.');
    }

    const nofollowOffenders = rows.filter((r) => r.verdict === 'nofollow').map((r) => r.path);
    if (nofollowOffenders.length > 0) {
      return makeResult(this, 'warn', `nofollow found on: ${offenderList(nofollowOffenders)}`,
        'Remove nofollow from meta robots / X-Robots-Tag unless intentionally blocking link equity.');
    }

    return makeResult(this, 'pass', `no noindex on ${pages.length} sampled page(s)`);
  },
};

/** A directive that actively starves the search/AI snippet or preview (spec §3.1 snippet-preview-directives). */
function isPreviewRestrictive(set: RobotsDirectiveSet): boolean {
  return hasDirectiveToken(set, 'nosnippet')
    || directiveValue(set, 'max-snippet') === '0'
    || directiveValue(set, 'max-image-preview') === 'none'
    || directiveValue(set, 'max-video-preview') === '0';
}

/** A page explicitly states a preview preference (positive or restrictive), as opposed to leaving platform defaults. */
function hasPreviewDirective(set: RobotsDirectiveSet): boolean {
  return hasDirectiveToken(set, 'nosnippet')
    || directiveValue(set, 'max-snippet') !== undefined
    || directiveValue(set, 'max-image-preview') !== undefined
    || directiveValue(set, 'max-video-preview') !== undefined;
}

export const snippetPreviewDirectives: Check = {
  id: 'snippet-preview-directives', family: 'ai-access', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const rows = pages.map((p) => ({ path: pathOf(p), set: robotsDirectiveSet(p) }));

    const restrictive = rows.filter((r) => isPreviewRestrictive(r.set)).map((r) => r.path);
    if (restrictive.length > 0) {
      return makeResult(this, 'fail', `preview-limiting directive on: ${offenderList(restrictive)}`,
        'Set max-image-preview:large, max-snippet:-1, max-video-preview:-1; remove stray nosnippet/max-snippet:0.');
    }

    const missing = rows.filter((r) => !hasPreviewDirective(r.set)).map((r) => r.path);
    if (missing.length > 0) {
      return makeResult(this, 'warn', `no preview directives set on: ${offenderList(missing)}`,
        'Set max-image-preview:large, max-snippet:-1, max-video-preview:-1 on every page to guarantee full search/AI previews.');
    }

    return makeResult(this, 'pass', `preview directives set on ${pages.length} sampled page(s)`);
  },
};

export const uniqueTitles: Check = {
  id: 'unique-titles', family: 'on-page', maxPoints: 5,
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
  id: 'images-alt', family: 'accessibility', maxPoints: 4,
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
