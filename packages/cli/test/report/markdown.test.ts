import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/report/markdown.js';
import type { AuditReport } from '../../src/runner.js';
import type { CheckResult } from '../../src/types.js';
import type { FamilyScore } from '../../src/scoring.js';

const r = (over: Partial<CheckResult>): CheckResult => ({
  id: 'x', family: 'ai-access', status: 'pass', points: 4, maxPoints: 4, message: 'ok', ...over,
});

const familyScores: FamilyScore[] = [
  { family: 'ai-access', score: 25, weight: 0.16, earned: 4, max: 16 },
  { family: 'on-page', score: 50, weight: 0.12, earned: 2, max: 4 },
];

const report: AuditReport = {
  url: 'https://example.com/',
  score: 72,
  grade: 'C',
  familyScores,
  sampledPages: ['/'],
  results: [
    r({ id: 'robots-exists', message: 'robots.txt found' }),
    r({ id: 'ai-crawlers-allowed', status: 'fail', points: 0, maxPoints: 12, message: 'AI crawlers blocked: GPTBot', fix: 'Remove the Disallow rules.' }),
    r({ id: 'meta-description', family: 'on-page', status: 'warn', points: 2, message: 'description | too short', fix: 'Write 150 chars.' }),
    r({ id: 'sitemap-ok', family: 'on-page', status: 'skip', points: 0, message: 'skipped' }),
  ],
};

describe('renderMarkdown', () => {
  const md = renderMarkdown(report, new Date('2026-07-20T12:00:00Z'));

  it('includes title, score, grade and date', () => {
    expect(md).toContain('# findable-audit — https://example.com/');
    expect(md).toContain('**Score: 72/100**');
    expect(md).toContain('**Grade C**');
    expect(md).toContain('2026-07-20');
  });

  it('renders one section per family with earned/max (skips excluded)', () => {
    expect(md).toContain('## AI crawler access (4/16)');
    expect(md).toContain('## On-page & content (2/4)');
  });

  it('renders a per-family subscore table with score, weight and earned/max', () => {
    expect(md).toContain('## Category subscores');
    expect(md).toContain('| Family | Subscore | Weight | Earned/Max |');
    expect(md).toContain('| AI crawler access | 25/100 | 16% | 4/16 |');
    expect(md).toContain('| On-page & content | 50/100 | 12% | 2/4 |');
  });

  it('omits the subscore table when familyScores is empty', () => {
    const noScores = renderMarkdown({ ...report, familyScores: [] });
    expect(noScores).not.toContain('## Category subscores');
  });

  it('escapes pipes in table cells', () => {
    expect(md).toContain('description \\| too short');
  });

  it('lists fixes with fails before warns', () => {
    const fixes = md.slice(md.indexOf('## Recommended fixes'));
    expect(fixes.indexOf('ai-crawlers-allowed')).toBeLessThan(fixes.indexOf('meta-description'));
    expect(fixes).toContain('Remove the Disallow rules.');
  });

  it('omits the fixes section when everything passes', () => {
    const clean = renderMarkdown({ ...report, results: [r({})] });
    expect(clean).not.toContain('## Recommended fixes');
  });
});
