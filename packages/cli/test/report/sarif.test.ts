import { describe, it, expect } from 'vitest';
import { renderSarif } from '../../src/report/sarif.js';
import type { AuditReport } from '../../src/runner.js';

const report: AuditReport = {
  url: 'https://example.com/',
  score: 72,
  grade: 'C',
  familyScores: [],
  sampledPages: ['/'],
  results: [
    { id: 'llms-txt', family: 'llm-content', status: 'fail', points: 0, maxPoints: 10, message: 'llms.txt missing', fix: 'Add /llms.txt', docUrl: 'https://llmstxt.org/' },
    { id: 'evil', family: 'security', status: 'warn', points: 2, maxPoints: 4, message: 'weak header', fix: 'Add the header' },
    { id: 'ok', family: 'on-page', status: 'pass', points: 5, maxPoints: 5, message: 'good' },
    { id: 'skipped', family: 'performance', status: 'skip', points: 0, maxPoints: 6, message: 'n/a' },
  ],
};

describe('renderSarif', () => {
  const sarif = JSON.parse(renderSarif(report));

  it('is a SARIF 2.1.0 document with the findable-audit driver', () => {
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toMatch(/sarif-2\.1\.0/);
    expect(sarif.runs[0].tool.driver.name).toBe('findable-audit');
  });

  it('emits only fail/warn checks as results, with the right SARIF levels', () => {
    const results = sarif.runs[0].results;
    expect(results).toHaveLength(2); // pass + skip are omitted
    const byId = Object.fromEntries(results.map((r: { ruleId: string }) => [r.ruleId, r]));
    expect(byId['llms-txt'].level).toBe('error');   // fail -> error
    expect(byId['evil'].level).toBe('warning');     // warn -> warning
    expect(byId['ok']).toBeUndefined();
    expect(byId['skipped']).toBeUndefined();
  });

  it('includes the fix in the message and the doc link as helpUri', () => {
    const r = sarif.runs[0].results.find((x: { ruleId: string }) => x.ruleId === 'llms-txt');
    expect(r.message.text).toMatch(/Fix: Add \/llms\.txt/);
    const rule = sarif.runs[0].tool.driver.rules.find((x: { id: string }) => x.id === 'llms-txt');
    expect(rule.helpUri).toBe('https://llmstxt.org/');
  });

  it('attaches score, grade and audited URL as run properties + result locations', () => {
    expect(sarif.runs[0].properties.score).toBe(72);
    expect(sarif.runs[0].properties.grade).toBe('C');
    // The location is a RELATIVE pseudo-path, not the audited URL: GitHub rejects
    // an upload whose absolute URI scheme differs from the checkout's (see the
    // ingestion suite below). The URL itself lives in the properties.
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe('findable-audit/example.com/index');
    expect(sarif.runs[0].results[0].properties.url).toBe('https://example.com/');
  });
});

// Regression: GitHub code scanning REJECTED the whole upload when the artifact
// URI was the audited https:// URL — "SARIF URI scheme https did not match the
// checkout URI scheme file". Found by our own self-audit workflow, not by a
// user. The feature is advertised in the README, so it has to actually land.
describe('renderSarif — GitHub code-scanning ingestion', () => {
  const at = (url: string) => JSON.parse(renderSarif({ ...report, url }));

  it('never emits an absolute URI as the artifact location', () => {
    const uri = at('https://example.com/').runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    expect(uri).not.toMatch(/^[a-z][a-z0-9+.-]*:\/\//i);
    expect(uri.startsWith('/')).toBe(false);
  });

  it('derives a stable, readable path from the audited origin', () => {
    const uri = at('https://example.com/').runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    expect(uri).toBe('findable-audit/example.com/index');
    expect(at('https://example.com/pricing').runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri)
      .toBe('findable-audit/example.com/pricing');
  });

  it('is stable across runs, so alerts are not closed and reopened every time', () => {
    const a = at('https://example.com/page/');
    const b = at('https://example.com/page/');
    expect(JSON.stringify(a.runs[0].results)).toBe(JSON.stringify(b.runs[0].results));
  });

  it('keeps the real URL where a human can still read it', () => {
    const run = at('https://example.com/pricing').runs[0];
    expect(run.properties.auditedUrl).toBe('https://example.com/pricing');
    expect(run.results[0].properties.url).toBe('https://example.com/pricing');
  });

  it('sanitises a hostile path instead of emitting a traversal', () => {
    const uri = at('https://example.com/../../etc/passwd').runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    expect(uri).not.toContain('..');
  });
});
