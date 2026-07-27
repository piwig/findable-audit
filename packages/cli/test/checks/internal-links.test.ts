import { describe, it, expect } from 'vitest';
import { stubCtx } from '../helpers/stub.js';
import {
  anchorTargetProfile, internalLinkContext, internalEquityLeaks, topicTokens, brandTokens,
} from '../../src/checks/internal-links.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';

const BASE = 'https://acme.example/';

function html(title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title>`
    + `<meta property="og:site_name" content="Acme">${extraHead}</head><body>${body}</body></html>`;
}

function page(pathname: string, body: string): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

/**
 * A context whose sample is exactly `pages` and whose `fetch` answers for those
 * same paths (plus anything in `extra`). Unknown paths 404, which is what makes
 * the dead-end census testable without a server.
 */
function ctxOf(pages: FetchedResource[], extra: Record<string, Partial<FetchedResource>> = {}): CrawlContext {
  const map: Record<string, Partial<FetchedResource>> = { ...extra };
  for (const p of pages) map[new URL(p.finalUrl).pathname] = p;
  const ctx = stubCtx(map, BASE);
  ctx.sample = { pages, source: 'links' };
  return ctx;
}

/** The homepage nav, repeated on every page — the boilerplate half of the split. */
const NAV = '<nav><a href="/">Acme</a> <a href="/pricing/">Pricing plans</a> <a href="/guide/">Sourdough guide</a></nav>';

describe('topicTokens', () => {
  it('folds accents so an accented anchor matches an unaccented title', () => {
    expect(topicTokens('Référencement')).toEqual(['referencement']);
  });
  it('drops stopwords in both languages, leaving nothing for a generic anchor', () => {
    expect(topicTokens('read more')).toEqual([]);
    expect(topicTokens('en savoir plus')).toEqual([]);
  });
});

describe('brandTokens', () => {
  it('takes the brand from og:site_name, so a logo anchor never counts as topical', () => {
    const home = page('/', html('Acme — the sourdough people', `<main><p>hi</p></main>`));
    expect([...brandTokens([home], new URL(BASE))]).toContain('acme');
  });
});

describe('anchor-target-profile', () => {
  it('passes when the dominant anchor shares a token with the target title', async () => {
    const pages = [
      page('/', html('Acme — home', `${NAV}<main><p>Welcome.</p></main>`)),
      page('/pricing/', html('Pricing — Acme', `${NAV}<main><h1>Pricing</h1><p>Plans.</p></main>`)),
      page('/guide/', html('Sourdough guide — Acme', `${NAV}<main><h1>Sourdough guide</h1><p>Bake.</p></main>`)),
    ];
    const r = await anchorTargetProfile.run(ctxOf(pages));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('2 internal page(s)');
  });

  it('warns — never fails — when the anchor names nothing on the target page', async () => {
    const nav = '<nav><a href="/pricing/">Banana split</a> <a href="/guide/">Sourdough guide</a></nav>';
    const pages = [
      page('/', html('Acme — home', `${nav}<main><p>Welcome.</p></main>`)),
      page('/pricing/', html('Pricing — Acme', `${nav}<main><h1>Pricing</h1><p>Plans.</p></main>`)),
      page('/guide/', html('Sourdough guide — Acme', `${nav}<main><h1>Sourdough guide</h1><p>Bake.</p></main>`)),
    ];
    const r = await anchorTargetProfile.run(ctxOf(pages));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/pricing/');
    expect(r.message).toContain('Banana split');
  });

  it('warns when every in-content link to one target repeats a single wording', async () => {
    const body = (extra: string) => `${NAV}<main><h1>Post</h1><p>${extra}</p></main>`;
    const repeat = '<a href="/guide/">Sourdough guide</a>';
    const pages = [
      page('/', html('Acme — home', body(repeat))),
      page('/a/', html('Post A — Acme', body(repeat))),
      page('/b/', html('Post B — Acme', body(repeat))),
      page('/pricing/', html('Pricing — Acme', `${NAV}<main><h1>Pricing</h1></main>`)),
      page('/guide/', html('Sourdough guide — Acme', `${NAV}<main><h1>Sourdough guide</h1></main>`)),
    ];
    const r = await anchorTargetProfile.run(ctxOf(pages));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/guide/');
  });

  it('ignores a language switcher: "Français" is the right label for the French home', async () => {
    const nav = '<nav><a href="/fr/" hreflang="fr" lang="fr">Français</a>'
      + ' <a href="/pricing/">Pricing plans</a> <a href="/guide/">Sourdough guide</a></nav>';
    const pages = [
      page('/', html('Acme — home', `${nav}<main><p>Welcome.</p></main>`)),
      page('/fr/', html('Accueil — Acme', `${nav}<main><h1>Accueil</h1><p>Bonjour.</p></main>`)),
      page('/pricing/', html('Pricing — Acme', `${nav}<main><h1>Pricing</h1></main>`)),
      page('/guide/', html('Sourdough guide — Acme', `${nav}<main><h1>Sourdough guide</h1></main>`)),
    ];
    const r = await anchorTargetProfile.run(ctxOf(pages));
    expect(r.status).toBe('pass');
  });

  it('skips rather than guessing when fewer than two targets are gradable', async () => {
    const nav = '<nav><a href="/pricing/">Read more</a></nav>';
    const pages = [
      page('/', html('Acme — home', `${nav}<main><p>Welcome.</p></main>`)),
      page('/pricing/', html('Pricing — Acme', `${nav}<main><h1>Pricing</h1></main>`)),
    ];
    const r = await anchorTargetProfile.run(ctxOf(pages));
    expect(r.status).toBe('skip');
  });

  it('skips when no page is reachable', async () => {
    const r = await anchorTargetProfile.run(stubCtx({}, BASE));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no page reachable');
  });
});

describe('internal-link-context', () => {
  const six = (main: string): FetchedResource[] => ['/', '/a/', '/b/', '/c/', '/d/', '/e/']
    .map((p) => page(p, html(`Page ${p} — Acme`, `${NAV}<main><h1>Page</h1>${main}</main>`)));

  it('skips below five sampled pages — one template is not a link graph', async () => {
    const pages = ['/', '/a/', '/b/'].map((p) => page(p, html('Acme', `${NAV}<main><p>x</p></main>`)));
    const r = await internalLinkContext.run(ctxOf(pages));
    expect(r.status).toBe('skip');
  });

  it('skips when the sampled pages carry no internal link at all', async () => {
    const pages = ['/', '/a/', '/b/', '/c/', '/d/'].map((p) => page(p, html('Acme', '<main><p>x</p></main>')));
    const r = await internalLinkContext.run(ctxOf(pages));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no internal links on sampled pages');
  });

  it('warns when the graph is template-only', async () => {
    const r = await internalLinkContext.run(ctxOf(six('<p>No links here.</p>')));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('0%');
  });

  it('passes once real in-content links exist, and names the pages that have none', async () => {
    const pages = six('<p>See the <a href="/guide/">sourdough guide</a>.</p>');
    pages.push(page('/f/', html('Bare — Acme', `${NAV}<main><h1>Bare</h1><p>${'word '.repeat(200)}</p></main>`)));
    const r = await internalLinkContext.run(ctxOf(pages));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('main content');
    expect(r.message).toContain('1 substantial page(s)');
  });
});

describe('internal-equity-leaks', () => {
  it('skips when no page is reachable', async () => {
    const r = await internalEquityLeaks.run(stubCtx({}, BASE));
    expect(r.status).toBe('skip');
  });

  it('skips when there is no internal link to grade', async () => {
    const r = await internalEquityLeaks.run(ctxOf([page('/', html('Acme', '<main><p>x</p></main>'))]));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no internal links on sampled pages');
  });

  it('warns on rel=nofollow pointed at the site itself', async () => {
    const pages = [page('/', html('Acme', `<main><a href="/pricing/" rel="nofollow">Pricing</a></main>`))];
    const r = await internalEquityLeaks.run(ctxOf(pages, { '/pricing/': { contentType: 'text/html', body: '<h1>P</h1>' } }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('nofollow');
    expect(r.message).toContain('/pricing/');
  });

  it('warns on sponsored/ugc used internally, where neither means anything', async () => {
    const pages = [page('/', html('Acme', `<main><a href="/deal/" rel="sponsored ugc">Deal</a></main>`))];
    const r = await internalEquityLeaks.run(ctxOf(pages, { '/deal/': { contentType: 'text/html', body: '<h1>D</h1>' } }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('sponsored');
  });

  it('counts one offender per template mistake, not one per page it appears on', async () => {
    const body = `<main><a href="/pricing/" rel="nofollow">Pricing</a></main>`;
    const pages = ['/', '/a/', '/b/'].map((p) => page(p, html('Acme', body)));
    const r = await internalEquityLeaks.run(ctxOf(pages, { '/pricing/': { contentType: 'text/html', body: '<h1>P</h1>' } }));
    expect(r.status).toBe('warn');
    expect(r.message.match(/\/pricing\//g)).toHaveLength(1);
  });

  it('passes clean markup, and reports noindex/error targets without penalizing them', async () => {
    const pages = [page('/', html('Acme',
      `<main><a href="/pricing/">Pricing</a> <a href="/demo/">Demo</a> <a href="/gone/">Gone</a></main>`))];
    const ctx = ctxOf(pages, {
      '/pricing/': { contentType: 'text/html', body: '<h1>P</h1>' },
      '/demo/': { contentType: 'text/html', body: '<html><head><meta name="robots" content="noindex"></head><body>D</body></html>' },
    });
    const r = await internalEquityLeaks.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('1 point at a noindex page');
    expect(r.message).toContain('1 at an error page');
  });

  it('passes silently when nothing at all is wrong', async () => {
    const pages = [page('/', html('Acme', `<main><a href="/pricing/">Pricing</a></main>`))];
    const r = await internalEquityLeaks.run(ctxOf(pages, { '/pricing/': { contentType: 'text/html', body: '<h1>P</h1>' } }));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('no equity-blocking rel');
  });
});
