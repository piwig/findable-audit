import { describe, it, expect } from 'vitest';
import { sameAsVerified } from '../../src/checks/sameas-verified.js';
import { stubCtx } from '../helpers/stub.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';

const BASE = 'https://acme.example/';

function homepage(sameAs: string[]): string {
  const ld = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme', url: BASE, sameAs };
  return `<!doctype html><html lang="en"><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>Acme</h1></body></html>`;
}

/** A context whose off-origin fetches are scripted per URL. */
function ctxWith(sameAs: string[], external: Record<string, Partial<FetchedResource> | null>): CrawlContext {
  const ctx = stubCtx({ '/': { contentType: 'text/html', body: homepage(sameAs) } }, BASE);
  ctx.fetchExternal = async (url: string) => {
    if (!(url in external)) return null;
    const e = external[url];
    if (e === null) return null;
    return {
      status: e.status ?? 200, ok: (e.status ?? 200) < 400, body: e.body ?? '',
      contentType: e.contentType ?? 'text/html', finalUrl: e.finalUrl ?? url, headers: e.headers ?? {},
    };
  };
  return ctx;
}

const linksBack = { body: `<html><body><a href="${BASE}">Acme official site</a></body></html>` };
const noBacklink = { body: '<html><body><p>A profile that never mentions them.</p></body></html>' };

describe('sameas-verified', () => {
  it('skips when the off-origin capability was not enabled', async () => {
    const ctx = stubCtx({ '/': { contentType: 'text/html', body: homepage(['https://x.test/acme']) } }, BASE);
    const r = await sameAsVerified.run(ctx);
    expect(r.status).toBe('skip');
    expect(r.message).toMatch(/verify-profiles/);
  });

  it('skips when the site declares no sameAs at all — that is another check\'s job', async () => {
    const r = await sameAsVerified.run(ctxWith([], {}));
    expect(r.status).toBe('skip');
  });

  it('passes when a declared profile resolves and links back', async () => {
    const url = 'https://social.test/acme';
    const r = await sameAsVerified.run(ctxWith([url], { [url]: linksBack }));
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/1/);
  });

  it('recognises a backlink to the bare host, not only the exact URL', async () => {
    const url = 'https://social.test/acme';
    const r = await sameAsVerified.run(ctxWith([url], {
      [url]: { body: '<html><body><a href="https://acme.example/about?utm_source=x">our site</a></body></html>' },
    }));
    expect(r.status).toBe('pass');
  });

  it('warns — never fails — when a profile resolves without linking back', async () => {
    const url = 'https://social.test/acme';
    const r = await sameAsVerified.run(ctxWith([url], { [url]: noBacklink }));
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/no link back|0 of 1/i);
  });

  it('never counts a platform that blocks us against the site', async () => {
    // LinkedIn answers 999, Instagram 403, others time out. None of that says
    // anything about whether the profile is real — only that we were refused.
    const blocked = 'https://blocking.test/acme';
    const ok = 'https://social.test/acme';
    const r = await sameAsVerified.run(ctxWith([blocked, ok], {
      [blocked]: { status: 999 },
      [ok]: linksBack,
    }));
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/unverifiable|could not/i);
  });

  it('reports honestly when every profile was unreachable, without a verdict on the site', async () => {
    const a = 'https://blocking.test/a';
    const b = 'https://blocking.test/b';
    const r = await sameAsVerified.run(ctxWith([a, b], { [a]: null, [b]: { status: 403 } }));
    expect(r.status).toBe('skip');
    expect(r.message).toMatch(/unverifiable|could not/i);
  });

  it('never returns fail, whatever the profiles do', async () => {
    const cases: Array<Record<string, Partial<FetchedResource> | null>> = [
      { 'https://a.test/x': null },
      { 'https://a.test/x': { status: 404 } },
      { 'https://a.test/x': noBacklink },
      { 'https://a.test/x': { status: 500 } },
    ];
    for (const external of cases) {
      const r = await sameAsVerified.run(ctxWith(Object.keys(external), external));
      expect(r.status).not.toBe('fail');
    }
  });

  it('ignores a non-http scheme instead of handing it to the fetcher', async () => {
    const r = await sameAsVerified.run(ctxWith(['mailto:hi@acme.example', 'javascript:alert(1)'], {}));
    expect(r.status).toBe('skip');
  });
});
