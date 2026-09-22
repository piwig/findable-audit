import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const valid = { url: 'https://other.example/', score: 100, grade: 'A', sampledPages: ['/'], results: [], familyScores: [] };
it.each([
  [{ ...valid, results: [null] }, /not a valid audit report/],
  [{ ...valid, familyScores: [null] }, /not a valid audit report/],
  [valid, /different site/],
])('rejects an unusable baseline before fetching the target', async (baseline, message) => {
  const file = path.join(tmpdir(), `findable-baseline-${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(baseline));
  try {
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [cli, 'http://127.0.0.1:9/', '--baseline', file, '--no-report'], { encoding: 'utf8' }, (err, stdout, stderr) => {
        resolve({ code: err ? Number((err as NodeJS.ErrnoException).code) : 0, stdout, stderr });
      });
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(message as RegExp);
    expect(result.stderr).not.toMatch(/auditing|TypeError|ECONNREFUSED/);
    expect(result.stdout).toBe('');
  } finally { rmSync(file, { force: true }); }
});
