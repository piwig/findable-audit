import type { Family } from '../types.js';

/** How much work a fix takes — a coarse hint to help sequence the action plan. */
export type Effort = 'quick' | 'moderate' | 'involved';

/** Default effort to remediate a check in each family (heuristic). */
const FAMILY_EFFORT: Record<Family, Effort> = {
  'ai-access': 'quick', // robots.txt / meta directives — config
  'llm-content': 'moderate', // content, llms.txt, E-E-A-T — authoring
  'structured-data': 'moderate', // JSON-LD authoring
  'technical-seo': 'quick', // canonical, redirects, sitemap, hreflang — mostly config
  'on-page': 'quick', // titles, meta, alt, charset — markup
  performance: 'involved', // perf / Core Web Vitals — engineering
  accessibility: 'quick', // alt, labels, lang, landmarks — markup
  security: 'quick', // response headers — config
};

/**
 * Per-check overrides where the effort clearly deviates from the family default.
 * Keyed by check id (see docs/guide.md). Unlisted checks use the family default.
 */
const EFFORT_OVERRIDES: Record<string, Effort> = {
  // Content authoring is real writing work, not a config toggle.
  'content-depth': 'moderate',
  'content-freshness': 'moderate',
  'content-lead-answer': 'moderate',
  'content-readability': 'moderate',
  'content-uniqueness': 'moderate',
  'content-author-eeat': 'moderate',
  'answer-headings': 'moderate',
  'about-contact': 'moderate',
  'nap-consistency': 'moderate',
  'extractable-structure': 'moderate',
  // Needs server-side rendering / prerender — the biggest content-parity fix.
  'content-without-js': 'involved',
  // Technical items that touch many pages / templates.
  'broken-internal-links': 'moderate',
  'redirect-chains': 'moderate',
  'custom-404': 'moderate',
  'pagination-canonical': 'moderate',
  'internal-linking': 'moderate',
  'headings-outline': 'moderate',
  // Image work.
  'img-dimensions': 'moderate',
  'img-next-gen': 'moderate',
  // Structured data: a single OG block is quick (family default is 'moderate').
  'open-graph': 'quick',
  // Performance quick-config wins (family default is 'involved').
  'asset-caching': 'quick',
  'resource-hints': 'quick', // preconnect / dns-prefetch / preload tags
  'text-compression': 'quick',
};

/** Estimated effort to fix a given check. */
export function effortOf(id: string, family: Family): Effort {
  return EFFORT_OVERRIDES[id] ?? FAMILY_EFFORT[family];
}
