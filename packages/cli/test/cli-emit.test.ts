import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
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
  // Compile the package with tsc (cross-platform: run lib/tsc.js with node),
  // same pattern as cli.test.ts, so this file always exercises the current src.
  const require = createRequire(import.meta.url);
  const tscJs = path.join(path.dirname(require.resolve('typescript')), 'tsc.js');
  await new Promise<void>((resolve, reject) => {
    execFile(process.execPath, [tscJs, '-p', path.join(pkgRoot, 'tsconfig.json')], { cwd: pkgRoot, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(new Error(`tsc failed:\n${stdout}\n${stderr}`)) : resolve()));
  });
}, 120_000);

describe('findable CLI --emit <dir>', () => {
  it('writes the generated indexing files into <dir> and prints the count + EN warning', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const outDir = mkdtempSync(path.join(tmpdir(), 'findable-emit-'));
    try {
      const { code, stderr } = await runCli([srv.url, '--emit', outDir, '--no-report', '--indexnow-key', 'testkey123']);
      expect(code).toBe(0);
      expect(existsSync(path.join(outDir, 'robots.txt'))).toBe(true);
      expect(existsSync(path.join(outDir, 'llms.txt'))).toBe(true);
      expect(existsSync(path.join(outDir, 'llms-full.txt'))).toBe(true);
      expect(existsSync(path.join(outDir, '.well-known', 'ai.json'))).toBe(true);
      expect(existsSync(path.join(outDir, 'sitemap.xml'))).toBe(true);
      expect(existsSync(path.join(outDir, 'jsonld-stubs.json'))).toBe(true);
      expect(existsSync(path.join(outDir, 'GENERATED-README.md'))).toBe(true);
      expect(stderr).toContain('generated indexing files');
      expect(stderr).toContain(`(7 files)`);
      expect(stderr).toContain('review before deploying, especially robots.txt');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('prints the FR warning with --lang fr', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const outDir = mkdtempSync(path.join(tmpdir(), 'findable-emit-fr-'));
    try {
      const { code, stderr } = await runCli([srv.url, '--emit', outDir, '--no-report', '--lang', 'fr', '--indexnow-key', 'testkey123']);
      expect(code).toBe(0);
      expect(stderr).toContain('relire avant de déployer, surtout robots.txt');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not write any generated files without --emit (unchanged behaviour)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-emit-off-'));
    try {
      const { code, stderr } = await runCli([srv.url, '--no-report', '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      expect(readdirSync(workdir)).toEqual([]);
      expect(stderr).not.toContain('generated indexing files');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it('exits 2 on an empty --emit value with a clear message', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:1', '--emit', '   ']);
    expect(code).toBe(2);
    expect(stderr).toContain('--emit');
    expect(stderr).toContain('Usage:');
  });

  it('works alongside the default md/html reports (both are written)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const outDir = mkdtempSync(path.join(tmpdir(), 'findable-emit-with-report-'));
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-emit-cwd-'));
    try {
      const { code } = await runCli([srv.url, '--emit', outDir, '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      expect(existsSync(path.join(outDir, 'robots.txt'))).toBe(true);
      const reportFiles = readdirSync(workdir);
      expect(reportFiles.some((f) => f.endsWith('.md'))).toBe(true);
      expect(reportFiles.some((f) => f.endsWith('.html'))).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);
});
