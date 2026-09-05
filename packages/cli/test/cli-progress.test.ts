// A133 — progress readable outside a TTY: `--progress plain` (or CI=true) writes
// one line per sampled page on stderr instead of staying silent until the result.
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const distIndex = path.join(here, '..', 'dist', 'index.js');

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true, env: { ...process.env, CI: '', ...env } }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number ?? 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

describe('--progress (A133)', () => {
  it('plain: one "page n/m" line per sampled page and a final "checks" line, no cursor rewrites', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const { code, stderr } = await runCli([srv.url, '--json', '--no-report', '--progress', 'plain']);
    expect(code).toBe(0);
    expect(stderr).toMatch(/^page 1\/\d+$/m);
    expect(stderr).toMatch(/^checks (\d+)\/\1$/m);
    expect(stderr).not.toContain('\r');
  }, 30_000);

  it('non-TTY child with CI=true defaults to plain', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const { stderr } = await runCli([srv.url, '--json', '--no-report'], { CI: 'true' });
    expect(stderr).toMatch(/^page 1\/\d+$/m);
  }, 30_000);

  it('off and --quiet print no progress lines', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const off = await runCli([srv.url, '--json', '--no-report', '--progress', 'off']);
    expect(off.stderr).not.toMatch(/^page \d+\/\d+$/m);
    const quiet = await runCli([srv.url, '--json', '--no-report', '--quiet', '--progress', 'plain']);
    expect(quiet.stderr).not.toMatch(/^page \d+\/\d+$/m);
  }, 30_000);

  it('rejects an unknown mode with exit 2 and a clear message', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:1', '--progress', 'fancy']);
    expect(code).toBe(2);
    expect(stderr).toContain('--progress expects tty, plain or off');
  }, 30_000);
});
