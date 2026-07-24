// Task 4 — #7 Turnstile widget on the landing form + relaxed CSP when enabled.
//
// turnstileEnabled()/turnstileSiteKey() (lib/turnstile.mjs, task 3) read
// process.env at CALL time (default arg `env = process.env`), and the landing
// route must call them at REQUEST time — not cache a decision at import time
// — so a single server instance can be reused across "enabled" and
// "disabled" cases by toggling process.env.TURNSTILE_* around each fetch.
//
// This test does NOT touch handleAuditStart/handleCompareStart (task 5's
// server-side siteverify gate) — it only asserts what the landing renders
// and which CSP header it serves.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '0'; // ephemeral port: no collision with other test files.

const { server } = await import('../server.mjs');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

// Verbatim default CSP (server.mjs) — must stay byte-identical when Turnstile
// is disabled (env-gating: no keys => today's behavior, unchanged).
const DEFAULT_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; "
  + "img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** Run `fn` with TURNSTILE_SITE_KEY/TURNSTILE_SECRET_KEY set, then restore. */
async function withTurnstileEnv(site, secret, fn) {
  const prevSite = process.env.TURNSTILE_SITE_KEY;
  const prevSecret = process.env.TURNSTILE_SECRET_KEY;
  if (site === undefined) delete process.env.TURNSTILE_SITE_KEY; else process.env.TURNSTILE_SITE_KEY = site;
  if (secret === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = secret;
  try {
    await fn();
  } finally {
    if (prevSite === undefined) delete process.env.TURNSTILE_SITE_KEY; else process.env.TURNSTILE_SITE_KEY = prevSite;
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = prevSecret;
  }
}

test('without Turnstile keys, the landing is unchanged: no widget, default CSP', async () => {
  const res = await fetch(`${base}/en/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotMatch(html, /cf-turnstile/);
  assert.doesNotMatch(html, /challenges\.cloudflare\.com/);
  assert.equal(res.headers.get('content-security-policy'), DEFAULT_CSP);
});

test('with only one of the two keys set, the landing stays disabled (default CSP, no widget)', async () => {
  await withTurnstileEnv('site-only', undefined, async () => {
    const res = await fetch(`${base}/en/`);
    const html = await res.text();
    assert.doesNotMatch(html, /cf-turnstile/);
    assert.equal(res.headers.get('content-security-policy'), DEFAULT_CSP);
  });
});

test('with both Turnstile keys set, the landing renders the widget + relaxed CSP', async () => {
  await withTurnstileEnv('site-key-123', 'secret-abc', async () => {
    const res = await fetch(`${base}/en/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js" async defer><\/script>/);
    assert.match(html, /class="cf-turnstile" data-sitekey="site-key-123"/);
    // Exactly one api.js <script> tag (not duplicated).
    assert.equal((html.match(/turnstile\/v0\/api\.js/g) ?? []).length, 1);

    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'expected an explicit CSP header on the enabled landing');
    assert.match(csp, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    // No nonce: the brief specifies a host allowlist, not a nonce, for this widget.
    assert.doesNotMatch(csp, /nonce-/);
  });
});

test('the secret key is never rendered — only the public site key appears', async () => {
  await withTurnstileEnv('the-site-key', 'THE-SECRET-DO-NOT-LEAK', async () => {
    const res = await fetch(`${base}/en/`);
    const html = await res.text();
    assert.ok(!html.includes('THE-SECRET-DO-NOT-LEAK'));
  });
});

test('the sitekey is HTML-escaped in the rendered widget (defense in depth)', async () => {
  await withTurnstileEnv('"><script>alert(1)</script>', 'secret-xyz', async () => {
    const res = await fetch(`${base}/en/`);
    const html = await res.text();
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /data-sitekey="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  });
});

test('i18n parity: a non-empty, localized noscript fallback is present in both en and fr when enabled', async () => {
  await withTurnstileEnv('site-key-123', 'secret-abc', async () => {
    const enHtml = await (await fetch(`${base}/en/`)).text();
    const frHtml = await (await fetch(`${base}/fr/`)).text();
    const enMatch = enHtml.match(/<noscript>([\s\S]*?)<\/noscript>/);
    const frMatch = frHtml.match(/<noscript>([\s\S]*?)<\/noscript>/);
    assert.ok(enMatch, 'expected a <noscript> fallback on the English landing');
    assert.ok(frMatch, 'expected a <noscript> fallback on the French landing');
    assert.ok(enMatch[1].trim().length > 0);
    assert.ok(frMatch[1].trim().length > 0);
    assert.notEqual(enMatch[1].trim(), frMatch[1].trim());
  });
});
