import { describe, it, expect } from 'vitest';
import { stubCtx } from '../helpers/stub.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import {
  brokenSubresources, collectSubresources, srcsetUrls, MAX_SUBRESOURCES,
} from '../../src/checks/broken-subresources.js';

const BASE = 'http://stub.example/';

function doc(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}

function pageRes(pathname: string, body: string): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

/**
 * Multi-page context: the sampled pages, plus `assets` — pathnames that answer
 * 200. Anything else 404s (stubCtx's default), which is exactly the defect
 * under test.
 */
function mpCtx(pages: FetchedResource[], assets: string[] = []): CrawlContext {
  const resources: Record<string, Partial<FetchedResource>> = {};
  for (const p of pages) resources[new URL(p.finalUrl).pathname] = p;
  for (const a of assets) resources[a] = { contentType: 'application/octet-stream', body: 'x' };
  const ctx = stubCtx(resources, BASE);
  ctx.sample = { pages, source: 'links' };
  return ctx;
}

/** One-page context whose body is `body`. */
function onePage(body: string, assets: string[] = []): CrawlContext {
  return mpCtx([pageRes('/', doc(body))], assets);
}

// ---------------------------------------------------------------------------
// srcsetUrls — the parser that decides whether a reference even exists
// ---------------------------------------------------------------------------

describe('srcsetUrls', () => {
  it('returns the URL of every candidate, dropping the descriptors', () => {
    expect(srcsetUrls('/a.jpg 480w, /b.jpg 800w, /c.jpg 1200w')).toEqual(['/a.jpg', '/b.jpg', '/c.jpg']);
  });
  it('keeps commas that belong to the path (CDN transform segments)', () => {
    // A naive split(',') would invent "/img/w_800" and "h_600/photo.jpg" here,
    // and both would 404 — a false positive manufactured by the parser.
    expect(srcsetUrls('/img/w_800,h_600/photo.jpg 2x, /img/w_400,h_300/photo.jpg 1x'))
      .toEqual(['/img/w_800,h_600/photo.jpg', '/img/w_400,h_300/photo.jpg']);
  });
  it('handles candidates with no descriptor at all', () => {
    expect(srcsetUrls('/a.jpg, /b.jpg')).toEqual(['/a.jpg', '/b.jpg']);
  });
  it('tolerates stray whitespace, newlines and empty candidates', () => {
    expect(srcsetUrls('  \n /a.jpg 1x ,,  /b.jpg\t2x , ')).toEqual(['/a.jpg', '/b.jpg']);
  });
  it('returns nothing for an empty attribute', () => {
    expect(srcsetUrls('')).toEqual([]);
    expect(srcsetUrls('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectSubresources — what gets probed, and in which order
// ---------------------------------------------------------------------------

describe('collectSubresources', () => {
  const base = new URL(BASE);

  it('collects scripts, stylesheets, img src/srcset and source srcset', () => {
    const page = pageRes('/', doc(
      '<img src="/hero.jpg" srcset="/hero-2x.jpg 2x">'
      + '<picture><source srcset="/hero.webp"><img src="/hero.jpg"></picture>',
      '<script src="/app.js"></script><link rel="stylesheet" href="/site.css">',
    ));
    const refs = collectSubresources([page], base);
    expect(refs.sameOrigin).toEqual([
      // code first (script, stylesheet), then images in document order
      `${BASE}app.js`, `${BASE}site.css`,
      `${BASE}hero.jpg`, `${BASE}hero-2x.jpg`, `${BASE}hero.webp`,
    ]);
    expect(refs.crossOrigin).toBe(0);
  });

  it('dedupes the same asset referenced twice and across pages', () => {
    const pages = [
      pageRes('/', doc('<img src="/logo.png">', '<link rel="stylesheet" href="/site.css">')),
      pageRes('/about', doc('<img src="/logo.png#top">', '<link rel="stylesheet" href="/site.css">')),
    ];
    expect(collectSubresources(pages, base).sameOrigin).toEqual([`${BASE}site.css`, `${BASE}logo.png`]);
  });

  it('counts cross-origin assets separately and never probes them', () => {
    const page = pageRes('/', doc(
      '<img src="https://cdn.example.com/hero.jpg">',
      '<script src="https://cdn.example.com/app.js"></script>',
    ));
    const refs = collectSubresources([page], base);
    expect(refs.sameOrigin).toEqual([]);
    expect(refs.crossOrigin).toBe(2);
  });

  it('ignores data:/blob:/javascript: references and non-stylesheet links', () => {
    const page = pageRes('/', doc(
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
      '<link rel="icon" href="/favicon.ico">'
      + '<link rel="preload" as="font" href="/font.woff2">'
      + '<script src="javascript:void(0)"></script>',
    ));
    expect(collectSubresources([page], base).sameOrigin).toEqual([]);
  });

  it('ignores CDN-injected /cdn-cgi/ endpoints', () => {
    const page = pageRes('/', doc('', '<script src="/cdn-cgi/scripts/rocket-loader.min.js"></script>'));
    expect(collectSubresources([page], base).sameOrigin).toEqual([]);
  });

  it('resolves relative references against the page that declared them', () => {
    const page = pageRes('/blog/post', doc('<img src="hero.jpg">'));
    expect(collectSubresources([page], base).sameOrigin).toEqual([`${BASE}blog/hero.jpg`]);
  });
});

// ---------------------------------------------------------------------------
// broken-subresources — verdicts
// ---------------------------------------------------------------------------

describe('broken-subresources', () => {
  it('fails when no page is reachable', async () => {
    const r = await brokenSubresources.run(stubCtx({}, BASE));
    expect(r.status).toBe('fail');
    expect(r.message).toBe('no page reachable');
  });

  it('skips when the sampled pages reference no subresource at all', async () => {
    const r = await brokenSubresources.run(onePage('<h1>Plain page</h1>'));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no subresources on sampled pages');
  });

  it('skips — naming the count — when every subresource is third-party', async () => {
    const r = await brokenSubresources.run(onePage(
      '<img src="https://cdn.example.com/a.jpg"><img src="https://cdn.example.com/b.jpg">',
    ));
    expect(r.status).toBe('skip');
    expect(r.message).toContain('2');
    expect(r.message).toContain('third-party');
  });

  it('passes when every same-origin subresource resolves', async () => {
    const ctx = onePage(
      '<img src="/hero.jpg"><picture><source srcset="/hero.webp"></picture>',
      ['/hero.jpg', '/hero.webp', '/app.js'],
    );
    const r = await brokenSubresources.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toBe('2 same-origin subresource(s) resolve');
    expect(r.points).toBe(r.maxPoints);
  });

  it('fails and names the dead asset when the conform ratio drops below 80%', async () => {
    // 2 references, 1 dead -> 50% conform.
    const ctx = onePage('<img src="/hero.jpg"><img src="/gone.jpg">', ['/hero.jpg']);
    const r = await brokenSubresources.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/gone.jpg');
    expect(r.points).toBe(0);
    expect(r.fix).toBeTruthy();
  });

  it('warns (not fails) when a single asset is dead among many', async () => {
    const good = Array.from({ length: 9 }, (_, i) => `/img-${i}.jpg`);
    const body = [...good, '/gone.jpg'].map((p) => `<img src="${p}">`).join('');
    const r = await brokenSubresources.run(onePage(body, good));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/gone.jpg');
    expect(r.points).toBe(Math.floor(r.maxPoints / 2));
  });

  it('reports a 500 as broken, not only a 404', async () => {
    const ctx = mpCtx([pageRes('/', doc('<img src="/hero.jpg"><img src="/boom.jpg">'))], ['/hero.jpg']);
    const inner = ctx.fetch.bind(ctx);
    ctx.fetch = async (path: string) => {
      const url = new URL(path, BASE);
      if (url.pathname !== '/boom.jpg') return inner(path);
      return { status: 500, ok: false, body: '', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    };
    const r = await brokenSubresources.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/boom.jpg');
  });

  it('treats a transport failure (null response) as broken', async () => {
    const ctx = onePage('<img src="/hero.jpg"><img src="/dead.jpg">', ['/hero.jpg', '/dead.jpg']);
    const inner = ctx.fetch.bind(ctx);
    ctx.fetch = async (path: string) => (new URL(path, BASE).pathname === '/dead.jpg' ? null : inner(path));
    const r = await brokenSubresources.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/dead.jpg');
  });

  it('keeps the query string in the offender label (?v=2 is another file)', async () => {
    const ctx = onePage('<link rel="stylesheet" href="/site.css?v=2">');
    const r = await brokenSubresources.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/site.css?v=2');
  });

  it('caps the probe budget and spends it on code before images', async () => {
    // 1 dead script + 30 live images: the script must be inside the 20-URL
    // budget, and only 20 references may be counted.
    const images = Array.from({ length: 30 }, (_, i) => `/img-${i}.jpg`);
    const body = images.map((p) => `<img src="${p}">`).join('');
    const ctx = onePage(`${body}<script src="/app.js"></script>`, images);
    const r = await brokenSubresources.run(ctx);
    expect(r.status).toBe('warn'); // 1 of 20 dead -> 95% conform
    expect(r.message).toContain('/app.js');
    expect(MAX_SUBRESOURCES).toBe(20);
  });

  it('probes across every sampled page, not just the homepage', async () => {
    const pages = [
      pageRes('/', doc('<img src="/ok.jpg">')),
      pageRes('/about', doc('<img src="/about-missing.jpg">')),
    ];
    const r = await brokenSubresources.run(mpCtx(pages, ['/ok.jpg']));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/about-missing.jpg');
  });
});
