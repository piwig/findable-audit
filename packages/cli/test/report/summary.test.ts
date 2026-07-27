// #64 — the one-screen version, for whoever decides rather than whoever fixes.
//
// The full report already answers "what is wrong, everywhere". This answers
// "where do we stand, what are the three things worth doing, and what do they
// cost" — and stops there. A summary that quietly became a second full report
// would defeat its own purpose, so the tests police its brevity.
import { describe, it, expect } from 'vitest';
import { renderSummaryMarkdown, renderSummaryHtml, SUMMARY_ACTIONS } from '../../src/report/summary.js';
import type { AuditReport } from '../../src/runner.js';

const familyScores = [
  { family: 'ai-access' as const, score: 100, weight: 0.16, earned: 16, max: 16 },
  { family: 'llm-content' as const, score: 40, weight: 0.18, earned: 8, max: 20 },
  { family: 'structured-data' as const, score: 70, weight: 0.15, earned: 7, max: 10 },
  { family: 'security' as const, score: 90, weight: 0.07, earned: 9, max: 10 },
];

function res(id: string, family: AuditReport['results'][number]['family'], points: number, maxPoints: number, fix: string) {
  return {
    id, family, evidence: 'measured' as const, status: 'fail' as const,
    points, maxPoints, message: `${id} is unhappy on /a, /b`, fix,
  };
}

const report: AuditReport = {
  url: 'https://example.com/',
  score: 68,
  grade: 'D',
  familyScores,
  sampledPages: ['/', '/about', '/pricing'],
  results: [
    res('llms-txt', 'llm-content', 0, 10, 'Publish /llms.txt.'),
    res('sd-organization', 'structured-data', 0, 4, 'Add an Organization node.'),
    res('csp', 'security', 0, 3, 'Send a Content-Security-Policy header.'),
    res('open-graph', 'structured-data', 0, 2, 'Complete the Open Graph tags.'),
    res('hsts', 'security', 0, 1, 'Send HSTS.'),
    { id: 'https', family: 'security', evidence: 'measured', status: 'pass', points: 5, maxPoints: 5, message: 'served over HTTPS' },
  ],
  generatedAt: '2026-07-27T09:00:00.000Z',
};

describe('renderSummaryMarkdown', () => {
  const md = renderSummaryMarkdown(report, new Date('2026-07-27T12:00:00Z'), 'en');

  it('leads with the number a decision-maker asks for', () => {
    expect(md).toMatch(/68\/100/);
    expect(md).toMatch(/\bD\b/);
    expect(md).toContain('example.com');
  });

  it('carries the three axes, named and scored', () => {
    for (const axis of ['Reachable', 'Understood', 'Usable']) expect(md).toContain(axis);
  });

  it('lists exactly the top actions, highest gain first, with their cost', () => {
    const items = [...md.matchAll(/^\d+\. /gm)];
    expect(items.length).toBeLessThanOrEqual(SUMMARY_ACTIONS);
    // llms-txt recovers 10 points in the heaviest family: it cannot be second.
    const first = md.indexOf('llms-txt');
    const second = md.indexOf('sd-organization');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    expect(md).toMatch(/\+10/);
  });

  it('says what the fixes would be worth together, rather than leaving arithmetic to the reader', () => {
    expect(md).toMatch(/68 → \d+/);
  });

  it('is a summary: no per-check table, no passing checks, no 121 rows', () => {
    expect(md).not.toContain('| Check |');
    expect(md).not.toContain('served over HTTPS');
    expect(md.split('\n').length).toBeLessThan(45);
  });

  it('translates', () => {
    const fr = renderSummaryMarkdown(report, new Date('2026-07-27T12:00:00Z'), 'fr');
    expect(fr).toContain('Trouvable');
    expect(fr).not.toContain('Reachable');
  });

  it('stays honest when there is nothing to fix', () => {
    const clean: AuditReport = { ...report, score: 100, grade: 'A', results: [report.results[5]] };
    const out = renderSummaryMarkdown(clean, new Date('2026-07-27T12:00:00Z'), 'en');
    expect(out).toMatch(/100\/100/);
    expect(out).not.toMatch(/^\d+\. /m);
  });
});

describe('renderSummaryHtml', () => {
  const html = renderSummaryHtml(report, new Date('2026-07-27T12:00:00Z'), 'en');

  it('is a self-contained document, printable as-is', () => {
    expect(html.trimStart()).toMatch(/^<!doctype html/i);
    expect(html).toContain('<style');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('</html>');
  });

  it('shows the score, the grade and the three axes', () => {
    expect(html).toContain('68');
    expect(html).toContain('Reachable');
  });

  it('escapes site-derived text', () => {
    const hostile: AuditReport = {
      ...report,
      results: [res('x', 'security', 0, 3, '<script>alert(1)</script>')],
    };
    const out = renderSummaryHtml(hostile, new Date('2026-07-27T12:00:00Z'), 'en');
    expect(out).not.toMatch(/<script>alert/);
    expect(out).toContain('&lt;script&gt;');
  });
});

// Regression: the first real French summary quoted the checks' English `fix`
// strings, because the raw fix a check emits is English and only the catalogue
// is translated. Same leak the reports had before the localisation pass.
describe('a French summary is French all the way down', () => {
  it('takes fixes from the localized catalogue, not from the check', () => {
    const real: AuditReport = {
      ...report,
      results: [
        { id: 'sd-entity-grounding', family: 'structured-data', evidence: 'measured', status: 'warn',
          points: 2, maxPoints: 4, message: 'only 1 sameAs profile URL',
          fix: 'List >=2 official profile URLs in sameAs, including Wikipedia/Wikidata if available.' },
      ],
    };
    const fr = renderSummaryMarkdown(real, new Date('2026-07-27T12:00:00Z'), 'fr');
    expect(fr).not.toContain('List >=2 official profile URLs');
    expect(fr).toMatch(/profils officiels|sameAs/);
    const html = renderSummaryHtml(real, new Date('2026-07-27T12:00:00Z'), 'fr');
    expect(html).not.toContain('List &gt;=2 official profile URLs');
  });
});
