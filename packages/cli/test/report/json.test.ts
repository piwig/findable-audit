import { describe, it, expect } from 'vitest';
import { renderJson, JSON_SCHEMA_VERSION } from '../../src/report/json.js';
import type { AuditReport } from '../../src/runner.js';

const report: AuditReport = {
  url: 'https://example.com/',
  score: 72,
  grade: 'C',
  familyScores: [],
  sampledPages: ['/'],
  results: [
    { id: 'llms-txt', family: 'llm-content', status: 'fail', points: 0, maxPoints: 10, message: 'llms.txt missing' },
  ],
};

// A86: the JSON output is a machine contract — it needs a schemaVersion, and
// with --baseline the diff must travel with it (before, it only reached
// HTML/Markdown and the terminal).
describe('renderJson', () => {
  it('keeps every report field at the top level and adds schemaVersion', () => {
    const out = JSON.parse(renderJson(report));
    expect(out.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(out.url).toBe('https://example.com/');
    expect(out.score).toBe(72);
    expect(out.results).toHaveLength(1);
    expect(out.diff).toBeUndefined(); // no --baseline → no diff key at all
  });

  it('embeds the baseline diff when given', () => {
    const diff = {
      baselineScore: 80,
      currentScore: 72,
      scoreDelta: -8,
      familyDeltas: [],
      regressions: [
        { id: 'llms-txt', family: 'llm-content' as const, from: 'pass' as const, to: 'fail' as const, message: 'llms.txt missing' },
      ],
      improvements: [],
      added: [],
      removed: [],
    };
    const out = JSON.parse(renderJson(report, { diff }));
    expect(out.diff.scoreDelta).toBe(-8);
    expect(out.diff.regressions[0].id).toBe('llms-txt');
  });

  it('stays parseable by the baseline loader (report fields not nested)', () => {
    // `--baseline` reads a previous JSON output: score/results must remain
    // exactly where diffReports expects them.
    const out = JSON.parse(renderJson(report)) as AuditReport;
    expect(Array.isArray(out.results)).toBe(true);
    expect(typeof out.score).toBe('number');
  });
});
