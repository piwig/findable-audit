import { HTMLElement } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult } from '../types.js';
import { pagesOf, pathOf } from './aggregate.js';
import { parsePage, classifyHeadResources } from './dom.js';
import { headerOf } from './security.js';
import { rollupBySeverity, type SeverityItem } from './jsonld.js';

// ---------------------------------------------------------------------------
// html-weight (SH)
// ---------------------------------------------------------------------------

export const htmlWeight: Check = {
  id: 'html-weight', family: 'performance', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const bytes = Buffer.byteLength(res.body, 'utf8');
    const msg = `HTML document is ${Math.round(bytes / 1024)}KB`;
    if (bytes <= 100 * 1024) return makeResult(this, 'pass', msg);
    const fix = 'Externalize large inline blobs; paginate huge pages.';
    if (bytes <= 250 * 1024) return makeResult(this, 'warn', msg, fix);
    return makeResult(this, 'fail', msg, fix);
  },
};

// ---------------------------------------------------------------------------
// render-blocking-js (MP) — per-page severity via classifyHeadResources
// ---------------------------------------------------------------------------

export const renderBlockingJs: Check = {
  id: 'render-blocking-js', family: 'performance', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const items: SeverityItem[] = pages.map((p) => {
      const { blockingScripts: n } = classifyHeadResources(parsePage(p));
      const status: 'pass' | 'warn' | 'fail' = n === 0 ? 'pass' : n <= 2 ? 'warn' : 'fail';
      return { path: pathOf(p), status, reason: n > 0 ? `${n} render-blocking script(s)` : undefined };
    });
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') return makeResult(this, 'pass', `no render-blocking head scripts on ${pages.length} page(s)`);
    return makeResult(this, roll.status, `render-blocking head scripts on: ${roll.detail}`,
      'Add defer/async (or type=module) to head <script src>, or move scripts to the end of <body>.');
  },
};

// ---------------------------------------------------------------------------
// render-blocking-css (SH)
// ---------------------------------------------------------------------------

export const renderBlockingCss: Check = {
  id: 'render-blocking-css', family: 'performance', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const { blockingStylesheets: n } = classifyHeadResources(parsePage(res));
    const msg = `${n} render-blocking stylesheet(s)`;
    if (n <= 2) return makeResult(this, 'pass', msg);
    const fix = 'Inline critical CSS; defer the rest (media queries / preload+onload); reduce requests.';
    if (n <= 4) return makeResult(this, 'warn', msg, fix);
    return makeResult(this, 'fail', msg, fix);
  },
};

// ---------------------------------------------------------------------------
// img-dimensions (MP) — global ratio across the sample, like images-alt
// ---------------------------------------------------------------------------

function hasExplicitDimensions(img: HTMLElement): boolean {
  const w = (img.getAttribute('width') ?? '').trim();
  const h = (img.getAttribute('height') ?? '').trim();
  if (w !== '' && h !== '') return true;
  const style = (img.getAttribute('style') ?? '').toLowerCase();
  return /aspect-ratio\s*:/.test(style);
}

export const imgDimensions: Check = {
  id: 'img-dimensions', family: 'performance', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let withDims = 0;
    for (const p of pages) {
      for (const img of parsePage(p).querySelectorAll('img')) {
        total += 1;
        if (hasExplicitDimensions(img)) withDims += 1;
      }
    }
    if (total === 0) return makeResult(this, 'pass', 'no <img> elements on sampled pages');
    const ratio = withDims / total;
    const lackingPct = Math.round((1 - ratio) * 100);
    const msg = `${lackingPct}% images lack dimensions (${withDims}/${total} sized)`;
    const fix = 'Set intrinsic width/height (or CSS aspect-ratio) on every <img> to avoid layout shift.';
    if (ratio >= 0.9) return makeResult(this, 'pass', msg);
    return makeResult(this, ratio >= 0.7 ? 'warn' : 'fail', msg, fix);
  },
};

// ---------------------------------------------------------------------------
// img-lazy-loading (SH, warn-only) — first image is the presumed hero/LCP;
// images from the 4th onward (index >= 3) are the below-the-fold heuristic.
// ---------------------------------------------------------------------------

export const imgLazyLoading: Check = {
  id: 'img-lazy-loading', family: 'performance', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');
    const imgs = parsePage(res).querySelectorAll('img');
    if (imgs.length === 0) return makeResult(this, 'pass', 'no images to assess');
    const hero = imgs[0];
    const heroLazy = (hero.getAttribute('loading') ?? '').toLowerCase() === 'lazy';
    if (heroLazy) {
      return makeResult(this, 'warn', 'the likely-LCP image (first on the page) is lazy-loaded',
        'Keep the hero/LCP image eager (drop loading="lazy" on the first image); lazy-load images below the fold.');
    }
    const belowFold = imgs.slice(3);
    if (belowFold.length === 0) return makeResult(this, 'pass', 'hero image is eager; no below-fold images to assess');
    const eager = belowFold.filter((img) => (img.getAttribute('loading') ?? '').toLowerCase() !== 'lazy').length;
    if (eager / belowFold.length > 0.5) {
      return makeResult(this, 'warn', `${eager}/${belowFold.length} off-screen images not lazy-loaded`,
        'Add loading="lazy" to images below the fold; keep the first/LCP image eager.');
    }
    return makeResult(this, 'pass', `${belowFold.length - eager}/${belowFold.length} below-fold images lazy-loaded, hero eager`);
  },
};

// ---------------------------------------------------------------------------
// img-next-gen (SH, warn-only)
// ---------------------------------------------------------------------------

const RASTER_EXT = /\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i;
const NEXTGEN_EXT = /\.(webp|avif)(\?.*)?$/i;

function isNextGen(img: HTMLElement): boolean {
  const src = img.getAttribute('src') ?? '';
  if (NEXTGEN_EXT.test(src)) return true;
  const picture = img.closest('picture');
  if (!picture) return false;
  for (const source of picture.querySelectorAll('source')) {
    const type = (source.getAttribute('type') ?? '').toLowerCase();
    if (type === 'image/webp' || type === 'image/avif') return true;
  }
  return false;
}

export const imgNextGen: Check = {
  id: 'img-next-gen', family: 'performance', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');
    const raster = parsePage(res).querySelectorAll('img').filter((img) => RASTER_EXT.test(img.getAttribute('src') ?? ''));
    if (raster.length === 0) return makeResult(this, 'pass', 'no raster <img> elements to assess');
    const nextGen = raster.filter(isNextGen).length;
    const pct = Math.round((nextGen / raster.length) * 100);
    const msg = `${nextGen}/${raster.length} images served/offered in next-gen formats (${pct}%)`;
    if (pct >= 50) return makeResult(this, 'pass', msg);
    return makeResult(this, 'warn', msg,
      'Serve AVIF/WebP with <picture> + srcset (or a next-gen file extension) for raster images.');
  },
};

// ---------------------------------------------------------------------------
// resource-hints (SH, warn-only)
// ---------------------------------------------------------------------------

function relTokens(el: HTMLElement): string[] {
  return (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

export const resourceHints: Check = {
  id: 'resource-hints', family: 'performance', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');
    const root = parsePage(res);
    const crossOrigins = new Set<string>();
    for (const el of root.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
      const href = el.getAttribute('src') ?? el.getAttribute('href') ?? '';
      try {
        const origin = new URL(href, res.finalUrl).origin;
        if (origin !== ctx.baseUrl.origin) crossOrigins.add(origin);
      } catch { /* malformed/relative URL — ignore */ }
    }
    if (crossOrigins.size === 0) return makeResult(this, 'pass', 'no cross-origin resources requiring a preconnect hint');
    const hinted = new Set<string>();
    for (const l of root.querySelectorAll('link[rel][href]')) {
      const tokens = relTokens(l);
      if (!tokens.includes('preconnect') && !tokens.includes('dns-prefetch')) continue;
      try { hinted.add(new URL(l.getAttribute('href') ?? '', res.finalUrl).origin); } catch { /* ignore */ }
    }
    const missing = [...crossOrigins].filter((o) => !hinted.has(o));
    if (missing.length === 0) {
      return makeResult(this, 'pass', `preconnect/dns-prefetch present for ${crossOrigins.size} third-party origin(s)`);
    }
    return makeResult(this, 'warn', `no preconnect/dns-prefetch hint for: ${missing.slice(0, 3).join(', ')}`,
      'Add <link rel="preconnect" href="..."> for critical third-party origins and rel=preload for the LCP image/key font.');
  },
};

// ---------------------------------------------------------------------------
// dom-size (SH)
// ---------------------------------------------------------------------------

function maxDepth(node: HTMLElement, depth = 0): number {
  let max = depth;
  for (const child of node.childNodes) {
    if (child instanceof HTMLElement) max = Math.max(max, maxDepth(child, depth + 1));
  }
  return max;
}

export const domSize: Check = {
  id: 'dom-size', family: 'performance', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const root = parsePage(res);
    const elements = root.querySelectorAll('*').length;
    const depth = maxDepth(root);
    const fix = 'Simplify markup; virtualize long lists; flatten deep nesting.';
    if (elements > 1400) return makeResult(this, 'fail', `large DOM (${elements} nodes)`, fix);
    const msg = `DOM has ${elements} element(s), max nesting depth ${depth}`;
    if (elements > 800 || depth > 32) return makeResult(this, 'warn', msg, fix);
    return makeResult(this, 'pass', msg);
  },
};

// ---------------------------------------------------------------------------
// text-compression (HH)
// ---------------------------------------------------------------------------

export const textCompression: Check = {
  id: 'text-compression', family: 'performance', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const encoding = (headerOf(res, 'content-encoding') ?? '').toLowerCase();
    if (/\b(br|zstd|gzip)\b/.test(encoding)) {
      return makeResult(this, 'pass', `HTML served with Content-Encoding: ${encoding}`);
    }
    return makeResult(this, 'fail', 'HTML not compressed',
      'Enable Brotli/gzip compression for text responses at the server/CDN.');
  },
};

// ---------------------------------------------------------------------------
// asset-caching (HH, warn-only)
// ---------------------------------------------------------------------------

export const assetCaching: Check = {
  id: 'asset-caching', family: 'performance', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');
    const root = parsePage(res);
    let assetPath: string | undefined;
    for (const el of root.querySelectorAll('link[rel="stylesheet"], script[src]')) {
      const href = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
      if (!href) continue;
      try {
        const u = new URL(href, res.finalUrl);
        if (u.origin === ctx.baseUrl.origin) { assetPath = u.pathname + u.search; break; }
      } catch { /* malformed URL — skip candidate */ }
    }
    if (!assetPath) return makeResult(this, 'skip', 'no same-origin CSS/JS asset to sample');
    const asset = await ctx.fetch(assetPath);
    if (!asset || asset.status !== 200) return makeResult(this, 'skip', `sampled asset not reachable (${assetPath})`);
    const cacheControl = headerOf(asset, 'cache-control') ?? '';
    const maxAge = /max-age\s*=\s*(\d+)/i.exec(cacheControl);
    const cached = (maxAge !== null && Number(maxAge[1]) > 0) || headerOf(asset, 'etag') !== undefined;
    if (cached) return makeResult(this, 'pass', `caching headers present on ${assetPath}`);
    return makeResult(this, 'warn', `no caching headers on assets (sampled ${assetPath})`,
      'Cache-Control: public, max-age=31536000, immutable on hashed assets.');
  },
};

// ---------------------------------------------------------------------------
// inline-head-volume (SH, warn-only)
// ---------------------------------------------------------------------------

export const inlineHeadVolume: Check = {
  id: 'inline-head-volume', family: 'performance', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');
    const { inlineBytes } = classifyHeadResources(parsePage(res));
    const msg = `${Math.round(inlineBytes / 1024)}KB inline <style>/<script> in <head>`;
    if (inlineBytes <= 14 * 1024) return makeResult(this, 'pass', msg);
    return makeResult(this, 'warn', msg, 'Keep only minimal critical CSS inline in <head>; externalize the rest.');
  },
};
