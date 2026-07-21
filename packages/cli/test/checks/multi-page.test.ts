import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import { samplePages } from '../../src/sampler.js';
import {
  metaRobotsNoindex, snippetPreviewDirectives, uniqueTitles, imagesAlt, schemaCoverage,
} from '../../src/checks/multi-page.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function sampled(name: string, maxPages = 10) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  const c = new Crawler(srv.url);
  c.sample = await samplePages(c, maxPages);
  return c;
}

describe('meta-robots-noindex', () => {
  it('fails and names the offending page', async () => {
    const r = await metaRobotsNoindex.run(await sampled('multi-page'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/a.html');
  });
  it('passes on a clean sample', async () => {
    expect((await metaRobotsNoindex.run(await sampled('links-fallback'))).status).toBe('pass');
  });
  it('warns (not fails) on a nofollow-only page', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html><head><meta name="robots" content="index, nofollow"></head></html>' },
    });
    const r = await metaRobotsNoindex.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('nofollow');
  });
  it('warns on a header/meta noindex conflict', async () => {
    const c = stubCtx({
      '/': {
        contentType: 'text/html',
        body: '<html><head><meta name="robots" content="index, follow"></head></html>',
        headers: { 'x-robots-tag': 'noindex' },
      },
    });
    const r = await metaRobotsNoindex.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/disagree/);
  });
  it('fails on a space-separated (no comma) X-Robots-Tag noindex', async () => {
    const c = stubCtx({
      '/': {
        contentType: 'text/html',
        body: '<html><head></head></html>',
        headers: { 'x-robots-tag': 'noindex nofollow' },
      },
    });
    const r = await metaRobotsNoindex.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('noindex');
  });
});

describe('snippet-preview-directives', () => {
  it('fails when a page sets nosnippet', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html><head><meta name="robots" content="nosnippet"></head></html>' },
    });
    const r = await snippetPreviewDirectives.run(c);
    expect(r.status).toBe('fail');
  });
  it('fails when a page sets max-image-preview:none', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html><head><meta name="robots" content="max-image-preview:none"></head></html>' },
    });
    const r = await snippetPreviewDirectives.run(c);
    expect(r.status).toBe('fail');
  });
  it('warns when preview directives are merely absent', async () => {
    const c = stubCtx({ '/': { contentType: 'text/html', body: '<html><head></head></html>' } });
    const r = await snippetPreviewDirectives.run(c);
    expect(r.status).toBe('warn');
  });
  it('passes when max-image-preview:large is explicitly set', async () => {
    const c = stubCtx({
      '/': {
        contentType: 'text/html',
        body: '<html><head><meta name="robots" content="max-image-preview:large, max-snippet:-1, max-video-preview:-1"></head></html>',
      },
    });
    const r = await snippetPreviewDirectives.run(c);
    expect(r.status).toBe('pass');
  });
});

describe('unique-titles', () => {
  it('fails when half the sample shares title and description', async () => {
    // "/" and "/a.html" duplicate both -> 2/4 conform = 50% < 80%
    expect((await uniqueTitles.run(await sampled('multi-page'))).status).toBe('fail');
  });
  it('skips with fewer than 2 sampled pages', async () => {
    expect((await uniqueTitles.run(await sampled('multi-page', 1))).status).toBe('skip');
  });
});

describe('images-alt', () => {
  it('fails when only 1 of 3 images has an alt attribute', async () => {
    const r = await imagesAlt.run(await sampled('multi-page'));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('1/3');
  });
  it('passes when there are no images at all', async () => {
    expect((await imagesAlt.run(await sampled('links-fallback'))).status).toBe('pass');
  });
});

describe('schema-coverage', () => {
  it('warns when only 1 of 4 pages carries JSON-LD', async () => {
    expect((await schemaCoverage.run(await sampled('multi-page'))).status).toBe('warn');
  });
  it('skips with fewer than 2 sampled pages', async () => {
    expect((await schemaCoverage.run(await sampled('multi-page', 1))).status).toBe('skip');
  });
});
