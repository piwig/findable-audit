import { parse, type HTMLElement } from 'node-html-parser';
import type { Check, CrawlContext } from '../types.js';
import { makeResult } from '../types.js';

async function home(ctx: CrawlContext): Promise<HTMLElement | null> {
  const res = await ctx.fetch('/');
  return res?.status === 200 ? parse(res.body) : null;
}

export const titleDescription: Check = {
  id: 'title-description', family: 'seo-fundamentals', maxPoints: 8,
  async run(ctx) {
    const root = await home(ctx);
    if (!root) return makeResult(this, 'fail', 'homepage not reachable');
    const title = root.querySelector('title')?.textContent.trim() ?? '';
    const desc = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
    if (!title || !desc) {
      return makeResult(this, 'fail', `missing ${!title ? '<title>' : 'meta description'}`,
        'Add a <title> (10-70 chars) and a meta description (50-160 chars).');
    }
    const titleOk = title.length >= 10 && title.length <= 70;
    const descOk = desc.length >= 50 && desc.length <= 160;
    if (titleOk && descOk) return makeResult(this, 'pass', 'title and meta description look good');
    return makeResult(this, 'warn', `length out of range (title: ${title.length}, description: ${desc.length})`,
      'Aim for a 10-70 char title and a 50-160 char meta description.');
  },
};

export const canonical: Check = {
  id: 'canonical', family: 'seo-fundamentals', maxPoints: 5,
  async run(ctx) {
    const root = await home(ctx);
    if (!root) return makeResult(this, 'fail', 'homepage not reachable');
    const href = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (href) return makeResult(this, 'pass', `canonical set: ${href}`);
    return makeResult(this, 'fail', 'no canonical link', 'Add <link rel="canonical" href="..."> to every page.');
  },
};

export const openGraph: Check = {
  id: 'open-graph', family: 'seo-fundamentals', maxPoints: 5,
  async run(ctx) {
    const root = await home(ctx);
    if (!root) return makeResult(this, 'fail', 'homepage not reachable');
    const og = (p: string) => root.querySelector(`meta[property="og:${p}"]`)?.getAttribute('content');
    if (og('title') && og('description')) return makeResult(this, 'pass', 'Open Graph tags present');
    return makeResult(this, 'fail', 'og:title / og:description missing',
      'Add Open Graph meta tags so shared links and AI previews render correctly.');
  },
};

/** localhost, *.localhost, loopback (127.0.0.0/8, ::1) and private IPv4 ranges. */
export function isLocalOrPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127 || a === 10) return true; // 127.0.0.0/8, 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

export const httpsCheck: Check = {
  id: 'https', family: 'seo-fundamentals', maxPoints: 5,
  async run(ctx) {
    const res = await ctx.fetch('/');
    const final = new URL(res?.finalUrl || ctx.baseUrl.toString());
    if (isLocalOrPrivateHost(final.hostname)) return makeResult(this, 'skip', 'local host — HTTPS check skipped');
    if (final.protocol === 'https:') return makeResult(this, 'pass', 'served over HTTPS');
    return makeResult(this, 'fail', 'not served over HTTPS', 'Serve the site over HTTPS.');
  },
};

export const viewport: Check = {
  id: 'viewport', family: 'seo-fundamentals', maxPoints: 5,
  async run(ctx) {
    const root = await home(ctx);
    if (!root) return makeResult(this, 'fail', 'homepage not reachable');
    if (root.querySelector('meta[name="viewport"]')) return makeResult(this, 'pass', 'mobile viewport set');
    return makeResult(this, 'fail', 'no viewport meta tag',
      'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  },
};
