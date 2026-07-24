// Hermetic tests for the Cloudflare Turnstile lib: env-gated config +
// server-side siteverify. No real network calls — fetchImpl is always a
// stub, and the empty-token fast path is asserted to make zero calls.

import test from 'node:test';
import assert from 'node:assert/strict';

import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from '../lib/turnstile.mjs';

// --- turnstileEnabled -------------------------------------------------------

test('turnstileEnabled is false when neither key is set', () => {
  assert.equal(turnstileEnabled({}), false);
});

test('turnstileEnabled is false + warns when only TURNSTILE_SITE_KEY is set', () => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    const result = turnstileEnabled({ TURNSTILE_SITE_KEY: 'site-only' });
    assert.equal(result, false);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0][0],
      '[turnstile] disabled: both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required',
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('turnstileEnabled is false + warns when only TURNSTILE_SECRET_KEY is set', () => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    const result = turnstileEnabled({ TURNSTILE_SECRET_KEY: 'secret-only' });
    assert.equal(result, false);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0][0],
      '[turnstile] disabled: both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required',
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('turnstileEnabled is true when both keys are set (no warn)', () => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    const result = turnstileEnabled({ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });
    assert.equal(result, true);
    assert.equal(calls.length, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test('turnstileEnabled treats empty-string keys as unset (0 keys -> false, no warn)', () => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    const result = turnstileEnabled({ TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
    assert.equal(result, false);
    assert.equal(calls.length, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test('turnstileEnabled defaults to process.env when no arg is given', () => {
  const prevSite = process.env.TURNSTILE_SITE_KEY;
  const prevSecret = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    assert.equal(turnstileEnabled(), false);
  } finally {
    if (prevSite === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = prevSite;
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = prevSecret;
  }
});

// --- turnstileSiteKey --------------------------------------------------------

test('turnstileSiteKey is null when disabled', () => {
  assert.equal(turnstileSiteKey({}), null);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(turnstileSiteKey({ TURNSTILE_SITE_KEY: 'site-only' }), null);
  } finally {
    console.warn = originalWarn;
  }
});

test('turnstileSiteKey returns the site key when enabled', () => {
  assert.equal(
    turnstileSiteKey({ TURNSTILE_SITE_KEY: 'my-site-key', TURNSTILE_SECRET_KEY: 'my-secret' }),
    'my-site-key',
  );
});

// --- verifyTurnstile ----------------------------------------------------------

function fakeFetch(response) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return response;
  };
  fn.calls = calls;
  return fn;
}

test('verifyTurnstile returns {ok:true} on success:true', async () => {
  const fetchImpl = fakeFetch({ ok: true, json: async () => ({ success: true }) });
  const result = await verifyTurnstile('good-token', '1.2.3.4', { secret: 's3cr3t', fetchImpl });
  assert.deepEqual(result, { ok: true });
});

test('verifyTurnstile returns {ok:false} on success:false', async () => {
  const fetchImpl = fakeFetch({ ok: true, json: async () => ({ success: false }) });
  const result = await verifyTurnstile('bad-token', '1.2.3.4', { secret: 's3cr3t', fetchImpl });
  assert.deepEqual(result, { ok: false });
});

test('verifyTurnstile returns {ok:false} without any network call for an empty token', async () => {
  const fetchImpl = fakeFetch({ ok: true, json: async () => ({ success: true }) });
  const result = await verifyTurnstile('', '1.2.3.4', { secret: 's3cr3t', fetchImpl });
  assert.deepEqual(result, { ok: false });
  assert.equal(fetchImpl.calls.length, 0);
});

test('verifyTurnstile returns {ok:false} without any network call for a missing/undefined token', async () => {
  const fetchImpl = fakeFetch({ ok: true, json: async () => ({ success: true }) });
  const result = await verifyTurnstile(undefined, '1.2.3.4', { secret: 's3cr3t', fetchImpl });
  assert.deepEqual(result, { ok: false });
  assert.equal(fetchImpl.calls.length, 0);
});

test('verifyTurnstile fails closed when fetchImpl throws (network error / timeout)', async () => {
  const fetchImpl = async () => {
    throw new Error('network unreachable');
  };
  const result = await verifyTurnstile('some-token', '1.2.3.4', { secret: 's3cr3t', fetchImpl });
  assert.deepEqual(result, { ok: false });
});

test('verifyTurnstile fails closed when the response status is not ok (non-2xx)', async () => {
  const fetchImpl = fakeFetch({ ok: false, status: 500, json: async () => ({ success: true }) });
  const result = await verifyTurnstile('some-token', '1.2.3.4', { secret: 's3cr3t', fetchImpl });
  assert.deepEqual(result, { ok: false });
});

test('verifyTurnstile fails closed when the response JSON is invalid', async () => {
  const fetchImpl = fakeFetch({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token in JSON');
    },
  });
  const result = await verifyTurnstile('some-token', '1.2.3.4', { secret: 's3cr3t', fetchImpl });
  assert.deepEqual(result, { ok: false });
});

test('verifyTurnstile never throws even when fetchImpl rejects', async () => {
  const fetchImpl = async () => {
    throw new Error('boom');
  };
  await assert.doesNotReject(verifyTurnstile('t', undefined, { secret: 's3cr3t', fetchImpl }));
});

test('verifyTurnstile posts form-encoded body with secret, response, and remoteip to the fixed siteverify endpoint', async () => {
  const fetchImpl = fakeFetch({ ok: true, json: async () => ({ success: true }) });
  await verifyTurnstile('the-token', '9.9.9.9', { secret: 'the-secret', fetchImpl });

  assert.equal(fetchImpl.calls.length, 1);
  const [url, init] = fetchImpl.calls[0];
  assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(init.method, 'POST');
  assert.match(init.headers['Content-Type'], /application\/x-www-form-urlencoded/);

  const body = new URLSearchParams(init.body);
  assert.equal(body.get('secret'), 'the-secret');
  assert.equal(body.get('response'), 'the-token');
  assert.equal(body.get('remoteip'), '9.9.9.9');
  assert.ok(init.signal, 'expected an AbortSignal to be passed for the timeout');
});

test('verifyTurnstile omits remoteip from the body when not provided', async () => {
  const fetchImpl = fakeFetch({ ok: true, json: async () => ({ success: true }) });
  await verifyTurnstile('the-token', undefined, { secret: 'the-secret', fetchImpl });

  const [, init] = fetchImpl.calls[0];
  const body = new URLSearchParams(init.body);
  assert.equal(body.has('remoteip'), false);
});

test('verifyTurnstile result never contains the secret', async () => {
  const fetchImpl = fakeFetch({ ok: true, json: async () => ({ success: true }) });
  const result = await verifyTurnstile('the-token', '1.2.3.4', { secret: 'super-secret-value', fetchImpl });
  assert.deepEqual(Object.keys(result).sort(), ['ok']);
  assert.ok(!Object.values(result).includes('super-secret-value'));
  assert.ok(!JSON.stringify(result).includes('super-secret-value'));
});

test('verifyTurnstile never logs the secret, even on failure paths', async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logged = [];
  const capture = (...args) => logged.push(args.map(String).join(' '));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    const fetchImpl = async () => {
      throw new Error('boom');
    };
    await verifyTurnstile('t', '1.2.3.4', { secret: 'top-secret-do-not-log', fetchImpl });
    const badResponseFetch = fakeFetch({ ok: false, status: 500, json: async () => ({}) });
    await verifyTurnstile('t', '1.2.3.4', { secret: 'top-secret-do-not-log', fetchImpl: badResponseFetch });
    const invalidJsonFetch = fakeFetch({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    await verifyTurnstile('t', '1.2.3.4', { secret: 'top-secret-do-not-log', fetchImpl: invalidJsonFetch });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  const combined = logged.join('\n');
  assert.ok(!combined.includes('top-secret-do-not-log'));
});
