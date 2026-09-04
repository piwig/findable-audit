import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { declaredFlags } from './docs-flags.test.js';

/**
 * A135 — action.yml is the one integration surface exercised in CI, and it
 * drifted: `--allow-cross-version` (A128) shipped in the CLI while the action
 * kept failing jobs on cross-version baselines. Same failure mode as the check
 * counts before sync-check-counts.mjs: two lists, nobody comparing them.
 *
 * Read as text (like docs-flags.test.ts) — importing index.ts runs the CLI.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'index.ts');
const ACTION = path.join(HERE, '..', '..', '..', 'action.yml');

/** Inputs that are action-side sugar, not CLI flags. */
const ACTION_ONLY = new Set(['sarif-file', 'badge', 'version']);

/** CLI flags deliberately kept out of the action (interactive / local-only). */
const CLI_ONLY = new Set([
  'json', 'out', 'no-report', 'timeout', 'user-agent', 'indexnow-key', 'submit',
  'psi-strategy', 'compare', 'entity-graph', 'answers', 'emit-probes', 'summary',
  'history', 'verify-profiles', 'check-outbound', 'experimental-agent-standards',
  'dry-run',
]);

function actionInputs(yaml: string): string[] {
  const start = yaml.indexOf('\ninputs:');
  const end = yaml.indexOf('\noutputs:');
  if (start < 0 || end < 0 || end < start) throw new Error('inputs block not found in action.yml');
  return [...yaml.slice(start, end).matchAll(/^  ([a-z][a-z-]*):$/gm)].map((m) => m[1]);
}

describe('action.yml inputs ↔ CLI options parity', () => {
  const yaml = fs.readFileSync(ACTION, 'utf8');
  const inputs = actionInputs(yaml);
  const flags = declaredFlags(fs.readFileSync(CLI, 'utf8'));

  it('finds both lists, so a layout change cannot make this test vacuous', () => {
    expect(inputs.length).toBeGreaterThan(10);
    expect(inputs).toContain('url');
    expect(flags).toContain('allow-cross-version');
  });

  it('every action input is either a CLI flag or a known action-only input', () => {
    const orphans = inputs.filter((i) => i !== 'url' && !ACTION_ONLY.has(i) && !flags.includes(i));
    expect(orphans, `inputs sans option CLI : ${orphans.join(', ')}`).toEqual([]);
  });

  it('every CLI flag is exposed by the action unless listed as CLI-only', () => {
    const missing = flags.filter((f) => !CLI_ONLY.has(f) && !inputs.includes(f));
    expect(missing, `options CLI absentes de action.yml : ${missing.join(', ')}`).toEqual([]);
  });

  it('every exposed input actually reaches the CLI argument list (env + ARGS)', () => {
    const run = yaml.slice(yaml.indexOf('runs:'));
    const unplumbed = inputs
      .filter((i) => i !== 'url' && !ACTION_ONLY.has(i))
      .filter((i) => !run.includes(`--${i}`));
    expect(unplumbed, `inputs declares mais jamais passes au CLI : ${unplumbed.join(', ')}`).toEqual([]);
  });

  it('the CLI-only allowlist does not name flags that no longer exist', () => {
    const dead = [...CLI_ONLY].filter((f) => f !== 'dry-run' && !flags.includes(f));
    expect(dead).toEqual([]);
  });
});
