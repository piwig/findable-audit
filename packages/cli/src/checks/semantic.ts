import type { Check, FetchedResource } from '../types.js';
import { makeResult, t } from '../types.js';
import { parsePage, tokenize } from './dom.js';
import { pagesOf, pathOf } from './aggregate.js';
import { mainContent, shingles, jaccard } from './content.js';
import { splitTitleSegments } from './on-page.js';

// ---------------------------------------------------------------------------
// Semantic cluster (backlog §13 "Sémantique"):
//   topical-focus          (#30) — does the body deliver on the title's promise?
//   keyword-cannibalization (#31) — do two distinct pages promise the same thing?
//
// Both rest on bars we chose (a coverage ratio, a similarity threshold), so both are
// `heuristic` and, per CLAUDE.md § honesty guard-rails, warn at most — never fail.
// Neither fetches anything: they read the pages the crawl already sampled.
// ---------------------------------------------------------------------------

// --- thresholds -------------------------------------------------------------

/**
 * A page is judged on topic when this share of its declared-topic weight appears in
 * the prose. Calibrated on measured pages, not on a round number: hand-written pages
 * that are plainly on subject land between 50 % and 92 % (test/fixtures/perfect-site
 * scores 68/69/92, our own bilingual site 50 to 75, its floor being a short contact
 * page), while a body about another subject entirely falls under 20 %. The bar sits
 * nearer the noise floor than the real-page floor on purpose — a heuristic that
 * warns should be one a reader trusts.
 */
const FOCUS_MIN = 0.35;
/** Weight of a token the page put in its <title> or <h1> — the promise proper. */
const CORE_WEIGHT = 2;
/** Weight of a token only the meta description carries — supporting, not headline, evidence. */
const SUPPORT_WEIGHT = 1;
/** Below this many <title>+<h1> tokens the ratio is noise (one miss would swing it). */
const MIN_CORE_TOKENS = 3;
/** Prose (headings removed) short of this cannot fairly be asked to echo a whole title. */
const PROSE_WORDS = 100;
/** Two title/H1 signatures this similar are competing for one intent. */
const TWIN_JACCARD = 0.6;
/** Same bar as content-uniqueness: above it the pages are near-duplicates, not twins. */
const DUPLICATE_BODY_JACCARD = 0.8;
/** A title/H1 signature smaller than this makes Jaccard swing between 0 and 1 on one word. */
const MIN_SIGNATURE_TOKENS = 3;
/** The frequency rule needs a real sample before "most titles say it" means anything. */
const FREQUENCY_RULE_MIN_PAGES = 4;
/** Share of sampled titles a token must appear in to count as site-wide boilerplate. */
const BOILERPLATE_SHARE = 0.8;

// --- text primitives --------------------------------------------------------

/**
 * French function words, diacritic-folded like the tokens they filter. `tokenize`'s
 * stopword list is English-only, and every one of these survives its `length > 1`
 * filter, so an unfiltered French title would count "de", "les" and "pour" as topic.
 *
 * Deliberately narrow: only words that are function words in French AND carry no
 * meaning in English. "car" and "son" are French function words too, but they are
 * ordinary English nouns — dropping them would blind the check on car dealerships.
 */
const STOPWORDS_FR = new Set([
  'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'et', 'ou', 'en', 'au', 'aux',
  'dans', 'sur', 'sous', 'pour', 'par', 'avec', 'sans', 'chez', 'vers', 'entre',
  'ce', 'cet', 'cette', 'ces', 'cela', 'ceci', 'qui', 'que', 'quoi', 'dont',
  'est', 'sont', 'etre', 'ete', 'ont', 'ainsi', 'alors', 'donc', 'apres', 'avant',
  'aussi', 'mais', 'quand', 'lors', 'chaque', 'autre', 'autres', 'comme', 'meme',
  'tres', 'plus', 'tout', 'tous', 'toute', 'toutes', 'ne', 'pas', 'ni', 'si', 'se',
  'il', 'elle', 'ils', 'elles', 'nous', 'vous', 'nos', 'notre', 'votre', 'vos',
  'leur', 'leurs', 'mon', 'ma', 'mes', 'sa', 'ses',
]);

/**
 * Text with its diacritics removed. `tokenize`'s word pattern is ASCII (`[a-z0-9]+`),
 * so without this "réparation" is read as "paration" and "vélos" as "los". Folding
 * both sides of every comparison keeps French words whole instead of comparing
 * mutilated stems, and is a no-op on English.
 */
export function foldDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Meaningful lower-case tokens of a text, French included (see foldDiacritics). */
export function topicTokens(text: string): string[] {
  return tokenize(foldDiacritics(text)).filter((w) => !STOPWORDS_FR.has(w));
}

/**
 * Tokens that say nothing about a single page's subject: the brand.
 *
 * Two rules, both derived from the sample rather than from a guess about one title:
 *
 * 1. **A repeated trailing segment.** `title-pattern` already defines the brand as the
 *    segment after the separator in "Primary topic — Brand"; what makes it a brand
 *    rather than a subtitle is that *other pages end with it too*. Stripping the last
 *    segment of a lone title deletes real subject matter — "About us — our story since
 *    1998" would lose "story".
 * 2. **A token in almost every title** (needs >= 4 sampled titles). This catches the
 *    brand-first sites the separator convention misses ("Example Bakery | Sourdough").
 *
 * Erring towards keeping a token is the safe direction: an un-stripped brand word
 * inflates topical-focus's coverage (a page mentions its own brand) and drags
 * cannibalization's similarity *up* by the same amount on every pair, which the
 * >= 3-token signature floor and the 0.6 bar already absorb.
 */
export function boilerplateTitleTokens(titles: string[]): Set<string> {
  const out = new Set<string>();

  const suffixCount = new Map<string, number>();
  for (const title of titles) {
    const segments = splitTitleSegments(title);
    if (segments.length < 2) continue;
    const last = segments[segments.length - 1].toLowerCase();
    suffixCount.set(last, (suffixCount.get(last) ?? 0) + 1);
  }
  for (const [segment, n] of suffixCount) {
    if (n >= 2) for (const token of topicTokens(segment)) out.add(token);
  }

  if (titles.length >= FREQUENCY_RULE_MIN_PAGES) {
    const pageCount = new Map<string, number>();
    for (const title of titles) {
      for (const token of new Set(topicTokens(title))) pageCount.set(token, (pageCount.get(token) ?? 0) + 1);
    }
    const bar = titles.length * BOILERPLATE_SHARE;
    for (const [token, n] of pageCount) if (n >= bar) out.add(token);
  }

  return out;
}

// --- per-page topic model ---------------------------------------------------

/** Trailing-slash-insensitive pathname, so /fr/about/ and /fr/about compare equal. */
function normalizePath(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  } catch {
    return url;
  }
}

export interface PageTopic {
  path: string;
  /** `path`, trailing slash removed — the key hreflang alternates are matched against. */
  key: string;
  /** `<html lang>`, lower-cased and whole ("fr", "en-us"). Empty when undeclared. */
  lang: string;
  /** Normalized paths this page declares as hreflang alternates of itself. */
  alternates: Set<string>;
  /** Raw <title>, kept verbatim so identical titles can be left to unique-titles. */
  title: string;
  /** What the page ANNOUNCES: <title> + <h1> tokens, brand aside. */
  core: Set<string>;
  /** Extra tokens from the meta description, minus anything already in `core`. */
  support: Set<string>;
  /** Tokens of the main content with every heading removed — the prose must earn the promise itself. */
  prose: Set<string>;
  /** Word count of that heading-free prose. */
  proseWords: number;
  /** Full main content (headings included), for the near-duplicate guard. */
  body: string;
}

/** Read one sampled page into the topic model above. `boilerplate` comes from the whole sample. */
export function readTopic(res: FetchedResource, boilerplate: Set<string>): PageTopic {
  const root = parsePage(res);
  const title = root.querySelector('title')?.textContent.trim() ?? '';
  const h1 = root.querySelector('h1')?.textContent.trim() ?? '';
  const description = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';

  const mc = mainContent(res);
  // Headings are labels, not prose — and the <h1> is itself part of the promise, so
  // counting it as delivery would let a page satisfy the check by repeating itself.
  for (const h of mc.root.querySelectorAll('h1, h2, h3, h4, h5, h6')) h.remove();
  const proseText = mc.root.structuredText.replace(/\s+/g, ' ').trim();

  const keep = (text: string) => topicTokens(text).filter((w) => !boilerplate.has(w));
  const core = new Set([...keep(title), ...keep(h1)]);
  const support = new Set(keep(description).filter((w) => !core.has(w)));

  const alternates = new Set<string>();
  for (const link of root.querySelectorAll('link')) {
    if (link.getAttribute('rel') !== 'alternate' || !link.getAttribute('hreflang')) continue;
    const href = link.getAttribute('href');
    if (!href) continue;
    try { alternates.add(normalizePath(new URL(href, res.finalUrl).toString())); } catch { /* unparseable */ }
  }

  return {
    path: pathOf(res),
    key: normalizePath(res.finalUrl),
    lang: (root.querySelector('html')?.getAttribute('lang') ?? '').trim().toLowerCase(),
    alternates,
    title,
    core,
    support,
    prose: new Set(topicTokens(proseText)),
    proseWords: proseText ? proseText.split(' ').length : 0,
    body: mc.text,
  };
}

// ---------------------------------------------------------------------------
// topical-focus (#30)
// ---------------------------------------------------------------------------

/** true when a page declares enough of a topic, and writes enough prose, to be judged at all. */
export function isJudgeable(topic: PageTopic): boolean {
  return topic.core.size >= MIN_CORE_TOKENS && topic.proseWords >= PROSE_WORDS;
}

/**
 * Share of the declared topic the prose reinforces, 0..1. Title/H1 tokens weigh twice
 * a description-only token: the description is where incidental marketing words live
 * ("see the hours we bake and serve each week"), and demanding the body echo all of
 * them would flag pages that are perfectly on subject.
 */
export function focusScore(topic: PageTopic): number {
  let total = 0;
  let hit = 0;
  for (const w of topic.core) {
    total += CORE_WEIGHT;
    if (topic.prose.has(w)) hit += CORE_WEIGHT;
  }
  for (const w of topic.support) {
    total += SUPPORT_WEIGHT;
    if (topic.prose.has(w)) hit += SUPPORT_WEIGHT;
  }
  return total === 0 ? 0 : hit / total;
}

const pct = (ratio: number): number => Math.round(ratio * 100);

function offenderList(entries: string[]): string {
  return entries.slice(0, 3).join(', ') + (entries.length > 3 ? ` (+${entries.length - 3} more)` : '');
}

export const topicalFocus: Check = {
  id: 'topical-focus', family: 'on-page', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');

    const boilerplate = boilerplateTitleTokens(
      pages.map((p) => parsePage(p).querySelector('title')?.textContent.trim() ?? ''),
    );
    const judged = pages.map((p) => readTopic(p, boilerplate)).filter(isJudgeable);
    if (judged.length === 0) {
      return makeResult(this, 'skip', 'no page declares a topic and carries enough prose to judge it');
    }

    const scored = judged.map((topic) => ({ path: topic.path, score: focusScore(topic) }));
    const offenders = scored.filter((s) => s.score < FOCUS_MIN).sort((a, b) => a.score - b.score);
    if (offenders.length === 0) {
      const worst = Math.min(...scored.map((s) => s.score));
      return makeResult(this, 'pass',
        t`main content stays on the declared topic across ${judged.length} page(s) (lowest ${pct(worst)}%)`);
    }
    return makeResult(this, 'warn',
      t`main content barely mentions the declared topic on: ${offenderList(offenders.map((o) => `${o.path} (${pct(o.score)}%)`))}`,
      'Write the body around the subject the <title>, <h1> and meta description promise — an engine matches a query against the prose it retrieves, not against the label above it.');
  },
};

// ---------------------------------------------------------------------------
// keyword-cannibalization (#31)
// ---------------------------------------------------------------------------

/** A page's competing "intent": what its <title> and <h1> claim the page is for. */
function signature(topic: PageTopic): Set<string> {
  return topic.core;
}

export interface TwinPair {
  a: string;
  b: string;
  similarity: number;
}

/**
 * Two pages that are the same page in two languages. Translations promise the same
 * thing on purpose and compete for nothing — they address different audiences — so
 * they must never be read as cannibalization. Found by auditing our own bilingual
 * site, where /en/about/ and /fr/about/ scored 80 % title similarity: proper nouns,
 * cognates and diacritic folding leave a French title looking much like its English
 * twin. Declared hreflang alternates settle it first; a differing `<html lang>` is
 * the fallback for sites that ship translations without hreflang.
 */
export function areLanguageVariants(a: PageTopic, b: PageTopic): boolean {
  if (a.alternates.has(b.key) || b.alternates.has(a.key)) return true;
  return a.lang !== '' && b.lang !== '' && a.lang !== b.lang;
}

/**
 * Pairs of DISTINCT pages whose declared intent is near-identical — the soft band
 * `content-uniqueness` leaves untouched.
 *
 * Three exclusions keep every defect reported by exactly one check, and keep
 * translations out of it entirely:
 * - byte-identical titles are `unique-titles`' finding (and it may fail on them);
 * - bodies above the near-duplicate bar are `content-uniqueness`' finding;
 * - language variants of one page are hreflang's business, not a rivalry.
 * What is left is the interesting case: two genuinely different pages that promise
 * the same thing and therefore split the same intent between them.
 */
export function twinPairs(topics: PageTopic[]): TwinPair[] {
  const comparable = topics.filter((tpc) => signature(tpc).size >= MIN_SIGNATURE_TOKENS);
  const bodies = new Map(comparable.map((tpc) => [tpc.path, shingles(tpc.body)]));
  const pairs: TwinPair[] = [];
  for (let i = 0; i < comparable.length; i += 1) {
    for (let j = i + 1; j < comparable.length; j += 1) {
      const a = comparable[i];
      const b = comparable[j];
      if (a.title && a.title === b.title) continue; // unique-titles owns exact duplicates
      if (areLanguageVariants(a, b)) continue; // a translation is not a competitor
      const similarity = jaccard(signature(a), signature(b));
      if (similarity < TWIN_JACCARD) continue;
      if (jaccard(bodies.get(a.path)!, bodies.get(b.path)!) >= DUPLICATE_BODY_JACCARD) continue;
      pairs.push({ a: a.path, b: b.path, similarity });
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}

export const keywordCannibalization: Check = {
  id: 'keyword-cannibalization', family: 'on-page', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length < 2) return makeResult(this, 'skip', 'fewer than 2 sampled pages');

    const boilerplate = boilerplateTitleTokens(
      pages.map((p) => parsePage(p).querySelector('title')?.textContent.trim() ?? ''),
    );
    const topics = pages.map((p) => readTopic(p, boilerplate));
    const comparable = topics.filter((tpc) => signature(tpc).size >= MIN_SIGNATURE_TOKENS);
    if (comparable.length < 2) {
      return makeResult(this, 'skip', 'fewer than 2 pages declare enough title/H1 words to compare');
    }

    const pairs = twinPairs(topics);
    if (pairs.length === 0) {
      return makeResult(this, 'pass', t`the ${comparable.length} compared page(s) each target a distinct intent`);
    }
    const shown = pairs.map((p) => `${p.a} vs ${p.b} (${pct(p.similarity)}%)`);
    return makeResult(this, 'warn',
      t`page(s) competing for the same intent: ${offenderList(shown)}`,
      'Merge the twins into one page and redirect the others to it, or re-aim each one at a distinct question — two pages promising the same thing split the links, the ranking and the retrieval score that one page would have kept.');
  },
};
