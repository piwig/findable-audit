/**
 * A116 — Dated registry of retired or restricted search features.
 *
 * WHY THIS EXISTS. The report's selling point is that it never sells a gain
 * that no longer exists. That honesty is already in the product, but it lives
 * as prose: a comment in `checks/rich-results.ts` about FAQ/HowTo/Q&A, a `why`
 * string in `report/check-i18n.ts` about the sitelinks search box. Prose cannot
 * be audited. Nothing today stops a future check from promising a rich result
 * Google removed in 2024, and every re-verification starts from zero because no
 * one recorded where the last one looked.
 *
 * One record per retired feature: what it was, WHEN it went, the source that
 * says so, which checks touch it, and — the field that matters most — what the
 * markup is still worth. "Retired from Search results" is almost never the same
 * as "worthless": structured data that no longer earns a SERP feature usually
 * still feeds entity understanding and AI answers. Saying so precisely is the
 * difference between an honest audit and a scare tactic.
 *
 * This registry is deliberately NOT wired into scoring. It documents and is
 * test-enforced; it does not silently change anyone's grade.
 */

export interface Deprecation {
  /** Stable identifier, kebab-case. */
  id: string;
  /** The feature as a reader would name it. */
  feature: string;
  /** ISO date (YYYY-MM or YYYY-MM-DD) the retirement/restriction took effect or was announced. */
  since: string;
  /** Public, re-openable source for that date. */
  source: string;
  /** Check ids that grade markup related to this feature. */
  checks: string[];
  /** What the markup still buys, if anything. Never left vague. */
  stillWorth: string;
}

export const DEPRECATIONS: Deprecation[] = [
  {
    id: 'sitelinks-searchbox',
    feature: 'Sitelinks search box (WebSite + SearchAction)',
    since: '2024-11-29',
    source: 'https://developers.google.com/search/blog/2024/10/sitelinks-search-box',
    checks: ['sd-website-searchaction'],
    stillWorth:
      'No SERP feature. The markup still declares a site-level search endpoint, which assistants and agents can use to query the site directly, so it is graded structurally against schema.org rather than as a rich-result promise.',
  },
  {
    id: 'faq-rich-results',
    feature: 'FAQ rich results',
    since: '2023-08',
    source: 'https://developers.google.com/search/blog/2023/08/howto-faq-changes',
    checks: ['sd-faq', 'sd-special-types'],
    stillWorth:
      'Restricted in 2023 to government and health sites, then dropped from Search entirely (reported May 2026). FAQPage markup still labels question/answer pairs explicitly, which is directly useful to retrieval: an answer unit that names its own question survives chunking better than one that does not.',
  },
  {
    id: 'howto-rich-results',
    feature: 'HowTo rich results',
    since: '2023-08',
    source: 'https://developers.google.com/search/blog/2023/08/howto-faq-changes',
    checks: ['sd-special-types'],
    stillWorth:
      'Removed from Google Search results. HowTo markup still exposes ordered steps and their materials as data, which is what an assistant needs to reproduce a procedure faithfully.',
  },
];

/** Lookup by feature id. */
export function deprecation(id: string): Deprecation | undefined {
  return DEPRECATIONS.find((d) => d.id === id);
}

/** Every deprecation touching a given check id. */
export function deprecationsForCheck(checkId: string): Deprecation[] {
  return DEPRECATIONS.filter((d) => d.checks.includes(checkId));
}

/** Check ids covered by at least one record — the set a test can hold the product to. */
export function deprecatedCheckIds(): string[] {
  return [...new Set(DEPRECATIONS.flatMap((d) => d.checks))].sort();
}
