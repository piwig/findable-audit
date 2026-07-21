import type { HTMLElement } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult } from '../types.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import { parsePage, headingOutline, hasHeadingSkip, tokenize, isGenericAnchorText } from './dom.js';

// ---------------------------------------------------------------------------
// meta-per-page
// ---------------------------------------------------------------------------

export const metaPerPage: Check = {
  id: 'meta-per-page', family: 'on-page', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const offenders: string[] = [];
    for (const p of pages) {
      const root = parsePage(p);
      const title = root.querySelector('title')?.textContent.trim() ?? '';
      const desc = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
      const titleOk = title.length >= 10 && title.length <= 70;
      const descOk = desc.length >= 50 && desc.length <= 160;
      if (!titleOk || !descOk) offenders.push(pathOf(p));
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `title and description in range on ${pages.length} page(s)`);
    const agg = aggregate(pages.length, offenders);
    return makeResult(this, agg.status, `title/description out of range on: ${agg.detail}`,
      'Give every sampled page a unique 10-70 char <title> and a 50-160 char meta description.');
  },
};

// ---------------------------------------------------------------------------
// title-pattern
// ---------------------------------------------------------------------------

/** Separators conventionally used between a title's topic and brand segments. */
const TITLE_SEPARATOR = /\s[|\-–—·]\s/;

function splitTitleSegments(title: string): string[] {
  return title.split(TITLE_SEPARATOR).map((s) => s.trim()).filter(Boolean);
}

export const titlePattern: Check = {
  id: 'title-pattern', family: 'on-page', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const root = parsePage(res);
    const title = root.querySelector('title')?.textContent.trim() ?? '';
    if (!title) return makeResult(this, 'fail', 'no <title>', 'Format the title as "Primary topic — Brand".');
    const segments = splitTitleSegments(title);
    if (segments.length < 2) {
      return makeResult(this, 'warn', 'title has no separator to distinguish topic from brand',
        'Format the title as "Primary topic — Brand" (e.g. "Sourdough bread in Springfield — Example Bakery").');
    }
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (first.length < last.length) {
      return makeResult(this, 'warn', 'title looks brand-first, not front-loaded with the topic',
        'Lead with the primary topic, then a short brand suffix after the separator.');
    }
    return makeResult(this, 'pass', 'title is topic-first with a brand suffix');
  },
};

// ---------------------------------------------------------------------------
// title-h1-alignment
// ---------------------------------------------------------------------------

export const titleH1Alignment: Check = {
  id: 'title-h1-alignment', family: 'on-page', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const root = parsePage(res);
    const title = root.querySelector('title')?.textContent.trim() ?? '';
    const h1 = root.querySelector('h1')?.textContent.trim() ?? '';
    if (!title || !h1) {
      return makeResult(this, 'fail', `missing ${!title ? '<title>' : '<h1>'}`,
        'Add both a <title> and a single <h1> describing the page topic.');
    }
    // Exclude the brand (the title's trailing segment after a separator, as in
    // title-pattern) from the overlap, so two topically-different strings that
    // share only the brand token don't falsely pass.
    const segments = splitTitleSegments(title);
    const brandTokens = segments.length >= 2 ? new Set(tokenize(segments[segments.length - 1])) : new Set<string>();
    const titleTokens = new Set(tokenize(title).filter((t) => !brandTokens.has(t)));
    const h1Tokens = tokenize(h1).filter((t) => !brandTokens.has(t));
    const shared = new Set(h1Tokens.filter((t) => titleTokens.has(t)));
    if (shared.size === 0) {
      return makeResult(this, 'warn', 'title and H1 topics diverge (no shared meaningful tokens)',
        'Keep the <h1> on the same subject as the <title>.');
    }
    return makeResult(this, 'pass', `title and H1 share ${shared.size} meaningful token(s)`);
  },
};

// ---------------------------------------------------------------------------
// headings-outline
// ---------------------------------------------------------------------------

export const headingsOutline: Check = {
  id: 'headings-outline', family: 'on-page', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const offenders: string[] = [];
    for (const p of pages) {
      const outline = headingOutline(parsePage(p));
      const h1Count = outline.filter((h) => h.level === 1 && h.text).length;
      if (h1Count !== 1 || hasHeadingSkip(outline)) offenders.push(pathOf(p));
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `heading outline clean on ${pages.length} page(s)`);
    const agg = aggregate(pages.length, offenders);
    return makeResult(this, agg.status, `heading outline broken on: ${agg.detail}`,
      'Use exactly one <h1> per page and nest H2/H3/... without skipping a level.');
  },
};

// ---------------------------------------------------------------------------
// anchor-text
// ---------------------------------------------------------------------------

function isInternalHref(href: string, pageUrl: string, baseOrigin: string): boolean {
  try {
    return new URL(href, pageUrl || baseOrigin).origin === baseOrigin;
  } catch { return false; }
}

export const anchorText: Check = {
  id: 'anchor-text', family: 'on-page', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let generic = 0;
    for (const p of pages) {
      const root = parsePage(p);
      for (const a of root.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') ?? '';
        if (!href || href.startsWith('#')) continue;
        if (!isInternalHref(href, p.finalUrl, ctx.baseUrl.origin)) continue;
        total += 1;
        const text = a.textContent.trim();
        if (!text) {
          const img = a.querySelector('img');
          const alt = img?.getAttribute('alt')?.trim();
          if (!alt) generic += 1;
          continue;
        }
        if (isGenericAnchorText(text)) generic += 1;
      }
    }
    if (total === 0) return makeResult(this, 'pass', 'no internal links on sampled pages');
    const ratio = generic / total;
    const pct = Math.round(ratio * 100);
    if (ratio < 0.1) return makeResult(this, 'pass', `${pct}% generic internal anchor text (${generic}/${total})`);
    const status = ratio < 0.5 ? 'warn' : 'fail';
    return makeResult(this, status, `generic anchor text (${pct}%)`,
      'Name the destination in the anchor text instead of "click here" / "read more" / bare URLs.');
  },
};

// ---------------------------------------------------------------------------
// charset
// ---------------------------------------------------------------------------

export const charset: Check = {
  id: 'charset', family: 'on-page', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const headSnippet = res.body.slice(0, 1024);
    const metaMatch = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(headSnippet);
    const headerMatch = /charset=([\w-]+)/i.exec(res.headers['content-type'] ?? '');
    const declared = (metaMatch?.[1] ?? headerMatch?.[1] ?? '').toLowerCase();
    if (!declared) return makeResult(this, 'fail', 'no charset declared', 'Add <meta charset="utf-8"> first in <head>.');
    if (declared === 'utf-8' || declared === 'utf8') return makeResult(this, 'pass', 'UTF-8 charset declared');
    return makeResult(this, 'warn', `legacy charset declared (${declared})`,
      'Switch to <meta charset="utf-8"> as the first element in <head>.');
  },
};

// ---------------------------------------------------------------------------
// favicon
// ---------------------------------------------------------------------------

export const favicon: Check = {
  id: 'favicon', family: 'on-page', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const root = parsePage(res);
    let hasIcon = !!root.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    if (!hasIcon) {
      const fav = await ctx.fetch('/favicon.ico');
      hasIcon = fav?.status === 200;
    }
    const hasTouch = !!root.querySelector('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
    if (hasIcon && hasTouch) return makeResult(this, 'pass', 'favicon and apple-touch-icon present');
    if (hasIcon) {
      return makeResult(this, 'warn', 'favicon present but no apple-touch-icon',
        'Add <link rel="apple-touch-icon" href="...">.');
    }
    return makeResult(this, 'fail', 'no favicon or apple-touch-icon',
      'Add <link rel="icon" href="..."> (or serve /favicon.ico) and <link rel="apple-touch-icon" href="...">.');
  },
};

// ---------------------------------------------------------------------------
// content-readability (warn-only, homepage main text)
// ---------------------------------------------------------------------------

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g) ?? [];
  let count = groups.length;
  if (w.endsWith('e') && count > 1) count -= 1;
  return Math.max(count, 1);
}

function mainText(root: HTMLElement): string {
  for (const el of root.querySelectorAll('script, style, noscript, nav, header, footer, aside')) el.remove();
  return root.textContent.replace(/\s+/g, ' ').trim();
}

export const contentReadability: Check = {
  id: 'content-readability', family: 'on-page', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const text = mainText(parsePage(res));
    const words = text.match(/[A-Za-z']+/g) ?? [];
    if (words.length < 20) return makeResult(this, 'pass', 'not enough main text to assess readability');
    const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? [text]).filter((s) => s.trim().length > 0);
    const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
    const grade = 0.39 * (words.length / Math.max(sentences.length, 1)) + 11.8 * (syllables / words.length) - 15.59;
    if (grade <= 12) return makeResult(this, 'pass', `main content reads at approximately grade ${grade.toFixed(1)}`);
    return makeResult(this, 'warn', `dense/hard-to-read main content (grade ~${grade.toFixed(1)})`,
      'Break long sentences and paragraphs into shorter, simpler ones.');
  },
};

// ---------------------------------------------------------------------------
// figure-caption (warn-only, MP)
// ---------------------------------------------------------------------------

function isDecorativeImg(img: HTMLElement): boolean {
  const alt = img.getAttribute('alt');
  return alt !== undefined && alt.trim() === '';
}

export const figureCaption: Check = {
  id: 'figure-caption', family: 'on-page', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let captioned = 0;
    for (const p of pages) {
      const root = parsePage(p);
      for (const el of root.querySelectorAll('nav, header, footer, aside')) el.remove();
      for (const img of root.querySelectorAll('img')) {
        if (isDecorativeImg(img)) continue;
        total += 1;
        const figure = img.closest('figure');
        if (figure && figure.querySelector('figcaption')) captioned += 1;
      }
    }
    if (total === 0) return makeResult(this, 'skip', 'no explanatory content images on sampled pages');
    if (captioned === total) return makeResult(this, 'pass', `${captioned}/${total} content image(s) have a figure/figcaption`);
    return makeResult(this, 'warn', `${captioned}/${total} content image(s) wrapped in figure/figcaption`,
      'Wrap explanatory images in <figure> with a <figcaption>.');
  },
};
