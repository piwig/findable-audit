// IndexNow submission (#61) — the "submit" end of detect → generate → submit.
//
// This is the ONLY place in the tool that writes to a third party on the user's
// behalf, so the guard-rails live at the call site (index.ts) and the rules are
// spelled out in docs/superpowers/specs/2026-07-27-lot9-fermer-la-boucle.md:
// opt-in flag, an IndexNow key file actually hosted on the audited site (proof
// of ownership — you cannot submit someone else's site), sampled URLs only, and
// never from the web app.
//
// The IndexNow key is NOT a secret: it only works because it is published at
// /<key>.txt on the site itself. It therefore appears in reports and logs like
// any other public fact, and nothing here tries to redact it.
//
// One notification reaches Bing, Yandex, Seznam and Naver at once (Google does
// not participate in IndexNow — the guide says so rather than implying reach we
// do not have).

import type { AuditReport } from '../runner.js';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Upper bound on one submission. The protocol allows 10 000; an audit samples far fewer. */
export const INDEXNOW_MAX_URLS = 100;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export interface SubmitResult {
  ok: boolean;
  status: number | null;
  message: string;
}

/**
 * Turn a finished audit into an IndexNow payload, or null when there is
 * nothing safe to submit.
 *
 * Every URL is rebuilt from the audited origin, so a sampled entry that somehow
 * carries an absolute foreign URL can never widen the submission to another
 * host — the origin is the fixed point, the sample only contributes paths.
 */
export function buildIndexNowPayload(report: AuditReport, key: string): IndexNowPayload | null {
  let origin: URL;
  try {
    origin = new URL(report.url);
  } catch {
    return null;
  }
  const seen = new Set<string>();
  const urlList: string[] = [];
  for (const entry of report.sampledPages) {
    let pathname: string;
    try {
      // `new URL(entry, origin)` would follow an absolute entry to its own host;
      // taking only the pathname (+search) keeps the origin ours.
      const parsed = new URL(entry, origin);
      pathname = parsed.pathname + parsed.search;
    } catch {
      continue;
    }
    const absolute = new URL(pathname, origin).toString();
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    urlList.push(absolute);
    if (urlList.length >= INDEXNOW_MAX_URLS) break;
  }
  if (urlList.length === 0) return null;
  return {
    host: origin.host,
    key,
    keyLocation: new URL(`/${key}.txt`, origin).toString(),
    urlList,
  };
}

/** Documented IndexNow responses, turned into something a human can act on. */
function explain(status: number): string {
  switch (status) {
    case 400: return 'invalid request — the payload was malformed (400)';
    case 403: return 'key rejected: the key file was not found or does not match on the site (403)';
    case 422: return 'URLs refused: they do not belong to the declared host, or the key does not match (422)';
    case 429: return 'too many submissions — rate limited, try again later (429)';
    default: return `unexpected response from the IndexNow service (${status})`;
  }
}

/**
 * POST the payload. Takes its `fetch` so the whole path is testable without a
 * network, and NEVER throws: a submission that fails must not turn a successful
 * audit into a failed run.
 */
export async function submitIndexNow(
  payload: IndexNowPayload,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SubmitResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.status === 200 || res.status === 202) {
      return { ok: true, status: res.status, message: `accepted by the IndexNow service (${res.status})` };
    }
    return { ok: false, status: res.status, message: explain(res.status) };
  } catch (err) {
    return { ok: false, status: null, message: `submission failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
