import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { buildChecks } from '../src/checks/index.js';
import { runAudit, UnreachableSiteError } from '../src/runner.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

describe('runAudit', () => {
  it('throws UnreachableSiteError for a dead host', async () => {
    await expect(runAudit('http://127.0.0.1:1', buildChecks())).rejects.toBeInstanceOf(UnreachableSiteError);
  });
  it('produces a normalized score over non-skipped checks', async () => {
    const srv = await serveFixture(path.join(fixtures, 'llm-good'));
    closers.push(srv.close);
    const report = await runAudit(srv.url, buildChecks());
    expect(report.results).toHaveLength(15);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
    const skipped = report.results.filter((r) => r.status === 'skip');
    expect(skipped.map((r) => r.id).sort()).toEqual(['https', 'indexnow']);
  });
});
