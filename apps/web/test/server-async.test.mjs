import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

// Bind an ephemeral port BEFORE importing the server (which listens on import).
process.env.PORT = '0';
const { server, jobs } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

// A literal PUBLIC IP passes assertPublicUrl without DNS and is NOT blocked
// (see ssrf.test.mjs). /audit only CREATES the job — it never fetches the target
// (execution is lazy), so no outbound network call happens here.
const PUBLIC = 'http://93.184.216.34/';

test('GET /audit returns a nonce-CSP progress page (no audit run)', async () => {
  const res = await fetch(`${BASE}/audit?url=${encodeURIComponent(PUBLIC)}&lang=fr`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'nonce-[^']+'/);
  assert.match(csp, /connect-src 'self'/);
  const html = await res.text();
  assert.match(html, /<html lang="fr"/);
  const nonce = csp.match(/nonce-([^']+)/)[1];
  assert.ok(html.includes(`<script nonce="${nonce}">`), 'inline script carries the CSP nonce');
  assert.match(html, /<noscript>/);
  assert.match(html, /\/audit\/result\?job=/);   // noscript fallback target
  assert.match(html, /new EventSource\('\/audit\/stream\?job='/);
});

test('GET /audit with a blocked (localhost) URL returns an error page, no job', async () => {
  const before = jobs.size;
  const res = await fetch(`${BASE}/audit?url=${encodeURIComponent('http://localhost/')}`);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  assert.equal(jobs.size, before); // blocked before job creation
});

test('landing page still served at / with the default (script-src none) CSP', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'none'/);
});

// Read an SSE stream until a terminal `event: done|error`, then abort.
async function readSse(url, { timeoutMs = 5000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (/\nevent: (done|error)\n/.test(buf) || buf.startsWith('event: done') || buf.startsWith('event: error')) break;
    }
  } finally { clearTimeout(timer); ac.abort(); }
  return { contentType: res.headers.get('content-type'), text: buf };
}

test('GET /audit/stream emits done immediately for an already-finished job', async () => {
  // Seed a completed job WITHOUT running an audit (no network).
  const job = jobs.create({ url: 'https://example.com/', lang: 'en' });
  jobs.finish(job.id, { report: { url: 'https://example.com/' }, html: '<html><body>ok</body></html>' });
  const { contentType, text } = await readSse(`${BASE}/audit/stream?job=${job.id}`);
  assert.match(contentType, /text\/event-stream/);
  assert.match(text, /event: done/);
});

test('GET /audit/stream emits error with code for a failed job', async () => {
  const job = jobs.create({ url: 'https://example.com/', lang: 'en' });
  jobs.fail(job.id, 'timeout', 'too slow');
  const { text } = await readSse(`${BASE}/audit/stream?job=${job.id}`);
  assert.match(text, /event: error/);
  assert.match(text, /"code":"timeout"/);
});

test('GET /audit/stream with an unknown job returns 404', async () => {
  const res = await fetch(`${BASE}/audit/stream?job=does-not-exist`);
  assert.equal(res.status, 404);
});

test('GET /audit/result serves the report with export + back chrome', async () => {
  const job = jobs.create({ url: 'https://example.com/', lang: 'en' });
  jobs.finish(job.id, { report: { url: 'https://example.com/' }, html: '<!doctype html><html><body>REPORT_BODY</body></html>' });
  const res = await fetch(`${BASE}/audit/result?job=${job.id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /REPORT_BODY/);
  assert.ok(html.includes(`/audit/export?job=${job.id}&format=md`));
  assert.ok(html.includes(`/audit/export?job=${job.id}&format=json`));
  assert.match(html, /Audit another site|href="\/"/);
});

test('GET /audit/result serves a localized error page for a failed job', async () => {
  const job = jobs.create({ url: 'https://example.com/', lang: 'fr' });
  jobs.fail(job.id, 'timeout', "L'audit a expiré (test)");
  const res = await fetch(`${BASE}/audit/result?job=${job.id}`);
  assert.equal(res.status, 200); // timeout returns 200 so Cloudflare shows our page
  const html = await res.text();
  assert.match(html, /expiré/);
});

test('GET /audit/result with unknown job returns 404', async () => {
  const res = await fetch(`${BASE}/audit/result?job=nope`);
  assert.equal(res.status, 404);
});

function seedDone(lang = 'en') {
  const job = jobs.create({ url: 'https://example.com/', lang });
  // Minimal-but-valid AuditReport (shape from runner.ts). Empty arrays render
  // cleanly and touch no network. Extend minimally only if a renderer needs more.
  const report = { url: 'https://example.com/', score: 100, grade: 'A', familyScores: [], sampledPages: ['/'], results: [], psi: undefined };
  jobs.finish(job.id, { report, html: '<!doctype html><html><body>x</body></html>' });
  return job;
}

test('GET /audit/export?format=json returns JSON with an attachment filename', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/export?job=${job.id}&format=json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="example\.com-\d{4}-\d{2}-\d{2}\.json"/);
  const parsed = JSON.parse(await res.text());
  assert.equal(parsed.url, 'https://example.com/');
});

test('GET /audit/export?format=md returns markdown', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/export?job=${job.id}&format=md`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.match(res.headers.get('content-disposition'), /\.md"/);
});

test('GET /audit/export rejects an unknown format with 400', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/export?job=${job.id}&format=pdf`);
  assert.equal(res.status, 400);
});

test('GET /audit/export with unknown job returns 404', async () => {
  const res = await fetch(`${BASE}/audit/export?job=nope&format=md`);
  assert.equal(res.status, 404);
});

test('CWV decision follows PSI_KEY presence', async () => {
  const prev = process.env.PSI_KEY;
  try {
    delete process.env.PSI_KEY;
    // A blocked URL never runs the audit, so no PSI call; we assert the helper.
    // (Export cwvActive/auditTimeout for testability.)
    const mod = await import('../server.mjs');
    assert.equal(mod.cwvActive(), false);
    assert.equal(mod.auditTimeout(), 45000);
    process.env.PSI_KEY = 'test-key';
    assert.equal(mod.cwvActive(), true);
    assert.equal(mod.auditTimeout(), 90000);
  } finally {
    if (prev === undefined) delete process.env.PSI_KEY; else process.env.PSI_KEY = prev;
  }
});
