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
