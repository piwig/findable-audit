import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../src/types.js';
import { csrContentParity } from '../src/checks/llm-content.js';

const BASE = 'https://stub.example/';

function page(pathname: string, body = '', extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

interface CtxOpts {
  pages?: FetchedResource[];
  base?: string;
  noSample?: boolean;
}

/** makeCtx pattern copied from test/checks/technical-seo.test.ts. */
function makeCtx(opts: CtxOpts = {}): CrawlContext {
  const { pages = [], base = BASE, noSample = false } = opts;
  const byPath = new Map<string, FetchedResource>();
  for (const p of pages) byPath.set(new URL(p.finalUrl).pathname, p);
  const ctx: CrawlContext = {
    baseUrl: new URL(base),
    async fetch(p: string) {
      const url = new URL(p, base);
      return byPath.get(url.pathname) ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
  };
  if (!noSample) ctx.sample = { pages, source: 'links' };
  return ctx;
}

function repeatTo(minChars: number): string {
  const s = 'Fresh sourdough bread baked daily in our small neighbourhood bakery for everyone to enjoy. ';
  let out = '';
  while (out.length < minChars) out += s;
  return out.trim();
}

const RICH_SSR = `<h1>Welcome</h1><p>${repeatTo(250)}</p>`;
const TINY = '<p>Loading…</p>';

describe('csr-content-parity', () => {
  it('(a) passes on fully server-rendered pages with no mount roots at all', async () => {
    const ctx = makeCtx({
      pages: [page('/', `<body>${RICH_SSR}</body>`), page('/about', `<body>${RICH_SSR}</body>`)],
    });
    const r = await csrContentParity.run(ctx);
    expect(r.status).toBe('pass');
  });

  it('(b) flags an empty #root mount + tiny body text as an offender', async () => {
    const home = page('/', `<body>${RICH_SSR}</body>`);
    const spa = page('/app', `<body><div id="root"></div>${TINY}</body>`);
    const r = await csrContentParity.run(makeCtx({ pages: [home, spa] }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/app');
  });

  it('(c) does not penalize __NEXT_DATA__ + rich SSR text inside #__next (SSR frameworks not penalized)', async () => {
    const body = `<body><div id="__next">${RICH_SSR}</div>`
      + `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script></body>`;
    const r = await csrContentParity.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(d) flags an empty <app-root></app-root> as an offender', async () => {
    const home = page('/', `<body>${RICH_SSR}</body>`);
    const spa = page('/app', `<body><app-root></app-root>${TINY}</body>`);
    const r = await csrContentParity.run(makeCtx({ pages: [home, spa] }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/app');
  });

  it('(e) does not penalize data-server-rendered="true" with real SSR text', async () => {
    const body = `<body><div id="app" data-server-rendered="true">${RICH_SSR}</div></body>`;
    const r = await csrContentParity.run(makeCtx({ pages: [page('/', body)] }));
    expect(r.status).toBe('pass');
  });

  it('(f) falls back to homepage-only via pagesOf when no sample is attached', async () => {
    const ctx = makeCtx({ pages: [page('/', `<body>${RICH_SSR}</body>`)], noSample: true });
    expect(ctx.sample).toBeUndefined();
    const r = await csrContentParity.run(ctx);
    expect(r.status).toBe('pass');
  });

  it('(f) homepage-only fallback also catches an offending homepage', async () => {
    const ctx = makeCtx({ pages: [page('/', `<body><div id="root"></div>${TINY}</body>`)], noSample: true });
    const r = await csrContentParity.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/');
  });

  it('(g) lists offender paths in the message, truncated with "(+N more)" beyond 3', async () => {
    const spa = (p: string) => page(p, `<body><div id="root"></div>${TINY}</body>`);
    const pages = [page('/', `<body>${RICH_SSR}</body>`), spa('/p1'), spa('/p2'), spa('/p3'), spa('/p4')];
    const r = await csrContentParity.run(makeCtx({ pages }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/p1');
    expect(r.message).toContain('/p2');
    expect(r.message).toContain('/p3');
    expect(r.message).not.toContain('/p4');
    expect(r.message).toContain('(+1 more)');
  });
});
