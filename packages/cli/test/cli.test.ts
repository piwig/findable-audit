import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const fixtures = path.join(here, 'fixtures');
const distIndex = path.join(pkgRoot, 'dist', 'index.js');

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

function runCli(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true, cwd }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number ?? 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

beforeAll(async () => {
  // Compile the package with tsc (cross-platform: run lib/tsc.js with node).
  const require = createRequire(import.meta.url);
  const tscJs = path.join(path.dirname(require.resolve('typescript')), 'tsc.js');
  await new Promise<void>((resolve, reject) => {
    execFile(process.execPath, [tscJs, '-p', path.join(pkgRoot, 'tsconfig.json')], { cwd: pkgRoot, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(new Error(`tsc failed:\n${stdout}\n${stderr}`)) : resolve()));
  });
}, 120_000);

describe('findable CLI binary', () => {
  it('exits 0 and prints a JSON report for a perfect site', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const { code, stdout } = await runCli([srv.url, '--json', '--no-report', '--indexnow-key', 'testkey123']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.score).toBe(100);
    expect(Array.isArray(report.results)).toBe(true);
  }, 30_000);

  it('exits 1 when the score is below --min-score', async () => {
    const srv = await serveFixture(path.join(fixtures, 'blocked-ai'));
    closers.push(srv.close);
    const { code, stdout } = await runCli([srv.url, '--json', '--no-report', '--min-score', '100']);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).score).toBeLessThan(100);
  }, 30_000);

  it('exits 2 on a non-numeric --min-score with a clear message', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:1', '--min-score', 'abc']);
    expect(code).toBe(2);
    expect(stderr).toContain('--min-score');
    expect(stderr).toContain('Usage:');
  });

  it('exits 2 on an unreachable site (with --timeout honoured)', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:1', '--timeout', '500']);
    expect(code).toBe(2);
    expect(stderr).toContain('Cannot reach');
  }, 30_000);

  it('exits 2 on an invalid --timeout', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:1', '--timeout', 'nope']);
    expect(code).toBe(2);
    expect(stderr).toContain('--timeout');
  });

  it('exits 2 on an empty --psi-key', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:1', '--psi-key', '   ']);
    expect(code).toBe(2);
    expect(stderr).toContain('--psi-key');
    expect(stderr).toContain('Usage:');
  });

  it('writes a Markdown report with --report', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const out = path.join(tmpdir(), `findable-report-${Date.now()}.md`);
    try {
      const { code } = await runCli([srv.url, '--report', out, '--indexnow-key', 'testkey123']);
      expect(code).toBe(0);
      const md = readFileSync(out, 'utf8');
      expect(md).toContain('# findable-audit — ');
      expect(md).toContain('**Score: 100/100**');
      expect(md).toContain('## AI crawler access');
    } finally {
      rmSync(out, { force: true });
    }
  }, 30_000);

  it('writes both a Markdown and an HTML report when --report is repeated', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const md = path.join(tmpdir(), `findable-report-${Date.now()}.md`);
    const html = path.join(tmpdir(), `findable-report-${Date.now()}.html`);
    try {
      const { code } = await runCli([srv.url, '--report', md, '--report', html, '--indexnow-key', 'testkey123']);
      expect(code).toBe(0);
      expect(readFileSync(md, 'utf8')).toContain('# findable-audit — ');
      const h = readFileSync(html, 'utf8');
      expect(h.trimStart()).toMatch(/^<!doctype html/i);
      expect(h).toContain('Score: 100/100');
    } finally {
      rmSync(md, { force: true });
      rmSync(html, { force: true });
    }
  }, 30_000);

  it('exits 2 when the --report path is not writable', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const bad = path.join(tmpdir(), `no-such-dir-${Date.now()}`, 'report.md');
    const { code, stderr } = await runCli([srv.url, '--report', bad, '--indexnow-key', 'testkey123']);
    expect(code).toBe(2);
    expect(stderr).toContain('cannot write report');
  }, 30_000);

  it('writes <host>-<date>.md and .html to the cwd by default (no --report)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-cwd-'));
    try {
      const { code } = await runCli([srv.url, '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      const files = readdirSync(workdir);
      const md = files.find((f) => f.endsWith('.md'));
      const html = files.find((f) => f.endsWith('.html'));
      expect(md).toMatch(/^127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.md$/);
      expect(html).toMatch(/^127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.html$/);
      expect(readFileSync(path.join(workdir, md!), 'utf8')).toContain('# findable-audit — ');
      expect(readFileSync(path.join(workdir, html!), 'utf8').trimStart()).toMatch(/^<!doctype html/i);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it('writes no files with --no-report', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-cwd-'));
    try {
      const { code } = await runCli([srv.url, '--no-report', '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      expect(readdirSync(workdir)).toEqual([]);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it('explicit --report suppresses the default files', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-cwd-'));
    try {
      const { code } = await runCli([srv.url, '--report', 'custom.md', '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      expect(readdirSync(workdir)).toEqual(['custom.md']); // only the explicit file, no host-date defaults
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);
});
