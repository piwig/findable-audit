import { describe, it, expect } from 'vitest';
import { validateBaseline } from '../src/report/baseline.js';
import { diffReports, versionNotice, renderDiffTerminal, renderDiffMarkdown, renderDiffHtmlSection } from '../src/report/diff.js';
import { renderCompareMarkdown, renderCompareHtml, renderCompareTerminal } from '../src/report/compare.js';
import { computeScore } from '../src/scoring.js';
import type { AuditReport } from '../src/runner.js';
import type { CheckResult } from '../src/types.js';

const check = (id: string, status: CheckResult['status']): CheckResult => ({ id, family: 'ai-access', evidence: 'measured', status, points: status === 'pass' ? 10 : 0, maxPoints: 10, message: status });
const report = (results = [check('stable', 'pass')], extra: Partial<AuditReport> = {}): AuditReport => ({ url: 'https://example.org/', sampledPages: ['/'], results, ...computeScore(results), ...extra });

describe('baseline validation', () => {
  it('accepts authentic legacy reports without version, date or evidence', () => {
    const old = JSON.parse(JSON.stringify(report())); delete old.results[0].evidence;
    expect(validateBaseline(old, 'https://example.org/other').ok).toBe(true);
  });
  it.each([{ results: [null] }, { familyScores: [null] }, { familyScores: [{ family: 'security', score: '90' }] }, { score: Infinity }, { results: [{ ...check('x', 'pass'), status: 'other' }] }])('rejects malformed consumed fields %j', (extra) => {
    expect(validateBaseline({ ...report(), ...extra })).toEqual({ ok: false, reason: 'invalid-report' });
  });
  it('rejects a report from another domain', () => {
    expect(validateBaseline(report(), 'https://elsewhere.example/')).toEqual({ ok: false, reason: 'different-site' });
  });
});

describe('honest comparison scope', () => {
  it('names an unknown current version as well as an unknown baseline', () => {
    expect(versionNotice(diffReports(report(), report([], { toolVersion: '0.11.0' })))).toMatch(/current.*version|version.*current/i);
  });
  it('keeps the measured delta but explains fail-to-skip and a changed corpus', () => {
    const before = report([check('stable', 'pass'), check('conditional', 'fail')], { toolVersion: '0.12.0' });
    const after = report([check('stable', 'pass'), check('conditional', 'skip')], { toolVersion: '0.12.0', sampledPages: ['/', '/new'] });
    const diff = diffReports(after, before);
    expect(diff.scoreDelta).toBe(50);
    for (const render of [renderDiffTerminal, renderDiffMarkdown, renderDiffHtmlSection]) {
      const text = render(diff, 'en');
      expect(text).toContain('https://example.org/');
      expect(text).toMatch(/sampled pages differ/i);
      expect(text).toMatch(/applicable checks differ/i);
      expect(text).toMatch(/do not establish.*improvement/i);
    }
  });
  it('compares page sets independent of order and ignores skip-only catalogue changes', () => {
    const a = report([check('stable', 'pass')], { toolVersion: '0.12.0', sampledPages: ['/', '/two'] });
    const b = report([...a.results, check('unused', 'skip')], { toolVersion: '0.12.0', sampledPages: ['/two', '/'] });
    expect(renderDiffTerminal(diffReports(a, b))).not.toMatch(/sampled pages differ|applicable checks differ/i);
  });
  it('escapes version and URL notices in HTML and Markdown', () => {
    const diff = diffReports(report([], { url: 'https://example.org/<img src=x>', toolVersion: '<script>alert(1)</script>' }), report([], { toolVersion: 'old' }));
    for (const render of [renderDiffHtmlSection, renderDiffMarkdown]) {
      expect(render(diff)).not.toMatch(/<script>|<img src=x>/);
      expect(render(diff)).toContain('&lt;');
    }
  });
  it('shows sample sizes and applicable controls in every competitor rendering', () => {
    for (const render of [(r: AuditReport[]) => renderCompareHtml(r), renderCompareMarkdown, renderCompareTerminal]) {
      const text = render([report(), report([], { url: 'https://other.example/', sampledPages: ['/', '/two'] })]);
      expect(text).toMatch(/Pages examined/);
      expect(text).toMatch(/Applicable checks/);
      expect(text).toMatch(/different.*applicable|applicable.*differ/i);
    }
  });
});
