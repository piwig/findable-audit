// Integration tests for the /en /fr path-prefix routing, against a real
// local HTTP server (no mocks). Requires `npm run build` in packages/cli
// first, since server.mjs imports the built CLI library.
//
// Each request either hits a fast SSRF-rejection path or a plain redirect,
// so no real outbound network call is ever made.

import test from 'node:test';
import assert from 'node:assert/strict';

// Bind to a fixed high port for this test file's server instance (node:test
// runs each test file in its own process, so a hard-coded port is safe here
// and avoids the `Number(process.env.PORT) || 3021` fallback swallowing "0").
process.env.PORT = '31021';

const { server } = await import('../server.mjs');
if (!server.listening) {
  await new Promise((resolve) => server.once('listening', resolve));
}
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
});

test('GET / redirects (301 + Vary) to /en/ when no Accept-Language is sent', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/en/');
  assert.match(res.headers.get('vary') ?? '', /accept-language/i);
});

test('GET / redirects (301) to /fr/ when Accept-Language prefers French', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual', headers: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5' } });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/fr/');
});

test('GET /en/ and /fr/ both serve the landing page (200)', async () => {
  const en = await fetch(`${base}/en/`);
  const fr = await fetch(`${base}/fr/`);
  assert.equal(en.status, 200);
  assert.equal(fr.status, 200);
});

test('GET /healthz is untouched by prefix routing', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('GET /audit.json is never redirected, even without a language prefix', async () => {
  // 127.0.0.1 is SSRF-blocked, so this returns fast without a real network call.
  const res = await fetch(`${base}/audit.json?url=http://127.0.0.1`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'blocked');
});

test('GET /audit (legacy, unprefixed) redirects (301) to /en/audit, keeping the query', async () => {
  const res = await fetch(`${base}/audit?url=http://127.0.0.1`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/en/audit?url=http%3A%2F%2F127.0.0.1');
});

test('GET /en/audit forces lang=en through to the existing SSRF-guarded /audit handling', async () => {
  const res = await fetch(`${base}/en/audit?url=http://127.0.0.1`, { redirect: 'manual' });
  // The SSRF guard rejects before any job/report logic runs, so this proves
  // the rewrite (prefix -> unprefixed pathname + forced lang=en) reached the
  // existing /audit dispatch, regardless of whether 2B's job-based handler
  // or the pre-2B synchronous handler is in place.
  assert.equal(res.status, 400);
});

test('GET /audit/stream, /audit/result, /audit/export (unprefixed) are never redirected — only /audit is human-navigable', async () => {
  for (const p of ['/audit/stream', '/audit/result', '/audit/export']) {
    const res = await fetch(`${base}${p}?job=x`, { redirect: 'manual' });
    assert.notEqual(res.status, 301, `${p} should not 301-redirect (would add a wasteful extra hop)`);
  }
});

test('trailing-slash canonicalization: /en, /en/about, /fr/contact each 301 to the slashed form', async () => {
  for (const [from, to] of [['/en', '/en/'], ['/en/about', '/en/about/'], ['/fr/contact', '/fr/contact/']]) {
    const res = await fetch(`${base}${from}`, { redirect: 'manual' });
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), to);
  }
});

test('unprefixed /about and /contact 301 to the negotiated language', async () => {
  const en = await fetch(`${base}/about`, { redirect: 'manual' });
  assert.equal(en.status, 301);
  assert.equal(en.headers.get('location'), '/en/about/');
  const fr = await fetch(`${base}/contact/`, { redirect: 'manual', headers: { 'accept-language': 'fr' } });
  assert.equal(fr.status, 301);
  assert.equal(fr.headers.get('location'), '/fr/contact/');
});

test('GET /en/about/ and /fr/contact/ serve the interior pages (200)', async () => {
  const about = await fetch(`${base}/en/about/`);
  assert.equal(about.status, 200);
  assert.match(await about.text(), /About findable-audit/);
  const contact = await fetch(`${base}/fr/contact/`);
  assert.equal(contact.status, 200);
  assert.match(await contact.text(), /Contact/);
});
