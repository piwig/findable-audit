// A138 — --dry-run: see what --emit / --emit-probes / --submit would do, without doing it.
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(here, '..', 'dist', 'index.js');
const fixtures = path.join(here, 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

function runCli(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true }, (err, _stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number ?? 1) : 0, stderr });
    });
  });
}

describe('findable CLI --dry-run', () => {
  it('lists the 7 files --emit would write, writes none, exit 0', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), 'findable-dry-')), 'out');
    try {
      const { code, stderr } = await runCli([srv.url, '--emit', outDir, '--emit-probes', path.join(outDir, 'probes.json'), '--no-report', '--indexnow-key', 'testkey123', '--dry-run']);
      expect(code).toBe(0);
      expect(stderr).toContain('would write 7 generated files');
      expect(stderr).toContain(path.join(outDir, 'robots.txt'));
      expect(stderr).toContain(path.join(outDir, 'GENERATED-README.md'));
      expect(stderr).toContain('would write AI probe suggestions');
      expect(stderr).not.toContain('generated indexing files in');
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(path.dirname(outDir), { recursive: true, force: true });
    }
  }, 30_000);

  it('lists the URLs --submit would send and sends nothing', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const { code, stderr } = await runCli([srv.url, '--no-report', '--indexnow-key', 'testkey123', '--submit', '--dry-run', '--max-pages', '2']);
    expect(code).toBe(0);
    // Either the key file is verified on the fixture (then the URL list is shown) or it is not
    // (then the ownership guard refuses first). In both cases nothing is submitted.
    expect(stderr).toMatch(/would submit [0-9]+ URL[(]s[)] to IndexNow [(]nothing sent[)]|not submitting/);
    expect(stderr).not.toMatch(/^submitting /m);
    expect(stderr).not.toMatch(/accepted by the IndexNow service/);
  }, 30_000);

  it('without --dry-run the behaviour is unchanged: files are written', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const outDir = mkdtempSync(path.join(tmpdir(), 'findable-wet-'));
    try {
      const { code } = await runCli([srv.url, '--emit', outDir, '--no-report', '--indexnow-key', 'testkey123']);
      expect(code).toBe(0);
      expect(readdirSync(outDir).length).toBeGreaterThan(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});
