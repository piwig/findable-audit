// #22 — modern transport & delivery: HTTP/2, TLS version, CDN/edge-cache fingerprint.
//
// Three checks, on purpose, because they do not rest on the same kind of evidence and
// averaging them would hide that:
//
//   http-protocol   performance / measured  — what ALPN negotiated on a real handshake
//   tls-version     security    / measured  — the TLS version and cipher that handshake used
//   cdn-edge-cache  performance / heuristic — what the response headers SUGGEST about the edge
//
// The first two read one shared probe (see ../net/transport.ts): one connection per audit,
// never one per check. The third adds no request at all — it reads headers the crawl has
// already collected.

import type { Check, CheckStatus, CrawlContext, FetchedResource } from '../types.js';
import { makeResult, t } from '../types.js';
import { probeTransport, type TransportResult } from '../net/transport.js';
import { pagesOf } from './aggregate.js';
import { headerOf } from './security.js';

// ---------------------------------------------------------------------------
// One probe per audit
// ---------------------------------------------------------------------------

/**
 * The probe promise for a given audit, keyed by its context.
 *
 * Weak on purpose: the key is the live `Crawler` of one audit, so nothing survives it —
 * which matters because the web app runs many audits in one long-lived process and a
 * plain Map keyed by origin would serve a stale handshake to the next visitor.
 *
 * Storing the PROMISE (not the result) is what makes the "one connection" guarantee hold
 * when checks run concurrently: the second caller joins the first handshake instead of
 * opening its own.
 */
const PROBES = new WeakMap<CrawlContext, Promise<TransportResult>>();

/** The audit's single transport probe, started on first use. */
export function transportOf(ctx: CrawlContext): Promise<TransportResult> {
  const cached = PROBES.get(ctx);
  if (cached) return cached;
  const started = probeTransport(ctx.baseUrl)
    // probeTransport already resolves rather than throws; this is the belt to that
    // braces, so a transport surprise can never turn into a failing check.
    .catch((): TransportResult => ({ ok: false, reason: 'handshake' }));
  PROBES.set(ctx, started);
  return started;
}

/**
 * Test seam: pre-set the probe result for one context, so the check verdicts can be
 * exercised without a network. Never called in shipped code.
 */
export function primeTransport(ctx: CrawlContext, result: TransportResult): void {
  PROBES.set(ctx, Promise.resolve(result));
}

// ---------------------------------------------------------------------------
// http-protocol (measured) — h2 vs http/1.1, straight off the ALPN handshake
// ---------------------------------------------------------------------------

/** `Alt-Svc: h3=":443"; ma=86400, h3-29=":443"` — an advertisement, never a measurement. */
function advertisesH3(res: FetchedResource | null): boolean {
  const altSvc = res ? headerOf(res, 'alt-svc') : undefined;
  if (!altSvc) return false;
  return /(^|[\s,])h3(-\d+)?\s*=/i.test(altSvc);
}

export const httpProtocol: Check = {
  id: 'http-protocol', family: 'performance', evidence: 'measured', maxPoints: 3,
  async run(ctx) {
    const result = await transportOf(ctx);
    // The five skip messages are spelled out at the call site, in both checks, rather
    // than built by a shared helper: `test/message-i18n.test.ts` reads the LITERAL third
    // argument of `makeResult`, and a message assembled elsewhere would silently ship in
    // English on French reports. The repetition is the price of the translation gate.
    if (!result.ok) {
      if (result.reason === 'not-https') return makeResult(this, 'skip', 'origin is not served over HTTPS — no TLS transport to negotiate on');
      if (result.reason === 'blocked-port') return makeResult(this, 'skip', 'origin answers on a non-standard HTTPS port — transport probe skipped');
      if (result.reason === 'blocked-address') return makeResult(this, 'skip', 'origin resolves to a private or reserved address — transport probe skipped');
      if (result.reason === 'dns') return makeResult(this, 'skip', 'origin hostname did not resolve — transport probe skipped');
      return makeResult(this, 'skip', 'TLS handshake did not complete — transport probe skipped');
    }
    const fix = 'Enable HTTP/2 on the server or at the CDN edge; it is a configuration flag on every current stack and needs no change to the site itself.';
    if (result.probe.alpnProtocol === 'h2') {
      // HTTP/3 is reported, never graded: this tool has no QUIC client, so Alt-Svc is
      // the origin's claim about itself and is labelled as one. The homepage is already
      // in the crawler's cache, so reading its headers costs no request.
      return advertisesH3(await ctx.fetch('/'))
        ? makeResult(this, 'pass', 'ALPN negotiated HTTP/2 (h2); the origin also advertises HTTP/3 in Alt-Svc, which this probe cannot verify')
        : makeResult(this, 'pass', 'ALPN negotiated HTTP/2 (h2)');
    }
    if (result.probe.alpnProtocol === '') {
      return makeResult(this, 'warn', 'the origin answered the ALPN request with no protocol, so connections fall back to HTTP/1.1', fix);
    }
    return makeResult(this, 'warn', t`ALPN negotiated ${result.probe.alpnProtocol} — the origin does not offer HTTP/2`, fix);
  },
};

// ---------------------------------------------------------------------------
// tls-version (measured) — the version and cipher a modern client is given
// ---------------------------------------------------------------------------

/**
 * Whether the negotiated suite gives forward secrecy. Both naming styles are handled:
 * OpenSSL's ('ECDHE-RSA-AES128-GCM-SHA256') and IANA's ('TLS_ECDHE_RSA_WITH_…'). Every
 * TLS 1.3 suite ('TLS_AES_…', 'TLS_CHACHA20_…') is ephemeral by construction.
 */
export function hasForwardSecrecy(cipher: string): boolean {
  const c = cipher.toUpperCase();
  if (/^TLS_(AES|CHACHA20)/.test(c)) return true;
  return /(^|[_-])(ECDHE|DHE|EECDH|EDH)([_-]|$)/.test(c);
}

/**
 * Verdict for one negotiated (version, cipher) pair.
 *
 * TLS 1.0/1.1 are deprecated by RFC 8996 — an unambiguous, externally defined defect, so
 * it may fail. In practice such an origin never reaches this point: Node's default
 * `minVersion` is TLS 1.2, so the crawl itself could not have fetched the page and the
 * audit would have stopped at "unreachable". The mapping is kept because it is the
 * correct answer if that ever changes, and because a wrong-but-unreachable branch is
 * worse than a right one. TLS 1.2 with an ECDHE/DHE suite is current practice (RFC 9325)
 * and passes; without forward secrecy it warns.
 */
export function gradeTls(version: string, cipher: string): CheckStatus {
  if (version === 'TLSv1' || version === 'TLSv1.1') return 'fail';
  if (version === 'TLSv1.3') return 'pass';
  if (version === 'TLSv1.2') return hasForwardSecrecy(cipher) ? 'pass' : 'warn';
  return 'skip'; // unknown/unreported version: report nothing rather than guess
}

export const tlsVersion: Check = {
  id: 'tls-version', family: 'security', evidence: 'measured', maxPoints: 3,
  async run(ctx) {
    const result = await transportOf(ctx);
    if (!result.ok) {
      if (result.reason === 'not-https') return makeResult(this, 'skip', 'origin is not served over HTTPS — no TLS transport to negotiate on');
      if (result.reason === 'blocked-port') return makeResult(this, 'skip', 'origin answers on a non-standard HTTPS port — transport probe skipped');
      if (result.reason === 'blocked-address') return makeResult(this, 'skip', 'origin resolves to a private or reserved address — transport probe skipped');
      if (result.reason === 'dns') return makeResult(this, 'skip', 'origin hostname did not resolve — transport probe skipped');
      return makeResult(this, 'skip', 'TLS handshake did not complete — transport probe skipped');
    }
    const { tlsVersion: version, cipher } = result.probe;
    // A handshake always reports both; if this socket did not, say so rather than grade
    // a blank.
    if (version === '' || cipher === '') return makeResult(this, 'skip', 'the handshake reported no usable TLS version or cipher — nothing to grade');
    const status = gradeTls(version, cipher);
    if (status === 'skip') return makeResult(this, 'skip', 'the handshake reported no usable TLS version or cipher — nothing to grade');
    if (status === 'fail') {
      return makeResult(this, 'fail', t`obsolete ${version} negotiated (${cipher})`,
        'Disable TLS 1.0 and 1.1 (deprecated by RFC 8996) and require TLS 1.2 or later.');
    }
    if (status === 'warn') {
      return makeResult(this, 'warn', t`${version} negotiated without forward secrecy (${cipher})`,
        'Put ECDHE suites first in the server cipher list (RFC 9325) and enable TLS 1.3.');
    }
    return makeResult(this, 'pass', t`${version} negotiated (${cipher})`);
  },
};

// ---------------------------------------------------------------------------
// cdn-edge-cache (heuristic) — read off headers the crawl already has
// ---------------------------------------------------------------------------

/** Vendor markers, in order: the first header that matches names the stack. */
const VENDOR_HEADERS: Array<[header: string, vendor: string]> = [
  ['cf-ray', 'Cloudflare'],
  ['cf-cache-status', 'Cloudflare'],
  ['x-amz-cf-id', 'CloudFront'],
  ['x-vercel-id', 'Vercel'],
  ['x-vercel-cache', 'Vercel'],
  ['x-nf-request-id', 'Netlify'],
  ['fastly-request-id', 'Fastly'],
  ['x-fastly-request-id', 'Fastly'],
  ['x-akamai-transformed', 'Akamai'],
  ['akamai-grn', 'Akamai'],
  ['x-azure-ref', 'Azure Front Door'],
  ['x-sucuri-id', 'Sucuri'],
  ['x-bunny-cache-status', 'Bunny'],
  ['x-litespeed-cache', 'LiteSpeed'],
];

/** Substrings in `server:`/`via:` that name a stack the vendor headers missed. */
const VENDOR_TOKENS: Array<[token: string, vendor: string]> = [
  ['cloudflare', 'Cloudflare'],
  ['cloudfront', 'CloudFront'],
  ['akamai', 'Akamai'],
  ['varnish', 'Varnish'],
  ['fastly', 'Fastly'],
  ['ecacc', 'Edgio'],
  ['nginx-cache', 'nginx'],
];

/** Generic proof that SOME shared cache sits in front, when no vendor is identifiable. */
const GENERIC_EDGE_HEADERS = ['x-cache', 'x-cache-status', 'x-served-by', 'x-cdn', 'age', 'via'];

export interface DeliveryFingerprint {
  /** true when at least one header shows a CDN, proxy or shared cache in front. */
  edge: boolean;
  /** Vendor name when one is identifiable, else ''. */
  vendor: string;
  /** What the cache-status headers say about THIS response. */
  cacheStatus: 'hit' | 'miss' | '';
  /** The header (and value) the verdict rests on, for the message. */
  signal: string;
}

/**
 * Cache-status vocabularies. Anything unlisted leaves the status unknown.
 *
 * The boundaries are "not a letter" rather than `\b`, because Squid-style values
 * (`TCP_MEM_HIT`) put an underscore where a word boundary would be — while still
 * refusing a longer word that merely starts the same way ("MISSING" is not a MISS).
 */
const HIT_WORDS = /(^|[^a-z])(hit|stale|revalidated|updating|prerender)([^a-z]|$)/i;
const MISS_WORDS = /(^|[^a-z])(miss|expired|bypass|dynamic|none|no-cache|uncacheable)([^a-z]|$)/i;
const STATUS_HEADERS = ['cf-cache-status', 'x-vercel-cache', 'x-cache', 'x-cache-status', 'x-bunny-cache-status', 'x-litespeed-cache'];

/**
 * What one response's headers say about the delivery path in front of it.
 *
 * Everything here is inference from strings a server chose to send — hence the heuristic
 * label on the check. A header can be forged, renamed by a reverse proxy, or absent on a
 * CDN that is very much there, so the absence of markers is reported as "cannot tell",
 * never as "no CDN".
 */
export function fingerprintDelivery(res: FetchedResource): DeliveryFingerprint {
  let vendor = '';
  const proofs: string[] = [];

  for (const [header, name] of VENDOR_HEADERS) {
    if (headerOf(res, header) !== undefined) {
      if (!vendor) vendor = name;
      break;
    }
  }
  if (!vendor) {
    const banner = `${headerOf(res, 'server') ?? ''} ${headerOf(res, 'via') ?? ''}`.toLowerCase();
    for (const [token, name] of VENDOR_TOKENS) {
      if (banner.includes(token)) { vendor = name; break; }
    }
  }
  if (vendor) proofs.push(vendor);

  let cacheStatus: 'hit' | 'miss' | '' = '';
  for (const header of STATUS_HEADERS) {
    const value = headerOf(res, header);
    if (value === undefined || value === '') continue;
    // "HIT" wins over "MISS" in a chained value ("HIT, MISS" is a hit at the edge the
    // client actually talked to).
    const status = HIT_WORDS.test(value) ? 'hit' : MISS_WORDS.test(value) ? 'miss' : '';
    if (status !== '') {
      cacheStatus = status;
      proofs.push(`${header}: ${value}`);
      break;
    }
  }

  // `Age` is RFC 9111: a shared cache held this response for N seconds. It is the one
  // measured cache signal in the set, and it can promote an otherwise unknown status.
  const age = Number(headerOf(res, 'age') ?? '');
  if (Number.isFinite(age) && age > 0) {
    if (cacheStatus === '') cacheStatus = 'hit';
    proofs.push(`age: ${age}`);
  }

  let edge = vendor !== '' || cacheStatus !== '';
  if (!edge) {
    for (const header of GENERIC_EDGE_HEADERS) {
      const value = headerOf(res, header);
      if (value !== undefined && value !== '') { edge = true; proofs.push(`${header}: ${value}`); break; }
    }
  }
  return { edge, vendor, cacheStatus, signal: proofs.slice(0, 2).join(', ') };
}

/**
 * Whether the response ASKED a shared cache to store it: `s-maxage`, or `public` with a
 * non-zero `max-age`. This is the precondition that makes a cache miss a finding — a page
 * marked `no-store`/`private` is meant to bypass the edge, and reporting that as a
 * failure would be inventing a defect.
 */
export function declaresCacheablePolicy(cacheControl: string | undefined): boolean {
  if (!cacheControl) return false;
  const cc = cacheControl.toLowerCase();
  if (/\b(no-store|private)\b/.test(cc)) return false;
  const sMaxAge = /\bs-maxage\s*=\s*(\d+)/.exec(cc);
  if (sMaxAge) return Number(sMaxAge[1]) > 0;
  const maxAge = /\bmax-age\s*=\s*(\d+)/.exec(cc);
  return /\bpublic\b/.test(cc) && maxAge !== null && Number(maxAge[1]) > 0;
}

export const cdnEdgeCache: Check = {
  id: 'cdn-edge-cache', family: 'performance', evidence: 'heuristic', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');

    const prints = pages.map(fingerprintDelivery);
    const edge = prints.filter((p) => p.edge);
    if (edge.length === 0) {
      // Absence of markers is not absence of a CDN — an origin can sit behind one that
      // strips its own headers. Say "cannot tell", and never score it.
      return makeResult(this, 'skip', 'no CDN or edge-cache headers on the sampled pages — the delivery path cannot be read from here');
    }

    const hit = edge.find((p) => p.cacheStatus === 'hit');
    if (hit) return makeResult(this, 'pass', t`pages served from an edge cache (${hit.signal})`);

    // Only a page that asked to be cached can be reported as not cached.
    const cacheable = pages.findIndex((p) => declaresCacheablePolicy(headerOf(p, 'cache-control')));
    if (cacheable !== -1 && prints[cacheable].cacheStatus === 'miss') {
      return makeResult(this, 'warn', t`pages declare a cacheable policy but none was served from the edge cache (${prints[cacheable].signal})`,
        'Check the CDN cache rules for HTML: a policy the edge ignores costs a round trip to the origin on every crawl.');
    }
    return makeResult(this, 'skip', t`edge cache detected (${edge[0].signal}) but no sampled page both declares a cacheable policy and reports a cache status — nothing to grade`);
  },
};
