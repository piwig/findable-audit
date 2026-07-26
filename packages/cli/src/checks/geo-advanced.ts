import type { HTMLElement } from 'node-html-parser';
import type { Check, CrawlContext, FetchedResource } from '../types.js';
import { makeResult } from '../types.js';
import { parsePage } from './dom.js';
import { pagesOf, pathOf } from './aggregate.js';
import { extractJsonLd, flatten, str, rollupBySeverity, type SeverityItem } from './jsonld.js';
import { mainContent } from './content.js';
import { discoverSitemap, parseSitemapEntries } from './sitemap.js';
import { canonicalIdentity } from './canonical.js';

// ---------------------------------------------------------------------------
// Section « GEO avancé » quick wins (spec 2026-07-25-geo-avance.md):
//   QW1 freshness-coherence  (retrieval)  — tripartite freshness signal coherence
//   QW2 hedging-rate         (selection)  — evasive leads lose the citation
//   QW3 answer-units         (selection)  — liftable, self-sufficient passages
//   QW4 chunk-boundary       (generation) — chunk-splitting DOM hygiene
// QW2/QW3/QW4 are advisory heuristics: warn max, never fail (verified research:
// stylistic effects vary by domain — sell probability of citation, not guarantees).
// ---------------------------------------------------------------------------

/** Truncate an offender list to 3 entries + "(+N more)", matching the other MP checks. */
function offenderList(paths: string[]): string {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` (+${paths.length - 3} more)` : '');
}

const SUBSTANTIAL_WORDS = 150;
const PILLAR_WORDS = 300;
const DAY_MS = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Shared FR/EN hedge lexicon (QW2 + QW3). Matched on a normalized token stream
// (lowercased, curly→straight apostrophe, non-letter/digit runs collapsed to one
// space) so accented starts like « éventuellement » match without \b pitfalls.
// ---------------------------------------------------------------------------

const HEDGE_PHRASES = [
  // EN
  'maybe', 'perhaps', 'possibly', 'arguably', 'probably', 'presumably', 'seemingly', 'apparently',
  'it seems', 'it appears', 'some say', 'might be', 'may be', 'could be', 'in some cases',
  // FR
  'peut-être', 'il semble', 'il semblerait', 'il paraît', 'sans doute', 'probablement',
  'apparemment', 'éventuellement', 'en principe', 'a priori', 'selon les cas',
  'dans certains cas', 'cela dépend',
];

/** Number of hedge-lexicon matches in `text` (word-boundary, case/apostrophe-insensitive). */
export function hedgeCount(text: string): number {
  const padded = ` ${text.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}'-]+/gu, ' ').trim()} `;
  let count = 0;
  for (const phrase of HEDGE_PHRASES) count += padded.split(` ${phrase} `).length - 1;
  return count;
}

/** Trimmed, whitespace-collapsed text of the page's <p> elements (document order). */
function paragraphTexts(root: HTMLElement): string[] {
  return root.querySelectorAll('p')
    .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// QW1 freshness-coherence — Last-Modified vs dateModified vs sitemap lastmod.
// Direction-aware: a deploy touching mtimes makes Last-Modified newer than the
// claimed dates, which is benign. Only *claimed* freshness ahead of reality
// (future dates, claims newer than the served representation, claims that
// contradict each other) burns the signal.
// ---------------------------------------------------------------------------

function parseDateMs(v: string | undefined): number | null {
  if (!v || !v.trim()) return null;
  const t = Date.parse(v.trim());
  return Number.isNaN(t) ? null : t;
}

/** Claimed on-page modified date: article:modified_time meta, else first JSON-LD dateModified. */
function claimedModifiedMs(res: FetchedResource): number | null {
  const meta = parsePage(res).querySelector('meta[property="article:modified_time"]')?.getAttribute('content');
  const fromMeta = parseDateMs(meta ?? undefined);
  if (fromMeta !== null) return fromMeta;
  for (const n of flatten(extractJsonLd(res.body))) {
    const d = parseDateMs(str(n.dateModified) || undefined);
    if (d !== null) return d;
  }
  return null;
}

/** canonicalIdentity(loc) → lastmod ms for the top-level urlset (no index recursion). */
async function sitemapLastmods(ctx: CrawlContext): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const found = await discoverSitemap(ctx);
  if (!found) return map;
  for (const e of parseSitemapEntries(found.res.body)) {
    const ms = parseDateMs(e.lastmod);
    if (ms === null) continue;
    try { map.set(canonicalIdentity(new URL(e.loc, ctx.baseUrl).toString()), ms); } catch { /* invalid loc ignored */ }
  }
  return map;
}

export const freshnessCoherence: Check = {
  id: 'freshness-coherence', family: 'llm-content', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const lastmods = await sitemapLastmods(ctx);
    const now = Date.now();
    const items: SeverityItem[] = [];
    for (const p of pages) {
      const s1 = parseDateMs(p.headers['last-modified']); // served representation
      const s2 = claimedModifiedMs(p);                    // claimed on-page
      const s3 = lastmods.get(canonicalIdentity(p.finalUrl)) ?? null; // claimed in sitemap
      if ([s1, s2, s3].filter((s) => s !== null).length < 2) continue;
      const path = pathOf(p);
      if (s2 !== null && s2 > now + DAY_MS) {
        items.push({ path, status: 'fail', reason: 'dateModified in the future' });
      } else if (s3 !== null && s3 > now + DAY_MS) {
        items.push({ path, status: 'fail', reason: 'sitemap lastmod in the future' });
      } else if (s2 !== null && s3 !== null && Math.abs(s2 - s3) > DAY_MS) {
        items.push({ path, status: 'warn', reason: 'dateModified vs sitemap lastmod diverge' });
      } else if (s1 !== null && s2 !== null && s2 - s1 > DAY_MS) {
        items.push({ path, status: 'warn', reason: 'dateModified newer than Last-Modified' });
      } else if (s1 !== null && s3 !== null && s3 - s1 > DAY_MS) {
        items.push({ path, status: 'warn', reason: 'sitemap lastmod newer than Last-Modified' });
      } else {
        items.push({ path, status: 'pass' });
      }
    }
    if (items.length === 0) {
      return makeResult(this, 'skip', 'fewer than 2 freshness sources per page (Last-Modified header, dateModified, sitemap lastmod)');
    }
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') {
      return makeResult(this, 'pass', `freshness signals coherent (24h tolerance) on ${items.length} page(s)`);
    }
    return makeResult(this, roll.status, `freshness signals diverge on: ${roll.detail}`,
      'Align HTTP Last-Modified, JSON-LD dateModified and sitemap <lastmod> on the real last-edit date, never in the future — divergent signals get your freshness ignored.');
  },
};

// ---------------------------------------------------------------------------
// QW2 hedging-rate — hedged leads (first 2 paragraphs). Warn max: heuristic.
// ---------------------------------------------------------------------------

const LEAD_PARAS = 2;
const HEDGE_OFFENDER_MIN = 2; // one hedge in a lead is tolerated

export const hedgingRate: Check = {
  id: 'hedging-rate', family: 'llm-content', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const scored = pages.map((p) => ({ p, mc: mainContent(p) })).filter((x) => x.mc.wordCount >= SUBSTANTIAL_WORDS);
    if (scored.length === 0) return makeResult(this, 'skip', 'no substantial pages (>=150 words) to evaluate');
    const offenders: string[] = [];
    for (const { p, mc } of scored) {
      const lead = paragraphTexts(mc.root).slice(0, LEAD_PARAS).join(' ');
      const n = hedgeCount(lead);
      if (n >= HEDGE_OFFENDER_MIN) offenders.push(`${pathOf(p)} (${n} hedges)`);
    }
    if (offenders.length === 0) {
      return makeResult(this, 'pass', `direct, hedge-free leads on ${scored.length} page(s)`);
    }
    return makeResult(this, 'warn', `hedged (evasive) lead on: ${offenderList(offenders)}`,
      'Open with one crisp, committed claim and move hedged nuance (maybe / it seems / peut-être / il semble) below the lead — engines quote confident statements.');
  },
};

// ---------------------------------------------------------------------------
// QW3 answer-units — liftable passages on pillar pages. Warn max: heuristic.
// An answer unit is a <p>/<li> of 8–40 words that carries a fact anchor (digit
// or mid-sentence capitalized entity), opens self-sufficiently (no anaphora or
// connector) and hedges nothing.
// ---------------------------------------------------------------------------

const UNIT_MIN_WORDS = 8;
const UNIT_MAX_WORDS = 40;

const ANAPHORIC_OPENERS = new Set([
  'it', 'this', 'that', 'these', 'those', 'they', 'he', 'she', 'such',
  'il', 'ils', 'elle', 'elles', 'cela', 'ceci', "c'est", 'ce', 'cette', 'ces', 'celui', 'celle', 'ceux',
  'however', 'moreover', 'therefore', 'also', 'cependant', 'toutefois', 'donc', 'ainsi',
]);
const CONNECTOR_PREFIXES = ['de plus', 'en outre', 'par ailleurs'];

/** Starts with an uppercase letter/digit and not with an anaphoric opener or connector. */
function isSelfSufficientStart(text: string): boolean {
  if (!/^[\p{Lu}\p{N}]/u.test(text)) return false;
  const norm = text.toLowerCase().replace(/’/g, "'");
  const first = (norm.match(/^[\p{L}\p{N}'-]+/u) ?? [''])[0];
  if (ANAPHORIC_OPENERS.has(first)) return false;
  return !CONNECTOR_PREFIXES.some((c) => norm.startsWith(`${c} `));
}

/** A digit sequence, or an entity proxy: a capitalized token not opening a sentence. */
function hasFactAnchor(text: string): boolean {
  if (/\d/.test(text)) return true;
  const tokens = text.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    if (/^[\p{Lu}]/u.test(tokens[i]) && !/[.!?:]$/.test(tokens[i - 1])) return true;
  }
  return false;
}

/** true when a block reads as a liftable answer unit (spec QW3). */
export function isAnswerUnit(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < UNIT_MIN_WORDS || words > UNIT_MAX_WORDS) return false;
  return hasFactAnchor(text) && isSelfSufficientStart(text) && hedgeCount(text) === 0;
}

export const answerUnits: Check = {
  id: 'answer-units', family: 'llm-content', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const pillars = pages.map((p) => ({ p, mc: mainContent(p) })).filter((x) => x.mc.wordCount >= PILLAR_WORDS);
    if (pillars.length === 0) return makeResult(this, 'skip', 'no pillar pages (>=300 words) to evaluate');
    const offenders: string[] = [];
    let units = 0;
    for (const { p, mc } of pillars) {
      const blocks = mc.root.querySelectorAll('p, li').map((el) => el.textContent.replace(/\s+/g, ' ').trim());
      const n = blocks.filter(isAnswerUnit).length;
      units += n;
      if (n === 0) offenders.push(pathOf(p));
    }
    if (offenders.length === 0) {
      return makeResult(this, 'pass', `${units} liftable answer unit(s) across ${pillars.length} pillar page(s)`);
    }
    return makeResult(this, 'warn', `no liftable answer unit on: ${offenderList(offenders)}`,
      'Add short, self-contained statements (8-40 words) carrying a number, date or named entity — passages an engine can quote verbatim.');
  },
};

// ---------------------------------------------------------------------------
// QW4 chunk-boundary — DOM hygiene at chunk boundaries. Warn max: heuristic.
// ---------------------------------------------------------------------------

const LONG_TABLE_ROWS = 10;
const ORPHAN_LIST_ITEMS = 3;

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const TEXT_BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'DL']);
const DECORATIVE_TAGS = new Set(['IMG', 'HR', 'FIGURE', 'PICTURE', 'SVG', 'VIDEO', 'IFRAME']);

const QUESTION_HEAD_RE = /^(what|how|why|when|where|who|which|can|does|do|is|are|should|quels?|quelles?|comment|pourquoi|quand|où|qui|combien|est-ce)\b/i;

function isQuestionHeading(text: string): boolean {
  const t = text.trim();
  return t.endsWith('?') || QUESTION_HEAD_RE.test(t);
}

function tagOf(el: HTMLElement | null): string {
  return (el?.tagName ?? '').toUpperCase();
}

/** A >10-row table with no <th>/<thead>: rows chunked mid-table lose all column meaning. */
function hasHeaderlessLongTable(root: HTMLElement): boolean {
  for (const table of root.querySelectorAll('table')) {
    if (table.querySelectorAll('tr').length > LONG_TABLE_ROWS && !table.querySelector('th, thead')) return true;
  }
  return false;
}

/** A question heading separated from its first text block by decorative/empty nodes. */
function hasDetachedFaqAnswer(root: HTMLElement): boolean {
  for (const h of root.querySelectorAll('h2, h3, h4')) {
    if (!isQuestionHeading(h.textContent)) continue;
    let decorative = 0;
    let el = h.nextElementSibling;
    while (el) {
      const tag = tagOf(el);
      if (HEADING_TAGS.has(tag)) break;
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (TEXT_BLOCK_TAGS.has(tag) && text) {
        if (decorative > 0) return true;
        break;
      }
      if (DECORATIVE_TAGS.has(tag) || !text) decorative += 1;
      el = el.nextElementSibling;
    }
  }
  return false;
}

/** true when the list sits inside another list (nested lists are never orphans). */
function isNestedList(list: HTMLElement, root: HTMLElement): boolean {
  let p = list.parentNode as HTMLElement | null;
  while (p && p !== root) {
    const tag = tagOf(p);
    if (tag === 'LI' || tag === 'UL' || tag === 'OL') return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

/** A 3+-item top-level list whose nearest preceding element is not a heading/<p>/<figcaption>. */
function hasOrphanedList(root: HTMLElement): boolean {
  for (const list of root.querySelectorAll('ul, ol')) {
    if (isNestedList(list, root)) continue;
    if (list.querySelectorAll('li').length < ORPHAN_LIST_ITEMS) continue;
    let el: HTMLElement | null = list;
    let context = el.previousElementSibling;
    while (!context && el.parentNode && el.parentNode !== root) {
      el = el.parentNode as HTMLElement;
      context = el.previousElementSibling;
    }
    const tag = tagOf(context);
    if (!context || !(HEADING_TAGS.has(tag) || tag === 'P' || tag === 'FIGCAPTION')) return true;
  }
  return false;
}

export const chunkBoundary: Check = {
  id: 'chunk-boundary', family: 'llm-content', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const scored = pages.map((p) => ({ p, mc: mainContent(p) })).filter((x) => x.mc.wordCount >= SUBSTANTIAL_WORDS);
    if (scored.length === 0) return makeResult(this, 'skip', 'no substantial pages (>=150 words) to evaluate');
    const offenders: string[] = [];
    for (const { p, mc } of scored) {
      const reasons: string[] = [];
      if (hasHeaderlessLongTable(mc.root)) reasons.push('headerless table');
      if (hasDetachedFaqAnswer(mc.root)) reasons.push('detached FAQ answer');
      if (hasOrphanedList(mc.root)) reasons.push('orphaned list');
      if (reasons.length > 0) offenders.push(`${pathOf(p)} (${reasons.join(', ')})`);
    }
    if (offenders.length === 0) {
      return makeResult(this, 'pass', `chunk-safe structure on ${scored.length} page(s)`);
    }
    return makeResult(this, 'warn', `chunk-boundary hazards on: ${offenderList(offenders)}`,
      'Give long tables <thead>/<th> headers, keep FAQ answers directly under their question, and title every list — chunked retrieval loses distant context.');
  },
};
