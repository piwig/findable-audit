import { describe, it, expect } from 'vitest';
import { stubCtx } from '../helpers/stub.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import {
  jsOnlyDestinations, scriptedTargets, elementTargets, isRealHyperlink, looksInteractive,
} from '../../src/checks/js-only-destinations.js';
import { parsePage } from '../../src/checks/dom.js';

const BASE = 'http://stub.example/';

function doc(body: string): string {
  return `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;
}
function pageRes(pathname: string, body: string): FetchedResource {
  return { status: 200, ok: true, body: doc(body), contentType: 'text/html', finalUrl: new URL(pathname, BASE).toString(), headers: {} };
}
function mpCtx(pages: FetchedResource[]): CrawlContext {
  const resources: Record<string, Partial<FetchedResource>> = {};
  for (const p of pages) resources[new URL(p.finalUrl).pathname] = p;
  const ctx = stubCtx(resources, BASE);
  ctx.sample = { pages, source: 'links' };
  return ctx;
}
/** Single-element helper for the exported primitives. */
function el(html: string) {
  return parsePage({ body: html } as FetchedResource).firstChild as unknown as Parameters<typeof elementTargets>[0];
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

describe('scriptedTargets', () => {
  it('pulls the URL out of every supported navigation form', () => {
    expect(scriptedTargets("location.href='/a'")).toEqual(['/a']);
    expect(scriptedTargets('window.location.href = "/b"')).toEqual(['/b']);
    expect(scriptedTargets("location.assign('/c')")).toEqual(['/c']);
    expect(scriptedTargets('location.replace("/d")')).toEqual(['/d']);
    expect(scriptedTargets("window.open('/e','_blank')")).toEqual(['/e']);
    expect(scriptedTargets("document.location='/f'")).toEqual(['/f']);
    expect(scriptedTargets("router.push('/g')")).toEqual(['/g']);
    expect(scriptedTargets("navigate('/h')")).toEqual(['/h']);
  });
  it('keeps no lastIndex state between calls (shared /g patterns)', () => {
    expect(scriptedTargets("location.href='/x'")).toEqual(['/x']);
    expect(scriptedTargets("location.href='/x'")).toEqual(['/x']);
  });
  it('returns nothing for handler code that does not navigate', () => {
    expect(scriptedTargets('toggleMenu(this)')).toEqual([]);
    expect(scriptedTargets('trackEvent("cta", { url: 1 })')).toEqual([]);
  });
});

describe('isRealHyperlink', () => {
  it('accepts an anchor with a usable href', () => {
    expect(isRealHyperlink(el('<a href="/about">a</a>'))).toBe(true);
    expect(isRealHyperlink(el('<area href="/map">'))).toBe(true);
  });
  it('rejects the anchors a non-JS crawler cannot follow', () => {
    expect(isRealHyperlink(el('<a>a</a>'))).toBe(false);
    expect(isRealHyperlink(el('<a href="#">a</a>'))).toBe(false);
    expect(isRealHyperlink(el('<a href="  ">a</a>'))).toBe(false);
    expect(isRealHyperlink(el('<a href="JavaScript:go()">a</a>'))).toBe(false);
  });
  it('rejects anything that is not an anchor', () => {
    expect(isRealHyperlink(el('<div href="/about">d</div>'))).toBe(false);
  });
});

describe('looksInteractive', () => {
  it('recognises buttons, link/button roles, handlers and tabindex', () => {
    expect(looksInteractive(el('<button data-href="/a">b</button>'))).toBe(true);
    expect(looksInteractive(el('<div role="link" data-href="/a">d</div>'))).toBe(true);
    expect(looksInteractive(el('<div role="BUTTON" data-href="/a">d</div>'))).toBe(true);
    expect(looksInteractive(el('<div onclick="go()" data-href="/a">d</div>'))).toBe(true);
    expect(looksInteractive(el('<div tabindex="0" data-href="/a">d</div>'))).toBe(true);
  });
  it('rejects an inert element', () => {
    expect(looksInteractive(el('<div data-url="/api/track">d</div>'))).toBe(false);
  });
});

describe('elementTargets', () => {
  it('reads a javascript: href', () => {
    expect(elementTargets(el(`<a href="javascript:location.href='/secret'">x</a>`))).toEqual(['/secret']);
  });
  it('returns nothing for a real link, even one that also scripts a navigation', () => {
    expect(elementTargets(el(`<a href="/about" onclick="location.href='/other'">x</a>`))).toEqual([]);
  });
  it('ignores a data-* URL on an inert element', () => {
    expect(elementTargets(el('<div data-url="/api/track">x</div>'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

describe('js-only-destinations', () => {
  it('skips when no page could be sampled', async () => {
    const r = await jsOnlyDestinations.run(stubCtx({}, BASE));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no pages sampled');
    expect(r.points).toBe(0);
  });

  it('passes when every destination is a real anchor', async () => {
    const ctx = mpCtx([
      pageRes('/', '<a href="/about">About</a> <a href="/pricing">Pricing</a> <a href="#top">Top</a>'),
      pageRes('/about', '<a href="/">Home</a>'),
    ]);
    const r = await jsOnlyDestinations.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toBe('2 page(s) inspected; every internal destination is a real <a href>');
    expect(r.points).toBe(3);
  });

  it('warns on a div navigating by onclick to a URL no anchor exposes', async () => {
    const ctx = mpCtx([
      pageRes('/', `<a href="/about">About</a><div class="card" onclick="location.href='/promo'">Promo</div>`),
    ]);
    const r = await jsOnlyDestinations.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('1 internal URL(s) reachable only by running JavaScript');
    expect(r.message).toContain('/promo (on /)');
    expect(r.fix).toContain('<a href="/path">');
    expect(r.points).toBe(1); // floor(3 / 2) — warn, never fail
  });

  it('warns on a button carrying data-href', async () => {
    const ctx = mpCtx([pageRes('/', '<button data-href="/pricing">Pricing</button>')]);
    const r = await jsOnlyDestinations.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/pricing (on /)');
  });

  it('passes when the scripted destination is also linked by a real anchor elsewhere in the sample', async () => {
    const ctx = mpCtx([
      pageRes('/', `<div role="link" data-href="/pricing">Pricing</div>`),
      pageRes('/about', '<a href="/pricing/">Pricing</a>'),
    ]);
    const r = await jsOnlyDestinations.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toBe('1 scripted destination(s), all also exposed as a real <a href>');
  });

  it('passes when the scripted destination is itself a sampled page', async () => {
    const ctx = mpCtx([
      pageRes('/', `<div onclick="location.href='/about'">About</div>`),
      pageRes('/about', '<p>About us</p>'),
    ]);
    expect((await jsOnlyDestinations.run(ctx)).status).toBe('pass');
  });

  it('never counts an anchor with an href as a scripted destination', async () => {
    const ctx = mpCtx([pageRes('/', `<a href="/about" onclick="location.href='/ghost'">About</a>`)]);
    const r = await jsOnlyDestinations.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('every internal destination is a real <a href>');
  });

  it('extracts the destination hidden in a javascript: href', async () => {
    const ctx = mpCtx([pageRes('/', `<a href="javascript:location.href='/secret'">Secret</a>`)]);
    const r = await jsOnlyDestinations.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/secret (on /)');
  });

  it('ignores cross-origin, mailto and infrastructure destinations', async () => {
    const ctx = mpCtx([pageRes('/', [
      `<div onclick="location.href='https://other.example/x'">a</div>`,
      `<div onclick="location.href='mailto:hi@stub.example'">b</div>`,
      `<div onclick="location.href='/cdn-cgi/l/email-protection'">c</div>`,
    ].join(''))]);
    expect((await jsOnlyDestinations.run(ctx)).status).toBe('pass');
  });

  it('ignores a scripted asset download (not a page)', async () => {
    const ctx = mpCtx([pageRes('/', `<button onclick="window.open('/brochure.pdf')">PDF</button>`)]);
    expect((await jsOnlyDestinations.run(ctx)).status).toBe('pass');
  });

  it('ignores an inert data-url (analytics endpoint, not a link)', async () => {
    const ctx = mpCtx([pageRes('/', '<div data-url="/api/track">stats</div>')]);
    expect((await jsOnlyDestinations.run(ctx)).status).toBe('pass');
  });

  it('lists at most three offenders and counts the rest', async () => {
    const cards = ['/a', '/b', '/c', '/d', '/e']
      .map((p) => `<span role="button" onclick="location.href='${p}'">go</span>`).join('');
    const r = await jsOnlyDestinations.run(mpCtx([pageRes('/', cards)]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('5 internal URL(s)');
    expect(r.message).toContain('/a (on /), /b (on /), /c (on /) (+2 more)');
  });

  it('deduplicates a destination scripted from several elements and pages', async () => {
    const ctx = mpCtx([
      pageRes('/', `<div onclick="location.href='/promo'">1</div><div onclick="location.href='/promo'">2</div>`),
      pageRes('/about', `<div onclick="location.href='/promo'">3</div>`),
    ]);
    const r = await jsOnlyDestinations.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toBe('1 internal URL(s) reachable only by running JavaScript: /promo (on /)');
  });

  it('keeps every message translatable (template plus params)', async () => {
    const warned = await jsOnlyDestinations.run(mpCtx([pageRes('/', `<div onclick="location.href='/promo'">Promo</div>`)]));
    expect(warned.messageTemplate).toBe('{0} internal URL(s) reachable only by running JavaScript: {1}');
    expect(warned.messageParams).toEqual([1, '/promo (on /)']);
    expect(warned.evidence).toBe('heuristic');
    expect(warned.family).toBe('technical-seo');

    const clean = await jsOnlyDestinations.run(mpCtx([pageRes('/', '<a href="/about">About</a>')]));
    expect(clean.messageTemplate).toBe('{0} page(s) inspected; every internal destination is a real <a href>');
    expect(clean.messageParams).toEqual([1]);

    const mirrored = await jsOnlyDestinations.run(mpCtx([
      pageRes('/', `<a href="/about">About</a><div onclick="location.href='/about'">About</div>`),
    ]));
    expect(mirrored.messageTemplate).toBe('{0} scripted destination(s), all also exposed as a real <a href>');
    expect(mirrored.messageParams).toEqual([1]);

    const skipped = await jsOnlyDestinations.run(stubCtx({}, BASE));
    expect(skipped.messageTemplate).toBe('no pages sampled');
  });
});
