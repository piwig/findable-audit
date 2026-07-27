import type { Lang } from '../report/i18n.js';

// ---------------------------------------------------------------------------
// The answer matrix generates its questions from what the site DECLARES about
// itself, crossed with the frozen grid below. The grid is pure data on purpose:
// a table can be diffed, reviewed and locked by a test, which is what keeps it
// honest as it grows. The evidence predicates live in predicates.ts — an intent
// is satisfied by a typed predicate, never by a keyword match.
//
// Design: docs/superpowers/specs/2026-07-27-matrice-de-reponses-design.md
// ---------------------------------------------------------------------------

/** The schema.org families a site falls into, which decide the intents that apply. */
export type Bucket = 'local-business' | 'product' | 'article' | 'unknown';

/** Whether the predicate is evaluated against one retrieval window, or the whole page. */
export type IntentScope = 'chunk' | 'page';

/**
 * What the verdict rests on. Structural intents read markup or document structure and
 * are close to `measured`; lexical ones read prose through a pattern and are frankly
 * heuristic. The matrix renders the difference per cell rather than averaging it away.
 */
export type IntentNature = 'structural' | 'lexical' | 'mixed';

export type IntentId = 'price' | 'hours' | 'location' | 'contact' | 'process' | 'identity';

export interface IntentDef {
  id: IntentId;
  /** Buckets this intent applies to. An intent outside its bucket is never generated. */
  buckets: readonly Bucket[];
  /** Does the generated question carry an area? Drives whether {zone} is interpolated. */
  zoned: boolean;
  scope: IntentScope;
  nature: IntentNature;
  /** Question template per language, interpolating {subject} and — when zoned — {zone}. */
  question: Record<Lang, string>;
}

export const BUCKETS: readonly Bucket[] = ['local-business', 'product', 'article', 'unknown'];

export const INTENT_GRID: readonly IntentDef[] = [
  {
    id: 'price',
    buckets: ['local-business', 'product'],
    zoned: true,
    scope: 'chunk',
    nature: 'lexical',
    question: {
      en: '{subject} in {zone}: what does it cost?',
      fr: '{subject} à {zone} : quel prix ?',
    },
  },
  {
    id: 'hours',
    buckets: ['local-business'],
    zoned: false,
    scope: 'chunk',
    nature: 'mixed',
    question: {
      en: '{subject}: when are you open?',
      fr: '{subject} : quels sont les horaires ?',
    },
  },
  {
    id: 'location',
    buckets: ['local-business'],
    zoned: true,
    scope: 'chunk',
    nature: 'lexical',
    question: {
      en: 'do you cover {zone} for {subject}?',
      fr: 'couvrez-vous {zone} pour {subject} ?',
    },
  },
  {
    id: 'contact',
    buckets: ['local-business', 'product', 'article', 'unknown'],
    zoned: false,
    scope: 'page',
    nature: 'structural',
    question: {
      en: '{subject}: how do I reach a human?',
      fr: '{subject} : comment joindre quelqu un ?',
    },
  },
  {
    id: 'process',
    buckets: ['local-business', 'product', 'article'],
    zoned: false,
    scope: 'chunk',
    nature: 'structural',
    question: {
      en: '{subject}: how does it work, step by step?',
      fr: '{subject} : comment ça se passe, étape par étape ?',
    },
  },
  {
    id: 'identity',
    buckets: ['local-business', 'product', 'article', 'unknown'],
    zoned: false,
    scope: 'page',
    nature: 'structural',
    question: {
      en: '{subject}: who are you?',
      fr: '{subject} : qui êtes-vous ?',
    },
  },
];

/** The intents that apply to a bucket, in grid order. */
export function intentsFor(bucket: Bucket): readonly IntentDef[] {
  return INTENT_GRID.filter((i) => i.buckets.includes(bucket));
}
