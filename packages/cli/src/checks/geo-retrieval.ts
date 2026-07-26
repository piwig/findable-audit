import type { HTMLElement } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult } from '../types.js';
import { parsePage } from './dom.js';
import { pagesOf, pathOf } from './aggregate.js';
import { rollupBySeverity, type SeverityItem } from './jsonld.js';
import { mainContent, opensWithoutBackreference, hasFactAnchor } from './content.js';
import { chunkContent, leadBlock, type Chunk } from './chunker.js';

// ---------------------------------------------------------------------------
// LOT 5 — shared chunker (spec 2026-07-26-lot5-chunker.md):
//   chunk-retrieval-sim (retrieval)  — would each retrieved window stand alone?
//   injection-hygiene   (generation) — is the text an engine ingests clean?
// chunk-retrieval-sim is an advisory heuristic: warn max, never fail.
// ---------------------------------------------------------------------------

const PILLAR_WORDS = 300;
const CHUNK_TOKENS = 512;
const SURVIVAL_RATIO = 0.7;

function offenderList(entries: string[]): string {
  return entries.slice(0, 3).join(', ') + (entries.length > 3 ? ` (+${entries.length - 3} more)` : '');
}

// ---------------------------------------------------------------------------
// chunk-retrieval-sim
// ---------------------------------------------------------------------------

/**
 * A chunk survives isolated extraction when it can be read on its own: it carries a
 * topic anchor (counting its heading trail, which retrievers prepend) and does not
 * open on a reference whose antecedent stayed behind in the previous window.
 *
 * Uses `opensWithoutBackreference`, not `answer-units`' stricter
 * `isSelfSufficientStart`: a window only has to be readable, not quotable, so
 * demanding an uppercase first letter would fail every lowercase brand name.
 */
export function chunkSurvives(chunk: Chunk): boolean {
  const lead = leadBlock(chunk);
  if (!lead) return false;
  const anchorScope = [...chunk.headings, lead].join(' ');
  return hasFactAnchor(anchorScope) && opensWithoutBackreference(lead);
}

export const chunkRetrievalSim: Check = {
  id: 'chunk-retrieval-sim', family: 'llm-content', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const pillars = pages.map((p) => ({ p, mc: mainContent(p) })).filter((x) => x.mc.wordCount >= PILLAR_WORDS);
    if (pillars.length === 0) return makeResult(this, 'skip', 'no pillar pages (>=300 words) to chunk');
    let total = 0;
    let survivors = 0;
    const offenders: Array<{ path: string; ratio: number }> = [];
    for (const { p, mc } of pillars) {
      const chunks = chunkContent(mc.root, { targetTokens: CHUNK_TOKENS });
      if (chunks.length === 0) continue;
      const ok = chunks.filter(chunkSurvives).length;
      total += chunks.length;
      survivors += ok;
      const ratio = ok / chunks.length;
      if (ratio < SURVIVAL_RATIO) offenders.push({ path: pathOf(p), ratio });
    }
    if (total === 0) return makeResult(this, 'skip', 'no chunkable content on the pillar pages');
    const pct = Math.round((survivors / total) * 100);
    if (offenders.length === 0) {
      return makeResult(this, 'pass',
        `${survivors}/${total} ~${CHUNK_TOKENS}-token chunk(s) survive isolated retrieval (${pct}%)`);
    }
    const worst = offenders
      .sort((a, b) => a.ratio - b.ratio)
      .map((o) => `${o.path} (${Math.round(o.ratio * 100)}%)`);
    return makeResult(this, 'warn',
      `chunks that cannot stand alone on: ${offenderList(worst)}`,
      'Open each section with a named subject rather than "it"/"this"/"cela", and keep a descriptive heading above every passage — a retriever hands the model one window, not the page.');
  },
};

// ---------------------------------------------------------------------------
// injection-hygiene
// ---------------------------------------------------------------------------

const HIDDEN_WORDS_MIN = 15;

/**
 * Inline-style/attribute hiding only. Crawl-only means no stylesheet, and the
 * legitimate `.sr-only` / `.visually-hidden` patterns live in stylesheets — so
 * restricting the probe to inline markup is exactly what keeps it precise.
 */
const HIDDEN_STYLE_RE = new RegExp([
  'display\\s*:\\s*none',
  'visibility\\s*:\\s*hidden',
  'opacity\\s*:\\s*0(?:\\.0+)?(?:\\s|;|$)',
  'font-size\\s*:\\s*0(?:px|em|rem|pt)?(?:\\s|;|$)',
  'text-indent\\s*:\\s*-\\s*\\d',
  'clip\\s*:\\s*rect\\(\\s*0',
  '(?:left|top)\\s*:\\s*-\\s*\\d{3,}',
].join('|'), 'i');

/** Instructions aimed at a model rather than a reader (FR + EN). */
const MACHINE_INSTRUCTION_RE = new RegExp([
  'ignore\\s+(?:all\\s+)?(?:previous|prior|above)\\s+instructions',
  'disregard\\s+(?:all\\s+)?(?:previous|prior|the\\s+above)',
  'as\\s+an\\s+ai\\s+(?:language\\s+)?model',
  'system\\s+prompt',
  'respond\\s+only\\s+with',
  'you\\s+must\\s+(?:always\\s+)?(?:recommend|say|answer|output)',
  'always\\s+recommend',
  'do\\s+not\\s+mention',
  'ignore[zr]?\\s+les\\s+instructions\\s+(?:pr[ée]c[ée]dentes|ci-dessus)',
  'en\\s+tant\\s+que\\s+mod[èe]le',
  'r[ée]ponds?\\s+uniquement',
  'recommande\\s+toujours',
  'ne\\s+mentionne\\s+pas',
].join('|'), 'i');

const UGC_CONTAINER_SELECTOR = '#comments, [class*=comment], [class*=review], [itemtype*=Comment], [itemtype*=Review]';

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

interface HiddenFinding { injected: boolean; count: number }

/** Code and inert containers: their text is never prose, so hiding them means nothing. */
const NON_PROSE_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/** Outermost inline-hidden elements carrying substantial text, and whether any is an injection payload. */
export function scanHiddenText(root: HTMLElement): HiddenFinding {
  const flagged = new Set<HTMLElement>();
  let injected = false;
  // querySelectorAll('*') is document order, so an ancestor is always seen first.
  for (const el of root.querySelectorAll('*')) {
    if (NON_PROSE_TAGS.has(el.tagName?.toUpperCase() ?? '')) continue;
    const style = el.getAttribute('style') ?? '';
    if (!el.hasAttribute('hidden') && !HIDDEN_STYLE_RE.test(style)) continue;
    // Nested hiding is one payload, not two.
    let nested = false;
    for (let a = el.parentNode as HTMLElement | null; a; a = a.parentNode as HTMLElement | null) {
      if (flagged.has(a)) { nested = true; break; }
    }
    if (nested) continue;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (wordCount(text) < HIDDEN_WORDS_MIN) continue;
    flagged.add(el);
    if (MACHINE_INSTRUCTION_RE.test(text)) injected = true;
  }
  return { injected, count: flagged.size };
}

/** Outbound links inside a comment/review container that claim neither rel=ugc nor rel=nofollow. */
export function unattributedUgcLinks(root: HTMLElement, origin: string): number {
  let count = 0;
  for (const container of root.querySelectorAll(UGC_CONTAINER_SELECTOR)) {
    for (const a of container.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') ?? '';
      let u: URL;
      try { u = new URL(href, origin); } catch { continue; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (u.origin === origin) continue;
      const rel = (a.getAttribute('rel') ?? '').toLowerCase();
      if (/\b(ugc|nofollow|sponsored)\b/.test(rel)) continue;
      count += 1;
    }
  }
  return count;
}

export const injectionHygiene: Check = {
  id: 'injection-hygiene', family: 'llm-content', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const items: SeverityItem[] = [];
    for (const p of pages) {
      const root = parsePage(p);
      const hidden = scanHiddenText(root);
      const ugc = unattributedUgcLinks(root, ctx.baseUrl.origin);
      const path = pathOf(p);
      if (hidden.injected) {
        items.push({ path, status: 'fail', reason: 'hidden text carrying model instructions' });
      } else if (hidden.count > 0) {
        items.push({ path, status: 'warn', reason: `${hidden.count} hidden text block(s)` });
      } else if (ugc > 0) {
        items.push({ path, status: 'warn', reason: `${ugc} UGC link(s) without rel="ugc"` });
      } else {
        items.push({ path, status: 'pass' });
      }
    }
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') {
      return makeResult(this, 'pass', `no hidden text or unattributed UGC across ${pages.length} page(s)`);
    }
    return makeResult(this, roll.status, `ingestion hygiene issues on: ${roll.detail}`,
      'Remove inline-hidden copy (an assistant reads it even when a visitor cannot), and mark user-contributed links rel="ugc".');
  },
};
