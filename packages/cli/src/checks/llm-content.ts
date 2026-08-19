import { parse, type HTMLElement } from 'node-html-parser';
import type { Check, CrawlContext, FetchedResource } from '../types.js';
import { makeResult, isPlainText, t } from '../types.js';
import { parsePage, headOf } from './dom.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import { extractJsonLd, flatten, typesOf, str, rollupBySeverity, type SeverityItem } from './jsonld.js';
import { mainContent, isArticlePage, depthThreshold, shingles, jaccard, isQuestionHeading } from './content.js';

/** Truncate an offender path list to 3 entries + "(+N more)", matching the other MP checks. */
function offenderList(paths: string[]): string {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` (+${paths.length - 3} more)` : '');
}

// ---------------------------------------------------------------------------
// llms-txt (upgrade: richness — H1 + summary + ≥1 ## section + ≥5 links)
// ---------------------------------------------------------------------------

/** A link title is descriptive when it is a real label, not a stub like "Go" or "›" (spec §3.2). */
function isDescriptiveLinkTitle(title: string): boolean {
  const words = title.split(/\s+/).filter(Boolean).length;
  return title.length >= 10 || words >= 2;
}

/** Descriptive, absolute, same-origin markdown links `[Title](https://origin/…)` in an llms.txt body. */
function descriptiveSameOriginLinks(body: string, origin: string): number {
  let count = 0;
  for (const m of body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    const title = m[1].trim();
    let u: URL;
    try { u = new URL(m[2]); } catch { continue; }
    if (isDescriptiveLinkTitle(title) && u.origin === origin) count += 1;
  }
  return count;
}

/** A one-line summary / blockquote after the H1 (a non-heading, non-list prose line). */
function hasSummaryLine(body: string): boolean {
  const lines = body.split(/\r?\n/);
  const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1Idx < 0) return false;
  return lines.slice(h1Idx + 1).some((l) => {
    const t = l.trim();
    if (!t || /^#/.test(t) || /^[-*]\s/.test(t)) return false;
    return t.replace(/^>\s*/, '').length >= 10;
  });
}

export const llmsTxt: Check = {
  // Signal of UNPROVEN value, and scored as such. Large studies find no measurable
  // citation gain, adoption is ~3%, and Google states it has no ranking impact — so the
  // verdict rests on our judgement, not on a spec: `heuristic`, warn at worst, and a
  // weight that cannot sink a family. It used to be 10 points and `measured`, which made
  // the heaviest check in the tool enforce a convention our own guide calls unproven.
  id: 'llms-txt', family: 'llm-content', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/llms.txt');
    if (res?.status !== 200) {
      return makeResult(this, 'warn', 'llms.txt missing',
        'Add a /llms.txt file: an H1 title, a one-line summary, then "## Section" blocks of descriptive links.');
    }
    if (!isPlainText(res)) {
      return makeResult(this, 'warn', t`llms.txt served with content-type "${res.contentType}" (SPA fallback?)`,
        'Serve /llms.txt as text/plain, not an HTML fallback page.');
    }
    const body = res.body;
    if (!/^#\s+\S/m.test(body)) {
      return makeResult(this, 'warn', 'llms.txt found but has no markdown H1 title',
        'Start llms.txt with "# Site Name" followed by a short description.');
    }
    const hasSection = /^##\s+\S/m.test(body);
    const hasSummary = hasSummaryLine(body);
    const links = descriptiveSameOriginLinks(body, ctx.baseUrl.origin);
    if (hasSection && hasSummary && links >= 5) {
      return makeResult(this, 'pass', t`llms.txt structured (summary + section + ${links} descriptive links)`);
    }
    const missing: string[] = [];
    if (!hasSummary) missing.push('summary line');
    if (!hasSection) missing.push('## section');
    if (links < 5) missing.push(`${links}/5 descriptive same-origin links`);
    return makeResult(this, 'warn', t`llms.txt thin (${missing.join(', ')})`,
      'Structure llms.txt: "# Site", a one-line summary, then "## Section" blocks of "- [Title](https://abs-url): note" (≥5 links).');
  },
};

// ---------------------------------------------------------------------------
// llms-full-txt (upgrade: substance — ≥~2000 words + multiple headings)
// ---------------------------------------------------------------------------

export const llmsFullTxt: Check = {
  id: 'llms-full-txt', family: 'llm-content', evidence: 'heuristic', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/llms-full.txt');
    if (res?.status !== 200) {
      return makeResult(this, 'warn', 'llms-full.txt missing',
        'Add a /llms-full.txt containing the full text content of your key pages, under headings.');
    }
    if (!isPlainText(res)) {
      return makeResult(this, 'warn', t`llms-full.txt served with content-type "${res.contentType}" (SPA fallback?)`,
        'Serve /llms-full.txt as text/plain, not an HTML fallback page.');
    }
    const words = (res.body.match(/\S+/g) ?? []).length;
    const headings = (res.body.match(/^#{1,6}\s+\S/gm) ?? []).length;
    if (words >= 2000 && headings >= 2) {
      return makeResult(this, 'pass', t`llms-full.txt has ${words} words under ${headings} headings`);
    }
    return makeResult(this, 'warn', t`llms-full.txt is thin (${words} words, ${headings} heading(s))`,
      'Concatenate the full text of your key pages under headings at build time (aim for a rich, multi-section file).');
  },
};

// ---------------------------------------------------------------------------
// content-without-js (upgrade to MP: static visible text per sampled page)
// ---------------------------------------------------------------------------

export const contentWithoutJs: Check = {
  id: 'content-without-js', family: 'llm-content', evidence: 'measured', maxPoints: 6,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const offenders: string[] = [];
    for (const p of pages) {
      const root = parse(p.body);
      root.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
      const text = root.textContent.replace(/\s+/g, ' ').trim();
      if (text.length < 200) offenders.push(pathOf(p));
    }
    if (offenders.length === 0) {
      return makeResult(this, 'pass', t`static text ≥200 chars on ${pages.length} sampled page(s)`);
    }
    const agg = aggregate(pages.length, offenders);
    return makeResult(this, agg.status, t`static text too thin on: ${agg.detail}`,
      'Server-render (SSR/SSG) your main content: AI crawlers do not execute JavaScript.');
  },
};

// ---------------------------------------------------------------------------
// content-depth (MP: main-content word count by page type)
// ---------------------------------------------------------------------------

export const contentDepth: Check = {
  id: 'content-depth', family: 'llm-content', evidence: 'heuristic', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const offenders: string[] = [];
    for (const p of pages) {
      if (mainContent(p).wordCount < depthThreshold(p)) offenders.push(pathOf(p));
    }
    if (offenders.length === 0) {
      return makeResult(this, 'pass', t`main content above the word threshold on ${pages.length} page(s)`);
    }
    const agg = aggregate(pages.length, offenders);
    return makeResult(this, agg.status, t`thin content on: ${agg.detail}`,
      'Expand or consolidate thin pages with substantive copy (≥300 words for articles, ≥150 for other pages).');
  },
};

// ---------------------------------------------------------------------------
// content-lead-answer (MP: concise direct-answer lead after the H1)
// ---------------------------------------------------------------------------

const LEAD_MIN = 40;
const LEAD_MAX = 320;
const LONG_PAGE_WORDS = 150;

/** true when a heading/strong near the top marks a TL;DR / key-takeaways block. */
function hasTldrBlock(root: HTMLElement): boolean {
  for (const el of root.querySelectorAll('h2, h3, h4, strong, b')) {
    if (/\b(tl;?dr|key takeaways?|in summary|in short|at a glance)\b/i.test(el.textContent)) return true;
  }
  return false;
}

function leadVerdict(res: FetchedResource): SeverityItem['status'] {
  const mc = mainContent(res);
  const paras = mc.root.querySelectorAll('p')
    .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const isAnswer = (t: string) => t.length >= LEAD_MIN && t.length <= LEAD_MAX;
  if (hasTldrBlock(mc.root)) return 'pass';
  if (paras.slice(0, 2).some(isAnswer)) return 'pass';            // concise answer up top
  if (paras.some(isAnswer)) return 'warn';                        // present but buried
  if (paras[0] && paras[0].length > LEAD_MAX) return 'warn';      // opens with a wall of text
  return mc.wordCount >= LONG_PAGE_WORDS ? 'fail' : 'warn';       // long page opening with fluff/nav
}

export const contentLeadAnswer: Check = {
  id: 'content-lead-answer', family: 'llm-content', evidence: 'heuristic', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const items: SeverityItem[] = pages.map((p) => ({ path: pathOf(p), status: leadVerdict(p) }));
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') return makeResult(this, 'pass', t`direct-answer lead on ${pages.length} page(s)`);
    return makeResult(this, roll.status, t`no direct-answer lead on: ${roll.detail}`,
      'Open each page with a 1–2 sentence direct answer/definition (≈40–320 chars) or a TL;DR block right after the H1.');
  },
};

// ---------------------------------------------------------------------------
// answer-headings (MP: question-style H2/H3 on long content pages)
// ---------------------------------------------------------------------------

// Beyond a plain question, these listicle/comparison openers also read as an
// answer-shaped subhead. The interrogative set itself lives in content.ts.
const ANSWER_HEAD_EXTRA_RE = /^(best|top|vs\.?|meilleurs?|meilleures?)\b/i;
const ANSWER_HEAD_WORDS = 300;

function isAnswerHeading(text: string): boolean {
  return isQuestionHeading(text) || ANSWER_HEAD_EXTRA_RE.test(text.trim());
}

export const answerHeadings: Check = {
  id: 'answer-headings', family: 'llm-content', evidence: 'heuristic', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const offenders: string[] = [];
    let longPages = 0;
    for (const p of pages) {
      const mc = mainContent(p);
      if (mc.wordCount < ANSWER_HEAD_WORDS) continue; // short pages skipped
      longPages += 1;
      const heads = mc.root.querySelectorAll('h2, h3').map((h) => h.textContent);
      if (!heads.some(isAnswerHeading)) offenders.push(pathOf(p));
    }
    if (longPages === 0) return makeResult(this, 'skip', 'no long content pages to evaluate');
    if (offenders.length === 0) {
      return makeResult(this, 'pass', t`question-style subheadings on ${longPages} long page(s)`);
    }
    return makeResult(this, 'warn', t`no question-style subheadings on: ${offenderList(offenders)}`,
      'Phrase subheads as the questions readers ask (start with what/how/why/… or end with "?").');
  },
};

// ---------------------------------------------------------------------------
// extractable-structure (MP: lists / data tables in main content)
// ---------------------------------------------------------------------------

const SUBSTANTIAL_WORDS = 150;
const LONG_PROSE_WORDS = 400;

function hasContentStructure(root: HTMLElement): boolean {
  if (root.querySelector('ul, ol')) return true;
  for (const table of root.querySelectorAll('table')) {
    if (table.querySelector('th')) return true;
  }
  return false;
}

export const extractableStructure: Check = {
  id: 'extractable-structure', family: 'llm-content', evidence: 'heuristic', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    // Cannot judge what could not be fetched: skip, never fail.
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const items: SeverityItem[] = [];
    for (const p of pages) {
      const mc = mainContent(p);
      if (mc.wordCount < SUBSTANTIAL_WORDS) continue;
      if (hasContentStructure(mc.root)) {
        items.push({ path: pathOf(p), status: 'pass' });
      } else {
        // Warn at worst: "this page would read better as a list" is our bar, not a spec,
        // and the guard-rails forbid a heuristic from failing an audit. The page length
        // stays in the reason so the signal is not lost.
        const reason = mc.wordCount >= LONG_PROSE_WORDS ? 'no list/table, long page' : 'no list/table';
        items.push({ path: pathOf(p), status: 'warn', reason });
      }
    }
    if (items.length === 0) return makeResult(this, 'skip', 'no substantial pages to evaluate');
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') {
      return makeResult(this, 'pass', t`lists/tables in main content on ${items.length} substantial page(s)`);
    }
    return makeResult(this, roll.status, t`no lists/tables in main content on: ${roll.detail}`,
      'Break comparisons/steps/specs into <ul>/<ol> bullets or a data <table> with <th> headers.');
  },
};

// ---------------------------------------------------------------------------
// content-freshness (MP: machine-readable, reasonably recent dates)
// ---------------------------------------------------------------------------

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v.trim());
  return Number.isNaN(t) ? null : new Date(t);
}

interface PageDates { all: Date[]; published: Date | null; modified: Date | null; }

function extractDates(res: FetchedResource): PageDates {
  const root = parsePage(res);
  const timeDates: Date[] = [];
  for (const el of root.querySelectorAll('time[datetime]')) {
    const d = parseDate(el.getAttribute('datetime'));
    if (d) timeDates.push(d);
  }
  let published = parseDate(root.querySelector('meta[property="article:published_time"]')?.getAttribute('content'));
  let modified = parseDate(root.querySelector('meta[property="article:modified_time"]')?.getAttribute('content'));
  for (const n of flatten(extractJsonLd(res.body))) {
    published = published ?? parseDate(str(n.datePublished));
    modified = modified ?? parseDate(str(n.dateModified));
  }
  const articleDates: Date[] = [];
  if (published) articleDates.push(published);
  if (modified) articleDates.push(modified);
  // Prefer the article's own dates (JSON-LD datePublished/dateModified or article:*_time meta).
  // Only fall back to arbitrary <time datetime> elements when no article-specific date exists,
  // so an unrelated recent <time> (e.g. a comment-widget timestamp) can't mask a stale article.
  const all = articleDates.length > 0 ? articleDates : timeDates;
  return { all, published, modified };
}

const MONTH_MS = (1000 * 60 * 60 * 24 * 365.25) / 12;

export const contentFreshness: Check = {
  id: 'content-freshness', family: 'llm-content', evidence: 'measured', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const articlePages = pages.filter(isArticlePage);
    if (articlePages.length === 0) return makeResult(this, 'skip', 'no article-type pages to date');
    const now = Date.now();
    const items: SeverityItem[] = articlePages.map((p) => {
      const path = pathOf(p);
      const dates = extractDates(p);
      if (dates.all.length === 0) return { path, status: 'fail', reason: 'no date' };
      const ageMonths = (now - Math.max(...dates.all.map((d) => d.getTime()))) / MONTH_MS;
      if (ageMonths > 24) return { path, status: 'fail', reason: 'older than 24 months' };
      if (ageMonths > 12) return { path, status: 'warn', reason: '12–24 months old' };
      if (!(dates.published && dates.modified)) return { path, status: 'warn', reason: 'only one of published/modified' };
      return { path, status: 'pass' };
    });
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') return makeResult(this, 'pass', t`fresh, dated content on ${articlePages.length} article page(s)`);
    return makeResult(this, roll.status, t`missing/stale content date on: ${roll.detail}`,
      'Emit ISO-8601 datePublished + dateModified (and a visible date) on article pages; keep them real and recent.');
  },
};

// ---------------------------------------------------------------------------
// content-author-eeat (MP: named Person author + visible byline on articles)
// ---------------------------------------------------------------------------

function hasStructuredAuthor(res: FetchedResource): boolean {
  for (const n of flatten(extractJsonLd(res.body))) {
    const authors = Array.isArray(n.author) ? n.author : n.author ? [n.author] : [];
    for (const a of authors) {
      if (a && typeof a === 'object') {
        const types = typesOf(a as Record<string, unknown>);
        if (str((a as Record<string, unknown>).name) && (types.length === 0 || types.includes('Person'))) return true;
      }
    }
  }
  return false;
}

function hasVisibleByline(res: FetchedResource): boolean {
  const root = parsePage(res);
  if (root.querySelector('[rel="author"], [itemprop="author"], .author, .byline, .author-name')) return true;
  // Prose fallback: require "By Firstname Lastname" — TWO capitalized name tokens — so
  // sentence openers like "By Friday, …" or "By Design, …" (a single word) don't false-positive.
  return /\b[Bb]y\s+[A-Z][\p{L}'-]+\s+[A-Z][\p{L}'-]+/u.test(mainContent(res).text);
}

export const contentAuthorEeat: Check = {
  id: 'content-author-eeat', family: 'llm-content', evidence: 'measured', maxPoints: 5,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const articlePages = pages.filter(isArticlePage);
    if (articlePages.length === 0) return makeResult(this, 'skip', 'no article-type pages to attribute');
    const items: SeverityItem[] = articlePages.map((p) => {
      const path = pathOf(p);
      const structured = hasStructuredAuthor(p);
      const visible = hasVisibleByline(p);
      if (structured && visible) return { path, status: 'pass' };
      if (structured || visible) return { path, status: 'warn', reason: structured ? 'no visible byline' : 'no structured author' };
      return { path, status: 'fail', reason: 'no author' };
    });
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') return makeResult(this, 'pass', t`named author + byline on ${articlePages.length} article page(s)`);
    return makeResult(this, roll.status, t`no author (E-E-A-T) on: ${roll.detail}`,
      'Add a visible byline linking a bio plus JSON-LD author {@type:Person, name, url, jobTitle}.');
  },
};

// ---------------------------------------------------------------------------
// outbound-citations (MP: external citation links from main content)
// ---------------------------------------------------------------------------

const SOCIAL_RE = /(^|\.)(facebook|twitter|x|instagram|linkedin|youtube|youtu\.be|tiktok|pinterest|reddit|t\.me|threads\.net|mastodon\.[a-z]+|fb\.com|bsky\.app|discord\.(gg|com)|whatsapp\.com|twitch\.tv)\b/i;

function citationDomains(root: HTMLElement, origin: string): Set<string> {
  const out = new Set<string>();
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    let u: URL;
    try { u = new URL(href, origin); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (u.origin === origin) continue;              // self
    if (SOCIAL_RE.test(u.hostname)) continue;       // social platform, not a citation
    out.add(u.hostname.replace(/^www\./, ''));
  }
  return out;
}

export const outboundCitations: Check = {
  id: 'outbound-citations', family: 'llm-content', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const items: SeverityItem[] = [];
    for (const p of pages) {
      const mc = mainContent(p);
      if (mc.wordCount < SUBSTANTIAL_WORDS) continue;
      if (citationDomains(mc.root, ctx.baseUrl.origin).size >= 1) {
        items.push({ path: pathOf(p), status: 'pass' });
      } else {
        // Warn at worst, same reason as extractable-structure: a heuristic advises.
        const reason = mc.wordCount >= LONG_PROSE_WORDS ? 'no citation, long page' : 'no citation';
        items.push({ path: pathOf(p), status: 'warn', reason });
      }
    }
    if (items.length === 0) return makeResult(this, 'skip', 'no substantial pages to evaluate');
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') return makeResult(this, 'pass', t`outbound citations on ${items.length} substantial page(s)`);
    return makeResult(this, roll.status, t`no outbound citations on: ${roll.detail}`,
      'Cite primary/authoritative sources with real outbound links in your main content.');
  },
};

// ---------------------------------------------------------------------------
// content-uniqueness (MP: near-duplicate bodies via shingle/Jaccard)
// ---------------------------------------------------------------------------

const DUPLICATE_JACCARD = 0.8;

export const contentUniqueness: Check = {
  id: 'content-uniqueness', family: 'llm-content', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length < 2) return makeResult(this, 'skip', 'fewer than 2 sampled pages');
    const sigs = pages.map((p) => ({ path: pathOf(p), sh: shingles(mainContent(p).text) }));
    const pairs: string[][] = [];
    for (let i = 0; i < sigs.length; i += 1) {
      for (let j = i + 1; j < sigs.length; j += 1) {
        if (jaccard(sigs[i].sh, sigs[j].sh) >= DUPLICATE_JACCARD) pairs.push([sigs[i].path, sigs[j].path]);
      }
    }
    if (pairs.length === 0) return makeResult(this, 'pass', t`no near-duplicate bodies across ${pages.length} pages`);
    const offenders = [...new Set(pairs.flat())];
    const status = pairs.length >= 2 ? 'fail' : 'warn';
    return makeResult(this, status, t`near-duplicate content: ${offenderList(offenders)}`,
      'Give each URL unique content, or canonicalize duplicates to one URL.');
  },
};

// ---------------------------------------------------------------------------
// csr-content-parity (#19: mount roots that stay empty until client-side JS
// runs — "what GPTBot actually sees" when it does not execute JavaScript).
// Complements (does not replace) content-without-js.
// ---------------------------------------------------------------------------

/** SPA "mount root" elements: the DOM hook a client-side framework renders into. */
const MOUNT_ROOT_SELECTOR = '#root, #__next, div#app, section#app, main#app, app-root, [data-reactroot], [ng-version]';

/** A mount root counts as populated once it holds one of these, not just loose whitespace/text. */
const CONTENT_BEARING_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, table, article, section, img, form, blockquote';

const MOUNT_ROOT_EMPTY_CHARS = 50;
const THIN_PAGE_TEXT_CHARS = 200;

/**
 * Vue's `data-server-rendered="true"` is a hard proof that this exact node was produced
 * by the SSR renderer — unlike `[data-reactroot]` (React sets it whether or not the root
 * actually holds server-rendered content), so it is trusted regardless of measured text.
 * The other framework hydration/state blobs (script#__NEXT_DATA__, window.__NUXT__,
 * __INITIAL_STATE__, __APOLLO_STATE__, #___gatsby) ship on CSR-only shells just as often
 * as on genuine SSR/SSG output, so — per spec — their mere presence is deliberately NOT
 * checked here: only actual rendered text/children (or this one attribute) count.
 */
function isConfirmedServerRendered(el: HTMLElement): boolean {
  return (el.getAttribute('data-server-rendered') ?? '').trim().toLowerCase() === 'true';
}

/** true when a candidate mount root has no confirmed-SSR marker, thin inner text, and no content-bearing children. */
function isEmptyMountRoot(el: HTMLElement): boolean {
  if (isConfirmedServerRendered(el)) return false;
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  if (text.length >= MOUNT_ROOT_EMPTY_CHARS) return false;
  return !el.querySelector(CONTENT_BEARING_SELECTOR);
}

/**
 * Offender = an empty mount root AND thin server-rendered text page-wide (script/style/
 * noscript stripped, same measurement as content-without-js). Substantial text anywhere
 * on the page — inside or outside the mount root — means SSR/SSG was done right and the
 * page must NOT be penalized just for also carrying SPA framework markup.
 */
function isCsrOffender(res: FetchedResource): boolean {
  const root = parsePage(res);
  if (!root.querySelectorAll(MOUNT_ROOT_SELECTOR).some(isEmptyMountRoot)) return false;
  root.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
  const text = root.textContent.replace(/\s+/g, ' ').trim();
  return text.length < THIN_PAGE_TEXT_CHARS;
}

export const csrContentParity: Check = {
  id: 'csr-content-parity', family: 'llm-content', evidence: 'measured', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const offenders = pages.filter(isCsrOffender).map(pathOf);
    if (offenders.length === 0) {
      return makeResult(this, 'pass', t`server-rendered main content on ${pages.length} sampled page(s), no empty CSR mount roots`);
    }
    const agg = aggregate(pages.length, offenders);
    return makeResult(this, agg.status, t`CSR-only content (empty mount root, no server-rendered text) on: ${agg.detail}`,
      'Server-render (SSR/SSG) the initial HTML for #root/#__next/#app and similar mount points: AI crawlers do not execute JavaScript, so an empty mount root is invisible to them.');
  },
};

// ---------------------------------------------------------------------------
// about-contact (MP: reachable About + Contact + a contact method)
// ---------------------------------------------------------------------------

// Bilingual on purpose. An English-only pattern reported every French site as having no
// About page — and did so as `measured`, i.e. as a fact rather than a guess. That is the
// fourth time a single-language regex silently mis-read half the web on this project.
const ABOUT_RE = /^\/(about(-us)?|a-propos|à-propos|qui-sommes-nous|notre-histoire)(\/|\.[a-z]+)?$/i;
const CONTACT_RE = /^\/(contact(-us)?|nous-contacter|contactez-nous)(\/|\.[a-z]+)?$/i;

function linkPaths(res: FetchedResource): string[] {
  const out: string[] = [];
  for (const a of parsePage(res).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    try { out.push(new URL(href, res.finalUrl).pathname); } catch { /* skip */ }
  }
  return out;
}

function hasContactMethod(res: FetchedResource): boolean {
  if (parsePage(res).querySelector('a[href^="tel:"], a[href^="mailto:"]')) return true;
  for (const n of flatten(extractJsonLd(res.body))) {
    if (typesOf(n).includes('ContactPoint') || n.contactPoint) return true;
    if (str(n.telephone) || str(n.email)) return true;
  }
  return false;
}

async function anyReachable(ctx: CrawlContext, paths: string[]): Promise<boolean> {
  for (const p of paths) {
    const r = await ctx.fetch(p);
    if (r?.status === 200) return true;
  }
  return false;
}

export const aboutContact: Check = {
  id: 'about-contact', family: 'llm-content', evidence: 'measured', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const paths = pages.flatMap((p) => [pathOf(p), ...linkPaths(p)]);
    let hasAbout = paths.some((p) => ABOUT_RE.test(p));
    let hasContactPage = paths.some((p) => CONTACT_RE.test(p));
    if (!hasAbout) hasAbout = await anyReachable(ctx, ['/about', '/about-us', '/about.html', '/a-propos', '/a-propos/']);
    if (!hasContactPage) hasContactPage = await anyReachable(ctx, ['/contact', '/contact-us', '/contact.html']);
    const contactMethod = pages.some(hasContactMethod);

    // Spec §3.2: three independent signals are required to pass — an About page,
    // a reachable Contact page, AND an exposed contact method. A contact method
    // alone must NOT substitute for a real Contact page in the pass gate.
    if (hasAbout && hasContactPage && contactMethod) {
      return makeResult(this, 'pass', 'About and Contact reachable with a contact method');
    }
    if (!hasAbout && !hasContactPage && !contactMethod) {
      return makeResult(this, 'fail', 'About/Contact pages not found',
        'Publish linked /about and /contact pages and expose a contact method (tel/email/ContactPoint).');
    }
    const missing: string[] = [];
    if (!hasAbout) missing.push('About page');
    if (!hasContactPage) missing.push('Contact page');
    if (!contactMethod) missing.push('contact method');
    return makeResult(this, 'warn', t`About/Contact incomplete (missing: ${missing.join(', ')})`,
      'Publish linked /about and /contact pages; add a ContactPoint (tel/email) to your Organization JSON-LD.');
  },
};

/**
 * LOT 3 §B — /.well-known/ai.json discovery manifest (emerging convention).
 * Advisory check: the convention is not yet standardized, so absence is a
 * `warn`, never a `fail`. A 200 answer must be a JSON *object* — SPA fallbacks
 * that return the HTML app shell with a 200 are the common false positive.
 */
export const wellKnownAiJson: Check = {
  id: 'well-known-ai-json', family: 'llm-content', evidence: 'measured', maxPoints: 1,
  async run(ctx) {
    const res = await ctx.fetch('/.well-known/ai.json');
    if (!res || res.status !== 200) {
      return makeResult(this, 'warn', 'no /.well-known/ai.json manifest (emerging AI-discovery convention)',
        'Publish a small JSON object at /.well-known/ai.json (name, description, contact, policies) so AI agents can discover how to interact with the site.');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(res.body); } catch { parsed = undefined; }
    if (parsed === undefined) {
      return makeResult(this, 'warn', '/.well-known/ai.json answers 200 but is not valid JSON (SPA fallback shell?)',
        'Serve real JSON at /.well-known/ai.json (or return 404) instead of the HTML app shell.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return makeResult(this, 'warn', '/.well-known/ai.json is valid JSON but not an object',
        'The manifest root must be a JSON object describing the site (name, description, contact).');
    }
    return makeResult(this, 'pass', '/.well-known/ai.json serves a JSON object manifest');
  },
};

/** Common feed paths tried when no <link rel="alternate"> is declared in <head>. */
const FEED_FALLBACK_PATHS = ['/feed', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed.json'];

/** MIME types that mark a <link rel="alternate"> as a syndication feed. */
const FEED_LINK_TYPE_RE = /rss\+xml|atom\+xml|feed\+json/i;

/** true when a response's content-type is a plausible feed format (XML feed or JSON feed). */
function looksLikeFeed(res: FetchedResource): boolean {
  const ct = res.contentType.split(';')[0].trim().toLowerCase();
  if (ct.includes('rss') || ct.includes('atom') || ct === 'application/feed+json') return true;
  if (ct === 'application/xml' || ct === 'text/xml') return /<rss[\s>]|<feed[\s>]/i.test(res.body);
  if (ct === 'application/json') { try { const j = JSON.parse(res.body); return typeof j === 'object' && j !== null && 'items' in j; } catch { return false; } }
  return false;
}

/**
 * Backlog A56 — presence of an up-to-date RSS/Atom/JSON feed. AI crawlers lean
 * on feeds as a cheap freshness signal (new/changed content) distinct from a
 * sitemap (which lists URLs, not change history). Advisory: no feed spec is
 * mandatory, so absence is a `warn`, never a `fail` — same posture as
 * `well-known-ai-json`.
 */
export const contentFeed: Check = {
  id: 'content-feed', family: 'llm-content', evidence: 'measured', maxPoints: 2,
  async run(ctx: CrawlContext) {
    const home = await ctx.fetch('/');
    const declared: string[] = [];
    if (home?.status === 200 && !isPlainText(home)) {
      const head = headOf(parsePage(home));
      for (const link of head?.querySelectorAll('link[rel="alternate"]') ?? []) {
        const type = link.getAttribute('type') ?? '';
        const href = link.getAttribute('href');
        if (href && FEED_LINK_TYPE_RE.test(type)) declared.push(href);
      }
    }
    const candidates = declared.length > 0 ? declared : FEED_FALLBACK_PATHS;
    for (const candidate of candidates) {
      let pathAndQuery = candidate;
      try {
        const u = new URL(candidate, ctx.baseUrl);
        if (u.origin !== ctx.baseUrl.origin) continue;
        pathAndQuery = u.pathname + u.search;
      } catch { continue; }
      const res = await ctx.fetch(pathAndQuery);
      if (res && res.status === 200 && looksLikeFeed(res)) {
        return makeResult(this, 'pass', t`feed found at ${pathAndQuery} (RSS/Atom/JSON Feed)`);
      }
    }
    return makeResult(this, 'warn', 'no RSS/Atom/JSON feed found',
      'Publish a feed (RSS, Atom, or JSON Feed) listing recent content, and declare it with <link rel="alternate" type="application/rss+xml" href="..."> in <head> — it gives AI crawlers a cheap, reliable freshness signal.');
  },
};
