// #63 — the evidence axis: does a verdict rest on an external standard, or on a
// bar we chose? Independent of severity, and the whole point is that the reader
// can tell the two apart without reading our source.
import { describe, it, expect } from 'vitest';
import { buildChecks } from '../../src/checks/index.js';
import { renderHtml } from '../../src/report/html.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import { renderJson } from '../../src/report/json.js';
import type { AuditReport } from '../../src/runner.js';

const checks = buildChecks();

function reportOf(results: AuditReport['results']): AuditReport {
  return {
    url: 'https://example.com/', score: 80, grade: 'B',
    familyScores: [{ family: 'llm-content', score: 80, weight: 0.18, earned: 8, max: 10 }],
    sampledPages: ['/'], results,
  };
}
const HEURISTIC_RESULT: AuditReport['results'][number] = {
  id: 'hedging-rate', family: 'llm-content', evidence: 'heuristic', status: 'warn',
  points: 1, maxPoints: 3, message: 'hedged leads on: /',
};
const MEASURED_RESULT: AuditReport['results'][number] = {
  id: 'hsts', family: 'security', evidence: 'measured', status: 'pass',
  points: 4, maxPoints: 4, message: 'HSTS max-age=31536000',
};

describe('every check declares what its verdict rests on', () => {
  it('classifies all of them, with no third state', () => {
    for (const c of checks) expect(['measured', 'heuristic']).toContain(c.evidence);
  });

  it('has both kinds — a catalogue that were all one or the other would be a lie', () => {
    const measured = checks.filter((c) => c.evidence === 'measured').length;
    const heuristic = checks.filter((c) => c.evidence === 'heuristic').length;
    expect(measured).toBeGreaterThan(0);
    expect(heuristic).toBeGreaterThan(0);
    expect(measured + heuristic).toBe(checks.length);
  });

  it('keeps the checks named as advisory in CLAUDE.md on the heuristic side', () => {
    for (const id of ['hedging-rate', 'answer-units', 'chunk-boundary', 'chunk-retrieval-sim',
      'content-lead-answer', 'content-readability', 'anchor-text']) {
      expect(checks.find((c) => c.id === id)?.evidence, id).toBe('heuristic');
    }
  });

  it('keeps spec-backed checks on the measured side, whatever their severity', () => {
    // security-txt only ever warns and is still measured: severity and evidence
    // are different axes, which is exactly what this label exists to show.
    for (const id of ['https', 'hsts', 'csp', 'canonical', 'json-ld-valid', 'images-alt',
      'cwv-lcp', 'security-txt', 'ai-crawlers-allowed']) {
      expect(checks.find((c) => c.id === id)?.evidence, id).toBe('measured');
    }
  });
});

describe('the label reaches the reader', () => {
  it('badges a heuristic check in HTML, and says what the badge means', () => {
    const html = renderHtml(reportOf([HEURISTIC_RESULT]), new Date('2026-07-27T00:00:00Z'));
    expect(html).toContain('class="ck-ev"');
    expect(html).toContain('heuristic');
    expect(html).toContain('ev-legend');
  });

  it('leaves a measured check unmarked, and drops the legend entirely', () => {
    const html = renderHtml(reportOf([MEASURED_RESULT]), new Date('2026-07-27T00:00:00Z'));
    expect(html).not.toContain('class="ck-ev"');
    // The stylesheet always ships every rule; it is the markup that must be absent.
    expect(html).not.toContain('<p class="ev-legend"');
  });

  it('marks it in Markdown too', () => {
    const md = renderMarkdown(reportOf([HEURISTIC_RESULT, MEASURED_RESULT]), new Date('2026-07-27T00:00:00Z'));
    expect(md).toMatch(/hedging-rate`\s*_\(heuristic\)_/);
    expect(md).not.toMatch(/hsts`\s*_\(/);
  });

  it('translates the badge rather than leaving English in a French report', () => {
    const fr = renderHtml(reportOf([HEURISTIC_RESULT]), new Date('2026-07-27T00:00:00Z'), 'fr');
    expect(fr).toContain('heuristique');
  });

  it('exposes it in JSON, for both kinds, so a machine gets the full picture', () => {
    const json = JSON.parse(renderJson(reportOf([HEURISTIC_RESULT, MEASURED_RESULT])));
    expect(json.results.map((r: { evidence: string }) => r.evidence)).toEqual(['heuristic', 'measured']);
  });
});
