import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const fixtures = path.join(here, 'fixtures');
const distIndex = path.join(pkgRoot, 'dist', 'index.js');

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true }, (err, stdout, stderr) => {
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
    const { code, stdout } = await runCli([srv.url, '--json', '--indexnow-key', 'testkey123']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.score).toBe(100);
    expect(Array.isArray(report.results)).toBe(true);
  }, 30_000);

  it('exits 1 when the score is below --min-score', async () => {
    const srv = await serveFixture(path.join(fixtures, 'blocked-ai'));
    closers.push(srv.close);
    const { code, stdout } = await runCli([srv.url, '--json', '--min-score', '100']);
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
});
