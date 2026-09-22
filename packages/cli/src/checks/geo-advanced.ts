import type { HTMLElement } from 'node-html-parser';
import type { Check, CrawlContext, FetchedResource } from '../types.js';
import { makeResult, t } from '../types.js';
import { parsePage } from './dom.js';
import { pagesOf, pathOf } from './aggregate.js';
import { extractJsonLd, flatten, str, rollupBySeverity, type SeverityItem } from './jsonld.js';
import { mainContent, isQuestionHeading, isSelfSufficientStart, hasFactAnchor } from './content.js';
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
  id: 'freshness-coherence', family: 'llm-content', evidence: 'measured', maxPoints: 4,
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
      return makeResult(this, 'pass', t`freshness signals coherent (24h tolerance) on ${items.length} page(s)`);
    }
    return makeResult(this, roll.status, t`freshness signals diverge on: ${roll.detail}`,
      'Align HTTP Last-Modified, JSON-LD dateModified and sitemap <lastmod> on the real last-edit date, never in the future — divergent signals get your freshness ignored.');
  },
};

// ---------------------------------------------------------------------------
// QW2 hedging-rate — hedged leads (first 2 paragraphs). Warn max: heuristic.
// ---------------------------------------------------------------------------

const LEAD_PARAS = 2;
const HEDGE_OFFENDER_MIN = 2; // one hedge in a lead is tolerated

export const hedgingRate: Check = {
  id: 'hedging-rate', family: 'llm-content', evidence: 'heuristic', maxPoints: 3,
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
      return makeResult(this, 'pass', t`direct, hedge-free leads on ${scored.length} page(s)`);
    }
    return makeResult(this, 'warn', t`hedged (evasive) lead on: ${offenderList(offenders)}`,
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

// isSelfSufficientStart / hasFactAnchor now live in checks/content.ts: LOT 5's
// chunk-retrieval-sim applies the same two primitives at chunk scale.

/** true when a block reads as a liftable answer unit (spec QW3). */
export function isAnswerUnit(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < UNIT_MIN_WORDS || words > UNIT_MAX_WORDS) return false;
  return hasFactAnchor(text) && isSelfSufficientStart(text) && hedgeCount(text) === 0;
}

export const answerUnits: Check = {
  id: 'answer-units', family: 'llm-content', evidence: 'heuristic', maxPoints: 4,
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
      return makeResult(this, 'pass', t`${units} liftable answer unit(s) across ${pillars.length} pillar page(s)`);
    }
    return makeResult(this, 'warn', t`no liftable answer unit on: ${offenderList(offenders)}`,
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

// Question shape comes from the shared FR/EN helper in checks/content.ts (this
// module used to carry the only bilingual copy of the three).

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
  id: 'chunk-boundary', family: 'llm-content', evidence: 'heuristic', maxPoints: 3,
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
      return makeResult(this, 'pass', t`chunk-safe structure on ${scored.length} page(s)`);
    }
    return makeResult(this, 'warn', t`chunk-boundary hazards on: ${offenderList(offenders)}`,
      'Give long tables <thead>/<th> headers, keep FAQ answers directly under their question, and title every list — chunked retrieval loses distant context.');
  },
};

// ---------------------------------------------------------------------------
// A162 — « citabilité documentaire » (FR checklists 2026: caption on every
// table, a Sources section on pillar pages, dates that cannot be misread).
// Advisory heuristics like QW2-QW4: warn max, never fail.
// ---------------------------------------------------------------------------

const MIN_TABLE_ROWS = 3;

/** true when the table carries a name a chunk can keep: <caption>, aria-label(ledby) or a heading/figcaption right before it. */
function tableIsTitled(table: HTMLElement): boolean {
  if (table.querySelector('caption')?.textContent.trim()) return true;
  if (table.getAttribute('aria-label')?.trim()) return true;
  const labels = table.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
  if (labels.length > 0) {
    let root = table;
    while (root.parentNode) root = root.parentNode as HTMLElement;
    const elements = root.querySelectorAll('[id]');
    if (labels.every(id => elements.some(el => el.getAttribute('id') === id && el.textContent.trim()))) return true;
  }
  const prev = table.previousElementSibling;
  const tag = tagOf(prev);
  if (prev && (HEADING_TAGS.has(tag) || tag === 'FIGCAPTION')) return true;
  const parent = table.parentNode as HTMLElement | null;
  if (parent && tagOf(parent) === 'FIGURE' && parent.querySelector('figcaption')?.textContent.trim()) return true;
  return false;
}

/** Untitled tables (>= 3 rows) in the page's main content. */
function untitledTables(root: HTMLElement): number {
  let n = 0;
  for (const table of root.querySelectorAll('table')) {
    if (table.querySelectorAll('tr').length < MIN_TABLE_ROWS) continue;
    if (!tableIsTitled(table)) n += 1;
  }
  return n;
}

export const tableCaption: Check = {
  id: 'table-caption', family: 'llm-content', evidence: 'heuristic', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const withTables = pages
      .map((p) => ({ p, mc: mainContent(p) }))
      .filter((x) => x.mc.root.querySelectorAll('table').some((t) => t.querySelectorAll('tr').length >= MIN_TABLE_ROWS));
    if (withTables.length === 0) return makeResult(this, 'skip', 'no table with >=3 rows in the sampled main content');
    const offenders: string[] = [];
    for (const { p, mc } of withTables) {
      const n = untitledTables(mc.root);
      if (n > 0) offenders.push(`${pathOf(p)} (${n} untitled)`);
    }
    if (offenders.length === 0) return makeResult(this, 'pass', t`every table is titled on ${withTables.length} page(s)`);
    return makeResult(this, 'warn', t`tables without <caption> on: ${offenderList(offenders)}`,
      'Give every table a <caption> (or aria-label) naming what it compares — a chunked table row without its title is uncitable.');
  },
};

const SOURCES_HEADING = /^(sources?|r[ée]f[ée]rences?|bibliographie|bibliography|pour aller plus loin|further reading|notes et r[ée]f[ée]rences)\b/i;

/** true when a h2/h3 named « Sources »/« References » is followed, before the next heading, by at least one link to another host. */
function hasSourcesSection(root: HTMLElement, host: string): boolean {
  for (const h of root.querySelectorAll('h2, h3')) {
    if (!SOURCES_HEADING.test(h.textContent.replace(/\s+/g, ' ').trim())) continue;
    let el = h.nextElementSibling;
    while (el && !HEADING_TAGS.has(tagOf(el))) {
      for (const a of [...(tagOf(el) === 'A' && el.hasAttribute('href') ? [el] : []), ...el.querySelectorAll('a[href]')]) {
        try {
          const u = new URL(a.getAttribute('href') ?? '', 'https://' + host + '/');
          if (/^https?:$/.test(u.protocol) && u.hostname !== host) return true;
        } catch { /* unparsable href: not a source */ }
      }
      el = el.nextElementSibling;
    }
  }
  return false;
}

export const sourcesSection: Check = {
  id: 'sources-section', family: 'llm-content', evidence: 'heuristic', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const pillars = pages.map((p) => ({ p, mc: mainContent(p) })).filter((x) => x.mc.wordCount >= PILLAR_WORDS);
    if (pillars.length === 0) return makeResult(this, 'skip', 'no pillar pages (>=300 words) to evaluate');
    const host = ctx.baseUrl.hostname;
    const offenders = pillars.filter(({ mc }) => !hasSourcesSection(mc.root, host)).map(({ p }) => pathOf(p));
    if (offenders.length === 0) return makeResult(this, 'pass', t`a Sources section with outbound links on ${pillars.length} pillar page(s)`);
    return makeResult(this, 'warn', t`no Sources section on ${offenders.length}/${pillars.length} pillar page(s): ${offenderList(offenders)}`,
      'End each pillar page with a « Sources » / « References » heading followed by the outbound links that back its claims (claim → evidence → source).');
  },
};

/** dd/mm/yyyy, mm-dd-yy, dd.mm.yyyy… — a numeric date whose day and month can be swapped by a reader or a model. */
const NUMERIC_DATE = /(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d|[/.-]\d)/g;
const MONTH_NAME = /\b(janv(?:ier)?|f[ée]v(?:rier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

/** Count of numeric dd/mm/yyyy- or mm/dd/yyyy-style dates in a text (both fields ≤ 31, one of them a plausible month). */
export function ambiguousDateCount(text: string): number {
  let n = 0;
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const x = Number(m[1]); const y = Number(m[2]);
    if (x >= 1 && y >= 1 && x <= 31 && y <= 31 && (x <= 12 || y <= 12)) n += 1;
  }
  return n;
}

export const ambiguousDates: Check = {
  id: 'ambiguous-dates', family: 'llm-content', evidence: 'heuristic', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const scored = pages.map((p) => ({ p, mc: mainContent(p) })).filter((x) => x.mc.wordCount >= SUBSTANTIAL_WORDS);
    if (scored.length === 0) return makeResult(this, 'skip', 'no substantial pages (>=150 words) to evaluate');
    const offenders: string[] = [];
    for (const { p, mc } of scored) {
      const n = ambiguousDateCount(mc.text);
      // A page that also spells months out is telling the reader the convention; only all-numeric pages are ambiguous.
      if (n > 0 && !MONTH_NAME.test(mc.text)) offenders.push(`${pathOf(p)} (${n})`);
    }
    if (offenders.length === 0) return makeResult(this, 'pass', t`no ambiguous numeric-only dates on ${scored.length} page(s)`);
    return makeResult(this, 'warn', t`numeric-only dates (dd/mm/yyyy) on: ${offenderList(offenders)}`,
      'Write dates with the month in letters (« 28 février 2026 », "28 February 2026") and add <time datetime="2026-02-28"> — 02/03 reads as two different days in Paris and in Boston.');
  },
};
