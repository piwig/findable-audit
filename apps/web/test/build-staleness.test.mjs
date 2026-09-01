// Ce test vit dans apps/web parce que c'est cette suite qui en depend :
// dogfooding.test.mjs, dogfooding-ecosystem.test.mjs et compare.test.mjs importent
// `packages/cli/dist/runner.js`, pas les sources. Si `dist` peut etre perime,
// ces tests peuvent rester verts contre un binaire qui n'est plus le code du depot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDecision, newestMtimeMs } from '../../../scripts/build-staleness.mjs';

const EPOCH = 1_600_000_000; // secondes
function touch(path, seconds) {
  utimesSync(path, seconds, seconds);
}

function makeWorkspace({ withDist = true, srcAge = EPOCH, distAge = EPOCH + 100 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fa-staleness-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
  touch(join(dir, 'src', 'index.ts'), srcAge);
  touch(join(dir, 'src'), srcAge);
  touch(join(dir, 'package.json'), srcAge);
  if (withDist) {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const a = 1;\n');
    touch(join(dir, 'dist', 'index.js'), distAge);
    touch(join(dir, 'dist'), distAge);
  }
  return dir;
}

test('dist absent : rebuild', () => {
  const dir = makeWorkspace({ withDist: false });
  try {
    assert.deepEqual(buildDecision(dir).reason, 'absent');
    assert.equal(buildDecision(dir).stale, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist plus recent que les sources : pas de rebuild', () => {
  const dir = makeWorkspace({ srcAge: EPOCH, distAge: EPOCH + 100 });
  try {
    const d = buildDecision(dir);
    assert.equal(d.stale, false);
    assert.equal(d.reason, 'fresh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source modifiee apres le build : rebuild (regression A119)', () => {
  const dir = makeWorkspace({ srcAge: EPOCH + 500, distAge: EPOCH + 100 });
  try {
    const d = buildDecision(dir);
    assert.equal(d.stale, true);
    assert.equal(d.reason, 'outdated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('package.json modifie apres le build : rebuild', () => {
  const dir = makeWorkspace({ srcAge: EPOCH, distAge: EPOCH + 100 });
  try {
    touch(join(dir, 'package.json'), EPOCH + 900);
    assert.equal(buildDecision(dir).stale, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('newestMtimeMs descend dans les sous-dossiers et vaut 0 si absent', () => {
  const dir = makeWorkspace();
  try {
    mkdirSync(join(dir, 'src', 'checks'), { recursive: true });
    const deep = join(dir, 'src', 'checks', 'deep.ts');
    writeFileSync(deep, 'export const b = 2;\n');
    touch(deep, EPOCH + 4242);
    assert.equal(Math.round(newestMtimeMs(join(dir, 'src')) / 1000), EPOCH + 4242);
    assert.equal(newestMtimeMs(join(dir, 'nope')), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le dist reel de packages/cli n est pas perime', () => {
  const cli = new URL('../../../packages/cli', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const d = buildDecision(cli);
  assert.equal(d.stale, false, `packages/cli/dist est perime (${d.reason}) : les tests web mesureraient un ancien binaire`);
});
