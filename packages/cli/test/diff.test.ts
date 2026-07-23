import { describe, it, expect } from 'vitest';
import { diffReports, renderDiffTerminal, renderDiffMarkdown, renderDiffHtmlSection } from '../src/report/diff.js';
import type { AuditReport } from '../src/runner.js';
import type { CheckResult } from '../src/types.js';

function chk(id: string, status: CheckResult['status'], family: CheckResult['family'] = 'ai-access'): CheckResult {
  const points = status === 'pass' ? 10 : status === 'warn' ? 5 : 0;
  return { id, family, status, points, maxPoints: 10, message: `${id} is ${status}` };
}

function report(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://ex.com/',
    score: 70,
    grade: 'C',
    familyScores: [{ family: 'ai-access', score: 70, weight: 0.2, earned: 14, max: 20 }],
    sampledPages: ['/'],
    results: [],
    ...over,
  };
}

describe('diffReports', () => {
  it('computes a signed overall score delta', () => {
    const d = diffReports(report({ score: 82 }), report({ score: 70 }));
    expect(d.baselineScore).toBe(70);
    expect(d.currentScore).toBe(82);
    expect(d.scoreDelta).toBe(12);
  });

  it('classifies a pass→fail as a regression and fail→pass as an improvement', () => {
    const current = report({ results: [chk('a', 'fail'), chk('b', 'pass')] });
    const baseline = report({ results: [chk('a', 'pass'), chk('b', 'fail')] });
    const d = diffReports(current, baseline);
    expect(d.regressions.map((r) => r.id)).toEqual(['a']);
    expect(d.improvements.map((r) => r.id)).toEqual(['b']);
  });

  it('treats warn→fail as a regression', () => {
    const d = diffReports(report({ results: [chk('a', 'fail')] }), report({ results: [chk('a', 'warn')] }));
    expect(d.regressions.map((r) => r.id)).toEqual(['a']);
    expect(d.improvements).toEqual([]);
  });

  it('treats a skip→pass as an added check only (not an improvement)', () => {
    const current = report({ results: [chk('a', 'pass')] });
    const baseline = report({ results: [chk('a', 'skip')] });
    const d = diffReports(current, baseline);
    expect(d.improvements).toEqual([]);
    expect(d.added).toEqual(['a']);
  });

  it('reports checks present on only one side', () => {
    const current = report({ results: [chk('a', 'pass'), chk('new', 'pass')] });
    const baseline = report({ results: [chk('a', 'pass'), chk('gone', 'fail')] });
    const d = diffReports(current, baseline);
    expect(d.added).toEqual(['new']);
    expect(d.removed).toEqual(['gone']);
  });

  it('marks a new family with a null baseline delta', () => {
    const current = report({ familyScores: [
      { family: 'ai-access', score: 70, weight: 0.2, earned: 14, max: 20 },
      { family: 'security', score: 90, weight: 0.1, earned: 9, max: 10 },
    ] });
    const baseline = report();
    const d = diffReports(current, baseline);
    const sec = d.familyDeltas.find((f) => f.family === 'security');
    expect(sec?.baseline).toBe(null);
    expect(sec?.current).toBe(90);
    expect(sec?.delta).toBe(null);
  });

  it('tolerates a baseline missing generatedAt', () => {
    const baseline = report(); // no generatedAt
    const d = diffReports(report({ score: 71 }), baseline);
    expect(d.baselineGeneratedAt).toBeUndefined();
    expect(d.scoreDelta).toBe(1);
  });
});

describe('diff renderers', () => {
  const d = diffReports(
    report({ score: 82, results: [chk('a', 'fail')] }),
    report({ score: 70, results: [chk('a', 'pass')] }),
  );

  it('terminal shows a signed delta', () => {
    const out = renderDiffTerminal(d, 'en');
    expect(out).toMatch(/\+12|12/);
    expect(out.toLowerCase()).toContain('baseline');
  });

  it('markdown renders a family table', () => {
    const out = renderDiffMarkdown(d, 'en');
    expect(out).toContain('|');
    expect(out.toLowerCase()).toMatch(/family|famille/);
  });

  it('html section is a self-contained <section> (no <html>)', () => {
    const out = renderDiffHtmlSection(d, 'en');
    expect(out).toMatch(/^<section/);
    expect(out).not.toContain('<html');
  });

  it('fr and en produce different labels', () => {
    expect(renderDiffMarkdown(d, 'fr')).not.toBe(renderDiffMarkdown(d, 'en'));
  });
});
