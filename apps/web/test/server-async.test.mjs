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
