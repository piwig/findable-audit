import { describe, it, expect } from 'vitest';
import { diffReports, versionNotice, renderDiffTerminal, renderDiffMarkdown, renderDiffHtmlSection } from '../src/report/diff.js';
import type { AuditReport } from '../src/runner.js';
import type { CheckResult } from '../src/types.js';

/**
 * A128 — `--baseline` used to compare two reports without ever asking whether they
 * were measured with the same ruler. Between two releases checks are added, and
 * because family weights are fixed and sum to 1.00, a new check dilutes every other
 * check in its family: the score moves without the site moving. A client's CI
 * running `--fail-on-regression` monthly would blame the site for our release.
 */

function chk(id: string, status: CheckResult['status']): CheckResult {
  const points = status === 'pass' ? 10 : status === 'warn' ? 5 : 0;
  return { id, family: 'ai-access', status, points, maxPoints: 10, message: `${id} is ${status}` };
}

function report(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://ex.com/',
    score: 70,
    grade: 'C',
    familyScores: [{ family: 'ai-access', score: 70, weight: 0.2, earned: 14, max: 20 }],
    sampledPages: ['/'],
    results: [chk('a', 'pass')],
    ...over,
  };
}

describe('cross-version baselines are named, not silently mixed in', () => {
  it('flags a version mismatch and carries both versions', () => {
    const d = diffReports(report({ toolVersion: '0.12.0', score: 68 }), report({ toolVersion: '0.11.0' }));
    expect(d.crossVersion).toBe(true);
    expect(d.baselineVersionUnknown).toBe(false);
    expect(d.baselineToolVersion).toBe('0.11.0');
    expect(d.currentToolVersion).toBe('0.12.0');
  });

  it('same version on both sides is not cross-version and says nothing', () => {
    const d = diffReports(report({ toolVersion: '0.11.0', score: 68 }), report({ toolVersion: '0.11.0' }));
    expect(d.crossVersion).toBe(false);
    expect(d.baselineVersionUnknown).toBe(false);
    expect(versionNotice(d, 'en')).toBeNull();
    expect(versionNotice(d, 'fr')).toBeNull();
  });

  it('a baseline without a recorded version is unknown, not cross-version', () => {
    const d = diffReports(report({ toolVersion: '0.12.0' }), report());
    expect(d.crossVersion).toBe(false);
    expect(d.baselineVersionUnknown).toBe(true);
    expect(versionNotice(d, 'en')).toMatch(/no tool version/i);
  });

  it('the notice names both versions, in both languages', () => {
    const d = diffReports(report({ toolVersion: '0.12.0' }), report({ toolVersion: '0.11.0' }));
    for (const lang of ['en', 'fr'] as const) {
      const notice = versionNotice(d, lang)!;
      expect(notice).toContain('0.11.0');
      expect(notice).toContain('0.12.0');
    }
    expect(versionNotice(d, 'fr')).not.toBe(versionNotice(d, 'en'));
  });

  it('every renderer shows the notice, and none shows it when versions match', () => {
    const mixed = diffReports(report({ toolVersion: '0.12.0' }), report({ toolVersion: '0.11.0' }));
    const same = diffReports(report({ toolVersion: '0.12.0' }), report({ toolVersion: '0.12.0' }));
    for (const render of [renderDiffTerminal, renderDiffMarkdown, renderDiffHtmlSection]) {
      expect(render(mixed, 'en')).toContain('0.11.0');
      expect(render(same, 'en')).not.toContain('0.11.0');
    }
  });

  it('html stays a self-contained section even with the notice', () => {
    const out = renderDiffHtmlSection(diffReports(report({ toolVersion: '0.12.0' }), report({ toolVersion: '0.11.0' })), 'fr');
    expect(out).toMatch(/^<section/);
    expect(out).not.toContain('<html');
  });
});
