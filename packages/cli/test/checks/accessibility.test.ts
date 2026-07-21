import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import {
  htmlLang, altDescriptive, landmarks, formLabels, linkText, viewportZoom, iframeTitle,
} from '../../src/checks/accessibility.js';

const BASE = 'http://stub.example/';

function page(pathname: string, body: string, extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

/** CrawlContext backed by an in-memory page list (MP checks read ctx.sample.pages). */
function ctxFromPages(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map(pages.map((p) => [new URL(p.finalUrl).pathname, p]));
  return {
    baseUrl: new URL(BASE),
    async fetch(path: string) {
      const url = new URL(path, BASE);
      const found = byPath.get(url.pathname);
      if (!found) return { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
      return found;
    },
    sample: { pages, source: 'links' },
  };
}

describe('html-lang', () => {
  it('passes when every page has a valid BCP-47 lang', async () => {
    const ctx = ctxFromPages([
      page('/', '<!doctype html><html lang="en"><body>Hi</body></html>'),
      page('/fr.html', '<!doctype html><html lang="fr-CA"><body>Bonjour</body></html>'),
    ]);
    expect((await htmlLang.run(ctx)).status).toBe('pass');
  });
  it('fails when the single sampled page has no lang', async () => {
    const ctx = ctxFromPages([page('/', '<!doctype html><html><body>Hi</body></html>')]);
    expect((await htmlLang.run(ctx)).status).toBe('fail');
  });
  it('warns on a malformed lang code', async () => {
    const ctx = ctxFromPages([page('/', '<!doctype html><html lang="english!"><body>Hi</body></html>')]);
    expect((await htmlLang.run(ctx)).status).toBe('warn');
  });
  it('warns at the 80% conform boundary (1 absent of 5)', async () => {
    const ok = '<!doctype html><html lang="en"><body>Hi</body></html>';
    const bad = '<!doctype html><html><body>Hi</body></html>';
    const ctx = ctxFromPages([page('/', ok), page('/a', ok), page('/b', ok), page('/c', ok), page('/d', bad)]);
    expect((await htmlLang.run(ctx)).status).toBe('warn');
  });
});

describe('alt-descriptive', () => {
  it('passes when non-empty alts are descriptive', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.jpg" alt="Sourdough loaf cooling on a rack"></body></html>')]);
    expect((await altDescriptive.run(ctx)).status).toBe('pass');
  });
  it('skips when there are no non-empty alts to assess', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.jpg" alt=""><img src="b.jpg"></body></html>')]);
    expect((await altDescriptive.run(ctx)).status).toBe('skip');
  });
  it('fails when most alts are filenames/placeholders', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><img src="a.jpg" alt="IMG_1234.jpg"><img src="b.jpg" alt="image"></body></html>')]);
    expect((await altDescriptive.run(ctx)).status).toBe('fail');
  });
  it('warns when 70-89% of alts are descriptive', async () => {
    const good = '<img src="x.jpg" alt="A descriptive caption here">';
    const ctx = ctxFromPages([page('/', `<html><body>${good.repeat(3)}<img src="y.jpg" alt="photo"></body></html>`)]);
    expect((await altDescriptive.run(ctx)).status).toBe('warn');
  });
});

describe('landmarks', () => {
  it('passes with a main plus two landmark regions', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><nav>n</nav><main>content</main><footer>f</footer></body></html>')]);
    expect((await landmarks.run(ctx)).status).toBe('pass');
  });
  it('warns when there is a main but only one other region', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><main>content</main><footer>f</footer></body></html>')]);
    expect((await landmarks.run(ctx)).status).toBe('warn');
  });
  it('fails on div-soup with no landmarks', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><div>content</div></body></html>')]);
    expect((await landmarks.run(ctx)).status).toBe('fail');
  });
  it('accepts an <article> as the main landmark', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><header>h</header><nav>n</nav><article>post</article></body></html>')]);
    expect((await landmarks.run(ctx)).status).toBe('pass');
  });
});

describe('form-labels', () => {
  it('skips when there are no form controls', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><p>no forms</p></body></html>')]);
    expect((await formLabels.run(ctx)).status).toBe('skip');
  });
  it('passes when every control has an accessible name', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><label for="q">Search</label><input id="q"><input aria-label="Email"></body></html>')]);
    expect((await formLabels.run(ctx)).status).toBe('pass');
  });
  it('ignores hidden/submit inputs that need no label', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><input type="hidden" name="t"><button type="submit">Go</button></body></html>')]);
    expect((await formLabels.run(ctx)).status).toBe('skip');
  });
  it('fails when more than 20% of controls are unlabelled', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><input><input></body></html>')]);
    expect((await formLabels.run(ctx)).status).toBe('fail');
  });
  it('warns with a single unlabelled control among many', async () => {
    const labelled = '<label for="a">A</label><input id="a">'.repeat(9);
    const ctx = ctxFromPages([page('/', `<html><body>${labelled}<input></body></html>`)]);
    expect((await formLabels.run(ctx)).status).toBe('warn');
  });
});

describe('link-text', () => {
  it('passes when every link has an accessible name', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/a">About</a><a href="/b" aria-label="Home">·</a></body></html>')]);
    expect((await linkText.run(ctx)).status).toBe('pass');
  });
  it('passes when a link wraps an image with alt', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/a"><img src="i.png" alt="Home"></a></body></html>')]);
    expect((await linkText.run(ctx)).status).toBe('pass');
  });
  it('warns on one or two nameless links', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/a">About</a><a href="/b"><img src="i.png"></a></body></html>')]);
    expect((await linkText.run(ctx)).status).toBe('warn');
  });
  it('fails on three or more nameless links', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><a href="/a"></a><a href="/b"></a><a href="/c"></a></body></html>')]);
    expect((await linkText.run(ctx)).status).toBe('fail');
  });
});

describe('viewport-zoom', () => {
  it('passes when zoom is allowed', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head></html>')]);
    expect((await viewportZoom.run(ctx)).status).toBe('pass');
  });
  it('passes when there is no viewport meta at all', async () => {
    const ctx = ctxFromPages([page('/', '<html><head></head></html>')]);
    expect((await viewportZoom.run(ctx)).status).toBe('pass');
  });
  it('fails on user-scalable=no', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head></html>')]);
    expect((await viewportZoom.run(ctx)).status).toBe('fail');
  });
  it('fails on maximum-scale=1', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><meta name="viewport" content="width=device-width, maximum-scale=1"></head></html>')]);
    expect((await viewportZoom.run(ctx)).status).toBe('fail');
  });
  it('warns on maximum-scale between 1 and 2', async () => {
    const ctx = ctxFromPages([page('/', '<html><head><meta name="viewport" content="width=device-width, maximum-scale=1.5"></head></html>')]);
    expect((await viewportZoom.run(ctx)).status).toBe('warn');
  });
});

describe('iframe-title', () => {
  it('skips when there are no iframes', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><p>no iframes</p></body></html>')]);
    expect((await iframeTitle.run(ctx)).status).toBe('skip');
  });
  it('passes when every iframe has a title', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><iframe src="/a" title="Map"></iframe></body></html>')]);
    expect((await iframeTitle.run(ctx)).status).toBe('pass');
  });
  it('warns on a single untitled iframe', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><iframe src="/a" title="Map"></iframe><iframe src="/b"></iframe></body></html>')]);
    expect((await iframeTitle.run(ctx)).status).toBe('warn');
  });
  it('fails on multiple untitled iframes', async () => {
    const ctx = ctxFromPages([page('/', '<html><body><iframe src="/a"></iframe><iframe src="/b"></iframe></body></html>')]);
    expect((await iframeTitle.run(ctx)).status).toBe('fail');
  });
});
