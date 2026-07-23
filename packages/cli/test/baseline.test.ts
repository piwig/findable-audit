import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { buildChecks } from '../src/checks/index.js';
import { runAudit } from '../src/runner.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderHtml } from '../src/report/html.js';
import { diffReports } from '../src/report/diff.js';
import type { AuditReport } from '../src/runner.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

function baseReport(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://ex.com/', score: 70, grade: 'C',
    familyScores: [{ family: 'ai-access', score: 70, weight: 0.2, earned: 14, max: 20 }],
    sampledPages: ['/'], results: [], ...over,
  };
}

describe('runAudit generatedAt', () => {
  it('stamps an ISO generatedAt on the report', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const report = await runAudit(srv.url, buildChecks({ indexnowKey: 'testkey123' }));
    expect(typeof report.generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(report.generatedAt!))).toBe(false);
  });
});

describe('renderers with a diff', () => {
  const current = baseReport({ score: 82 });
  const baseline = baseReport({ score: 70 }); // no generatedAt → must be tolerated
  const diff = diffReports(current, baseline);

  it('markdown includes the "vs baseline" section only when a diff is passed', () => {
    const withDiff = renderMarkdown(current, new Date('2026-07-24'), 'en', { diff });
    const without = renderMarkdown(current, new Date('2026-07-24'), 'en');
    expect(withDiff.toLowerCase()).toContain('baseline');
    expect(without.toLowerCase()).not.toContain('change vs baseline');
  });

  it('html includes the diff section only when a diff is passed', () => {
    const withDiff = renderHtml(current, new Date('2026-07-24'), 'en', { diff });
    const without = renderHtml(current, new Date('2026-07-24'), 'en');
    expect(withDiff).toContain('class="diff"');
    expect(without).not.toContain('class="diff"');
  });
});
