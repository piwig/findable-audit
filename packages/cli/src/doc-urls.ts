import type { Family } from './types.js';

/** Canonical documentation link per family — the fallback when a check has no own docUrl. */
export const FAMILY_DOC_URL: Record<Family, string> = {
  'ai-access': 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
  'llm-content': 'https://llmstxt.org/',
  'structured-data': 'https://schema.org/docs/schemas.html',
  'technical-seo': 'https://developers.google.com/search/docs',
  'on-page': 'https://developers.google.com/search/docs/appearance',
  performance: 'https://web.dev/explore/learn-core-web-vitals',
  accessibility: 'https://www.w3.org/WAI/WCAG21/quickref/',
  security: 'https://developer.mozilla.org/en-US/docs/Web/Security',
};
