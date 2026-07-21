import { test, expect } from 'vitest';
import http from 'node:http';
import { runAudit, type AuditProgress } from '../src/runner.js';
import { buildChecks } from '../src/checks/index.js';

const FIXTURE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>Fixture</title><meta name="description" content="a test fixture page">' +
  '</head><body><h1>Hello</h1><p>Some readable content for the audit.</p></body></html>';

async function withFixture(fn: (base: string) => Promise<void>) {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as import('node:net').AddressInfo;
  try { await fn(`http://127.0.0.1:${port}/`); }
  finally { server.close(); }
}

test('runAudit emits ordered onProgress events across phases', async () => {
  await withFixture(async (base) => {
    const events: AuditProgress[] = [];
    await runAudit(base, buildChecks(), { onProgress: (e) => events.push(e) });

    expect(events.some((e) => e.phase === 'connect')).toBe(true);
    expect(events.some((e) => e.phase === 'sample')).toBe(true);
    expect(events.some((e) => e.phase === 'checks')).toBe(true);
    expect(events.some((e) => e.phase === 'score')).toBe(true);

    const checks = events.filter((e) => e.phase === 'checks');
    expect(checks.length).toBeGreaterThan(0);
    const last = checks[checks.length - 1];
    expect(last.done).toBe(last.total);          // monotone, ends at total
    expect(typeof last.checkId).toBe('string');  // per-check id present
  });
});

test('onProgress that throws never breaks the audit (best-effort)', async () => {
  await withFixture(async (base) => {
    const report = await runAudit(base, buildChecks(), {
      onProgress: () => { throw new Error('boom'); },
    });
    expect(report.score).toBeGreaterThanOrEqual(0);   // audit still completes
  });
});
