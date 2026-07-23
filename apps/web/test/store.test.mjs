// Store JSONL — append-only event store with rotation and hashed IPs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, loadOrCreateSalt, ipHasher, eventFromReport } from '../lib/store.mjs';

async function tmp() {
  return mkdtemp(join(tmpdir(), 'fa-store-'));
}

const REPORT = {
  url: 'https://ex.com/',
  score: 72,
  grade: 'C',
  familyScores: [{ family: 'ai-access', score: 80, weight: 0.2, earned: 8, max: 10 }],
};

test('append creates DATA_DIR + events.jsonl with one parsable line per event', async () => {
  const dir = await tmp();
  try {
    const store = createStore({ dataDir: dir });
    await store.append({ ts: '2026-07-24T00:00:00.000Z', kind: 'audit', domain: 'a.com', score: 1 });
    await store.append({ ts: '2026-07-24T00:01:00.000Z', kind: 'audit', domain: 'b.com', score: 2 });
    const raw = await readFile(join(dir, 'events.jsonl'), 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).domain, 'a.com');
    assert.equal(JSON.parse(lines[1]).domain, 'b.com');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('readEvents returns events in order and counts corrupted lines', async () => {
  const dir = await tmp();
  try {
    const store = createStore({ dataDir: dir });
    await store.append({ ts: '1', kind: 'audit', domain: 'a.com' });
    await appendFile(join(dir, 'events.jsonl'), 'not-json{\n');
    await store.append({ ts: '2', kind: 'audit', domain: 'b.com' });
    const { events, ignored } = await store.readEvents();
    assert.equal(ignored, 1);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.domain), ['a.com', 'b.com']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rotation: exceeding maxBytes archives events.jsonl and starts fresh; readEvents aggregates', async () => {
  const dir = await tmp();
  try {
    const store = createStore({ dataDir: dir, maxBytes: 200 });
    for (let i = 0; i < 12; i++) {
      await store.append({ ts: String(i), kind: 'audit', domain: `d${i}.com`, pad: 'xxxxxxxxxxxxxxxxxxxx' });
    }
    const files = (await readdir(dir)).filter((f) => f.startsWith('events') && f.endsWith('.jsonl'));
    assert.ok(files.some((f) => /^events-\d{6}(-\d+)?\.jsonl$/.test(f)), `expected an archive file, got ${files.join(',')}`);
    assert.ok(files.includes('events.jsonl'));
    const { events } = await store.readEvents();
    assert.equal(events.length, 12);
    assert.deepEqual(events.map((e) => e.domain), Array.from({ length: 12 }, (_, i) => `d${i}.com`));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('append never rejects even when the path is unwritable', async () => {
  const dir = await tmp();
  try {
    // Put a FILE where the store expects a directory child: appendFile to a path
    // whose parent is a file must fail internally but not reject.
    const badParent = join(dir, 'afile');
    await writeFile(badParent, 'x');
    const store = createStore({ dataDir: join(badParent, 'sub') });
    await store.append({ ts: '1', kind: 'audit' }); // must resolve, not throw
    assert.ok(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ipHasher is 16 hex, stable, differs by ip and by salt', () => {
  const h = ipHasher('salt-a');
  const a = h('1.2.3.4');
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, h('1.2.3.4'));
  assert.notEqual(a, h('5.6.7.8'));
  assert.notEqual(a, ipHasher('salt-b')('1.2.3.4'));
});

test('loadOrCreateSalt creates then re-reads the same value; env wins without a file', async () => {
  const dir = await tmp();
  try {
    const s1 = await loadOrCreateSalt(dir);
    const s2 = await loadOrCreateSalt(dir);
    assert.equal(s1, s2);
    assert.ok(s1.length >= 16);
    const saved = await readFile(join(dir, 'salt'), 'utf8');
    assert.equal(saved.trim(), s1);

    const prev = process.env.STATS_SALT;
    process.env.STATS_SALT = 'env-salt-value';
    try {
      const dir2 = await tmp();
      try {
        const s = await loadOrCreateSalt(dir2);
        assert.equal(s, 'env-salt-value');
        // no file created when env is set
        const files = await readdir(dir2);
        assert.ok(!files.includes('salt'));
      } finally { await rm(dir2, { recursive: true, force: true }); }
    } finally {
      if (prev === undefined) delete process.env.STATS_SALT; else process.env.STATS_SALT = prev;
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('eventFromReport maps the report fields exactly', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');
  const ev = eventFromReport(REPORT, { kind: 'audit', lang: 'fr', ipHash: 'abc123', durationMs: 4200, cwv: true, now });
  assert.deepEqual(ev, {
    ts: '2026-07-24T12:00:00.000Z',
    kind: 'audit',
    domain: 'ex.com',
    url: 'https://ex.com/',
    lang: 'fr',
    score: 72,
    grade: 'C',
    familyScores: [{ family: 'ai-access', score: 80 }],
    ipHash: 'abc123',
    durationMs: 4200,
    cwv: true,
  });
});
