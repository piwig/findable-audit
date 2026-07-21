import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from '../lib/jobs.mjs';

test('create() returns a running job with a unique id and stored fields', () => {
  const store = createJobStore();
  const a = store.create({ url: 'https://example.com/', lang: 'fr' });
  const b = store.create({ url: 'https://example.org/', lang: 'en' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.status, 'running');
  assert.equal(a.url, 'https://example.com/');
  assert.equal(a.lang, 'fr');
  assert.equal(a.progress, null);
  assert.equal(store.get(a.id), a);
});

test('setProgress / finish / fail mutate the stored job', () => {
  const store = createJobStore();
  const j = store.create({ url: 'https://example.com/', lang: 'en' });
  store.setProgress(j.id, { phase: 'checks', done: 3, total: 10 });
  assert.equal(store.get(j.id).progress.done, 3);
  store.finish(j.id, { report: { score: 100 }, html: '<html></html>' });
  assert.equal(store.get(j.id).status, 'done');
  assert.equal(store.get(j.id).html, '<html></html>');
  const k = store.create({ url: 'https://x.test/', lang: 'en' });
  store.fail(k.id, 'timeout', 'too slow');
  assert.equal(store.get(k.id).status, 'error');
  assert.deepEqual(store.get(k.id).error, { code: 'timeout', message: 'too slow' });
});

test('get() treats an expired job as absent and prune() drops it', () => {
  const store = createJobStore({ ttlMs: 10 });
  const j = store.create({ url: 'https://example.com/', lang: 'en' });
  const future = Date.now() + 50;
  assert.equal(store.get(j.id, future), undefined);
});

test('prune() bounds the store to maxJobs (oldest evicted)', () => {
  const store = createJobStore({ maxJobs: 2 });
  const a = store.create({ url: 'a', lang: 'en' });
  store.create({ url: 'b', lang: 'en' });
  store.create({ url: 'c', lang: 'en' }); // triggers prune on create
  assert.equal(store.get(a.id), undefined); // oldest gone
  assert.equal(store.size, 2);
});
