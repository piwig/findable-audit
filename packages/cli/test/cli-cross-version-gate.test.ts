import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';

/**
 * A128 — the CI half. `--fail-on-regression` must not exit 1 because OUR scoring
 * model moved between two releases; that is a false alarm the client pays for in
 * trust. The gate is held, loudly, unless --allow-cross-version accepts the mixed
 * comparison on purpose.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(here, '..', 'dist', 'index.js');
const fixtures = path.join(here, 'fixtures');

const closers: Array<() => Promise<void>> = [];
const workdirs: string[] = [];
afterAll(async () => {
  for (const c of closers) await c();
  for (const d of workdirs) rmSync(d, { recursive: true, force: true });
});

function runCli(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true }, (err, _stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number ?? 1) : 0;
      resolve({ code, stderr });
    });
  });
}

/** A baseline nobody can beat, so the gate would always trip if it were applied. */
function writeBaseline(toolVersion?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'findable-xver-'));
  workdirs.push(dir);
  const file = path.join(dir, 'baseline.json');
  writeFileSync(file, JSON.stringify({
    url: 'https://ex.com/', score: 100, grade: 'A',
    familyScores: [{ family: 'ai-access', score: 100, weight: 0.2, earned: 20, max: 20 }],
    sampledPages: ['/'], results: [], toolVersion,
  }));
  return file;
}

describe('--fail-on-regression across findable-audit versions', () => {
  it('holds the gate (exit 0) and explains why when the baseline is from another version', async () => {
    const srv = await serveFixture(path.join(fixtures, 'mini'));
    closers.push(srv.close);
    const { code, stderr } = await runCli([
      srv.url, '--no-report', '--min-score', '0', '--baseline', writeBaseline('0.0.1'), '--fail-on-regression',
    ]);
    expect(code).toBe(0);
    expect(stderr).toContain('0.0.1');
    expect(stderr).toContain('--allow-cross-version');
  });

  it('fires the gate (exit 1) once --allow-cross-version accepts the mixed comparison', async () => {
    const srv = await serveFixture(path.join(fixtures, 'mini'));
    closers.push(srv.close);
    const { code } = await runCli([
      srv.url, '--no-report', '--min-score', '0', '--baseline', writeBaseline('0.0.1'),
      '--fail-on-regression', '--allow-cross-version',
    ]);
    expect(code).toBe(1);
  });

  it('still fires the gate for a same-version baseline, untouched', async () => {
    const { version } = JSON.parse(
      (await import('node:fs')).readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string };
    const srv = await serveFixture(path.join(fixtures, 'mini'));
    closers.push(srv.close);
    const { code } = await runCli([
      srv.url, '--no-report', '--min-score', '0', '--baseline', writeBaseline(version), '--fail-on-regression',
    ]);
    expect(code).toBe(1);
  });

  it('still fires the gate for a versionless baseline (unknown is not a licence to skip)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'mini'));
    closers.push(srv.close);
    const { code } = await runCli([
      srv.url, '--no-report', '--min-score', '0', '--baseline', writeBaseline(undefined), '--fail-on-regression',
    ]);
    expect(code).toBe(1);
  });
});
