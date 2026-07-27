import type { Chunk } from '../checks/chunker.js';
import type { FetchedResource } from '../types.js';
import { parsePage } from '../checks/dom.js';
import { extractJsonLd, flatten, typesOf, str } from '../checks/jsonld.js';
import type { IntentId } from './grid.js';

// ---------------------------------------------------------------------------
// One evidence predicate per intent. An intent is satisfied by a typed predicate
// rather than by a keyword match, which is what makes a cell hard to game: a page
// that says "price" without ever stating an amount does not answer "what does it
// cost?", and the matrix must not pretend otherwise.
//
// Every lexical predicate is written and tested in French AND English. A
// single-language regex has silently mis-read half the web four times on this
// project; here it would quietly empty a whole column of the matrix.
//
// Design: docs/superpowers/specs/2026-07-27-matrice-de-reponses-design.md §6
// ---------------------------------------------------------------------------

export interface PredicateInput {
  /** The retrieval window under test. Used by chunk-scoped intents. */
  chunk: Chunk;
  /** The page the window came from. Used by page-scoped intents (markup, affordances). */
  page: FetchedResource;
  /** Plain text of the whole page, for prose checks that are not window-bound. */
  pageText: string;
  /** The declared service label this cell is about. */
  subject: string;
  /** The declared area label, present only when the intent is zoned. */
  zone?: string;
}

export type Predicate = (input: PredicateInput) => boolean;

/** Case- and diacritic-insensitive form, so "Orgères" and "orgeres" compare equal. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every JSON-LD node on the page, flattened — nested authors and steps included. */
function nodesOf(page: FetchedResource): Record<string, unknown>[] {
  return flatten(extractJsonLd(page.body));
}

// --- price ------------------------------------------------------------------
// The evidence is the amount, never the word. Both typographic conventions must
// work: a French page writes "49,90 €" where an English one writes "$49.90".

/** Digits with optional thousands separators and at most two decimals, either convention. */
const AMOUNT = String.raw`\d+(?:[   ]\d{3})*(?:[.,]\d{1,2})?`;
const SYMBOL = String.raw`[€$£¥]`;
const CODE = String.raw`(?:EUR|USD|GBP|CHF|CAD|AUD)`;

/** An amount attached to a currency, symbol or code, on either side. */
const MONEY = new RegExp(
  `${SYMBOL}\\s?${AMOUNT}|${AMOUNT}\\s?${SYMBOL}|\\b${CODE}\\s?${AMOUNT}|${AMOUNT}\\s?${CODE}\\b`,
  'iu',
);

const price: Predicate = ({ chunk }) => MONEY.test(chunk.text);

// --- hours ------------------------------------------------------------------
// Mixed evidence: `openingHoursSpecification` is markup and settles it outright;
// otherwise we look for a RANGE in the prose. One clock time is not opening hours —
// "intervention en 2h" is a duration, and reading it as a schedule would be wrong.

/** A time of day in either notation: 8h, 9h30, 08:00. */
const CLOCK = /\b\d{1,2}\s?(?:h\s?\d{2}|h|:\d{2})/gi;

function declaresOpeningHours(page: FetchedResource): boolean {
  return nodesOf(page).some((n) => n.openingHoursSpecification !== undefined || n.openingHours !== undefined);
}

const hours: Predicate = ({ chunk, page }) => {
  if (declaresOpeningHours(page)) return true;
  return (chunk.text.match(CLOCK) ?? []).length >= 2;
};

// --- location ---------------------------------------------------------------
// The zone has to appear in the window itself: a city named in the footer does not
// make the passage an answer about that city.

const location: Predicate = ({ chunk, zone }) => {
  if (!zone) return false;
  return fold(chunk.text).includes(fold(zone));
};

// --- contact ----------------------------------------------------------------
// Structural, and page-scoped: an agent needs a way to act, not a promise. Either a
// direct channel, or a form it could actually submit without running JavaScript.

const SUBMIT = 'button, input[type="submit"], input[type="image"]';

const contact: Predicate = ({ page }) => {
  const root = parsePage(page);
  if (root.querySelector('a[href^="tel:"], a[href^="mailto:"]')) return true;
  return root.querySelectorAll('form').some((f) => f.querySelector(SUBMIT) !== null);
};

// --- process ----------------------------------------------------------------
// Structural where the markup exists, enumerated prose otherwise. Two markers are
// required: a lone "3" in "nous avons 3 agences" is a count, not a step.

const STEP_MARKER = /(?:^|[\s(])\d{1,2}[.)]|(?:étape|etape|step)\s*\d{1,2}/gi;

const process: Predicate = ({ chunk, page }) => {
  if (nodesOf(page).some((n) => typesOf(n).includes('HowTo'))) return true;
  return (chunk.text.match(STEP_MARKER) ?? []).length >= 2;
};

// --- identity ---------------------------------------------------------------
// "Who are you?" is answered by an entity someone can resolve: a profile link that
// anchors the entity elsewhere, or a named person behind the content.

const identity: Predicate = ({ page }) => nodesOf(page).some((n) => {
  const sameAs = n.sameAs;
  if (Array.isArray(sameAs) ? sameAs.length > 0 : typeof sameAs === 'string' && sameAs !== '') return true;
  if (typesOf(n).includes('Person') && str(n.name)) return true;
  const author = n.author as Record<string, unknown> | undefined;
  return Boolean(author && typeof author === 'object' && str(author.name));
});

export const PREDICATES: Record<IntentId, Predicate> = {
  price,
  hours,
  location,
  contact,
  process,
  identity,
};
