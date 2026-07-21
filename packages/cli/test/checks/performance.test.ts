import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { Crawler } from '../../src/crawler.js';
import {
  htmlWeight, renderBlockingJs, renderBlockingCss, imgDimensions, imgLazyLoading, imgNextGen,
  resourceHints, domSize, textCompression, assetCaching, inlineHeadVolume,
} from '../../src/checks/performance.js';

const BASE = 'http://stub.example/';

function page(pathname: string, body: string, extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

/** CrawlContext backed by an in-memory page list: ctx.fetch(path) looks it up by pathname,
 *  and ctx.sample.pages exposes the same list for multi-page (MP) checks. */
function ctxFromPages(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map(pages.map((p) => [new URL(p.finalUrl).pathname, p]));
  return {
    baseUrl: new URL(BASE),
    async fetch(path: string) {
      const url = new URL(path, BASE);
      const found = byPath.get(url.pathname);
      if (!found) {
        return { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
      }
      return found;
    },
    sample: { pages, source: 'links' },
  };
}

/** ctx with no reachable homepage at all (pagesOf falls back to [] and ctx.fetch('/') is a 404). */
const emptyCtx: CrawlContext = ctxFromPages([]);

describe('html-weight', () => {
  it('passes for a small document', async () => {
    const ctx = ctxFromPages([page('/', '<html><body>hello</body></html>')]);
    expect((await htmlWeight.run(ctx)).status).toBe('pass');
  });
  it('warns between 100KB and 250KB', async () => {
    const body = `<html><body>${'x'.repeat(150 * 1024)}</body></html>`;
    const ctx = ctxFromPages([page('/', body)]);
    expect((await htmlWeight.run(ctx)).status).toBe('warn');
  });
  it('fails above 250KB', async () => {
    const body = `<html><body>${'x'.repeat(300 * 1024)}</body></html>`;
    const ctx = ctxFromPages([page('/', body)]);
    expect((await htmlWeight.run(ctx)).status).toBe('fail');
  });
  it('fails when the homepage is not reachable', async () => {
    expect((await htmlWeight.run(emptyCtx)).status).toBe('fail');
  });
});

describe('render-blocking-js', () => {
  it('passes with no blocking head scripts', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><script src="a.js" defer></script></head></html>')]);
    expect((await renderBlockingJs.run(ctx)).status).toBe('pass');
  });
  it('passes when head scripts use async/defer/type=module', async () => {
    const html = '<html><head>'
      + '<script src="a.js" async></script>'
      + '<script src="b.js" defer></script>'
      + '<script src="c.js" type="module"></script>'
      + '</head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await renderBlockingJs.run(ctx)).status).toBe('pass');
  });
  it('warns with 1-2 blocking head scripts', async () => {
    const html = '<html><head><script src="a.js"></script><script src="b.js"></script></head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await renderBlockingJs.run(ctx)).status).toBe('warn');
  });
  it('fails with 3 or more blocking head scripts', async () => {
    const html = '<html><head>'
      + '<script src="a.js"></script><script src="b.js"></script><script src="c.js"></script>'
      + '</head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await renderBlockingJs.run(ctx)).status).toBe('fail');
  });
  it('rolls up the worst page across the sample', async () => {
    const clean = '<html><head></head></html>';
    const bad = '<html><head><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script></head></html>';
    const ctx = ctxFromPages([page('/', clean), page('/a.html', bad)]);
    expect((await renderBlockingJs.run(ctx)).status).toBe('fail');
  });
  it('fails when no page is reachable', async () => {
    expect((await renderBlockingJs.run(emptyCtx)).status).toBe('fail');
  });
});

describe('render-blocking-css', () => {
  it('passes with 2 or fewer render-blocking stylesheets', async () => {
    const html = '<html><head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css"></head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await renderBlockingCss.run(ctx)).status).toBe('pass');
  });
  it('ignores stylesheets deferred via a non-screen media query', async () => {
    const html = '<html><head>'
      + '<link rel="stylesheet" href="a.css">'
      + '<link rel="stylesheet" href="print.css" media="print">'
      + '</head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await renderBlockingCss.run(ctx)).status).toBe('pass');
  });
  it('warns with 3-4 render-blocking stylesheets', async () => {
    const links = Array.from({ length: 3 }, (_, i) => `<link rel="stylesheet" href="${i}.css">`).join('');
    const ctx = ctxFromPages([page('/', `<html><head>${links}</head></html>`)]);
    expect((await renderBlockingCss.run(ctx)).status).toBe('warn');
  });
  it('fails with 5 or more render-blocking stylesheets', async () => {
    const links = Array.from({ length: 5 }, (_, i) => `<link rel="stylesheet" href="${i}.css">`).join('');
    const ctx = ctxFromPages([page('/', `<html><head>${links}</head></html>`)]);
    expect((await renderBlockingCss.run(ctx)).status).toBe('fail');
  });
  it('fails when the homepage is not reachable', async () => {
    expect((await renderBlockingCss.run(emptyCtx)).status).toBe('fail');
  });
});

describe('img-dimensions', () => {
  it('passes when there are no images', async () => {
    const ctx = ctxFromPages([page('/', '<html><body>no images</body></html>')]);
    expect((await imgDimensions.run(ctx)).status).toBe('pass');
  });
  it('passes when >=90% of images have explicit width+height', async () => {
    const imgs = Array.from({ length: 10 }, (_, i) => (
      i === 0 ? '<img src="a.jpg">' : `<img src="${i}.jpg" width="100" height="100">`
    )).join('');
    const ctx = ctxFromPages([page('/', `<html><body>${imgs}</body></html>`)]);
    expect((await imgDimensions.run(ctx)).status).toBe('pass');
  });
  it('accepts a CSS aspect-ratio in place of width/height', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.jpg" style="aspect-ratio: 16/9"></body></html>')]);
    expect((await imgDimensions.run(ctx)).status).toBe('pass');
  });
  it('warns between 70% and 89% sized', async () => {
    const imgs = Array.from({ length: 10 }, (_, i) => (
      i < 2 ? '<img src="a.jpg">' : `<img src="${i}.jpg" width="100" height="100">`
    )).join('');
    const ctx = ctxFromPages([page('/', `<html><body>${imgs}</body></html>`)]);
    expect((await imgDimensions.run(ctx)).status).toBe('warn');
  });
  it('fails below 70% sized', async () => {
    const imgs = Array.from({ length: 10 }, (_, i) => (
      i < 5 ? '<img src="a.jpg">' : `<img src="${i}.jpg" width="100" height="100">`
    )).join('');
    const ctx = ctxFromPages([page('/', `<html><body>${imgs}</body></html>`)]);
    expect((await imgDimensions.run(ctx)).status).toBe('fail');
  });
  it('fails when no page is reachable', async () => {
    expect((await imgDimensions.run(emptyCtx)).status).toBe('fail');
  });
});

describe('img-lazy-loading (warn-only)', () => {
  it('passes with no images', async () => {
    const ctx = ctxFromPages([page('/', '<html><body>no images</body></html>')]);
    expect((await imgLazyLoading.run(ctx)).status).toBe('pass');
  });
  it('passes when the sole (hero) image stays eager', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.jpg"></body></html>')]);
    expect((await imgLazyLoading.run(ctx)).status).toBe('pass');
  });
  it('warns when the hero (first) image is lazy-loaded', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.jpg" loading="lazy"></body></html>')]);
    expect((await imgLazyLoading.run(ctx)).status).toBe('warn');
  });
  it('warns when most below-the-fold images are not lazy-loaded', async () => {
    const html = '<html><body>'
      + '<img src="hero.jpg">'
      + '<img src="a.jpg"><img src="b.jpg">' // indices 1,2 — not assessed
      + '<img src="c.jpg"><img src="d.jpg"><img src="e.jpg">' // indices 3,4,5 — below fold, all eager
      + '</body></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await imgLazyLoading.run(ctx)).status).toBe('warn');
  });
  it('passes when below-the-fold images are lazy-loaded and the hero stays eager', async () => {
    const html = '<html><body>'
      + '<img src="hero.jpg">'
      + '<img src="a.jpg"><img src="b.jpg">'
      + '<img src="c.jpg" loading="lazy"><img src="d.jpg" loading="lazy"><img src="e.jpg" loading="lazy">'
      + '</body></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await imgLazyLoading.run(ctx)).status).toBe('pass');
  });
  it('never fails: skips (not fails) when the homepage is unreachable', async () => {
    const r = await imgLazyLoading.run(emptyCtx);
    expect(r.status).not.toBe('fail');
    expect(r.status).toBe('skip');
  });
});

describe('img-next-gen (warn-only)', () => {
  it('passes when there are no raster images', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.svg"></body></html>')]);
    expect((await imgNextGen.run(ctx)).status).toBe('pass');
  });
  it('passes when >=50% of raster images are next-gen (extension or <source type>)', async () => {
    const html = '<html><body>'
      + '<img src="a.webp">'
      + '<picture><source srcset="b.avif" type="image/avif"><img src="b.jpg"></picture>'
      + '<img src="c.jpg">'
      + '<img src="d.jpg">'
      + '</body></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await imgNextGen.run(ctx)).status).toBe('pass');
  });
  it('warns when most raster images are legacy jpg/png', async () => {
    const html = '<html><body><img src="a.jpg"><img src="b.png"><img src="c.jpg"></body></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await imgNextGen.run(ctx)).status).toBe('warn');
  });
  it('never fails: skips (not fails) when the homepage is unreachable', async () => {
    const r = await imgNextGen.run(emptyCtx);
    expect(r.status).not.toBe('fail');
    expect(r.status).toBe('skip');
  });
});

describe('resource-hints (warn-only)', () => {
  it('passes with no cross-origin resources', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><script src="/local.js"></script></head></html>')]);
    expect((await resourceHints.run(ctx)).status).toBe('pass');
  });
  it('warns when a cross-origin script has no matching preconnect/dns-prefetch hint', async () => {
    const html = '<html><head><script src="https://cdn.example.com/app.js"></script></head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await resourceHints.run(ctx)).status).toBe('warn');
  });
  it('passes when a matching preconnect hint is present', async () => {
    const html = '<html><head>'
      + '<link rel="preconnect" href="https://cdn.example.com">'
      + '<script src="https://cdn.example.com/app.js"></script>'
      + '</head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await resourceHints.run(ctx)).status).toBe('pass');
  });
  it('never fails: skips (not fails) when the homepage is unreachable', async () => {
    const r = await resourceHints.run(emptyCtx);
    expect(r.status).not.toBe('fail');
    expect(r.status).toBe('skip');
  });
});

describe('dom-size', () => {
  it('passes for a small DOM', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><p>hello</p></body></html>')]);
    expect((await domSize.run(ctx)).status).toBe('pass');
  });
  it('warns between 800 and 1400 elements', async () => {
    const spans = '<span></span>'.repeat(900);
    const ctx = ctxFromPages([page('/', `<html><body>${spans}</body></html>`)]);
    expect((await domSize.run(ctx)).status).toBe('warn');
  });
  it('warns when nesting depth exceeds 32 even with a small element count', async () => {
    const html = `<html><body>${'<div>'.repeat(40)}text${'</div>'.repeat(40)}</body></html>`;
    const ctx = ctxFromPages([page('/', html)]);
    expect((await domSize.run(ctx)).status).toBe('warn');
  });
  it('fails above 1400 elements', async () => {
    const spans = '<span></span>'.repeat(1500);
    const ctx = ctxFromPages([page('/', `<html><body>${spans}</body></html>`)]);
    expect((await domSize.run(ctx)).status).toBe('fail');
  });
  it('fails when the homepage is not reachable', async () => {
    expect((await domSize.run(emptyCtx)).status).toBe('fail');
  });
});

describe('text-compression', () => {
  it('passes when the HTML response carries a gzip Content-Encoding', async () => {
    const ctx = ctxFromPages([page('/', '<html></html>', { headers: { 'content-encoding': 'gzip' } })]);
    expect((await textCompression.run(ctx)).status).toBe('pass');
  });
  it('passes for br and zstd too', async () => {
    const br = ctxFromPages([page('/', '<html></html>', { headers: { 'content-encoding': 'br' } })]);
    expect((await textCompression.run(br)).status).toBe('pass');
    const zstd = ctxFromPages([page('/', '<html></html>', { headers: { 'content-encoding': 'zstd' } })]);
    expect((await textCompression.run(zstd)).status).toBe('pass');
  });
  it('fails when there is no Content-Encoding header', async () => {
    const ctx = ctxFromPages([page('/', '<html></html>')]);
    expect((await textCompression.run(ctx)).status).toBe('fail');
  });
  it('fails when the homepage is not reachable', async () => {
    expect((await textCompression.run(emptyCtx)).status).toBe('fail');
  });

  // End-to-end: a real HTTP server, actual gzip bytes over the wire, and the real
  // Crawler — verifies the crawler transparently decodes gzip while text-compression
  // still sees the Content-Encoding header (spec §3.6, and the same path serveFixture
  // now exercises for every other check on gzip-compressed fixtures).
  describe('end-to-end over a real server', () => {
    const closers: Array<() => Promise<void>> = [];
    afterAll(async () => { for (const c of closers) await c(); });

    async function listen(server: http.Server): Promise<string> {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      closers.push(() => new Promise<void>((r) => server.close(() => r())));
      return `http://127.0.0.1:${port}`;
    }

    it('passes for a gzip-compressed response served over the wire', async () => {
      const html = '<html><body>hello gzip</body></html>';
      const url = await listen(http.createServer((_req, res) => {
        const gz = zlib.gzipSync(Buffer.from(html, 'utf8'));
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(gz);
      }));
      const crawler = new Crawler(url);
      const ctx: CrawlContext = { baseUrl: new URL(url), fetch: (p) => crawler.fetch(p) };
      const res = await ctx.fetch('/');
      expect(res?.body).toBe(html); // the crawler decoded it transparently
      expect((await textCompression.run(ctx)).status).toBe('pass');
    });

    it('fails for an uncompressed response served over the wire', async () => {
      const html = '<html><body>hello plain</body></html>';
      const url = await listen(http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html);
      }));
      const crawler = new Crawler(url);
      const ctx: CrawlContext = { baseUrl: new URL(url), fetch: (p) => crawler.fetch(p) };
      expect((await textCompression.run(ctx)).status).toBe('fail');
    });
  });
});

describe('asset-caching (warn-only)', () => {
  it('skips when there is no same-origin CSS/JS asset', async () => {
    const ctx = ctxFromPages([page('/', '<html><head></head></html>')]);
    expect((await assetCaching.run(ctx)).status).toBe('skip');
  });
  it('skips when the sampled asset is not reachable', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><link rel="stylesheet" href="/app.css"></head></html>')]);
    expect((await assetCaching.run(ctx)).status).toBe('skip');
  });
  it('passes when the sampled asset has a positive max-age', async () => {
    const ctx = ctxFromPages([
      page('/', '<html><head><link rel="stylesheet" href="/app.css"></head></html>'),
      page('/app.css', 'body{color:red}', { contentType: 'text/css', headers: { 'cache-control': 'public, max-age=31536000, immutable' } }),
    ]);
    expect((await assetCaching.run(ctx)).status).toBe('pass');
  });
  it('passes when the sampled asset carries an ETag', async () => {
    const ctx = ctxFromPages([
      page('/', '<html><head><script src="/app.js"></script></head></html>'),
      page('/app.js', 'console.log(1)', { contentType: 'application/javascript', headers: { etag: '"abc123"' } }),
    ]);
    expect((await assetCaching.run(ctx)).status).toBe('pass');
  });
  it('warns when the sampled asset has no caching headers', async () => {
    const ctx = ctxFromPages([
      page('/', '<html><head><link rel="stylesheet" href="/app.css"></head></html>'),
      page('/app.css', 'body{color:red}', { contentType: 'text/css' }),
    ]);
    expect((await assetCaching.run(ctx)).status).toBe('warn');
  });
  it('never fails: skips (not fails) when the homepage is unreachable', async () => {
    const r = await assetCaching.run(emptyCtx);
    expect(r.status).not.toBe('fail');
    expect(r.status).toBe('skip');
  });
});

describe('inline-head-volume (warn-only)', () => {
  it('passes for a small inline head', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><script>console.log(1)</script></head></html>')]);
    expect((await inlineHeadVolume.run(ctx)).status).toBe('pass');
  });
  it('warns above 14KB of inline head style/script', async () => {
    const big = 'x'.repeat(20 * 1024);
    const ctx = ctxFromPages([page('/', `<html><head><style>${big}</style></head></html>`)]);
    expect((await inlineHeadVolume.run(ctx)).status).toBe('warn');
  });
  it('never fails: skips (not fails) when the homepage is unreachable', async () => {
    const r = await inlineHeadVolume.run(emptyCtx);
    expect(r.status).not.toBe('fail');
    expect(r.status).toBe('skip');
  });
});
