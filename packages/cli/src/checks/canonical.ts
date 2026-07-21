import type { FetchedResource } from '../types.js';
import { parsePage } from './dom.js';

// ---------------------------------------------------------------------------
// Canonical URL extraction (tag + HTTP Link header) — shared by `canonical`
// and `canonical-resolves` (spec §3.4).
// ---------------------------------------------------------------------------

/** Tracking/query params that do not change page identity for canonical comparison. */
const TRACKING_PARAM_RE = /^(utm_|gclid$|fbclid$|mc_|_ga$|ref$|source$|yclid$|msclkid$)/i;

/**
 * Parse an HTTP `Link:` header value and return the hrefs whose rel is
 * `canonical`. Handles multiple comma-separated entries, e.g.
 * `<https://x/a>; rel="preload", <https://x/p>; rel="canonical"`.
 */
export function canonicalsFromLinkHeader(header: string, base: string): string[] {
  const out: string[] = [];
  // Split on commas that introduce a new `<...>` entry (not commas inside params).
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = /^\s*<([^>]+)>\s*;\s*(.*)$/s.exec(part);
    if (!m) continue;
    const [, href, params] = m;
    if (/(?:^|[;\s])rel\s*=\s*"?[^";]*\bcanonical\b/i.test(params)) {
      try {
        out.push(new URL(href.trim(), base).toString());
      } catch {
        /* ignore malformed href */
      }
    }
  }
  return out;
}

/**
 * All distinct canonical URLs a page declares, from BOTH `<link rel="canonical">`
 * tags and the HTTP `Link: rel="canonical"` header, resolved to absolute URLs
 * against the page's final URL. Order-preserving, de-duplicated.
 */
export function extractCanonicals(res: FetchedResource): string[] {
  const base = res.finalUrl || '';
  const urls: string[] = [];
  for (const link of parsePage(res).querySelectorAll('link[rel]')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().trim();
    if (rel !== 'canonical') continue;
    const href = link.getAttribute('href');
    if (!href) continue;
    try {
      urls.push(new URL(href, base || undefined).toString());
    } catch {
      /* ignore malformed href */
    }
  }
  const header = res.headers['link'] ?? '';
  if (header) urls.push(...canonicalsFromLinkHeader(header, base));
  return [...new Set(urls)];
}

/** Normalized identity of a URL for self-referential comparison: strip hash,
 *  drop tracking params, and normalize a trailing slash (`/a` ≡ `/a/`). */
export function canonicalIdentity(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM_RE.test(key)) u.searchParams.delete(key);
  }
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return `${u.origin}${path}${u.search}`;
}

/** true when `canonical` is self-referential to the page served at `pageUrl`. */
export function isSelfReferential(canonical: string, pageUrl: string): boolean {
  return canonicalIdentity(canonical) === canonicalIdentity(pageUrl);
}
