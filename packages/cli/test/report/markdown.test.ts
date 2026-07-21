import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../../src/report/markdown.js';
import { parsePsi } from '../../src/perf/psi.js';
import type { AuditReport } from '../../src/runner.js';
import type { CheckResult } from '../../src/types.js';
import type { FamilyScore } from '../../src/scoring.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'psi-sample.json'), 'utf8'));

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
    r({ id: 'ai-crawlers-allowed', status: 'fail', points: 0, maxPoints: 12, message: 'AI crawlers blocked: GPTBot', fix: 'Remove the Disallow rules.', docUrl: 'https://example.com/docs/ai-crawlers' }),
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

  it('shows a verdict line under the score', () => {
    expect(md).toMatch(/priority|Decent|Excellent|Solid|Fragile|Foundations/i);
  });

  it('renders a Core Web Vitals table when psi is present', () => {
    const withPsi = renderMarkdown({ ...report, psi: parsePsi(sample, 'mobile') });
    expect(withPsi).toContain('## Core Web Vitals');
    expect(withPsi).toMatch(/\| LCP \|/);
  });

  it('adds doc links to the recommended fixes', () => {
    const fixes = md.slice(md.indexOf('## Recommended fixes'));
    expect(fixes).toMatch(/\[doc\]\(https?:\/\/[^)]+\)/);
  });

  it('omits the Core Web Vitals section when psi is absent', () => {
    expect(md).not.toContain('## Core Web Vitals');
  });
});

describe('renderMarkdown in French', () => {
  const md = renderMarkdown(report, new Date('2026-07-20T12:00:00Z'), 'fr');
  it('localizes the report chrome', () => {
    expect(md).toContain('**Score : 72/100**');
    expect(md).toContain('**Note C**');
    expect(md).toMatch(/priorité/);                       // FR verdict, grade C
    expect(md).toContain('## Sous-scores par catégorie');
    expect(md).toContain('| Famille | Sous-score | Poids | Acquis/Max |');
    expect(md).toContain('| Accès crawler IA | 25/100 | 16% | 4/16 |');
    expect(md).toContain('## Accès crawler IA (4/16)');
    expect(md).toContain('## On-page & contenu (2/4)');
    expect(md).toContain('## Corrections recommandées');
  });
  it('keeps the 108-check messages/fixes in English', () => {
    expect(md).toContain('AI crawlers blocked: GPTBot');
    expect(md).toContain('Remove the Disallow rules.');
  });
});
