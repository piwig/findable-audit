// Cloudflare Turnstile: env-gated config + server-side token verification.
//
// This module is intentionally isolated: it knows nothing about server.mjs,
// the job queue, or i18n. It exposes three small, pure/hermetic-friendly
// functions so the wiring (later task) and this lib can be tested separately.
//
// Env-gating: Turnstile is OFF unless both TURNSTILE_SITE_KEY and
// TURNSTILE_SECRET_KEY are set (non-empty). This keeps dev/local/tests working
// unchanged with no captcha. If only one of the two is set, that is almost
// certainly a misconfiguration (e.g. a copy-paste mistake in the env file) —
// we warn once via console.warn and behave as fully disabled rather than
// half-configured.
//
// Fail-closed by design: verifyTurnstile() never throws. Any problem (empty
// token, network error, timeout, non-2xx status, invalid JSON) resolves to
// { ok: false }. The secret is used only in the outgoing POST body and is
// never included in the returned value or in any console output.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Whether Turnstile is configured and should be enforced.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function turnstileEnabled(env = process.env) {
  const hasSite = Boolean(env.TURNSTILE_SITE_KEY);
  const hasSecret = Boolean(env.TURNSTILE_SECRET_KEY);
  if (hasSite && hasSecret) return true;
  if (hasSite || hasSecret) {
    console.warn('[turnstile] disabled: both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required');
  }
  return false;
}

/**
 * The public site key to render in the widget, or null when disabled.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function turnstileSiteKey(env = process.env) {
  return turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : null;
}

/**
 * Verify a Turnstile token server-side against Cloudflare's siteverify
 * endpoint. Fail-closed: never throws, always resolves to { ok: boolean }.
 *
 * The siteverify endpoint is a fixed, trusted Cloudflare host — this
 * deliberately does NOT go through the SSRF guard (lib/ssrf.mjs), which
 * exists to validate *user-supplied* audit target URLs, not our own
 * hardcoded outbound call.
 *
 * @param {string | undefined | null} token   the client-side widget response
 * @param {string | undefined} [remoteip]     the visitor's IP, if known
 * @param {{ secret: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean }>}
 */
export async function verifyTurnstile(token, remoteip, opts = {}) {
  const { secret, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = opts;

  if (!token) {
    return { ok: false };
  }

  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token);
    if (remoteip) body.set('remoteip', remoteip);

    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { ok: false };
    }

    const json = await response.json();
    return { ok: Boolean(json.success) };
  } catch {
    // Network error, abort/timeout, invalid JSON, or anything else: fail
    // closed. Deliberately no logging here — the secret is in scope via
    // closure and any accidental `console.warn(err)` in the future must not
    // be able to leak it, so this catch stays silent by design.
    return { ok: false };
  }
}
