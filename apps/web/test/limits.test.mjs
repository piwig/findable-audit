// #8 defensive hardening: reject requests whose URL (path + query) exceeds
// MAX_URL_LEN early — a cheap bound against a trivial DoS vector (huge request
// lines forcing repeated URL/query parsing work per request). No crash, no
// info leak (generic short body); normal URLs are completely unaffected.
//
// MAX_URL_LEN is 8192 (nginx/Apache-style 8KB bound), not the tighter 2048 a
// standard link would need: it must leave room for a Turnstile token riding
// in the `cf-turnstile-response` query param (see turnstile-gate.test.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

// Bind an ephemeral port BEFORE importing the server (which listens on import).
process.env.PORT = '0';
const { server } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

test('GET with an over-long URL is rejected (414), short generic body, no crash', async () => {
  // /healthz is otherwise a trivial 200; pad it with a long query string well
  // past MAX_URL_LEN (8192) but still under Node's default header-size limit
  // (16384) so the request itself reaches our handler.
  const overlong = `/healthz?pad=${'a'.repeat(9000)}`;
  assert.ok(overlong.length > 8192, 'sanity: test URL exceeds MAX_URL_LEN');
  const res = await fetch(`${BASE}${overlong}`);
  assert.equal(res.status, 414);
  const body = await res.text();
  assert.ok(body.length < 200, `expected a short generic body, got ${body.length} chars`);
  // No leak: the padded query value must not be echoed back.
  assert.ok(!body.includes('aaaa'), 'response must not echo the oversized input');

  // The server must still be alive and serving normal requests afterwards.
  const ok = await fetch(`${BASE}/healthz`);
  assert.equal(ok.status, 200);
});

// Boundary: the guard is `req.url.length > MAX_URL_LEN`, so exactly 8192 must
// pass and 8193 must not. This is the case that matters for FIX A: a real
// Turnstile token (up to ~2048 chars) riding in the query string alongside a
// URL must land comfortably under this bound.
test('GET with a URL exactly at MAX_URL_LEN (8192) is accepted, not 414', async () => {
  const path = `/healthz?pad=${'a'.repeat(8192 - '/healthz?pad='.length)}`;
  assert.equal(path.length, 8192, 'sanity: test URL is exactly MAX_URL_LEN');
  const res = await fetch(`${BASE}${path}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('GET with a URL one char over MAX_URL_LEN (8193) is rejected (414)', async () => {
  const path = `/healthz?pad=${'a'.repeat(8193 - '/healthz?pad='.length)}`;
  assert.equal(path.length, 8193, 'sanity: test URL is one char over MAX_URL_LEN');
  const res = await fetch(`${BASE}${path}`);
  assert.equal(res.status, 414);
});

test('GET with a normal-length URL is unaffected (200)', async () => {
  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('GET /audit with a normal-length URL still dispatches normally (unaffected by the guard)', async () => {
  // A literal public IP passes SSRF without DNS; /audit only creates the job
  // lazily, so no outbound network call happens here (see server-async.test.mjs).
  const res = await fetch(`${BASE}/fr/audit?url=${encodeURIComponent('http://93.184.216.34/')}`);
  assert.equal(res.status, 200);
});
