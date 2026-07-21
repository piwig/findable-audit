import { XMLValidator } from 'fast-xml-parser';
import type { Check, CrawlContext, FetchedResource } from '../types.js';
import { makeResult, isPlainText, isXml } from '../types.js';
import { pagesOf } from './aggregate.js';
import { extractCanonicals, isSelfReferential, canonicalIdentity } from './canonical.js';
import { buildLinkGraph } from './link-graph.js';
import { isLocalOrPrivateHost } from './fundamentals.js';
import { robotsDirectiveSet, hasDirectiveToken } from '../robots.js';

/** Absolute sitemap URLs declared by `Sitemap:` lines in robots.txt. */
function sitemapsFromRobots(robots: FetchedResource | null, baseUrl: URL): string[] {
  if (robots?.status !== 200 || !isPlainText(robots)) return [];
  const out: string[] = [];
  for (const m of robots.body.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)) {
    try { out.push(new URL(m[1], baseUrl).toString()); } catch { /* invalid URL ignored */ }
  }
  return out;
}

/** One `<url>` entry of a urlset sitemap. */
export interface SitemapEntry {
  loc: string;
  /** Raw `<lastmod>` text, or undefined when the entry has none. */
  lastmod?: string;
}

/** Parse `<url>` entries (loc + optional lastmod) from a urlset sitemap body. */
export function parseSitemapEntries(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const block of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const inner = block[1];
    const loc = /<loc[^>]*>([^<]+)<\/loc>/i.exec(inner)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = /<lastmod[^>]*>([^<]+)<\/lastmod>/i.exec(inner)?.[1]?.trim();
    out.push({ loc, lastmod: lastmod || undefined });
  }
  return out;
}

/** `<loc>` values (used for sitemapindex children). */
function locsOf(xml: string): string[] {
  return [...xml.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
}

/** A W3C-datetime / ISO-8601 `<lastmod>` value that is a real, parseable date. */
function isValidLastmod(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}([Tt]\d{2}:\d{2}(:\d{2})?(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export async function discoverSitemap(ctx: CrawlContext): Promise<{ res: FetchedResource; fromRobots: boolean } | null> {
  const robotsUrls = sitemapsFromRobots(await ctx.fetch('/robots.txt'), ctx.baseUrl);
  const fallbacks = ['/sitemap.xml', '/sitemap-index.xml', '/sitemap_index.xml'];
  const candidates = [...robotsUrls, ...fallbacks];
  for (const [i, candidate] of candidates.entries()) {
    const res = await ctx.fetch(candidate);
    if (res?.status !== 200 || !isXml(res)) continue;
    return { res, fromRobots: i < robotsUrls.length };
  }
  return null;
}

export const sitemapCheck: Check = {
  id: 'sitemap', family: 'technical-seo', maxPoints: 10,
  async run(ctx) {
    const found = await discoverSitemap(ctx);
    if (!found) {
      return makeResult(this, 'fail', 'no sitemap found (robots.txt Sitemap lines, /sitemap.xml, /sitemap-index.xml, /sitemap_index.xml)',
        'Generate a sitemap.xml and reference it in robots.txt.');
    }
    const { res, fromRobots } = found;
    if (XMLValidator.validate(res.body) !== true) {
      return makeResult(this, 'fail', 'sitemap is not valid XML', 'Regenerate the sitemap with your framework integration.');
    }
    if (!/<(urlset|sitemapindex)[\s/>]/.test(res.body) || !/<loc[\s>]/.test(res.body)) {
      return makeResult(this, 'fail', 'sitemap XML has no <urlset>/<sitemapindex> root or no <loc> entry',
        'A sitemap must have a urlset or sitemapindex root element listing at least one <loc>.');
    }
    if (fromRobots) return makeResult(this, 'pass', 'valid sitemap, referenced in robots.txt');
    return makeResult(this, 'warn', 'valid sitemap but not referenced in robots.txt',
      'Add a "Sitemap: https://your-site/sitemap.xml" line to robots.txt.');
  },
};

export function indexnowCheck(key?: string): Check {
  return {
    id: 'indexnow', family: 'technical-seo', maxPoints: 4,
    async run(ctx) {
      if (!key) return makeResult(this, 'skip', 'no IndexNow key provided (use --indexnow-key to enable)');
      const res = await ctx.fetch(`/${key}.txt`);
      if (res?.status === 200 && isPlainText(res) && res.body.trim() === key) {
        return makeResult(this, 'pass', 'IndexNow key file verified');
      }
      return makeResult(this, 'fail', `IndexNow key file /${key}.txt missing or mismatched`,
        'Publish a text file named <key>.txt at the site root containing exactly the key.');
    },
  };
}

// ---------------------------------------------------------------------------
// sitemap-lastmod
// ---------------------------------------------------------------------------

export const sitemapLastmod: Check = {
  id: 'sitemap-lastmod', family: 'technical-seo', maxPoints: 4,
  async run(ctx) {
    const found = await discoverSitemap(ctx);
    if (!found) return makeResult(this, 'skip', 'no sitemap discovered');
    const entries = parseSitemapEntries(found.res.body);
    if (entries.length === 0) return makeResult(this, 'skip', 'sitemap has no <url> entries (index or empty)');
    const withMod = entries.filter((e) => e.lastmod);
    const now = Date.now();
    const valid = withMod.filter((e) => isValidLastmod(e.lastmod!));
    const future = valid.filter((e) => Date.parse(e.lastmod!) > now + 24 * 3600 * 1000);
    const distinct = new Set(valid.map((e) => e.lastmod));
    if (valid.length === 0) {
      return makeResult(this, withMod.length > 0 ? 'fail' : 'warn',
        withMod.length > 0 ? 'sitemap <lastmod> values are all invalid/garbage' : 'no <lastmod> on any sitemap entry',
        'Emit a real ISO-8601 <lastmod> per URL, not the build date.');
    }
    if (future.length === valid.length) {
      return makeResult(this, 'fail', 'every sitemap <lastmod> is future-dated', 'Set <lastmod> to the real last-change date, never in the future.');
    }
    const coverage = valid.length / entries.length;
    if (coverage >= 0.5 && distinct.size > 1 && future.length === 0) {
      return makeResult(this, 'pass', `${valid.length}/${entries.length} entries have valid, varied <lastmod>`);
    }
    const why = future.length > 0 ? `${future.length} future-dated` : distinct.size <= 1 ? 'all identical' : `only ${valid.length}/${entries.length} valid`;
    return makeResult(this, 'warn', `sitemap <lastmod> weak (${why})`,
      'Give each URL a real, distinct, non-future <lastmod> reflecting its last edit.');
  },
};

// ---------------------------------------------------------------------------
// sitemap-urls-valid
// ---------------------------------------------------------------------------

const MAX_SITEMAP_URLS = 10;

export const sitemapUrlsValid: Check = {
  id: 'sitemap-urls-valid', family: 'technical-seo', maxPoints: 4,
  async run(ctx) {
    const found = await discoverSitemap(ctx);
    if (!found) return makeResult(this, 'skip', 'no sitemap discovered');
    const entries = parseSitemapEntries(found.res.body);
    if (entries.length === 0) return makeResult(this, 'skip', 'sitemap has no <url> entries (index or empty)');
    const local = isLocalOrPrivateHost(ctx.baseUrl.hostname);
    const urls = entries.slice(0, MAX_SITEMAP_URLS).map((e) => e.loc);
    const offenders: string[] = [];
    for (const loc of urls) {
      let u: URL;
      try { u = new URL(loc, ctx.baseUrl); } catch { offenders.push(loc); continue; }
      const label = u.pathname;
      if (u.origin !== ctx.baseUrl.origin) { offenders.push(`${label} (cross-origin)`); continue; }
      if (!local && u.protocol !== 'https:') { offenders.push(`${label} (not https)`); continue; }
      const res = await ctx.fetch(u.toString());
      if (res === null || res.status !== 200) { offenders.push(`${label} (${res?.status ?? 'unreachable'})`); continue; }
      if (canonicalIdentity(res.finalUrl) !== canonicalIdentity(u.toString())) { offenders.push(`${label} (redirects)`); continue; }
      if (hasNoindex(res)) { offenders.push(`${label} (noindex)`); continue; }
      const canonicals = extractCanonicals(res);
      if (canonicals.length > 0 && !canonicals.some((c) => isSelfReferential(c, res.finalUrl))) {
        offenders.push(`${label} (non-canonical)`);
      }
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `${urls.length} sampled sitemap URL(s) are clean and indexable`);
    const conform = (urls.length - offenders.length) / urls.length;
    const detail = offenders.slice(0, 3).join(', ') + (offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '');
    return makeResult(this, conform >= 0.8 ? 'warn' : 'fail', `sitemap lists non-indexable URLs: ${detail}`,
      'List only final, 200, same-origin, self-canonical, indexable URLs in the sitemap.');
  },
};

// ---------------------------------------------------------------------------
// sitemap-index-limits
// ---------------------------------------------------------------------------

const MAX_CHILD_SITEMAPS = 5;
const SITEMAP_URL_LIMIT = 50_000;

export const sitemapIndexLimits: Check = {
  id: 'sitemap-index-limits', family: 'technical-seo', maxPoints: 2,
  async run(ctx) {
    const found = await discoverSitemap(ctx);
    if (!found || !/<sitemapindex[\s>]/i.test(found.res.body)) {
      return makeResult(this, 'skip', 'no <sitemapindex> (single urlset sitemap)');
    }
    const children = locsOf(found.res.body).slice(0, MAX_CHILD_SITEMAPS);
    if (children.length === 0) return makeResult(this, 'fail', 'sitemap index lists no children', 'A sitemapindex must reference at least one child sitemap.');
    const offenders: string[] = [];
    for (const child of children) {
      let u: URL;
      try { u = new URL(child, ctx.baseUrl); } catch { offenders.push(`${child} (bad URL)`); continue; }
      if (u.origin !== ctx.baseUrl.origin) { offenders.push(`${u.pathname} (cross-origin)`); continue; }
      const res = await ctx.fetch(u.toString());
      if (res === null || res.status !== 200 || !isXml(res) || XMLValidator.validate(res.body) !== true) {
        offenders.push(`${u.pathname} (unreachable/invalid XML)`);
        continue;
      }
      const count = parseSitemapEntries(res.body).length;
      if (count > SITEMAP_URL_LIMIT) offenders.push(`${u.pathname} (${count} URLs > 50k)`);
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `${children.length} child sitemap(s) valid and within limits`);
    return makeResult(this, 'fail', `sitemap index child invalid/oversize: ${offenders.slice(0, 3).join(', ')}`,
      'Split to <=50,000-URL children under one index; every child must be fetchable, valid XML, same-origin.');
  },
};

// ---------------------------------------------------------------------------
// sitemap-orphans
// ---------------------------------------------------------------------------

export const sitemapOrphans: Check = {
  id: 'sitemap-orphans', family: 'technical-seo', maxPoints: 3,
  async run(ctx) {
    const found = await discoverSitemap(ctx);
    if (!found) return makeResult(this, 'skip', 'no sitemap discovered');
    const entries = parseSitemapEntries(found.res.body);
    if (entries.length === 0) return makeResult(this, 'skip', 'sitemap has no <url> entries to cross-reference');
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no pages sampled');
    const graph = buildLinkGraph(pages, ctx.baseUrl);
    const linked = new Set<string>();
    for (const set of graph.outLinks.values()) for (const t of set) linked.add(canonicalIdentity(t));

    const sitemapSet = new Set<string>();
    for (const e of entries) {
      try {
        const u = new URL(e.loc, ctx.baseUrl);
        if (u.origin === ctx.baseUrl.origin) sitemapSet.add(canonicalIdentity(u.toString()));
      } catch { /* ignore */ }
    }
    if (sitemapSet.size === 0) return makeResult(this, 'skip', 'no same-origin sitemap URLs to cross-reference');

    const sampled = new Set(graph.pageUrls.map(canonicalIdentity));
    // Sitemap URLs we sampled but that nothing internally links to.
    const unlinked = [...sitemapSet].filter((u) => sampled.has(u) && !linked.has(u) && u !== canonicalIdentity(new URL('/', ctx.baseUrl).toString()));
    // Internally-linked, sampled pages missing from the sitemap.
    const missing = [...sampled].filter((u) => !sitemapSet.has(u));
    if (unlinked.length === 0 && missing.length === 0) {
      return makeResult(this, 'pass', `sitemap and internal links agree on ${sitemapSet.size} URL(s)`);
    }
    const parts: string[] = [];
    if (unlinked.length > 0) parts.push(`${unlinked.length} in sitemap never linked`);
    if (missing.length > 0) parts.push(`${missing.length} linked but not in sitemap`);
    return makeResult(this, 'warn', `sitemap/internal-link divergence (${parts.join('; ')})`,
      'Ensure key pages are both internally linked and listed in the sitemap.');
  },
};

/** noindex/none via meta robots or X-Robots-Tag. */
function hasNoindex(res: FetchedResource): boolean {
  const set = robotsDirectiveSet(res);
  return hasDirectiveToken(set, 'noindex') || hasDirectiveToken(set, 'none');
}
