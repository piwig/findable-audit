import type { Chunk } from '../checks/chunker.js';
import type { IntentId } from './grid.js';

// ---------------------------------------------------------------------------
// One evidence predicate per intent. An intent is satisfied by a typed predicate
// rather than by a keyword match, which is what makes a cell hard to game: a page
// that says "price" without ever stating an amount does not answer "what does it
// cost?", and the matrix must not pretend otherwise.
//
// Behaviour is driven test-first, one predicate at a time — see
// test/answers/predicates.test.ts. The registry below is locked against the grid
// by test/answers/grid.test.ts: exactly one predicate per intent, no orphans.
// ---------------------------------------------------------------------------

export interface PredicateInput {
  /** The retrieval window under test. Used by chunk-scoped intents. */
  chunk: Chunk;
  /** Plain text of the whole page. Used by page-scoped intents. */
  pageText: string;
  /** The declared service label this cell is about. */
  subject: string;
  /** The declared area label, present only when the intent is zoned. */
  zone?: string;
}

export type Predicate = (input: PredicateInput) => boolean;

/**
 * Not yet implemented — returns false so an unimplemented intent reads as "no evidence"
 * rather than as a false positive. A predicate that has not been written must never
 * report a question as answered.
 */
const noEvidence: Predicate = () => false;

// --- price ------------------------------------------------------------------
// A page that says "price" without ever stating an amount does not answer "what does
// it cost?", so the evidence is the amount, never the word. Both typographic
// conventions must work: "49,90 €" and "$49.90" are the same claim, and assuming one
// of them is the defect class that has already reached production three times here.

/** Digits with optional thousands separators and at most two decimals, either convention. */
const AMOUNT = String.raw`\d+(?:[   ]\d{3})*(?:[.,]\d{1,2})?`;
const SYMBOL = String.raw`[€$£¥]`;
const CODE = String.raw`(?:EUR|USD|GBP|CHF|CAD|AUD)`;

/** An amount attached to a currency, symbol or code, on either side. */
const MONEY = new RegExp(
  `${SYMBOL}\\s?${AMOUNT}|${AMOUNT}\\s?${SYMBOL}|\\b${CODE}\\s?${AMOUNT}|${AMOUNT}\\s?${CODE}\\b`,
  'iu',
);

const price: Predicate = ({ chunk }) => MONEY.test(chunk.text);

export const PREDICATES: Record<IntentId, Predicate> = {
  price,
  hours: noEvidence,
  location: noEvidence,
  contact: noEvidence,
  process: noEvidence,
  identity: noEvidence,
};
