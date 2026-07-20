import { parse } from 'node-html-parser';
import type { Check, FetchedResource } from '../types.js';
import { makeResult } from '../types.js';
import { isLocalOrPrivateHost } from './fundamentals.js';
import { pagesOf, aggregate } from './aggregate.js';
import { isContentPath } from '../crawl-filters.js';

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
        if (u.origin !== baseUrl.origin || !isContentPath(u.pathname)) continue;
        u.hash = '';
        seen.add(u.toString());
      } catch { /* invalid href ignored */ }
    }
  }
  return [...seen].slice(0, MAX_LINKS);
}

export const brokenInternalLinks: Check = {
  id: 'broken-internal-links', family: 'technical-seo', maxPoints: 8,
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
  id: 'redirect-hygiene', family: 'security', maxPoints: 4,
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

interface AlternateRef { href: string; from: string; }

/** Distinct hreflang alternate URLs declared on the sampled pages (bounded), with their source page. */
function hreflangRefs(pages: FetchedResource[], baseUrl: URL): AlternateRef[] {
  const seen = new Set<string>();
  const out: AlternateRef[] = [];
  for (const p of pages) {
    const from = new URL(p.finalUrl || baseUrl).toString();
    for (const l of parse(p.body).querySelectorAll('link')) {
      if (l.getAttribute('rel') !== 'alternate' || !l.getAttribute('hreflang')) continue;
      const href = l.getAttribute('href');
      if (!href) continue;
      try {
        const u = new URL(href, p.finalUrl || baseUrl).toString();
        if (!seen.has(u)) { seen.add(u); out.push({ href: u, from }); }
      } catch { /* invalid href ignored */ }
    }
  }
  return out.slice(0, MAX_HREFLANG);
}

/** true when the page body declares a hreflang alternate pointing back to referrerUrl. */
function declaresBackReference(body: string, alternateFinalUrl: string, referrerUrl: string): boolean {
  const target = stripHash(referrerUrl);
  return parse(body).querySelectorAll('link')
    .some((l) => {
      if (l.getAttribute('rel') !== 'alternate' || !l.getAttribute('hreflang')) return false;
      const href = l.getAttribute('href');
      if (!href) return false;
      try {
        return stripHash(new URL(href, alternateFinalUrl).toString()) === target;
      } catch { return false; }
    });
}

function stripHash(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

export const hreflang: Check = {
  id: 'hreflang', family: 'technical-seo', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const refs = hreflangRefs(pages, ctx.baseUrl);
    if (refs.length === 0) return makeResult(this, 'skip', 'no hreflang annotations (single-language site)');
    const offenders: string[] = [];
    for (const ref of refs) {
      const res = await ctx.fetch(ref.href);
      const alternateFinalUrl = res?.finalUrl || ref.href;
      if (res?.status !== 200 || !declaresBackReference(res.body, alternateFinalUrl, ref.from)) {
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
