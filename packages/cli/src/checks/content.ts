import type { HTMLElement } from 'node-html-parser';
import type { FetchedResource } from '../types.js';
import { parsePage } from './dom.js';
import { pathOf } from './aggregate.js';
import { extractJsonLd, flatten, typesOf } from './jsonld.js';

// ---------------------------------------------------------------------------
// Main-content extractor (shared by depth / lead / uniqueness / outbound / …)
// ---------------------------------------------------------------------------

/** Chrome to strip so only the readable article/body content remains. */
const CHROME_SELECTOR = 'script, style, noscript, nav, header, footer, aside';

export interface MainContent {
  /** The scoped, chrome-stripped element (a fresh tree; safe to query/mutate). */
  root: HTMLElement;
  /** Block-separated, whitespace-collapsed visible text. */
  text: string;
  /** Word count of `text`. */
  wordCount: number;
}

/**
 * The main readable content of a page: prefers `<main>`/`<article>` when present,
 * otherwise the `<body>` with nav/header/footer/aside/script/style/noscript removed.
 * Uses `structuredText` so adjacent block elements are separated (correct word counts).
 */
export function mainContent(res: FetchedResource): MainContent {
  const doc = parsePage(res);
  const scope = doc.querySelector('main') ?? doc.querySelector('article') ?? doc.querySelector('body') ?? doc;
  for (const el of scope.querySelectorAll(CHROME_SELECTOR)) el.remove();
  const text = scope.structuredText.replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(' ').length : 0;
  return { root: scope, text, wordCount };
}

// ---------------------------------------------------------------------------
// Page-type classification (spec §3.2 / §7)
// ---------------------------------------------------------------------------

/** schema.org types that mark a page as an article/blog post. */
export const ARTICLE_TYPES = new Set([
  'Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'ScholarlyArticle',
  'Report', 'LiveBlogPosting', 'ReportageNewsArticle', 'OpinionNewsArticle', 'AdvertiserContentArticle',
]);

const ARTICLE_URL_RE = /\/(blog|news|article|articles|posts?|stories)(\/|$|\.)/i;

/** true when a page is an Article/Blog page (by JSON-LD @type or a blog/news URL pattern). */
export function isArticlePage(res: FetchedResource): boolean {
  const nodes = flatten(extractJsonLd(res.body));
  if (nodes.some((n) => typesOf(n).some((t) => ARTICLE_TYPES.has(t)))) return true;
  return ARTICLE_URL_RE.test(pathOf(res));
}

/** Main-content word threshold by page type: Article/Blog → 300, other content → 150 (spec §3.2). */
export function depthThreshold(res: FetchedResource): number {
  return isArticlePage(res) ? 300 : 150;
}

// ---------------------------------------------------------------------------
// Shingle-hash near-duplicate detection (content-uniqueness)
// ---------------------------------------------------------------------------

/** Set of word k-shingles for near-duplicate comparison (k=5 by default). */
export function shingles(text: string, k = 5): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const set = new Set<string>();
  if (words.length < k) {
    if (words.length > 0) set.add(words.join(' '));
    return set;
  }
  for (let i = 0; i + k <= words.length; i++) set.add(words.slice(i, i + k).join(' '));
  return set;
}

/** Jaccard similarity of two shingle sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const s of small) if (large.has(s)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
