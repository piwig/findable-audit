import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * The check count has a whole skill to keep it propagated. The CLI's flag list had
 * nothing — and on 2026-07-27 the root README was found to be missing five of them,
 * three of which had shipped versions earlier. Nobody noticed because nothing looked.
 *
 * This is that missing look: the flags a user can actually type, compared against the
 * document that claims to list them. It reads `parseArgs` as text rather than importing
 * the CLI, because importing `index.ts` runs it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'index.ts');
const ROOT_README = path.join(HERE, '..', '..', '..', 'README.md');

/** Flags declared in the `parseArgs` options block, minus the two every CLI has. */
export function declaredFlags(source: string): string[] {
  const start = source.indexOf('options: {');
  const end = source.indexOf('} as const');
  if (start < 0 || end < 0 || end < start) throw new Error('parseArgs options block not found in index.ts');
  const block = source.slice(start, end);
  return [...block.matchAll(/^\s+'?([a-z][a-z-]*)'?:\s*\{/gm)]
    .map((m) => m[1])
    .filter((f) => f !== 'help' && f !== 'version');
}

describe('the flag list users read matches the flags the CLI accepts', () => {
  const flags = declaredFlags(fs.readFileSync(CLI, 'utf8'));

  it('finds the flags at all, so a parser change cannot make this test vacuous', () => {
    expect(flags.length).toBeGreaterThan(15);
    expect(flags).toContain('max-pages');
  });

  it('documents every flag in the root README', () => {
    const readme = fs.readFileSync(ROOT_README, 'utf8');
    const undocumented = flags.filter((f) => !readme.includes(`--${f}`));
    expect(undocumented, `flags absents du README : ${undocumented.join(', ')}`).toEqual([]);
  });

  it('documents every flag in the CLI --help output', () => {
    const usage = fs.readFileSync(CLI, 'utf8');
    const start = usage.indexOf('const USAGE = `');
    const end = usage.indexOf('`;', start);
    const help = usage.slice(start, end);
    const undocumented = flags.filter((f) => !help.includes(`--${f}`));
    expect(undocumented, `flags absents de --help : ${undocumented.join(', ')}`).toEqual([]);
  });
});
