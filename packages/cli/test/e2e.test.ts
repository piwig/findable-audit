import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { buildChecks } from '../src/checks/index.js';
import { runAudit } from '../src/runner.js';
import { renderTerminal } from '../src/report/terminal.js';
import { renderJson } from '../src/report/json.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

describe('perfect site e2e', () => {
  it('scores 100 and renders both reports', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const report = await runAudit(srv.url, buildChecks({ indexnowKey: 'testkey123' }));
    const failing = report.results.filter((r) => r.status === 'fail' || r.status === 'warn');
    expect(failing).toEqual([]); // every non-skip check passes
    expect(report.score).toBe(100);
    expect(report.grade).toBe('A'); // perfect-100 invariant: weighted score 100 -> grade A
    // familyScores present and non-empty: only included families (>=1 non-skip check).
    expect(report.familyScores.length).toBeGreaterThan(0);
    expect(report.familyScores.every((f) => f.score === 100)).toBe(true);
    expect(report.sampledPages).toEqual(['/', '/about.html']);
    expect(renderTerminal(report)).toContain('100/100');
    expect(renderTerminal(report)).toContain('Grade: A');
    const json = JSON.parse(renderJson(report));
    expect(json.score).toBe(100);
    expect(json.grade).toBe('A');
    expect(Array.isArray(json.familyScores)).toBe(true);
  });
});
