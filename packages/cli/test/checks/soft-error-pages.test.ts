import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { stubCtx } from '../helpers/stub.js';
import { softErrorPages, isErrorLabel, normalizeLabel } from '../../src/checks/soft-error-pages.js';

const BASE = 'https://stub.example/';

function doc(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;
}

function page(pathname: string, body: string, extra: Partial<FetchedResource> = {}): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {}, ...extra,
  };
}

/** A context whose sample is exactly `pages`. */
function mpCtx(pages: FetchedResource[]): CrawlContext {
  const resources: Record<string, Partial<FetchedResource>> = {};
  for (const p of pages) resources[new URL(p.finalUrl).pathname] = p;
  const ctx = stubCtx(resources, BASE);
  ctx.sample = { pages, source: 'links' };
  return ctx;
}

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ');
}

/** A healthy content page: real title, real H1, comfortably above the blank floor. */
function goodPage(pathname: string, name: string): FetchedResource {
  return page(pathname, doc(`${name} — Example Bakery`, `<main><h1>${name}</h1><p>${words(60)}</p></main>`));
}

const HOME = goodPage('/', 'Sourdough bread in Springfield');

// ---------------------------------------------------------------------------
// normalizeLabel / isErrorLabel — the bilingual lexicon itself
// ---------------------------------------------------------------------------

describe('normalizeLabel', () => {
  it('folds accents, case, apostrophes and punctuation', () => {
    expect(normalizeLabel('Erreur 404 — Page non trouvée !')).toBe('erreur 404 page non trouvee');
    expect(normalizeLabel("We couldn’t find that page")).toBe('we couldnt find that page');
  });
});

describe('isErrorLabel', () => {
  it('matches English error signatures', () => {
    for (const s of [
      'Page not found', '404 Not Found', 'Oops! The page you are looking for is gone',
      'This page does not exist', 'Internal Server Error', 'Something went wrong',
      'Error', 'Error 500', 'HTTP 404', '404', 'Access denied',
    ]) expect(isErrorLabel(s), s).toBe(true);
  });

  it('matches French error signatures', () => {
    for (const s of [
      'Page introuvable', 'Erreur 404', 'Cette page n’existe pas',
      'Page non trouvée', 'Une erreur est survenue', 'Service indisponible',
      'Erreur', 'Oups', 'Accès refusé', 'La page demandée est introuvable',
    ]) expect(isErrorLabel(s), s).toBe(true);
  });

  it('leaves ordinary page names alone', () => {
    for (const s of [
      '', 'About us', 'Contact the bakery', 'Error handling in Rust',
      '500 recipes for sourdough', 'Nos 404 boulangeries partenaires',
      'Gestion des erreurs en TypeScript', 'Notre histoire',
    ]) expect(isErrorLabel(s), s).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// soft-error-pages — verdict branches
// ---------------------------------------------------------------------------

describe('soft-error-pages', () => {
  it('skips when nothing was sampled and the homepage is unreachable', async () => {
    const r = await softErrorPages.run(stubCtx({}, BASE));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no pages sampled');
  });

  it('skips when the sample holds no 200 HTML page', async () => {
    const ctx = mpCtx([
      page('/brochure.pdf', '%PDF-1.7', { contentType: 'application/pdf' }),
      page('/moved', doc('Moved', '<h1>Moved</h1>'), { status: 301, ok: false }),
    ]);
    const r = await softErrorPages.run(ctx);
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no 200 HTML page in the sample');
  });

  it('passes when every sampled 200 carries a real document', async () => {
    const r = await softErrorPages.run(mpCtx([HOME, goodPage('/about', 'Our story'), goodPage('/contact', 'Visit us')]));
    expect(r.status).toBe('pass');
    expect(r.message).toBe('3 sampled page(s) return 200 with real content');
    expect(r.messageTemplate).toBe('{0} sampled page(s) return 200 with real content');
    expect(r.points).toBe(softErrorPages.maxPoints);
  });

  it('fails on an English error marker in <title>', async () => {
    const bad = page('/blog/old-post', doc('Page not found — Example Bakery', '<main><h1>Sorry</h1><p>Try the menu.</p></main>'));
    const r = await softErrorPages.run(mpCtx([HOME, bad]));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/blog/old-post');
    expect(r.message).toContain('title "Page not found');
    expect(r.messageTemplate).toBe('error page served with HTTP 200: {0}');
    expect(r.points).toBe(0);
    expect(r.fix).toMatch(/404/);
  });

  it('fails on a French error marker in <h1>, accents and all', async () => {
    const bad = page('/produits/pain', doc('Example Bakery', '<main><h1>Page introuvable</h1><p>Désolé.</p></main>'));
    const r = await softErrorPages.run(mpCtx([HOME, bad]));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('h1 "Page introuvable"');
  });

  it('fails on a bare status code used as the title', async () => {
    const bad = page('/x', doc('404', '<main><h1>404</h1><p>Nope.</p></main>'));
    expect((await softErrorPages.run(mpCtx([HOME, bad]))).status).toBe('fail');
  });

  it('does not fail a long article that merely writes about 404 errors', async () => {
    const article = page('/blog/fix-404',
      doc('Erreur 404 : comment la corriger', `<main><h1>Erreur 404 : comment la corriger</h1><p>${words(500)}</p></main>`));
    const r = await softErrorPages.run(mpCtx([HOME, article]));
    expect(r.status).toBe('pass');
  });

  it('warns (never fails) on a non-home 200 with almost no content', async () => {
    const shell = page('/services', doc('Services — Example Bakery', '<main><div id="root"></div></main>'));
    const r = await softErrorPages.run(mpCtx([HOME, shell]));
    expect(r.status).toBe('warn');
    expect(r.message).toBe('page served with HTTP 200 has almost no content: /services');
    expect(r.messageTemplate).toBe('page served with HTTP 200 has almost no content: {0}');
    expect(r.points).toBe(Math.floor(softErrorPages.maxPoints / 2));
  });

  it('exempts a deliberately minimal homepage from the blank rule', async () => {
    const splash = page('/', doc('Example Bakery', '<main><h1>Example Bakery</h1></main>'));
    const r = await softErrorPages.run(mpCtx([splash, goodPage('/about', 'Our story')]));
    expect(r.status).toBe('pass');
  });

  it('does not treat an image gallery as an empty shell', async () => {
    const gallery = page('/gallery',
      doc('Gallery — Example Bakery', '<main><h1>Gallery</h1><img src="a.jpg" alt="Loaf"><img src="b.jpg" alt="Tart"><img src="c.jpg" alt="Bun"></main>'));
    const r = await softErrorPages.run(mpCtx([HOME, gallery]));
    expect(r.status).toBe('pass');
  });

  it('reports the error pages, not the blank ones, when both are present', async () => {
    const bad = page('/gone', doc('Erreur 404', '<main><h1>Erreur 404</h1></main>'));
    const shell = page('/services', doc('Services', '<main></main>'));
    const r = await softErrorPages.run(mpCtx([HOME, bad, shell]));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/gone');
    expect(r.message).not.toContain('/services');
  });

  it('truncates the offender list to three plus a count', async () => {
    const bad = ['/a', '/b', '/c', '/d', '/e'].map((p) => page(p, doc('Page not found', '<main><h1>404</h1></main>')));
    const r = await softErrorPages.run(mpCtx([HOME, ...bad]));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('(+2 more)');
  });

  it('shortens a verbose error title in the offender label', async () => {
    const long = 'Page not found — we are very sorry about this unfortunate situation indeed';
    const bad = page('/x', doc(long, '<main><h1>Sorry</h1></main>'));
    const r = await softErrorPages.run(mpCtx([HOME, bad]));
    expect(r.message).toContain('…');
    expect(r.message).not.toContain('unfortunate');
  });

  it('falls back to the homepage when the runner attached no sample', async () => {
    const ctx = stubCtx({ '/': { contentType: 'text/html', body: doc('Page not found', '<main><h1>404</h1></main>') } }, BASE);
    const r = await softErrorPages.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/ (title "Page not found")');
  });
});
