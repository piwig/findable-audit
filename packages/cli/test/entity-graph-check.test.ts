import { describe, it, expect } from 'vitest';
import { entityGraphConnectivity } from '../src/checks/entity-graph.js';
import { buildChecks } from '../src/checks/index.js';
import type { CrawlContext, FetchedResource, PageSample } from '../src/types.js';

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

function fetched(path: string, body: string): FetchedResource {
  return { status: 200, ok: true, body, contentType: 'text/html', finalUrl: `https://ex.com${path}`, headers: {} };
}

function ctxWith(pages: FetchedResource[]): CrawlContext {
  const sample: PageSample = { pages, source: 'links' };
  return {
    baseUrl: new URL('https://ex.com/'),
    async fetch() { return null; },
    sample,
  };
}

describe('entity-graph-connectivity check', () => {
  it('skips when there is no page sample', async () => {
    const ctx: CrawlContext = { baseUrl: new URL('https://ex.com/'), async fetch() { return null; } };
    const r = await entityGraphConnectivity.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('warns when no JSON-LD entities are found', async () => {
    const ctx = ctxWith([fetched('/', '<html><body>no ld here</body></html>')]);
    const r = await entityGraphConnectivity.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message.toLowerCase()).toContain('no');
  });

  it('fails on a dangling @id reference', async () => {
    const body = `<html><body>${ld({
      '@graph': [
        { '@type': 'WebSite', '@id': 'https://ex.com/#site', publisher: { '@id': 'https://ex.com/#ghost' } },
      ],
    })}</body></html>`;
    const r = await entityGraphConnectivity.run(ctxWith([fetched('/', body)]));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('#ghost');
  });

  it('passes on a connected, dangling-free entity graph', async () => {
    const body = `<html><body>${ld({
      '@graph': [
        { '@type': 'Organization', '@id': 'https://ex.com/#org', name: 'Ex' },
        { '@type': 'WebSite', '@id': 'https://ex.com/#site', name: 'Ex', publisher: { '@id': 'https://ex.com/#org' } },
      ],
    })}</body></html>`;
    const r = await entityGraphConnectivity.run(ctxWith([fetched('/', body)]));
    expect(r.status).toBe('pass');
  });

  it('warns when two named root entities live in separate components', async () => {
    const body = `<html><body>${ld([
      { '@type': 'Organization', '@id': 'https://ex.com/#org', name: 'Ex Corp' },
      { '@type': 'WebSite', '@id': 'https://ex.com/#site', name: 'Ex Site' },
    ])}</body></html>`; // no link between them → 2 components, 2 named roots
    const r = await entityGraphConnectivity.run(ctxWith([fetched('/', body)]));
    expect(r.status).toBe('warn');
  });

  it('is registered in buildChecks', () => {
    expect(buildChecks().some((c) => c.id === 'entity-graph-connectivity')).toBe(true);
  });
});
