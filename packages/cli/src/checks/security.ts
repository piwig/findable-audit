import type { HTMLElement } from 'node-html-parser';
import type { Check, FetchedResource } from '../types.js';
import { makeResult } from '../types.js';
import { pagesOf, pathOf } from './aggregate.js';
import { parsePage } from './dom.js';
import { isLocalOrPrivateHost } from './fundamentals.js';

/** Truncate an offender path list to 3 entries + "(+N more)", matching the other MP checks. */
function offenderList(paths: string[]): string {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` (+${paths.length - 3} more)` : '');
}

/**
 * Case-insensitive response-header lookup, returning the value or undefined.
 * Reused by every HTTP-header security check so header parsing lives in one place.
 * (FetchedResource.headers already has lower-cased keys, but this stays robust.)
 */
export function headerOf(res: FetchedResource, name: string): string | undefined {
  const key = name.toLowerCase();
  if (key in res.headers) return res.headers[key];
  for (const [k, v] of Object.entries(res.headers)) {
    if (k.toLowerCase() === key) return v;
  }
  return undefined;
}

/** A CSP policy from the response header, falling back to a <meta http-equiv> tag. */
function cspOf(res: FetchedResource): string | undefined {
  const header = headerOf(res, 'content-security-policy');
  if (header) return header;
  for (const m of parsePage(res).querySelectorAll('meta[http-equiv]')) {
    if ((m.getAttribute('http-equiv') ?? '').toLowerCase() === 'content-security-policy') {
      return m.getAttribute('content') ?? undefined;
    }
  }
  return undefined;
}

/** Parse a CSP into a directive → lower-cased sources map. */
function cspDirectives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const raw of policy.split(';')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    map.set(parts[0].toLowerCase(), parts.slice(1).map((s) => s.toLowerCase()));
  }
  return map;
}

const hostOf = (url: string | undefined, fallback: string): string => {
  if (!url) return fallback;
  try { return new URL(url).hostname; } catch { return fallback; }
};

// ---------------------------------------------------------------------------
// mixed-content (MP, skip if not https)
// ---------------------------------------------------------------------------

export interface MixedContentRefs {
  /** http:// subresources that block/execute: scripts, stylesheets, iframes. */
  active: string[];
  /** http:// subresources that are merely displayed: images, media, other links. */
  passive: string[];
}

/** Collect insecure (http://) subresource URLs on a page, split by active vs passive risk. */
export function classifyMixedContent(root: HTMLElement): MixedContentRefs {
  const active: string[] = [];
  const passive: string[] = [];
  const add = (bucket: string[], url: string | undefined) => {
    if (url && /^http:\/\//i.test(url.trim())) bucket.push(url.trim());
  };
  for (const s of root.querySelectorAll('script[src]')) add(active, s.getAttribute('src'));
  for (const f of root.querySelectorAll('iframe[src]')) add(active, f.getAttribute('src'));
  for (const l of root.querySelectorAll('link[href]')) {
    const rel = (l.getAttribute('rel') ?? '').toLowerCase();
    add(rel.includes('stylesheet') ? active : passive, l.getAttribute('href'));
  }
  for (const img of root.querySelectorAll('img[src]')) add(passive, img.getAttribute('src'));
  for (const m of root.querySelectorAll('audio[src], video[src], source[src]')) add(passive, m.getAttribute('src'));
  return { active, passive };
}

export const mixedContent: Check = {
  id: 'mixed-content', family: 'security', maxPoints: 4,
  async run(ctx) {
    const home = await ctx.fetch('/');
    let scheme = ctx.baseUrl.protocol;
    try { scheme = new URL(home?.finalUrl || ctx.baseUrl.toString()).protocol; } catch { /* keep baseUrl scheme */ }
    if (scheme !== 'https:') return makeResult(this, 'skip', 'page is not served over HTTPS');
    const pages = await pagesOf(ctx);
    const activePages: string[] = [];
    const passivePages: string[] = [];
    for (const p of pages) {
      const refs = classifyMixedContent(parsePage(p));
      if (refs.active.length > 0) activePages.push(pathOf(p));
      else if (refs.passive.length > 0) passivePages.push(pathOf(p));
    }
    if (activePages.length > 0) {
      return makeResult(this, 'fail', `active mixed content on: ${offenderList(activePages)}`,
        'Serve every script/stylesheet/iframe over https:// (or protocol-relative URLs).');
    }
    if (passivePages.length > 0) {
      return makeResult(this, 'warn', `passive mixed content (images/media) on: ${offenderList(passivePages)}`,
        'Serve images and media over https:// so the page stays fully secure.');
    }
    return makeResult(this, 'pass', `no mixed content across ${pages.length} sampled page(s)`);
  },
};

// ---------------------------------------------------------------------------
// hsts (HH, skip local)
// ---------------------------------------------------------------------------

const HSTS_MIN_AGE = 15552000; // 180 days

export const hsts: Check = {
  id: 'hsts', family: 'security', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (isLocalOrPrivateHost(hostOf(res?.finalUrl, ctx.baseUrl.hostname))) {
      return makeResult(this, 'skip', 'local host — HSTS check skipped');
    }
    if (!res) return makeResult(this, 'skip', 'homepage not reachable');
    const h = headerOf(res, 'strict-transport-security');
    if (!h) {
      return makeResult(this, 'fail', 'no Strict-Transport-Security header',
        'Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.');
    }
    const m = /max-age\s*=\s*"?(\d+)"?/i.exec(h);
    const maxAge = m ? Number(m[1]) : 0;
    const extras = [/includesubdomains/i.test(h) && 'includeSubDomains', /preload/i.test(h) && 'preload'].filter(Boolean);
    const suffix = extras.length ? ` (+${extras.join(', ')})` : '';
    if (maxAge >= HSTS_MIN_AGE) return makeResult(this, 'pass', `HSTS max-age=${maxAge}${suffix}`);
    return makeResult(this, 'warn', `HSTS max-age=${maxAge} is below 180 days`,
      'Raise HSTS max-age to at least 15552000 (180 days); prefer 31536000 with includeSubDomains.');
  },
};

// ---------------------------------------------------------------------------
// x-content-type-options (HH)
// ---------------------------------------------------------------------------

export const xContentTypeOptions: Check = {
  id: 'x-content-type-options', family: 'security', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (!res) return makeResult(this, 'skip', 'homepage not reachable');
    const h = headerOf(res, 'x-content-type-options');
    if ((h ?? '').trim().toLowerCase() === 'nosniff') return makeResult(this, 'pass', 'X-Content-Type-Options: nosniff');
    return makeResult(this, 'fail', h ? `X-Content-Type-Options is "${h}", not nosniff` : 'no X-Content-Type-Options header',
      'Add `X-Content-Type-Options: nosniff`.');
  },
};

// ---------------------------------------------------------------------------
// csp (HH)
// ---------------------------------------------------------------------------

export const csp: Check = {
  id: 'csp', family: 'security', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (!res) return makeResult(this, 'skip', 'homepage not reachable');
    const policy = cspOf(res);
    if (!policy) {
      return makeResult(this, 'fail', 'no Content-Security-Policy',
        'Add a Content-Security-Policy header restricting script/style/connect sources.');
    }
    const dirs = cspDirectives(policy);
    const scriptSrc = dirs.get('script-src') ?? dirs.get('default-src') ?? [];
    if (scriptSrc.includes("'unsafe-inline'") || scriptSrc.includes('*')) {
      return makeResult(this, 'warn', "Content-Security-Policy allows 'unsafe-inline' or * in script sources",
        "Tighten script-src: drop 'unsafe-inline' and wildcard sources; use nonces/hashes.");
    }
    return makeResult(this, 'pass', 'Content-Security-Policy present');
  },
};

// ---------------------------------------------------------------------------
// clickjacking (HH): X-Frame-Options or CSP frame-ancestors
// ---------------------------------------------------------------------------

export const clickjacking: Check = {
  id: 'clickjacking', family: 'security', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (!res) return makeResult(this, 'skip', 'homepage not reachable');
    const xfo = (headerOf(res, 'x-frame-options') ?? '').trim().toUpperCase();
    if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return makeResult(this, 'pass', `X-Frame-Options: ${xfo}`);
    // frame-ancestors is ONLY enforced when delivered via the HTTP CSP header — browsers
    // ignore frame-ancestors in a <meta> CSP. Read the header directly, not cspOf (meta fallback).
    const headerPolicy = headerOf(res, 'content-security-policy');
    if (headerPolicy) {
      const fa = cspDirectives(headerPolicy).get('frame-ancestors');
      if (fa && fa.length > 0 && !fa.includes('*')) return makeResult(this, 'pass', "CSP frame-ancestors restricts framing");
    }
    return makeResult(this, 'fail', 'no clickjacking protection (X-Frame-Options / frame-ancestors)',
      "Add `X-Frame-Options: SAMEORIGIN` or a CSP `frame-ancestors 'self'`.");
  },
};

// ---------------------------------------------------------------------------
// referrer-policy (HH)
// ---------------------------------------------------------------------------

/** The recognized Referrer-Policy tokens (spec §3.8); anything else is not a valid policy. */
const REFERRER_POLICY_TOKENS = new Set([
  'no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
]);

export const referrerPolicy: Check = {
  id: 'referrer-policy', family: 'security', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (!res) return makeResult(this, 'skip', 'homepage not reachable');
    const h = headerOf(res, 'referrer-policy');
    if (!h || !h.trim()) return makeResult(this, 'fail', 'no Referrer-Policy header',
      'Add `Referrer-Policy: strict-origin-when-cross-origin`.');
    const values = h.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    const recognized = values.filter((v) => REFERRER_POLICY_TOKENS.has(v));
    if (recognized.length === 0) {
      return makeResult(this, 'warn', `Referrer-Policy has no recognized value (${h})`,
        'Use a recognized token such as strict-origin-when-cross-origin.');
    }
    if (recognized.includes('unsafe-url')) {
      return makeResult(this, 'warn', 'Referrer-Policy is leaky (unsafe-url)',
        'Use a non-leaky value such as strict-origin-when-cross-origin.');
    }
    return makeResult(this, 'pass', `Referrer-Policy: ${h}`);
  },
};

// ---------------------------------------------------------------------------
// permissions-policy (HH)
// ---------------------------------------------------------------------------

export const permissionsPolicy: Check = {
  id: 'permissions-policy', family: 'security', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (!res) return makeResult(this, 'skip', 'homepage not reachable');
    const h = headerOf(res, 'permissions-policy') ?? headerOf(res, 'feature-policy');
    if (h) return makeResult(this, 'pass', 'Permissions-Policy present');
    return makeResult(this, 'fail', 'no Permissions-Policy header',
      'Add `Permissions-Policy: geolocation=(), camera=(), microphone=()`.');
  },
};
