import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import {
  metaPerPage, titlePattern, titleH1Alignment, headingsOutline, anchorText,
  charset, favicon, contentReadability, figureCaption,
} from '../../src/checks/on-page.js';

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
// emptyCtx above sets sample.pages = [] so pagesOf() re-fetches '/' and gets a 404 -> [].

describe('meta-per-page', () => {
  it('passes when every sampled page has an in-range title and description', async () => {
    const html = (t: string, d: string) => `<html><head><title>${t}</title><meta name="description" content="${d}"></head><body></body></html>`;
    const ctx = ctxFromPages([
      page('/', html('A fine title here', 'A perfectly reasonable meta description that easily clears the fifty character minimum length.')),
      page('/about.html', html('About us and our story', 'Another perfectly reasonable meta description that clears the fifty character minimum too.')),
    ]);
    expect((await metaPerPage.run(ctx)).status).toBe('pass');
  });
  it('fails when the single sampled page has an out-of-range title', async () => {
    const html = '<html><head><title>Hi</title><meta name="description" content="A perfectly reasonable meta description that clears the fifty character minimum."></head></html>';
    const ctx = ctxFromPages([page('/', html)]);
    expect((await metaPerPage.run(ctx)).status).toBe('fail');
  });
  it('warns at the 80% conform boundary (1 offender out of 5 pages)', async () => {
    const good = '<html><head><title>A fine title here</title><meta name="description" content="A perfectly reasonable meta description that clears the fifty character minimum."></head></html>';
    const bad = '<html><head><title>Hi</title><meta name="description" content="short"></head></html>';
    const ctx = ctxFromPages([
      page('/', good), page('/a.html', good), page('/b.html', good), page('/c.html', good), page('/d.html', bad),
    ]);
    expect((await metaPerPage.run(ctx)).status).toBe('warn');
  });
  it('fails with "no page reachable" when nothing can be fetched', async () => {
    expect((await metaPerPage.run(emptyCtx)).status).toBe('fail');
  });
});

describe('title-pattern', () => {
  it('passes for a topic-first title with a brand suffix', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><title>Sourdough Bread in Springfield — Example Bakery</title></head></html>')]);
    expect((await titlePattern.run(ctx)).status).toBe('pass');
  });
  it('warns for a brand-first title', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><title>Example Bakery — Sourdough Bread in Springfield</title></head></html>')]);
    expect((await titlePattern.run(ctx)).status).toBe('warn');
  });
  it('warns when the title has no separator', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><title>Sourdough Bread Example Bakery</title></head></html>')]);
    expect((await titlePattern.run(ctx)).status).toBe('warn');
  });
  it('fails when there is no title', async () => {
    const ctx = ctxFromPages([page('/', '<html><head></head></html>')]);
    expect((await titlePattern.run(ctx)).status).toBe('fail');
  });
});

describe('title-h1-alignment', () => {
  it('passes when title and H1 share meaningful tokens', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><title>Sourdough Bread in Springfield</title></head><body><h1>Sourdough Bread, Croissants and Cakes</h1></body></html>')]);
    expect((await titleH1Alignment.run(ctx)).status).toBe('pass');
  });
  it('warns when title and H1 topics diverge', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><title>Sourdough Bread in Springfield</title></head><body><h1>Contact Us Today</h1></body></html>')]);
    expect((await titleH1Alignment.run(ctx)).status).toBe('warn');
  });
  it('fails when the H1 is missing', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><title>Sourdough Bread in Springfield</title></head><body></body></html>')]);
    expect((await titleH1Alignment.run(ctx)).status).toBe('fail');
  });
});

describe('headings-outline', () => {
  it('passes with exactly one H1 and no level skip', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><h1>Title</h1><h2>Section</h2><h3>Sub</h3></body></html>')]);
    expect((await headingsOutline.run(ctx)).status).toBe('pass');
  });
  it('fails the single sampled page when it skips a heading level', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><h1>Title</h1><h2>Section</h2><h4>Too deep</h4></body></html>')]);
    expect((await headingsOutline.run(ctx)).status).toBe('fail');
  });
  it('fails the single sampled page when there is no H1', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><h2>Section</h2></body></html>')]);
    expect((await headingsOutline.run(ctx)).status).toBe('fail');
  });
  it('warns at the 80% conform boundary (1 offender out of 5 pages)', async () => {
    const good = '<html><body><h1>Title</h1></body></html>';
    const bad = '<html><body><h1>Title</h1><h2>Section</h2><h4>Too deep</h4></body></html>';
    const ctx = ctxFromPages([
      page('/', good), page('/a.html', good), page('/b.html', good), page('/c.html', good), page('/d.html', bad),
    ]);
    expect((await headingsOutline.run(ctx)).status).toBe('warn');
  });
});

describe('anchor-text', () => {
  it('passes with no internal links at all', async () => {
    const ctx = ctxFromPages([page('/', '<html><body>no links here</body></html>')]);
    expect((await anchorText.run(ctx)).status).toBe('pass');
  });
  it('passes when every internal anchor is descriptive', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/about.html">About our bakery</a><a href="/menu.html">See our menu</a></body></html>')]);
    expect((await anchorText.run(ctx)).status).toBe('pass');
  });
  it('warns when a minority of internal anchors are generic', async () => {
    const ctx = ctxFromPages([page('/', `<html><body>
      <a href="/a">Our story</a><a href="/b">Our menu</a><a href="/c">Contact page</a>
      <a href="/d">click here</a>
    </body></html>`)]);
    const r = await anchorText.run(ctx);
    expect(r.status).toBe('warn');
  });
  it('fails when at least half of internal anchors are generic', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/a">Our story</a><a href="/b">click here</a><a href="/c">read more</a></body></html>')]);
    expect((await anchorText.run(ctx)).status).toBe('fail');
  });
  it('treats an image-only anchor without alt text as generic', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/a">Our story</a><a href="/b">Our menu</a><a href="/c"><img src="x.jpg"></a></body></html>')]);
    expect((await anchorText.run(ctx)).status).toBe('warn');
  });
  it('treats an image-only anchor WITH alt text as descriptive', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/a">Our story</a><a href="/b"><img src="x.jpg" alt="Our storefront"></a></body></html>')]);
    expect((await anchorText.run(ctx)).status).toBe('pass');
  });
  it('ignores external and same-page anchor links', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="https://other.example/page">click here</a><a href="#top">click here</a></body></html>')]);
    expect((await anchorText.run(ctx)).status).toBe('pass');
  });
});

describe('charset', () => {
  it('passes with a UTF-8 meta charset', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><meta charset="utf-8"></head></html>')]);
    expect((await charset.run(ctx)).status).toBe('pass');
  });
  it('warns on a legacy charset', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><meta charset="iso-8859-1"></head></html>')]);
    expect((await charset.run(ctx)).status).toBe('warn');
  });
  it('passes when UTF-8 is declared only via the content-type header', async () => {
    const ctx = ctxFromPages([page('/', '<html><head></head></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })]);
    expect((await charset.run(ctx)).status).toBe('pass');
  });
  it('fails when no charset is declared anywhere', async () => {
    const ctx = ctxFromPages([page('/', '<html><head></head></html>', { contentType: 'text/html' })]);
    expect((await charset.run(ctx)).status).toBe('fail');
  });
});

describe('favicon', () => {
  it('passes with both an icon link and an apple-touch-icon link', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head></html>')]);
    expect((await favicon.run(ctx)).status).toBe('pass');
  });
  it('warns when only the icon link is present', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><link rel="icon" href="/favicon.ico"></head></html>')]);
    expect((await favicon.run(ctx)).status).toBe('warn');
  });
  it('falls back to fetching /favicon.ico when no <link> is declared', async () => {
    const ctx = ctxFromPages([
      page('/', '<html><head></head></html>'),
      page('/favicon.ico', '', { contentType: 'image/x-icon' }),
    ]);
    expect((await favicon.run(ctx)).status).toBe('warn'); // icon via fallback, still no apple-touch-icon
  });
  it('fails when there is no icon link and no /favicon.ico', async () => {
    const ctx = ctxFromPages([page('/', '<html><head></head></html>')]);
    expect((await favicon.run(ctx)).status).toBe('fail');
  });
});

describe('content-readability', () => {
  it('passes when there is not enough main text to assess', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><p>Hello world.</p></body></html>')]);
    expect((await contentReadability.run(ctx)).status).toBe('pass');
  });
  it('passes for short, simple sentences', async () => {
    const easy = 'The cat sat on the mat. The dog ran fast. We ate good food today. It was a fun day. '
      + 'The sun was very hot. We had lots of fun. This is the end of our story.';
    const ctx = ctxFromPages([page('/', `<html><body><p>${easy}</p></body></html>`)]);
    expect((await contentReadability.run(ctx)).status).toBe('pass');
  });
  it('warns on dense, hard-to-read main content', async () => {
    const hard = 'Extraordinarily controversial international organizational communication misunderstandings '
      + 'dramatically complicate professional interpersonal relationships throughout multinational corporate '
      + 'environments consistently generating substantial operational inefficiencies universally acknowledged '
      + 'by contemporary academic researchers investigating organizational behavior methodologies.';
    const ctx = ctxFromPages([page('/', `<html><body><p>${hard}</p></body></html>`)]);
    expect((await contentReadability.run(ctx)).status).toBe('warn');
  });
});

describe('figure-caption', () => {
  it('skips when there are no content images', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><p>no images</p></body></html>')]);
    expect((await figureCaption.run(ctx)).status).toBe('skip');
  });
  it('ignores decorative images (empty alt)', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="deco.png" alt=""></body></html>')]);
    expect((await figureCaption.run(ctx)).status).toBe('skip');
  });
  it('passes when every content image is wrapped in figure/figcaption', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><figure><img src="a.jpg" alt="A bakery photo"><figcaption>Our shop</figcaption></figure></body></html>')]);
    expect((await figureCaption.run(ctx)).status).toBe('pass');
  });
  it('warns when a content image is not wrapped in a figure/figcaption', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.jpg" alt="A bakery photo"></body></html>')]);
    expect((await figureCaption.run(ctx)).status).toBe('warn');
  });
});
