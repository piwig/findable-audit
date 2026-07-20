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
