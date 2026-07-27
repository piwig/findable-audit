import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { sdPageEntity } from '../../src/checks/page-entity.js';

const BASE = 'http://stub.example/';

function page(pathname: string, body: string): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

function ctxFromPages(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map(pages.map((p) => [new URL(p.finalUrl).pathname, p]));
  return {
    baseUrl: new URL(BASE),
    async fetch(path: string) {
      const url = new URL(path, BASE);
      return byPath.get(url.pathname) ?? {
        status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {},
      };
    },
    sample: { pages, source: 'links' },
  };
}

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const html = (head: string) => `<html><head>${head}</head><body></body></html>`;
const graph = (nodes: unknown[]) => html(ld({ '@context': 'https://schema.org', '@graph': nodes }));

describe('sd-page-entity', () => {
  it('skips when the homepage carries no WebPage/CreativeWork node', async () => {
    // The perfect-site shape: a LocalBusiness and a WebSite, nowhere to hang `about`.
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'Bakery', '@id': 'https://x.example/#biz', name: 'Example Bakery' },
      { '@type': 'WebSite', '@id': 'https://x.example/#site', name: 'Example Bakery' },
    ]))]);
    expect((await sdPageEntity.run(ctx)).status).toBe('skip');
  });

  it('skips when there is no JSON-LD at all', async () => {
    expect((await sdPageEntity.run(ctxFromPages([page('/', html(''))]))).status).toBe('skip');
  });

  it('passes when the homepage WebPage points at an entity defined in the same graph', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'WebApplication', '@id': 'https://x.example/#app', name: 'Findable', url: 'https://x.example/' },
      { '@type': 'WebPage', '@id': 'https://x.example/#webpage', about: { '@id': 'https://x.example/#app' } },
    ]))]);
    const r = await sdPageEntity.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('1 page(s)');
  });

  it('accepts mainEntity as the declaration, like about', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'WebApplication', '@id': 'https://x.example/#app', name: 'Findable' },
      { '@type': 'WebPage', mainEntity: { '@id': 'https://x.example/#app' } },
    ]))]);
    expect((await sdPageEntity.run(ctx)).status).toBe('pass');
  });

  it('accepts an inline entity grounded by sameAs', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'WebPage', about: { '@type': 'Thing', name: 'Sourdough', sameAs: ['https://www.wikidata.org/wiki/Q184370'] } },
    ]))]);
    expect((await sdPageEntity.run(ctx)).status).toBe('pass');
  });

  it('warns when the homepage page node declares no subject', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'WebPage', '@id': 'https://x.example/#webpage', url: 'https://x.example/' },
    ]))]);
    const r = await sdPageEntity.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('no about/mainEntity');
  });

  it('warns when the subject is a bare string rather than an entity', async () => {
    const ctx = ctxFromPages([page('/', graph([{ '@type': 'WebPage', about: 'sourdough bread' }]))]);
    const r = await sdPageEntity.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('not anchored');
  });

  it('warns when about points at an @id nothing defines', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'WebPage', about: { '@id': 'https://x.example/#nowhere' } },
    ]))]);
    expect((await sdPageEntity.run(ctx)).status).toBe('warn');
  });

  it('warns when an anonymous named entity has neither a resolvable @id nor sameAs', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'WebPage', about: { '@type': 'Thing', name: 'Sourdough' } },
    ]))]);
    expect((await sdPageEntity.run(ctx)).status).toBe('warn');
  });

  it('never fails, whatever is missing', async () => {
    const ctx = ctxFromPages([page('/', graph([{ '@type': 'WebPage' }]))]);
    expect((await sdPageEntity.run(ctx)).status).not.toBe('fail');
  });

  it('leaves navigational interior pages out of scope', async () => {
    // A contact page whose only node is a WebPage: no subject demanded, no warning.
    const ctx = ctxFromPages([
      page('/', graph([
        { '@type': 'WebApplication', '@id': 'https://x.example/#app', name: 'Findable' },
        { '@type': 'WebPage', about: { '@id': 'https://x.example/#app' } },
      ])),
      page('/contact', graph([{ '@type': 'WebPage', '@id': 'https://x.example/contact#webpage' }])),
    ]);
    const r = await sdPageEntity.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('1 page(s)');
  });

  it('grades article pages and names the ones without a subject', async () => {
    const ctx = ctxFromPages([
      page('/', graph([{ '@type': 'WebPage', about: { '@type': 'Thing', name: 'Bread', sameAs: ['https://www.wikidata.org/wiki/Q7802'] } }])),
      page('/blog/post', graph([{ '@type': 'Article', headline: 'Sourdough' }])),
    ]);
    const r = await sdPageEntity.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/blog/post');
    expect(r.message).toContain('no about/mainEntity');
  });

  it('reports a mentions list that names nothing resolvable', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'Thing', '@id': 'https://x.example/#bread', name: 'Bread' },
      { '@type': 'WebPage', about: { '@id': 'https://x.example/#bread' }, mentions: ['rye', 'spelt'] },
    ]))]);
    const r = await sdPageEntity.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('mentions declared but not anchored');
  });

  it('says nothing about a page that declares no mentions at all', async () => {
    const ctx = ctxFromPages([page('/', graph([
      { '@type': 'Thing', '@id': 'https://x.example/#bread', name: 'Bread' },
      { '@type': 'WebPage', about: { '@id': 'https://x.example/#bread' } },
    ]))]);
    expect((await sdPageEntity.run(ctx)).status).toBe('pass');
  });

  it('treats the first sampled page as the homepage after a language redirect', async () => {
    // `/` 302s to `/en/`, so no sampled page sits at '/'; the sampler puts it first.
    const ctx = ctxFromPages([
      page('/en/', graph([{ '@type': 'WebPage', '@id': 'https://x.example/en/#webpage' }])),
      page('/en/contact/', graph([{ '@type': 'WebPage' }])),
    ]);
    const r = await sdPageEntity.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/en/');
    expect(r.message).not.toContain('/en/contact/');
  });
});
