import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredFlags } from './docs-flags.test.js';

/**
 * A130 — `--help` is the first thing anyone who installs the package reads. It used
 * to open with a single 584-character line listing 32 options, which a 100-column
 * terminal wraps six times mid-word before the first explanation. The text was fine;
 * its shape was not. These tests hold the new shape: a short head, and topics.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(here, '..', 'dist', 'index.js');
const CLI_SRC = path.join(here, '..', 'src', 'index.ts');

function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true }, (err, stdout) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number ?? 1) : 0;
      resolve({ code, stdout });
    });
  });
}

const TOPICS = ['audit', 'compare', 'output', 'ci', 'network'];

describe('findable --help', () => {
  it('is short enough to read at once, and no line overflows 110 columns', async () => {
    const { code, stdout } = await runCli(['--help']);
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(30);
    const tooLong = lines.filter((l) => l.length > 110);
    expect(tooLong, `lignes trop longues : ${tooLong.join(' | ')}`).toEqual([]);
  });

  it('names every topic it accepts', async () => {
    const { stdout } = await runCli(['--help']);
    for (const topic of TOPICS) expect(stdout).toContain(topic);
  });

  it('prints one section per topic, each different from the head', async () => {
    const head = (await runCli(['--help'])).stdout;
    for (const topic of TOPICS) {
      const { code, stdout } = await runCli(['--help', topic]);
      expect(code).toBe(0);
      expect(stdout.trim().length).toBeGreaterThan(100);
      expect(stdout).not.toBe(head);
    }
  });

  it('--help all still contains every flag the CLI accepts', async () => {
    const { stdout } = await runCli(['--help', 'all']);
    const missing = declaredFlags(fs.readFileSync(CLI_SRC, 'utf8')).filter((f) => !stdout.includes(`--${f}`));
    expect(missing, `flags absents de --help all : ${missing.join(', ')}`).toEqual([]);
  });

  it('an unknown topic lists the real ones instead of failing', async () => {
    const { code, stdout } = await runCli(['--help', 'chaussettes']);
    expect(code).toBe(0);
    expect(stdout).toContain('unknown help topic');
    for (const topic of TOPICS) expect(stdout).toContain(topic);
  });

  it('an invalid invocation prints the head, not the whole manual', async () => {
    // The old behaviour dumped every option on every validation error.
    const { code, stdout } = await runCli([]);
    expect(code).toBe(2);
    expect(stdout.trimEnd().split('\n').length).toBeLessThanOrEqual(30);
  });
});
