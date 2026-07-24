// Task 5 — #7 server-side Turnstile verification gate.
//
// Verifies that handleAuditStart / handleCompareStart call verifyTurnstile()
// BEFORE creating a job, ONLY when turnstileEnabled() (both env keys set).
// No real network call: the server-side verify call is stubbed via the
// test-only seam `setVerifyTurnstileForTest` exported by server.mjs (a
// reassignable module-level indirection — see server.mjs comment at its
// definition). The "token absent" case deliberately uses the REAL
// verifyTurnstile (no stub): an empty/missing token short-circuits to
// {ok:false} with zero network calls (asserted in turnstile.test.mjs task 3),
// so it stays hermetic without needing a stub.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '0'; // ephemeral port: no collision with other test files.

const { server, jobs, setVerifyTurnstileForTest } = await import('../server.mjs');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

// A literal PUBLIC IP passes assertPublicUrl without DNS and is NOT blocked
// (see ssrf.test.mjs). Job creation never fetches the target (lazy execution),
// so no outbound network call happens regardless of the Turnstile gate.
const PUBLIC = 'http://93.184.216.34/';

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

// Always reset the stub after each test so a stub set in one test can never
// leak into the next (each test that stubs also does this explicitly, but a
// global safety net costs nothing).
test.afterEach(() => setVerifyTurnstileForTest(undefined));

// --- /audit --------------------------------------------------------------

test('with keys set, a token that fails verification returns 400 + captcha error page, no job created', async () => {
  await withTurnstileEnv('site-key', 'secret-key', async () => {
    setVerifyTurnstileForTest(async () => ({ ok: false }));
    const before = jobs.size;
    const res = await fetch(`${base}/en/audit?url=${encodeURIComponent(PUBLIC)}&cf-turnstile-response=bad-token`);
    assert.equal(res.status, 400);
    const html = await res.text();
    // i18n captcha error strings (added this task) render.
    assert.match(html, /<html lang="en"/);
    assert.equal(jobs.size, before, 'no job was created for a failed verification');
  });
});

test('with keys set, a token that passes verification lets the normal flow continue (job created)', async () => {
  await withTurnstileEnv('site-key', 'secret-key', async () => {
    let calledWith = null;
    setVerifyTurnstileForTest(async (token, ip, opts) => {
      calledWith = { token, ip, opts };
      return { ok: true };
    });
    const before = jobs.size;
    const res = await fetch(`${base}/en/audit?url=${encodeURIComponent(PUBLIC)}&cf-turnstile-response=good-token`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'nonce-[^']+'/); // same progress page as the unguarded flow
    assert.equal(jobs.size, before + 1, 'a job was created after a successful verification');
    assert.ok(calledWith, 'verify stub was invoked');
    assert.equal(calledWith.token, 'good-token');
    assert.equal(calledWith.opts.secret, 'secret-key');
  });
});

test('with keys set and no token in the query, verification fails closed (400 captcha, no stub needed)', async () => {
  await withTurnstileEnv('site-key', 'secret-key', async () => {
    // Deliberately NOT stubbing: real verifyTurnstile short-circuits on an
    // empty token with zero network calls (task 3 behavior).
    const before = jobs.size;
    const res = await fetch(`${base}/en/audit?url=${encodeURIComponent(PUBLIC)}`);
    assert.equal(res.status, 400);
    assert.equal(jobs.size, before, 'no job was created without a token');
  });
});

test('without keys, /audit is unchanged: job created normally, verify stub is never consulted', async () => {
  let stubCalled = false;
  setVerifyTurnstileForTest(async () => { stubCalled = true; return { ok: false }; });
  const before = jobs.size;
  // No cf-turnstile-response param at all — exactly today's landing form shape.
  const res = await fetch(`${base}/en/audit?url=${encodeURIComponent(PUBLIC)}`);
  assert.equal(res.status, 200);
  assert.equal(jobs.size, before + 1, 'job created exactly as before Turnstile existed');
  assert.equal(stubCalled, false, 'the gate must not even read the token when Turnstile is disabled');
});

// --- /compare/start --------------------------------------------------------

test('compare: with keys set, a failing token returns 400 + captcha page, no job created', async () => {
  await withTurnstileEnv('site-key', 'secret-key', async () => {
    setVerifyTurnstileForTest(async () => ({ ok: false }));
    const before = jobs.size;
    const res = await fetch(`${base}/en/compare/start?url=${encodeURIComponent(PUBLIC)}&cf-turnstile-response=bad`);
    assert.equal(res.status, 400);
    assert.equal(jobs.size, before, 'no compare job was created for a failed verification');
  });
});

test('compare: with keys set, a passing token lets the compare job get created', async () => {
  await withTurnstileEnv('site-key', 'secret-key', async () => {
    setVerifyTurnstileForTest(async () => ({ ok: true }));
    const before = jobs.size;
    const res = await fetch(`${base}/en/compare/start?url=${encodeURIComponent(PUBLIC)}&cf-turnstile-response=good`);
    assert.equal(res.status, 200);
    assert.equal(jobs.size, before + 1, 'a compare job was created after a successful verification');
  });
});

test('compare: without keys, /compare/start is unchanged: job created normally', async () => {
  const before = jobs.size;
  const res = await fetch(`${base}/en/compare/start?url=${encodeURIComponent(PUBLIC)}`);
  assert.equal(res.status, 200);
  assert.equal(jobs.size, before + 1, 'compare job created exactly as before Turnstile existed');
});
