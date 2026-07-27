// Compile the package ONCE, before any test worker starts.
//
// Why this is not a `beforeAll` in the suites that need it: several suites spawn
// `dist/index.js` as a child process (cli, cli-emit, cli-report-dispatch,
// cli-submit, e2e), and vitest runs test FILES in parallel. A `beforeAll` that
// runs tsc therefore rewrites ~120 files in `dist/` while another worker is
// importing them. The child then dies on a half-written module, and the suite
// that happened to be running sees a wrong exit code ("expected 1 to be 2") or a
// report that was never written (ENOENT) — a different test each time, on any
// platform, in roughly one CI run out of eight.
//
// A global setup runs to completion before the first worker spawns, so nothing
// can be executing `dist/` while it is being written.
//
// It compiles only when `dist` is stale, which keeps a focused run
// (`vitest run test/report/badge.test.ts`) as fast as it was.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');

/** Newest mtime under a directory (recursive), 0 when it does not exist. */
function newestMtime(dir: string): number {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function mtimeOf(file: string): number {
  try { return statSync(file).mtimeMs; } catch { return 0; }
}

export async function setup(): Promise<void> {
  const built = mtimeOf(path.join(pkgRoot, 'dist', 'index.js'));
  const sources = Math.max(
    newestMtime(path.join(pkgRoot, 'src')),
    mtimeOf(path.join(pkgRoot, 'tsconfig.json')),
  );
  if (built > 0 && built >= sources) return; // dist is current — nothing to do

  const require = createRequire(import.meta.url);
  const tscJs = path.join(path.dirname(require.resolve('typescript')), 'tsc.js');
  await new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      [tscJs, '-p', path.join(pkgRoot, 'tsconfig.json')],
      { cwd: pkgRoot, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(new Error(`tsc failed:\n${stdout}\n${stderr}`)) : resolve()),
    );
  });
}
