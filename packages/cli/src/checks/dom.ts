import { parse, type HTMLElement } from 'node-html-parser';
import type { FetchedResource } from '../types.js';

/** Parse a fetched resource's body into a fresh DOM tree. Safe to mutate (each call is a new tree). */
export function parsePage(res: FetchedResource): HTMLElement {
  return parse(res.body);
}

/** The <head> element of a parsed page, or null if absent. */
export function headOf(root: HTMLElement): HTMLElement | null {
  return root.querySelector('head');
}

export interface Heading {
  level: number; // 1-6
  text: string;
}

/** h1..h6 in document order, with their level and trimmed text. */
export function headingOutline(root: HTMLElement): Heading[] {
  const out: Heading[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    out.push({ level: Number(el.tagName.slice(1)), text: el.textContent.trim() });
  }
  return out;
}

/**
 * true when the outline skips a heading level while descending (e.g. H2 -> H4,
 * skipping H3). Levels can go back UP freely (closing a section); only a
 * forward jump of more than one level is a violation.
 */
export function hasHeadingSkip(outline: Heading[]): boolean {
  let prev = 0;
  for (const h of outline) {
    if (prev > 0 && h.level > prev + 1) return true;
    prev = h.level;
  }
  return false;
}

/** Minimal English stopword list for title/H1 token-overlap comparisons. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'as', 'your', 'you', 'we', 'our', 'us', 'i', 'my', 'me', 'their', 'they', 'them', 'all', 'about',
  'into', 'over', 'up', 'out', 'no', 'not', 'so', 'if', 'than', 'then', 'here', 'there', 'when',
]);

/** Lowercased, punctuation-stripped, stopword-filtered word tokens (length > 1). */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Exact-phrase generic anchor texts (spec §3.5 anchor-text). */
export const GENERIC_ANCHOR_TEXTS = new Set(['click here', 'read more', 'here', 'more', 'link']);

/** true when anchor text is a known generic phrase or a bare URL, not a descriptive label. */
export function isGenericAnchorText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (GENERIC_ANCHOR_TEXTS.has(t)) return true;
  if (/^(https?:\/\/|www\.)/i.test(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Accessibility helpers (spec §3.7) — shared by the accessibility family.
// BCP-47 is shared with hreflang's validator (technical-seo hreflang-x-default).
// ---------------------------------------------------------------------------

/** BCP-47 language-tag shape (spec §3.7 html-lang): primary subtag + optional subtags. */
const BCP47_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/**
 * true when `code` is a well-formed BCP-47 language tag (e.g. "en", "en-US", "zh-Hant").
 * BCP-47 is case-insensitive, so "EN-US" is valid — lower-case before matching.
 */
export function isValidBcp47(code: string): boolean {
  return BCP47_RE.test(code.trim().toLowerCase());
}

export interface Landmarks {
  /** A single primary content landmark: <main>/<article> or role=main/article. */
  hasMain: boolean;
  /** Which of the surrounding landmark regions (header/nav/footer, native or ARIA) are present. */
  regions: Set<'header' | 'nav' | 'footer'>;
}

/** Detect semantic landmarks on a page (spec §3.7 landmarks). */
export function detectLandmarks(root: HTMLElement): Landmarks {
  const regions = new Set<'header' | 'nav' | 'footer'>();
  if (root.querySelector('header, [role="banner"]')) regions.add('header');
  if (root.querySelector('nav, [role="navigation"]')) regions.add('nav');
  if (root.querySelector('footer, [role="contentinfo"]')) regions.add('footer');
  const hasMain = !!root.querySelector('main, [role="main"], article, [role="article"]');
  return { hasMain, regions };
}

/**
 * The accessible name of a link: visible text, then aria-label / aria-labelledby /
 * title, then a child image's alt (spec §3.7 link-text). Empty string = nameless.
 */
export function accessibleLinkName(a: HTMLElement): string {
  const text = a.textContent.trim();
  if (text) return text;
  for (const attr of ['aria-label', 'aria-labelledby', 'title']) {
    const v = (a.getAttribute(attr) ?? '').trim();
    if (v) return v;
  }
  for (const img of a.querySelectorAll('img')) {
    const alt = (img.getAttribute('alt') ?? '').trim();
    if (alt) return alt;
  }
  return '';
}

/**
 * true when a form control has an accessible name (spec §3.7 form-labels):
 * aria-label / aria-labelledby / title, a wrapping <label>, or a `label[for]`
 * matching its id (pass the page's set of `label[for]` values).
 */
export function formControlHasName(el: HTMLElement, labelForIds: Set<string>): boolean {
  for (const attr of ['aria-label', 'aria-labelledby', 'title']) {
    if ((el.getAttribute(attr) ?? '').trim()) return true;
  }
  const id = el.getAttribute('id');
  if (id && labelForIds.has(id)) return true;
  return el.closest('label') !== null;
}

// ---------------------------------------------------------------------------
// Performance helpers (spec §3.6) — shared by the performance family.
// ---------------------------------------------------------------------------

export interface HeadResources {
  /** External <script src> in <head> lacking async/defer/type=module. */
  blockingScripts: number;
  /** External <link rel=stylesheet> in <head> not deferred via a non-screen media query. */
  blockingStylesheets: number;
  /** Total UTF-8 byte size of inline <style> and inline (no-src) <script> content in <head>. */
  inlineBytes: number;
}

/** Classifies <head> render-blocking resources and inline volume (spec §3.6). Shared by
 *  render-blocking-js, render-blocking-css and inline-head-volume so head parsing lives in one place. */
export function classifyHeadResources(root: HTMLElement): HeadResources {
  const head = headOf(root);
  if (!head) return { blockingScripts: 0, blockingStylesheets: 0, inlineBytes: 0 };

  let blockingScripts = 0;
  for (const s of head.querySelectorAll('script[src]')) {
    const type = (s.getAttribute('type') ?? '').trim().toLowerCase();
    if (!s.hasAttribute('async') && !s.hasAttribute('defer') && type !== 'module') blockingScripts += 1;
  }

  let blockingStylesheets = 0;
  for (const l of head.querySelectorAll('link[rel="stylesheet"]')) {
    const media = (l.getAttribute('media') ?? '').trim().toLowerCase();
    const deferredByMedia = media !== '' && media !== 'all' && media !== 'screen';
    if (!deferredByMedia) blockingStylesheets += 1;
  }

  let inlineBytes = 0;
  for (const el of head.querySelectorAll('style, script:not([src])')) {
    inlineBytes += Buffer.byteLength(el.textContent ?? '', 'utf8');
  }

  return { blockingScripts, blockingStylesheets, inlineBytes };
}
