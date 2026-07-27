// #60 — bounded crawl-depth selector on the audit form.
//
// The depth used to be fixed server-side. It is now a form field, but the
// server remains the only authority: the query value is parsed and clamped, and
// anything it does not recognise falls back to the default rather than being
// trusted. These tests drive the real HTTP routes and assert on what reaches
// runAudit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.PORT = '0';
const { server, setRunAuditForTest, MAX_PAGES } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

const PUBLIC = 'http://93.184.216.34/';

function extractJobId(html) {
  const m = /job=([0-9a-f-]{36})/.exec(html);
  assert.ok(m, 'job id present in the progress page');
  return m[1];
}

/** Run one audit through the real routes and return the opts runAudit received. */
async function optsFor(query, path = 'a') {
  let captured;
  setRunAuditForTest(async (url, checks, opts) => {
    captured = opts;
    return { url, score: 100, grade: 'A', familyScores: [], sampledPages: ['/'], results: [], psi: undefined };
  });
  // A distinct path per call: the report cache is keyed on the URL, and a
  // shared key would serve a previous run instead of calling the stub.
  const target = encodeURIComponent(PUBLIC + path);
  const start = await fetch(`${BASE}/en/audit?url=${target}${query}`);
  assert.equal(start.status, 200);
  const jobId = extractJobId(await start.text());
  await fetch(`${BASE}/audit/result?job=${jobId}`); // lazily starts + awaits the job
  assert.ok(captured, 'runAudit was called');
  return captured;
}

test('no pages param: the audit keeps the server default depth', async () => {
  const opts = await optsFor('', 'default');
  assert.equal(opts.maxPages, MAX_PAGES);
});

test('pages=1 audits the homepage only', async () => {
  const opts = await optsFor('&pages=1', 'one');
  assert.equal(opts.maxPages, 1);
});

test('pages=3 is honoured', async () => {
  const opts = await optsFor('&pages=3', 'three');
  assert.equal(opts.maxPages, 3);
});

test('a value above the ceiling is capped, never obeyed', async () => {
  const opts = await optsFor('&pages=500', 'big');
  assert.equal(opts.maxPages, MAX_PAGES);
});

test('junk, zero and negative values fall back to the default', async () => {
  for (const [i, raw] of ['abc', '0', '-4', '2.7', '', '1e3'].entries()) {
    const opts = await optsFor(`&pages=${encodeURIComponent(raw)}`, `junk${i}`);
    assert.equal(opts.maxPages, MAX_PAGES, `pages=${raw}`);
  }
});

test('two depths of the same URL do not share a cached report', async () => {
  const url = encodeURIComponent(PUBLIC + 'cache');
  const seen = [];
  setRunAuditForTest(async (u, checks, opts) => {
    seen.push(opts.maxPages);
    return { url: u, score: 100, grade: 'A', familyScores: [], sampledPages: ['/'], results: [], psi: undefined };
  });
  for (const q of ['&pages=1', '']) {
    const start = await fetch(`${BASE}/en/audit?url=${url}${q}`);
    await fetch(`${BASE}/audit/result?job=${extractJobId(await start.text())}`);
  }
  assert.deepEqual(seen, [1, MAX_PAGES], 'both audits ran; the shallow one did not serve the deep one');
});

test('the landing form offers the depth choices, with the default preselected', async () => {
  const html = await (await fetch(`${BASE}/en/`)).text();
  assert.match(html, /<select[^>]+name="pages"/, 'the form exposes a depth select');
  assert.match(html, new RegExp(`<option value="${MAX_PAGES}" selected`), 'the default depth is preselected');
  assert.match(html, /<option value="1"/);
  const fr = await (await fetch(`${BASE}/fr/`)).text();
  assert.match(fr, /<select[^>]+name="pages"/, 'the French form exposes it too');
});
