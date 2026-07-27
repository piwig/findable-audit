import { describe, it, expect } from 'vitest';
import { buildIndexNowPayload, submitIndexNow, INDEXNOW_ENDPOINT, INDEXNOW_MAX_URLS } from '../src/submit/indexnow.js';
import type { AuditReport } from '../src/runner.js';

function reportWith(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://example.com/',
    score: 90,
    grade: 'A',
    familyScores: [],
    sampledPages: ['/', '/about/', '/contact/'],
    results: [
      { id: 'indexnow', family: 'technical-seo', status: 'pass', points: 4, maxPoints: 4, message: 'IndexNow key file verified' },
    ],
    ...over,
  };
}

describe('buildIndexNowPayload', () => {
  it('builds host, key, keyLocation and absolute URLs from the sampled pages', () => {
    const p = buildIndexNowPayload(reportWith(), 'abc123')!;
    expect(p.host).toBe('example.com');
    expect(p.key).toBe('abc123');
    expect(p.keyLocation).toBe('https://example.com/abc123.txt');
    expect(p.urlList).toEqual([
      'https://example.com/',
      'https://example.com/about/',
      'https://example.com/contact/',
    ]);
  });

  it('keeps the port when the audited origin has one', () => {
    const p = buildIndexNowPayload(reportWith({ url: 'https://example.com:8443/' }), 'k')!;
    expect(p.host).toBe('example.com:8443');
    expect(p.urlList[0]).toBe('https://example.com:8443/');
  });

  it('dedupes repeated paths without reordering the rest', () => {
    const p = buildIndexNowPayload(reportWith({ sampledPages: ['/', '/a', '/', '/b', '/a'] }), 'k')!;
    expect(p.urlList).toEqual([
      'https://example.com/', 'https://example.com/a', 'https://example.com/b',
    ]);
  });

  it('never submits a URL outside the audited origin, whatever the sample holds', () => {
    const p = buildIndexNowPayload(reportWith({ sampledPages: ['/', 'https://evil.test/x', '//evil.test/y'] }), 'k')!;
    for (const u of p.urlList) expect(new URL(u).host).toBe('example.com');
  });

  it('caps the list rather than posting an unbounded payload', () => {
    const many = Array.from({ length: INDEXNOW_MAX_URLS + 25 }, (_, i) => `/p${i}`);
    const p = buildIndexNowPayload(reportWith({ sampledPages: many }), 'k')!;
    expect(p.urlList).toHaveLength(INDEXNOW_MAX_URLS);
  });

  it('returns null when there is nothing to submit', () => {
    expect(buildIndexNowPayload(reportWith({ sampledPages: [] }), 'k')).toBeNull();
  });

  it('returns null for an unparseable audited URL instead of guessing a host', () => {
    expect(buildIndexNowPayload(reportWith({ url: 'not a url' }), 'k')).toBeNull();
  });
});

describe('submitIndexNow', () => {
  const payload = { host: 'example.com', key: 'k', keyLocation: 'https://example.com/k.txt', urlList: ['https://example.com/'] };

  it('posts JSON to the fixed IndexNow endpoint', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    await submitIndexNow(payload, {
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch,
    });
    expect(seen!.url).toBe(INDEXNOW_ENDPOINT);
    expect(seen!.init.method).toBe('POST');
    expect(String((seen!.init.headers as Record<string, string>)['content-type'])).toMatch(/application\/json/);
    expect(JSON.parse(String(seen!.init.body))).toEqual(payload);
  });

  it('treats 200 and 202 as accepted', async () => {
    for (const status of [200, 202]) {
      const r = await submitIndexNow(payload, {
        fetchImpl: (async () => ({ ok: status < 300, status } as Response)) as unknown as typeof fetch,
      });
      expect(r.ok).toBe(true);
    }
  });

  it('explains the documented refusals instead of printing a bare status', async () => {
    const cases: Array<[number, RegExp]> = [
      [400, /invalid|malformed/i],
      [403, /key/i],
      [422, /url/i],
      [429, /too many|rate/i],
    ];
    for (const [status, expected] of cases) {
      const r = await submitIndexNow(payload, {
        fetchImpl: (async () => ({ ok: false, status } as Response)) as unknown as typeof fetch,
      });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(expected);
    }
  });

  it('never throws on a network failure: a failed submission is not a failed audit', async () => {
    const r = await submitIndexNow(payload, {
      fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/ECONNRESET/);
  });
});
