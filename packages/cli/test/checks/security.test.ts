import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { parse } from 'node-html-parser';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import {
  headerOf, classifyMixedContent, mixedContent, hsts, xContentTypeOptions, csp,
  clickjacking, referrerPolicy, permissionsPolicy,
} from '../../src/checks/security.js';

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${port}`;
}

/** Stub ctx whose homepage carries the given response headers (default https, public host). */
function ctxWith(headers: Record<string, string>, body = '<html></html>', base = 'https://example.com/'): CrawlContext {
  return stubCtx({ '/': { contentType: 'text/html', body, headers } }, base);
}

describe('headerOf', () => {
  it('looks up headers case-insensitively', () => {
    const res = { headers: { 'x-content-type-options': 'nosniff' } } as unknown as FetchedResource;
    expect(headerOf(res, 'X-Content-Type-Options')).toBe('nosniff');
    expect(headerOf(res, 'missing')).toBeUndefined();
  });
});

describe('classifyMixedContent', () => {
  it('separates active (script/style/iframe) from passive (img/media)', () => {
    const root = parse(`<html><head><link rel="stylesheet" href="http://cdn/x.css"></head>
      <body><script src="http://cdn/x.js"></script><img src="http://cdn/x.jpg"><iframe src="http://cdn/f"></iframe></body></html>`);
    const refs = classifyMixedContent(root);
    expect(refs.active.length).toBe(3); // script + stylesheet + iframe
    expect(refs.passive.length).toBe(1); // img
  });
  it('ignores https subresources', () => {
    const root = parse('<html><body><script src="https://cdn/x.js"></script><img src="/local.jpg"></body></html>');
    const refs = classifyMixedContent(root);
    expect(refs.active.length).toBe(0);
    expect(refs.passive.length).toBe(0);
  });
});

describe('mixed-content', () => {
  it('skips when the page is not served over HTTPS', async () => {
    const ctx = ctxWith({}, '<html><body><img src="http://cdn/x.jpg"></body></html>', 'http://example.com/');
    expect((await mixedContent.run(ctx)).status).toBe('skip');
  });
  it('fails on active mixed content over https', async () => {
    const ctx = ctxWith({}, '<html><body><script src="http://cdn/x.js"></script></body></html>');
    expect((await mixedContent.run(ctx)).status).toBe('fail');
  });
  it('warns on passive-only mixed content over https', async () => {
    const ctx = ctxWith({}, '<html><body><img src="http://cdn/x.jpg"></body></html>');
    expect((await mixedContent.run(ctx)).status).toBe('warn');
  });
  it('passes when all subresources are secure', async () => {
    const ctx = ctxWith({}, '<html><body><img src="https://cdn/x.jpg"></body></html>');
    expect((await mixedContent.run(ctx)).status).toBe('pass');
  });
});

describe('hsts', () => {
  it('skips on local hosts', async () => {
    const ctx = ctxWith({ 'strict-transport-security': 'max-age=0' }, '<html></html>', 'http://127.0.0.1/');
    expect((await hsts.run(ctx)).status).toBe('skip');
  });
  it('fails when the header is absent on a public https host', async () => {
    expect((await hsts.run(ctxWith({}))).status).toBe('fail');
  });
  it('passes with max-age >= 180 days', async () => {
    expect((await hsts.run(ctxWith({ 'strict-transport-security': 'max-age=31536000; includeSubDomains' }))).status).toBe('pass');
  });
  it('warns on a short max-age', async () => {
    expect((await hsts.run(ctxWith({ 'strict-transport-security': 'max-age=3600' }))).status).toBe('warn');
  });
});

describe('x-content-type-options', () => {
  it('passes on nosniff', async () => {
    expect((await xContentTypeOptions.run(ctxWith({ 'x-content-type-options': 'nosniff' }))).status).toBe('pass');
  });
  it('fails when absent', async () => {
    expect((await xContentTypeOptions.run(ctxWith({}))).status).toBe('fail');
  });
  it('fails on a non-nosniff value', async () => {
    expect((await xContentTypeOptions.run(ctxWith({ 'x-content-type-options': 'sniff' }))).status).toBe('fail');
  });
});

describe('csp', () => {
  it('passes with a restrictive policy', async () => {
    expect((await csp.run(ctxWith({ 'content-security-policy': "default-src 'self'" }))).status).toBe('pass');
  });
  it("warns when script-src allows 'unsafe-inline'", async () => {
    expect((await csp.run(ctxWith({ 'content-security-policy': "script-src 'self' 'unsafe-inline'" }))).status).toBe('warn');
  });
  it('fails when there is no CSP at all', async () => {
    expect((await csp.run(ctxWith({}))).status).toBe('fail');
  });
  it('accepts a CSP delivered via a meta tag', async () => {
    const ctx = ctxWith({}, '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head></html>');
    expect((await csp.run(ctx)).status).toBe('pass');
  });
});

describe('clickjacking', () => {
  it('passes with X-Frame-Options SAMEORIGIN', async () => {
    expect((await clickjacking.run(ctxWith({ 'x-frame-options': 'SAMEORIGIN' }))).status).toBe('pass');
  });
  it("passes with CSP frame-ancestors 'self'", async () => {
    expect((await clickjacking.run(ctxWith({ 'content-security-policy': "frame-ancestors 'self'" }))).status).toBe('pass');
  });
  it('fails with neither protection', async () => {
    expect((await clickjacking.run(ctxWith({ 'content-security-policy': "default-src 'self'" }))).status).toBe('fail');
  });
});

describe('referrer-policy', () => {
  it('passes on a non-leaky value', async () => {
    expect((await referrerPolicy.run(ctxWith({ 'referrer-policy': 'strict-origin-when-cross-origin' }))).status).toBe('pass');
  });
  it('warns on unsafe-url', async () => {
    expect((await referrerPolicy.run(ctxWith({ 'referrer-policy': 'unsafe-url' }))).status).toBe('warn');
  });
  it('fails when absent', async () => {
    expect((await referrerPolicy.run(ctxWith({}))).status).toBe('fail');
  });
});

describe('permissions-policy', () => {
  it('passes when present', async () => {
    expect((await permissionsPolicy.run(ctxWith({ 'permissions-policy': 'geolocation=()' }))).status).toBe('pass');
  });
  it('passes with a legacy Feature-Policy', async () => {
    expect((await permissionsPolicy.run(ctxWith({ 'feature-policy': "geolocation 'none'" }))).status).toBe('pass');
  });
  it('fails when absent', async () => {
    expect((await permissionsPolicy.run(ctxWith({}))).status).toBe('fail');
  });
});

describe('security headers over a real crawl', () => {
  it('a bespoke server that omits the headers fails the header checks', async () => {
    const url = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' }); // deliberately no security headers
      res.end('<html><body>hi</body></html>');
    }));
    const crawler = new Crawler(url);
    expect((await xContentTypeOptions.run(crawler)).status).toBe('fail');
    expect((await csp.run(crawler)).status).toBe('fail');
    expect((await clickjacking.run(crawler)).status).toBe('fail');
    expect((await referrerPolicy.run(crawler)).status).toBe('fail');
    expect((await permissionsPolicy.run(crawler)).status).toBe('fail');
  });
});
