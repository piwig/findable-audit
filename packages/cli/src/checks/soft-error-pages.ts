// Backlog #28 — soft-error pages: a 200 response whose own document says it failed.
//
// `soft-404` fires ONE synthetic probe at a random path that cannot exist, so it only
// ever learns what the server does with an obviously-missing route. It says nothing
// about the routes a crawler actually walks. This check reads the pages the crawl
// really sampled and looks for the opposite failure mode: a URL that a sitemap or an
// internal link advertised as real, that answers 200, and whose <title>/<h1> is an
// error message — or whose main content is an empty shell.
//
// Why it matters for findability: search engines and AI crawlers trust the status
// line. A 200 means "here is the document you asked for", so a soft-error page gets
// indexed, chunked and quoted as if it were content — and the genuinely missing page
// never drops out of the index. RFC 9110 §15 is explicit that the status code carries
// the semantics of the response; Google documents the same defect as a "soft 404".
//
// Zero extra requests: everything here is read off the already-fetched sample.

import type { Check, FetchedResource } from '../types.js';
import { makeResult, mediaType, t } from '../types.js';
import { pagesOf, pathOf } from './aggregate.js';
import { parsePage } from './dom.js';
import { mainContent } from './content.js';
import { canonicalIdentity } from './canonical.js';

/**
 * A real error page is short. Requiring the marked page to stay under this ceiling is
 * what keeps the lexicon from firing on genuine writing ABOUT errors — "Erreur 404 :
 * comment la corriger", "Server error codes explained" — which are long-form articles.
 */
const ERROR_PAGE_MAX_WORDS = 400;

/**
 * Main-content words below which a non-home 200 is an empty shell rather than a page.
 *
 * Deliberately an order of magnitude under `content-depth`'s 150/300-word bar, because
 * the two report different defects: `content-depth` says "this document is thin",
 * this says "there is no document here at all". Anything in between belongs to
 * `content-depth` alone.
 */
const BLANK_WORDS = 15;

/** Images inside main content at or above which a text-light page is a gallery, not a shell. */
const GALLERY_IMAGES = 2;

/** Longest offender label kept in the message. */
const LABEL_MAX = 48;

/**
 * Fold a title/H1 down to a comparable form: no diacritics, no case, no apostrophes,
 * punctuation collapsed to single spaces. "Erreur 404 — Page non trouvée !" becomes
 * "erreur 404 page non trouvee", and "We couldn't find that page" becomes
 * "we couldnt find that page", so one written form of a phrase matches all of them.
 */
export function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['‘’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Labels that ARE the error, with nothing else in them. Matched on the whole string
 * only: "Error" as a full <title> is an error page, "Error handling in Rust" is an
 * article, and a substring rule cannot tell them apart.
 */
const EXACT_ERROR_LABELS = new Set([
  // EN
  'error', 'errors', 'error page', 'page error', 'server error', 'not found',
  'oops', 'unavailable', 'forbidden', 'unauthorized', 'bad request', 'missing page',
  // FR
  'erreur', 'erreurs', 'page derreur', 'erreur de page', 'introuvable', 'non trouve',
  'non trouvee', 'oups', 'indisponible', 'page manquante',
]);

/**
 * Error-page signatures matched anywhere in the label. Bilingual on purpose: two
 * checks once shipped English-only regexes and silently ignored every French page.
 * Bare "error"/"erreur"/"404" are NOT here — they live in EXACT_ERROR_LABELS and
 * CODE_PATTERNS, where they cannot swallow an article that merely discusses them.
 */
const ERROR_PHRASES = [
  // --- EN ------------------------------------------------------------------
  'page not found', 'file not found', 'content not found', 'no such page',
  'page cannot be found', 'page can not be found', 'page cant be found',
  'page could not be found', 'page couldnt be found', 'page was not found',
  'page does not exist', 'page doesnt exist', 'page no longer exists',
  'page you are looking for', 'page youre looking for', 'page you requested',
  'cannot be found', 'could not be found', 'couldnt be found', 'cant be found',
  'cannot find that page', 'cant find that page',
  'could not find that page', 'couldnt find that page',
  'cannot find the page', 'cant find the page',
  'could not find the page', 'couldnt find the page',
  'page unavailable', 'page is unavailable', 'no longer available',
  'internal server error', 'service unavailable', 'temporarily unavailable',
  'something went wrong', 'an error occurred', 'an error has occurred',
  'access denied',
  // --- FR ------------------------------------------------------------------
  'introuvable', 'non trouve', 'nexiste pas', 'na pas ete trouve',
  'page recherchee', 'page demandee', 'page indisponible', 'nest plus disponible',
  'erreur interne', 'erreur serveur', 'erreur inattendue',
  'service indisponible', 'temporairement indisponible',
  'une erreur est survenue', 'une erreur sest produite', 'un probleme est survenu',
  'quelque chose sest mal passe', 'acces refuse', 'acces interdit',
  'impossible de trouver', 'nous navons pas trouve',
];

/**
 * HTTP status codes spelled out in the label. Either the label is nothing but the
 * code ("404"), or the code sits next to the word error/erreur ("Erreur 404",
 * "404 error", "error code 500") — never a loose 4xx/5xx anywhere, which would flag
 * "500 recipes for sourdough".
 */
const REASON_PHRASES = [
  'not found', 'forbidden', 'unauthorized', 'bad request', 'gone', 'not acceptable',
  'request timeout', 'too many requests', 'bad gateway', 'gateway timeout',
  'non trouve', 'non trouvee', 'introuvable', 'interdit', 'non autorise',
].join('|');

const CODE_PATTERNS: RegExp[] = [
  /^[45]\d\d$/,
  /\b(?:error|erreur)(?: code| number| numero)? [45]\d\d\b/,
  /\b[45]\d\d (?:error|erreur)\b/,
  /\bhttp [45]\d\d\b/,
  // "404 Not Found", "403 Forbidden" — a code glued to its standard reason phrase.
  new RegExp(`\\b[45]\\d\\d (?:${REASON_PHRASES})\\b`),
];

/** true when a title/H1 reads as an error message rather than as a page name. */
export function isErrorLabel(text: string): boolean {
  const label = normalizeLabel(text);
  if (label === '') return false;
  if (EXACT_ERROR_LABELS.has(label)) return true;
  if (ERROR_PHRASES.some((p) => label.includes(p))) return true;
  return CODE_PATTERNS.some((re) => re.test(label));
}

/** Up to 3 offenders, then "(+N more)" — the shape every multi-page check uses. */
function offenderList(items: string[]): string {
  return items.slice(0, 3).join(', ') + (items.length > 3 ? ` (+${items.length - 3} more)` : '');
}

/** Trim a label so one verbose title cannot flood the message. */
function short(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1)}…` : one;
}

/** HTML pages that actually answered 200 — the only ones this check can judge. */
function servedOk(pages: FetchedResource[]): FetchedResource[] {
  return pages.filter((p) => {
    if (p.status !== 200) return false;
    const ct = mediaType(p);
    return ct === '' || ct === 'text/html' || ct === 'application/xhtml+xml';
  });
}

export const softErrorPages: Check = {
  id: 'soft-error-pages', family: 'technical-seo', evidence: 'heuristic', maxPoints: 4,
  async run(ctx) {
    const sampled = await pagesOf(ctx);
    if (sampled.length === 0) return makeResult(this, 'skip', 'no pages sampled');
    const pages = servedOk(sampled);
    if (pages.length === 0) return makeResult(this, 'skip', 'no 200 HTML page in the sample');

    const homeId = canonicalIdentity(new URL('/', ctx.baseUrl).toString());
    const errorPages: string[] = [];
    const blankPages: string[] = [];

    for (const page of pages) {
      const root = parsePage(page);
      const title = root.querySelector('title')?.textContent.trim() ?? '';
      const h1 = root.querySelector('h1')?.textContent.trim() ?? '';
      const main = mainContent(page);
      const label = pathOf(page);

      // An error page is short. A long document that merely talks about 404s is not
      // one, and must not be failed for using the words.
      if (main.wordCount <= ERROR_PAGE_MAX_WORDS) {
        if (isErrorLabel(title)) { errorPages.push(`${label} (title "${short(title)}")`); continue; }
        if (isErrorLabel(h1)) { errorPages.push(`${label} (h1 "${short(h1)}")`); continue; }
      }

      // The homepage is exempt: a deliberately minimal splash page is a design
      // choice, and `homepage-ok` already judges the homepage on its own terms.
      if (canonicalIdentity(page.finalUrl) === homeId) continue;
      const images = main.root.querySelectorAll('img').length;
      if (main.wordCount < BLANK_WORDS && images < GALLERY_IMAGES) blankPages.push(label);
    }

    if (errorPages.length > 0) {
      return makeResult(this, 'fail', t`error page served with HTTP 200: ${offenderList(errorPages)}`,
        'Return 404 (or 410 for permanently removed content) on the routes whose page says it failed, so crawlers drop them instead of indexing the error text.');
    }
    if (blankPages.length > 0) {
      return makeResult(this, 'warn', t`page served with HTTP 200 has almost no content: ${offenderList(blankPages)}`,
        'Give each 200 URL a real document, or answer 404/410 if there is nothing to serve there.');
    }
    return makeResult(this, 'pass', t`${pages.length} sampled page(s) return 200 with real content`);
  },
};
