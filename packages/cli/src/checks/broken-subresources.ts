// broken-subresources (backlog #27) — do the files a page *needs* actually exist?
//
// `broken-internal-links` probes navigation (`<a href>`). Nothing probed the
// assets the page loads by itself: a 404 on a stylesheet strips the page of its
// layout, a 404 on a script removes whatever it hydrated, and a 404 on an image
// leaves an alt string where the illustration a citation refers to should be.
// None of that is visible in the HTML — the markup is perfectly valid; only the
// response tells you.
//
// Verdict rests on the HTTP status alone (RFC 9110 §15.5: 4xx/5xx is an error
// response), so this is `measured` and `fail` is allowed. Everything that could
// turn into a judgement call is excluded rather than guessed at:
//
//   - Cross-origin assets are collected but never probed. A CDN answering 403 to
//     an unfamiliar user-agent, hotlink protection, or a bot wall is
//     indistinguishable from a dead file, and we will not fail a site for a
//     third party's WAF. Same-origin is where the answer is unambiguous.
//   - `/cdn-cgi/` injections are skipped, exactly as `broken-internal-links`
//     does — those are the CDN's endpoints, not the site's files.
//   - Non-http(s) references (`data:`, `blob:`, `javascript:`) carry their own
//     payload; there is nothing to fetch.

import { parse } from 'node-html-parser';
import type { Check, FetchedResource } from '../types.js';
import { makeResult, t } from '../types.js';
import { pagesOf, aggregate } from './aggregate.js';
import { mapProbes } from './concurrency.js';
import { isContentPath } from '../crawl-filters.js';

/**
 * Probe budget. Every probe is a real GET (the crawl context has no HEAD), and
 * an image is not a 3 KB HTML page — so this cap is deliberately lower than
 * `broken-internal-links`'s 30, and code assets are probed before images (see
 * `collectSubresources`) so the budget lands on the references whose failure
 * costs the most.
 */
export const MAX_SUBRESOURCES = 20;

/**
 * URLs of a `srcset` attribute, per the WHATWG image-candidate-string grammar.
 *
 * Naively splitting on `,` corrupts the very common transform-in-path CDN style
 * (`/img/w_800,h_600/photo.jpg 2x`) into two bogus URLs, which would then 404 —
 * a false positive manufactured by the parser. So: skip separators, take
 * everything up to the next whitespace as the URL, and only then walk the
 * descriptor list to the comma that ends this candidate.
 */
export function srcsetUrls(value: string): string[] {
  const out: string[] = [];
  const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (isWs(value[i]) || value[i] === ',')) i++;
    if (i >= value.length) break;
    const start = i;
    while (i < value.length && !isWs(value[i])) i++;
    let url = value.slice(start, i);
    if (url.endsWith(',')) {
      // Trailing commas belong to the separator, not to the URL.
      url = url.replace(/,+$/, '');
    } else {
      // Walk the descriptors ("2x", "800w", or a future parenthesised form) to
      // the comma that closes this candidate.
      let depth = 0;
      while (i < value.length) {
        const c = value[i];
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) { i++; break; }
        i++;
      }
    }
    if (url !== '') out.push(url);
  }
  return out;
}

export interface SubresourceRefs {
  /**
   * Distinct same-origin subresource URLs, code (scripts, stylesheets) first
   * then images, each group in document order across the sample.
   */
  sameOrigin: string[];
  /** Distinct cross-origin subresources — reported for context, never probed. */
  crossOrigin: number;
}

/** Raw reference strings on one page, split into the two probe priorities. */
function referencesOn(page: FetchedResource): { code: string[]; images: string[] } {
  const root = parse(page.body);
  const code: string[] = [];
  const images: string[] = [];
  for (const s of root.querySelectorAll('script[src]')) code.push(s.getAttribute('src') ?? '');
  for (const l of root.querySelectorAll('link[href]')) {
    const rel = (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet')) code.push(l.getAttribute('href') ?? '');
  }
  for (const img of root.querySelectorAll('img')) {
    images.push(img.getAttribute('src') ?? '');
    images.push(...srcsetUrls(img.getAttribute('srcset') ?? ''));
  }
  for (const src of root.querySelectorAll('source')) {
    images.push(...srcsetUrls(src.getAttribute('srcset') ?? ''));
  }
  return { code, images };
}

/** Deduped subresource references across the sampled pages (see the header note). */
export function collectSubresources(pages: FetchedResource[], baseUrl: URL): SubresourceRefs {
  const seen = new Set<string>();
  const cross = new Set<string>();
  const code: string[] = [];
  const images: string[] = [];

  const absorb = (raw: string, page: FetchedResource, bucket: string[]): void => {
    const href = raw.trim();
    if (href === '') return;
    let u: URL;
    try { u = new URL(href, page.finalUrl || baseUrl); } catch { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return; // data:/blob:/javascript:
    u.hash = '';
    const key = u.toString();
    if (seen.has(key)) return;
    seen.add(key);
    if (u.origin !== baseUrl.origin) { cross.add(key); return; }
    if (!isContentPath(u.pathname)) return; // CDN-injected /cdn-cgi/ endpoints
    bucket.push(key);
  };

  for (const page of pages) {
    const refs = referencesOn(page);
    for (const raw of refs.code) absorb(raw, page, code);
    for (const raw of refs.images) absorb(raw, page, images);
  }
  return { sameOrigin: [...code, ...images], crossOrigin: cross.size };
}

/** Compact offender label: path plus query, since `?v=2` is a different file. */
function labelOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

const FIX = 'Fix or remove <img>/<script>/<link rel=stylesheet> references returning >= 400: '
  + 'a missing stylesheet or script strips the page of the layout and content a crawler renders, '
  + 'and a missing image leaves an alt string where the illustration should be.';

export const brokenSubresources: Check = {
  id: 'broken-subresources', family: 'technical-seo', evidence: 'measured', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const refs = collectSubresources(pages, ctx.baseUrl);
    if (refs.sameOrigin.length === 0) {
      return refs.crossOrigin > 0
        ? makeResult(this, 'skip', t`no same-origin subresources (${refs.crossOrigin} third-party only)`)
        : makeResult(this, 'skip', 'no subresources on sampled pages');
    }
    const targets = refs.sameOrigin.slice(0, MAX_SUBRESOURCES);
    // Bounded concurrency, input order preserved: offenders are listed in the
    // same order the references were found, run after run.
    const probed = await mapProbes(targets, async (url) => ({ url, res: await ctx.fetch(url) }));
    const offenders = probed
      .filter(({ res }) => res === null || res.status >= 400)
      .map(({ url }) => labelOf(url));
    const agg = aggregate(targets.length, offenders);
    if (agg.status === 'pass') {
      return makeResult(this, 'pass', t`${targets.length} same-origin subresource(s) resolve`);
    }
    return makeResult(this, agg.status, t`broken subresources: ${agg.detail}`, FIX);
  },
};
