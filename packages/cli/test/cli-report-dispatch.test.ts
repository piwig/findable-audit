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
