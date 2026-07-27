// #22 — the three transport & delivery checks. Every verdict branch, skips included.
import { describe, it, expect } from 'vitest';
import { stubCtx } from '../helpers/stub.js';
import {
  httpProtocol, tlsVersion, cdnEdgeCache, primeTransport, transportOf,
  hasForwardSecrecy, gradeTls, fingerprintDelivery, declaresCacheablePolicy,
} from '../../src/checks/transport.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import type { TransportResult, TransportSkipReason } from '../../src/net/transport.js';

/** A context whose probe is already settled, so no verdict test touches the network. */
function ctxWith(result: TransportResult, resources: Record<string, Partial<FetchedResource>> = {}): CrawlContext {
  const ctx = stubCtx(resources);
  primeTransport(ctx, result);
  return ctx;
}

const H2: TransportResult = { ok: true, probe: { alpnProtocol: 'h2', tlsVersion: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256' } };

describe('http-protocol', () => {
  it('passes on a negotiated h2', async () => {
    const r = await httpProtocol.run(ctxWith(H2));
    expect(r.status).toBe('pass');
    expect(r.message).toBe('ALPN negotiated HTTP/2 (h2)');
  });

  it('reports an Alt-Svc h3 advertisement as a claim it cannot verify', async () => {
    const ctx = ctxWith(H2, { '/': { headers: { 'alt-svc': 'h3=":443"; ma=86400, h3-29=":443"' } } });
    const r = await httpProtocol.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('cannot verify');
  });

  it('warns when the origin only offers HTTP/1.1', async () => {
    const r = await httpProtocol.run(ctxWith({ ok: true, probe: { alpnProtocol: 'http/1.1', tlsVersion: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256' } }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('http/1.1');
    expect(r.messageTemplate).toBe('ALPN negotiated {0} — the origin does not offer HTTP/2');
  });

  it('warns when the origin answers ALPN with nothing', async () => {
    const r = await httpProtocol.run(ctxWith({ ok: true, probe: { alpnProtocol: '', tlsVersion: 'TLSv1.2', cipher: 'ECDHE-RSA-AES128-GCM-SHA256' } }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('fall back to HTTP/1.1');
  });

  const reasons: Array<[TransportSkipReason, RegExp]> = [
    ['not-https', /not served over HTTPS/],
    ['blocked-port', /non-standard HTTPS port/],
    ['blocked-address', /private or reserved address/],
    ['dns', /did not resolve/],
    ['handshake', /handshake did not complete/],
  ];
  for (const [reason, wording] of reasons) {
    it(`skips (never fails) when the probe reports "${reason}"`, async () => {
      const r = await httpProtocol.run(ctxWith({ ok: false, reason }));
      expect(r.status).toBe('skip');
      expect(r.points).toBe(0);
      expect(r.message).toMatch(wording);
    });
  }
});

describe('tls-version', () => {
  it('passes on TLS 1.3 and names the cipher', async () => {
    const r = await tlsVersion.run(ctxWith(H2));
    expect(r.status).toBe('pass');
    expect(r.message).toBe('TLSv1.3 negotiated (TLS_AES_128_GCM_SHA256)');
  });

  it('passes on TLS 1.2 with an ECDHE suite', async () => {
    const r = await tlsVersion.run(ctxWith({ ok: true, probe: { alpnProtocol: 'h2', tlsVersion: 'TLSv1.2', cipher: 'ECDHE-RSA-AES128-GCM-SHA256' } }));
    expect(r.status).toBe('pass');
  });

  it('warns on TLS 1.2 without forward secrecy', async () => {
    const r = await tlsVersion.run(ctxWith({ ok: true, probe: { alpnProtocol: 'h2', tlsVersion: 'TLSv1.2', cipher: 'AES128-SHA' } }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('forward secrecy');
  });

  it('fails on a version RFC 8996 deprecates', async () => {
    const r = await tlsVersion.run(ctxWith({ ok: true, probe: { alpnProtocol: '', tlsVersion: 'TLSv1', cipher: 'AES128-SHA' } }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('obsolete');
  });

  it('skips rather than guesses when the socket reports no version or cipher', async () => {
    for (const probe of [
      { alpnProtocol: 'h2', tlsVersion: '', cipher: '' },
      { alpnProtocol: 'h2', tlsVersion: 'TLSv1.2', cipher: '' },
      { alpnProtocol: 'h2', tlsVersion: 'TLSv9.9', cipher: 'SOMETHING-NEW' },
    ]) {
      const r = await tlsVersion.run(ctxWith({ ok: true, probe }));
      expect(r.status, JSON.stringify(probe)).toBe('skip');
    }
  });

  it('skips on a plain-HTTP origin, like the loopback fixtures', async () => {
    const r = await tlsVersion.run(ctxWith({ ok: false, reason: 'not-https' }));
    expect(r.status).toBe('skip');
  });
});

describe('gradeTls / hasForwardSecrecy', () => {
  it('recognises forward secrecy under both naming styles', () => {
    for (const cipher of ['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256', 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', 'DHE-RSA-AES256-SHA']) {
      expect(hasForwardSecrecy(cipher), cipher).toBe(true);
    }
    for (const cipher of ['AES128-SHA', 'TLS_RSA_WITH_AES_128_CBC_SHA', '']) {
      expect(hasForwardSecrecy(cipher), cipher).toBe(false);
    }
  });

  it('maps versions to verdicts, deprecated ones included', () => {
    expect(gradeTls('TLSv1.3', 'TLS_AES_128_GCM_SHA256')).toBe('pass');
    expect(gradeTls('TLSv1.2', 'ECDHE-RSA-AES128-GCM-SHA256')).toBe('pass');
    expect(gradeTls('TLSv1.2', 'AES128-SHA')).toBe('warn');
    expect(gradeTls('TLSv1.1', 'AES128-SHA')).toBe('fail');
    expect(gradeTls('TLSv1', 'AES128-SHA')).toBe('fail');
    expect(gradeTls('', '')).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// cdn-edge-cache
// ---------------------------------------------------------------------------

const page = (headers: Record<string, string>): Partial<FetchedResource> => ({
  status: 200, ok: true, contentType: 'text/html', body: '<html></html>', headers,
});

describe('cdn-edge-cache', () => {
  it('skips when no header shows a CDN or shared cache', async () => {
    const ctx = stubCtx({ '/': page({ 'content-type': 'text/html' }) });
    const r = await cdnEdgeCache.run(ctx);
    expect(r.status).toBe('skip');
    expect(r.message).toContain('cannot be read from here');
  });

  it('skips when the homepage is unreachable', async () => {
    const r = await cdnEdgeCache.run(stubCtx({}));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no page reachable');
  });

  it('passes on an edge HIT', async () => {
    const ctx = stubCtx({ '/': page({ 'cf-ray': 'abc-CDG', 'cf-cache-status': 'HIT' }) });
    const r = await cdnEdgeCache.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('Cloudflare');
    expect(r.message).toContain('cf-cache-status: HIT');
  });

  it('treats a non-zero Age as the shared-cache proof it is', async () => {
    const ctx = stubCtx({ '/': page({ via: '1.1 varnish', age: '3600' }) });
    const r = await cdnEdgeCache.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('age: 3600');
  });

  it('warns only when the page asked to be cached and was not', async () => {
    const ctx = stubCtx({ '/': page({ 'cf-cache-status': 'MISS', 'cache-control': 'public, max-age=3600' }) });
    const r = await cdnEdgeCache.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('none was served from the edge cache');
    expect(r.points).toBe(1); // heuristic, warn max: never more than half the points
  });

  it('does not hold a deliberately dynamic page against the site', async () => {
    const ctx = stubCtx({ '/': page({ 'cf-cache-status': 'DYNAMIC', 'cache-control': 'private, no-store' }) });
    const r = await cdnEdgeCache.run(ctx);
    expect(r.status).toBe('skip');
    expect(r.message).toContain('nothing to grade');
  });

  it('is heuristic and capped at warn', () => {
    expect(cdnEdgeCache.evidence).toBe('heuristic');
  });
});

describe('fingerprintDelivery', () => {
  const res = (headers: Record<string, string>): FetchedResource => ({
    status: 200, ok: true, body: '', contentType: 'text/html', finalUrl: 'https://x.example/', headers,
  });

  it('names the stack from a vendor header', () => {
    expect(fingerprintDelivery(res({ 'x-amz-cf-id': 'z' })).vendor).toBe('CloudFront');
    expect(fingerprintDelivery(res({ 'x-vercel-cache': 'HIT' })).vendor).toBe('Vercel');
  });

  it('falls back to the server/via banner', () => {
    expect(fingerprintDelivery(res({ server: 'AkamaiGHost' })).vendor).toBe('Akamai');
    expect(fingerprintDelivery(res({ via: '1.1 varnish (Varnish/6.0)' })).vendor).toBe('Varnish');
  });

  it('reads a chained x-cache value as a hit at the edge we talked to', () => {
    expect(fingerprintDelivery(res({ 'x-cache': 'HIT, MISS' })).cacheStatus).toBe('hit');
    expect(fingerprintDelivery(res({ 'x-cache': 'Miss from cloudfront' })).cacheStatus).toBe('miss');
    expect(fingerprintDelivery(res({ 'x-cache': 'TCP_MEM_HIT' })).cacheStatus).toBe('hit');
  });

  it('reports an unmarked response as "cannot tell", not as "no CDN"', () => {
    const print = fingerprintDelivery(res({ 'content-type': 'text/html' }));
    expect(print.edge).toBe(false);
    expect(print.cacheStatus).toBe('');
    expect(print.vendor).toBe('');
  });

  it('still sees a generic shared cache with no vendor name', () => {
    const print = fingerprintDelivery(res({ 'x-served-by': 'cache-cdg' }));
    expect(print.edge).toBe(true);
    expect(print.vendor).toBe('');
  });
});

describe('declaresCacheablePolicy', () => {
  it('accepts s-maxage and public max-age, refuses the rest', () => {
    expect(declaresCacheablePolicy('public, max-age=3600')).toBe(true);
    expect(declaresCacheablePolicy('s-maxage=600, max-age=0')).toBe(true);
    expect(declaresCacheablePolicy('max-age=3600')).toBe(false); // not marked shareable
    expect(declaresCacheablePolicy('public, max-age=0')).toBe(false);
    expect(declaresCacheablePolicy('private, s-maxage=600')).toBe(false);
    expect(declaresCacheablePolicy('no-store')).toBe(false);
    expect(declaresCacheablePolicy(undefined)).toBe(false);
  });
});

describe('one probe per audit', () => {
  it('shares a single in-flight handshake between the checks that need it', async () => {
    // A context whose origin is plain HTTP: probeTransport answers without a socket, so
    // this asserts the sharing, not the network.
    const ctx = stubCtx({ '/': page({}) }, 'http://stub.example/');
    const first = transportOf(ctx);
    const second = transportOf(ctx);
    expect(second).toBe(first); // the same promise, not a second probe
    expect(await first).toEqual({ ok: false, reason: 'not-https' });
  });
});
