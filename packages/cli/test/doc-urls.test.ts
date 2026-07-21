import { describe, it, expect } from 'vitest';
import { makeResult } from '../src/types.js';
import { FAMILY_DOC_URL } from '../src/doc-urls.js';

describe('docUrl resolution in makeResult', () => {
  it('falls back to the family doc URL when the check has none', () => {
    const r = makeResult({ id: 'x', family: 'performance', maxPoints: 5 }, 'fail', 'slow');
    expect(r.docUrl).toBe(FAMILY_DOC_URL.performance);
  });
  it('prefers the check-level docUrl override', () => {
    const r = makeResult(
      { id: 'x', family: 'performance', maxPoints: 5, docUrl: 'https://web.dev/lcp/' },
      'warn', 'meh',
    );
    expect(r.docUrl).toBe('https://web.dev/lcp/');
  });
  it('exposes a doc URL for every family', () => {
    const families = ['ai-access','llm-content','structured-data','technical-seo','on-page','performance','accessibility','security'] as const;
    for (const f of families) expect(FAMILY_DOC_URL[f]).toMatch(/^https:\/\//);
  });
});
