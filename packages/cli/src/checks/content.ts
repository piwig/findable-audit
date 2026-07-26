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
// Question-shaped headings (shared by answer-headings, sd-faq, chunk-boundary)
// ---------------------------------------------------------------------------

const QUESTION_OPENERS_EN = 'what|how|why|when|where|who|whose|which|can|could|should|will|would|does|do|did|is|are|was|were';
const QUESTION_OPENERS_FR = "quels?|quelles?|comment|pourquoi|quand|où|qui|combien|est-ce|qu['’]est-ce|peut-on|faut-il|doit-on";
/**
 * The boundary is a Unicode-aware negative lookahead, not `\b`: JavaScript's `\w`
 * is ASCII-only, so `où\b` never matched "Où trouver…" while still (correctly)
 * refusing to match "how" inside "however".
 */
const QUESTION_HEAD_RE = new RegExp(`^(?:${QUESTION_OPENERS_EN}|${QUESTION_OPENERS_FR})(?![\\p{L}\\p{N}])`, 'iu');

/**
 * true when a heading reads as a question — it ends with "?" or opens with a
 * French or English interrogative.
 *
 * Single source of truth on purpose: `answer-headings`, `sd-faq` and
 * `chunk-boundary` each carried their own copy, two of them English-only, so
 * French pages could never satisfy a question-heading check no matter how they
 * were written (found by auditing our own /fr/ landing, 2026-07-26).
 */
export function isQuestionHeading(text: string): boolean {
  const t = text.trim();
  return t.endsWith('?') || QUESTION_HEAD_RE.test(t);
}

// ---------------------------------------------------------------------------
// Passage primitives (shared by answer-units and chunk-retrieval-sim)
// ---------------------------------------------------------------------------

const ANAPHORIC_OPENERS = new Set([
  'it', 'this', 'that', 'these', 'those', 'they', 'he', 'she', 'such',
  'il', 'ils', 'elle', 'elles', 'cela', 'ceci', "c'est", 'ce', 'cette', 'ces', 'celui', 'celle', 'ceux',
  'however', 'moreover', 'therefore', 'also', 'cependant', 'toutefois', 'donc', 'ainsi',
]);
const CONNECTOR_PREFIXES = ['de plus', 'en outre', 'par ailleurs'];

/**
 * true when a passage does not open by pointing back at what came before it — no
 * anaphoric pronoun/demonstrative, no discourse connector.
 *
 * Deliberately case-blind: a *block* boundary already guarantees we are at the start
 * of a paragraph, and requiring an uppercase first letter would punish the many brands
 * that are lowercase by design (npm, iPhone, findable-audit…). That is the right test
 * for a retrieval window, which only has to be readable on its own.
 */
export function opensWithoutBackreference(text: string): boolean {
  const norm = text.toLowerCase().replace(/’/g, "'");
  const first = (norm.match(/^[\p{L}\p{N}'-]+/u) ?? [''])[0];
  if (ANAPHORIC_OPENERS.has(first)) return false;
  return !CONNECTOR_PREFIXES.some((c) => norm.startsWith(`${c} `));
}

/**
 * true when a passage can open on its own AND reads as a polished standalone
 * sentence: `opensWithoutBackreference` plus an uppercase-letter/digit start. The
 * extra bar is what an *answer unit* needs — a fragment an engine quotes verbatim —
 * and is stricter than what a retrieval window needs.
 */
export function isSelfSufficientStart(text: string): boolean {
  return /^[\p{Lu}\p{N}]/u.test(text) && opensWithoutBackreference(text);
}

/** A digit sequence, or an entity proxy: a capitalized token that does not open a sentence. */
export function hasFactAnchor(text: string): boolean {
  if (/\d/.test(text)) return true;
  const tokens = text.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    if (/^[\p{Lu}]/u.test(tokens[i]) && !/[.!?:]$/.test(tokens[i - 1])) return true;
  }
  return false;
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
