// Task 2 — the server journalizes completed audits to the JSONL store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'fa-wiring-'));
process.env.DATA_DIR = dataDir;
process.env.STATS_SALT = 'test-salt';
process.env.PORT = '31104';

const mod = await import('../server.mjs');
const { server, store, recordAuditEvent } = mod;
if (!server.listening) await new Promise((r) => server.once('listening', r));
test.after(async () => { server.close(); await rm(dataDir, { recursive: true, force: true }); });

test('server.mjs exports the store and recordAuditEvent', () => {
  assert.equal(typeof store, 'object');
  assert.equal(typeof store.append, 'function');
  assert.equal(typeof recordAuditEvent, 'function');
});

test('recordAuditEvent appends exactly one line to DATA_DIR/events.jsonl', async () => {
  const report = {
    url: 'https://wired.example/',
    score: 55,
    grade: 'F',
    familyScores: [{ family: 'security', score: 40, weight: 0.1, earned: 4, max: 10 }],
  };
  await recordAuditEvent(report, { kind: 'audit', lang: 'en', ipHash: 'deadbeef', durationMs: 1234, cwv: false });
  const raw = await readFile(join(dataDir, 'events.jsonl'), 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 1);
  const ev = JSON.parse(lines[0]);
  assert.equal(ev.domain, 'wired.example');
  assert.equal(ev.score, 55);
  assert.equal(ev.kind, 'audit');
  assert.equal(ev.ipHash, 'deadbeef');
});
