import { test, expect } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const FIXTURE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>'
  + '<meta name="description" content="fixture"></head><body><h1>Hi</h1><p>content</p></body></html>';

async function withFixture(fn: (base: string) => Promise<void>) {
  const server = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(FIXTURE_HTML); });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address() as import('node:net').AddressInfo;
  try { await fn(`http://127.0.0.1:${port}/`); } finally { server.close(); }
}

// NOTE: uses async execFile rather than spawnSync. spawnSync blocks this
// process's entire event loop (via a private libuv loop) until the child
// exits, which would starve the in-process fixture HTTP server above and
// deadlock the child's own fetch until it times out. execFile keeps this
// process's event loop pumping so the fixture server can respond. Same CLI
// invocations and assertions as the spec; only the spawn mechanism differs.
function runCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      const status = err ? (((err as NodeJS.ErrnoException).code as number) ?? 1) : 0;
      resolve({ status, stdout, stderr });
    });
  });
}

test('--report *.json writes a valid JSON report', async () => {
  await withFixture(async (base) => {
    const out = path.join(process.cwd(), 'tmp-cli-report.json');
    rmSync(out, { force: true });
    const r = await runCli([DIST, base, '--report', out, '--min-score', '0']);
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(typeof parsed.score).toBe('number');
    rmSync(out, { force: true });
  });
});

test('--lang fr is accepted and writes the md report', async () => {
  await withFixture(async (base) => {
    const out = path.join(process.cwd(), 'tmp-cli-report-fr.md');
    rmSync(out, { force: true });
    const r = await runCli([DIST, base, '--report', out, '--lang', 'fr', '--min-score', '0']);
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    rmSync(out, { force: true });
  });
});

test('--lang xx is rejected with exit code 2', async () => {
  const r = await runCli([DIST, 'https://example.com', '--lang', 'xx']);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/--lang/);
});

test('--report *.svg writes a self-contained status badge', async () => {
  await withFixture(async (base) => {
    const out = path.join(process.cwd(), 'tmp-cli-badge.svg');
    rmSync(out, { force: true });
    const r = await runCli([DIST, base, '--report', out, '--min-score', '0']);
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const body = readFileSync(out, 'utf8');
    expect(body.startsWith('<svg')).toBe(true);
    expect(body).toContain('>findable<');
    expect(body).toMatch(/>[A-F] \d{1,3}\/100</);
    expect(body).not.toMatch(/<script/i);
    rmSync(out, { force: true });
  });
});

test('--report *.shields.json writes a shields.io endpoint document', async () => {
  await withFixture(async (base) => {
    const out = path.join(process.cwd(), 'tmp-cli-badge.shields.json');
    rmSync(out, { force: true });
    const r = await runCli([DIST, base, '--report', out, '--min-score', '0']);
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.label).toBe('findable');
    expect(parsed.message).toMatch(/^[A-F] \d{1,3}\/100$/);
    expect(parsed.color).toMatch(/^#[0-9a-f]{6}$/);
    // Must NOT be the full audit report (the generic .json branch).
    expect(parsed.score).toBeUndefined();
    expect(parsed.checks).toBeUndefined();
    rmSync(out, { force: true });
  });
});

test('--report *.junit.xml writes a JUnit XML report', async () => {
  await withFixture(async (base) => {
    const out = path.join(process.cwd(), 'tmp-cli-report.junit.xml');
    rmSync(out, { force: true });
    const r = await runCli([DIST, base, '--report', out, '--min-score', '0']);
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const body = readFileSync(out, 'utf8');
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain('<testsuites');
    expect(body).toContain('classname="findable-audit.');
    rmSync(out, { force: true });
  });
});

// A131 — --format overrides the extension; `--report -` streams to stdout.
test('--report - --format json streams the JSON report on stdout and skips the human summary', async () => {
  await withFixture(async (base) => {
    const r = await runCli([DIST, base, '--report', '-', '--format', 'json', '--min-score', '0']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed.score).toBe('number');
    expect(r.stderr).toMatch(/written to stdout/);
  });
});

test('--format sarif wins over a .txt extension', async () => {
  await withFixture(async (base) => {
    const out = path.join(process.cwd(), 'tmp-cli-forced.txt');
    rmSync(out, { force: true });
    const r = await runCli([DIST, base, '--report', out, '--format', 'sarif', '--min-score', '0']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(Array.isArray(parsed.runs)).toBe(true);
    rmSync(out, { force: true });
  });
});

test('--report - without --format is Markdown', async () => {
  await withFixture(async (base) => {
    const r = await runCli([DIST, base, '--report', '-', '--min-score', '0']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^# /m);
  });
});

test('--format bogus is rejected with exit code 2', async () => {
  const r = await runCli([DIST, 'https://example.com', '--format', 'bogus']);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/--format/);
});
