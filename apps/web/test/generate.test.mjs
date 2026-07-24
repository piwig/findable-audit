// #55 (web side) — "generate indexing files" download, regenerated on the fly
// from the job's in-memory report. NOTHING is ever written to disk: every
// request re-runs EMITTED_FILES[*].build(report, {lang}) fresh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.PORT = '0';
const { server, jobs } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

// Minimal-but-valid AuditReport (shape from runner.ts), same pattern as
// server-async.test.mjs's seedDone(): empty arrays render cleanly and touch
// no network.
function seedDone(lang = 'en') {
  const job = jobs.create({ url: 'https://example.com/', lang });
  const report = { url: 'https://example.com/', score: 100, grade: 'A', familyScores: [], sampledPages: ['/'], results: [], psi: undefined };
  jobs.finish(job.id, { report, html: '<!doctype html><html><body>REPORT_BODY</body></html>' });
  return job;
}

test('GET /audit/generate?file=robots.txt returns the generated file as an attachment', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/generate?job=${job.id}&file=robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="robots\.txt"/);
  const body = await res.text();
  assert.match(body, /example\.com/, 'body carries the audited host');
  assert.match(body, /review before deploying/i, 'body carries the generic-content warning');
});

test('GET /audit/generate for a nested filename downloads with the basename only', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/generate?job=${job.id}&file=${encodeURIComponent('.well-known/ai.json')}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="ai\.json"/);
  const parsed = JSON.parse(await res.text());
  assert.equal(parsed.name, 'example.com');
});

test('GET /audit/generate regenerates in memory (identical, deterministic content across requests)', async () => {
  const job = seedDone();
  const res1 = await fetch(`${BASE}/audit/generate?job=${job.id}&file=sitemap.xml`);
  const body1 = await res1.text();
  const res2 = await fetch(`${BASE}/audit/generate?job=${job.id}&file=sitemap.xml`);
  const body2 = await res2.text();
  assert.equal(res1.status, 200);
  assert.equal(body1, body2);
  assert.match(body1, /example\.com/);
});

test('GET /audit/generate with a file name not in EMITTED_FILES returns 404', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/generate?job=${job.id}&file=passwd`);
  assert.equal(res.status, 404);
});

test('GET /audit/generate with a path-traversal file name returns 404 (no exact EMITTED_FILES match)', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/generate?job=${job.id}&file=${encodeURIComponent('../../etc/passwd')}`);
  assert.equal(res.status, 404);
});

test('GET /audit/generate with an unknown/expired job returns 404', async () => {
  const res = await fetch(`${BASE}/audit/generate?job=nope&file=robots.txt`);
  assert.equal(res.status, 404);
});

// NOTE: a freshly-created ('running') job is deliberately NOT tested here —
// handleGenerate calls ensureStarted() (the same lazy-start as
// handleResult/handleExport), which would kick off a REAL audit against
// whatever URL the job carries. The "not done" 404 path is instead covered
// below via a job that failed outright (a genuinely terminal, non-'done'
// state reachable without any network call).
test('GET /audit/generate for a failed job returns 404', async () => {
  const job = jobs.create({ url: 'https://example.com/', lang: 'en' });
  jobs.fail(job.id, 'timeout', 'too slow');
  const res = await fetch(`${BASE}/audit/generate?job=${job.id}&file=robots.txt`);
  assert.equal(res.status, 404);
});

test('GET /audit/result includes a "Generate indexing files" section with a download link per EMITTED_FILES entry', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/result?job=${job.id}`);
  const html = await res.text();
  assert.match(html, /Generate indexing files/);
  assert.match(html, /review before deploying/i, 'bilingual warning note rendered');
  for (const name of ['robots.txt', 'llms.txt', 'llms-full.txt', 'sitemap.xml', 'jsonld-stubs.json']) {
    assert.ok(html.includes(`/audit/generate?job=${job.id}&file=${encodeURIComponent(name)}`), `link for ${name} present`);
  }
  assert.ok(html.includes(`/audit/generate?job=${job.id}&file=${encodeURIComponent('.well-known/ai.json')}`), 'link for .well-known/ai.json present');
});

test('GET /audit/result (fr job) renders the generate section labels in French', async () => {
  const job = seedDone('fr');
  const res = await fetch(`${BASE}/audit/result?job=${job.id}`);
  const html = await res.text();
  assert.match(html, /indexation/i, 'fr heading rendered');
  assert.match(html, /relire avant de déployer/i, 'fr warning rendered');
  assert.ok(html.includes(`/audit/generate?job=${job.id}&file=robots.txt`), 'fr page still links the same generate route');
});
