// #59 — "bring your own baseline": paste a previous audit JSON, get the diff.
//
// Brings the value of history to the web without accounts, storage or cookies:
// the baseline never leaves the request that carried it. The server stays
// GET-only everywhere except this one route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.PORT = '0';
const { server, jobs } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

function reportOf(score, results) {
  return {
    url: 'https://example.com/',
    score,
    grade: score >= 90 ? 'A' : 'C',
    familyScores: [{ family: 'security', score, weight: 0.07, earned: score >= 90 ? 4 : 2, max: 4 }],
    sampledPages: ['/'],
    results,
    generatedAt: '2026-07-01T00:00:00.000Z',
  };
}

const CURRENT = reportOf(92, [
  { id: 'hsts', family: 'security', status: 'pass', points: 4, maxPoints: 4, message: 'HSTS set' },
  { id: 'csp', family: 'security', status: 'fail', points: 0, maxPoints: 3, message: 'no CSP' },
]);
const BASELINE = reportOf(70, [
  { id: 'hsts', family: 'security', status: 'fail', points: 0, maxPoints: 4, message: 'no HSTS' },
  { id: 'csp', family: 'security', status: 'pass', points: 3, maxPoints: 3, message: 'CSP present' },
]);

/** A finished job holding CURRENT, as if an audit had just run. */
function seedDone(lang = 'en') {
  const job = jobs.create({ url: CURRENT.url, lang });
  jobs.finish(job.id, { report: CURRENT, html: '<!doctype html><html><body>REPORT_BODY</body></html>' });
  return job;
}

function post(path, body, headers = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

test('the result page offers the baseline form', async () => {
  const job = seedDone();
  const html = await (await fetch(`${BASE}/audit/result?job=${job.id}`)).text();
  assert.match(html, /<form[^>]+method="post"[^>]+action="\/en\/audit\/diff\?job=/);
  assert.match(html, /<textarea[^>]+name="baseline"/);
});

test('a valid baseline renders the report with its diff section', async () => {
  const job = seedDone();
  const res = await post(`/en/audit/diff?job=${job.id}`,
    new URLSearchParams({ baseline: JSON.stringify(BASELINE) }).toString());
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /class="diff"/, 'the diff section is rendered');
  assert.match(html, /hsts/, 'the improved check is named');
  assert.match(html, /csp/, 'the regressed check is named');
});

test('the baseline is never stored: the job still renders without a diff afterwards', async () => {
  const job = seedDone();
  await post(`/en/audit/diff?job=${job.id}`, new URLSearchParams({ baseline: JSON.stringify(BASELINE) }).toString());
  const html = await (await fetch(`${BASE}/audit/result?job=${job.id}`)).text();
  assert.doesNotMatch(html, /class="diff"/, 'the pasted baseline left no trace on the job');
});

test('malformed JSON is refused with a friendly 400, not a stack trace', async () => {
  const job = seedDone();
  const res = await post(`/en/audit/diff?job=${job.id}`,
    new URLSearchParams({ baseline: '{not json' }).toString());
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.doesNotMatch(html, /SyntaxError|at Object|node:internal/, 'no internals leak into the page');
});

test('valid JSON that is not an audit report is refused the same way', async () => {
  const job = seedDone();
  const res = await post(`/en/audit/diff?job=${job.id}`,
    new URLSearchParams({ baseline: JSON.stringify({ hello: 'world' }) }).toString());
  assert.equal(res.status, 400);
});

test('an empty paste is refused', async () => {
  const job = seedDone();
  const res = await post(`/en/audit/diff?job=${job.id}`, new URLSearchParams({ baseline: '   ' }).toString());
  assert.equal(res.status, 400);
});

test('an oversized body is cut off with 413 rather than buffered', async () => {
  const job = seedDone();
  const huge = 'x'.repeat(3_000_000);
  const res = await post(`/en/audit/diff?job=${job.id}`, `baseline=${huge}`);
  assert.equal(res.status, 413);
});

test('an unknown or expired job gives the same page as an expired result', async () => {
  const res = await post('/en/audit/diff?job=00000000-0000-4000-8000-000000000000',
    new URLSearchParams({ baseline: JSON.stringify(BASELINE) }).toString());
  assert.equal(res.status, 404);
});

test('the diff route is POST-only, and the rest of the server stays GET-only', async () => {
  const job = seedDone();
  const get = await fetch(`${BASE}/en/audit/diff?job=${job.id}`);
  assert.equal(get.status, 405);
  assert.match(get.headers.get('allow') ?? '', /POST/);
  const elsewhere = await post('/en/', '');
  assert.equal(elsewhere.status, 405);
  assert.match(elsewhere.headers.get('allow') ?? '', /GET/);
});

test('the French result page posts to the French route', async () => {
  const job = seedDone('fr');
  const html = await (await fetch(`${BASE}/audit/result?job=${job.id}`)).text();
  assert.match(html, /action="\/fr\/audit\/diff\?job=/);
});
