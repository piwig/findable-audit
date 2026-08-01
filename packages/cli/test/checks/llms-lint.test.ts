import { describe, it, expect } from 'vitest';
import { stubCtx } from '../helpers/stub.js';
import { llmsTxtLint, markdownLinks } from '../../src/checks/llms-lint.js';

const BASE = 'http://stub.example/';

const GOOD_LLMS = [
  '# Stub Example',
  '> A small example site about honest bread.',
  '',
  '## Docs',
  '- [Getting started guide](http://stub.example/docs/start): the basics',
  '- [Pricing overview page](http://stub.example/pricing): plans',
].join('\n');

const URLSET = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>http://stub.example/docs/start</loc></url>
<url><loc>http://stub.example/pricing</loc></url>
</urlset>`;

describe('markdownLinks', () => {
  it('extracts titles and raw targets', () => {
    const links = markdownLinks('- [A guide](/docs) and [Ext](https://ext.example/x)');
    expect(links).toEqual([
      { title: 'A guide', target: '/docs' },
      { title: 'Ext', target: 'https://ext.example/x' },
    ]);
  });
});

describe('llms-txt-lint', () => {
  it('skips when llms.txt is missing', async () => {
    const ctx = stubCtx({}, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('skips when llms.txt is an HTML fallback', async () => {
    const ctx = stubCtx({ '/llms.txt': { body: '<html>app</html>', contentType: 'text/html' } }, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('passes a clean file whose links resolve and sit in the sitemap', async () => {
    const ctx = stubCtx({
      '/llms.txt': { body: GOOD_LLMS },
      '/docs/start': { body: 'ok', contentType: 'text/html' },
      '/pricing': { body: 'ok', contentType: 'text/html' },
      '/sitemap.xml': { body: URLSET, contentType: 'application/xml' },
    }, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('2 same-origin link(s) verified');
  });

  it('warns on broken links (stub 404s unknown paths)', async () => {
    const ctx = stubCtx({ '/llms.txt': { body: GOOD_LLMS } }, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('broken');
    expect(r.message).toContain('/docs/start');
  });

  it('warns on multiple H1 titles', async () => {
    const body = `${GOOD_LLMS}\n# Second Root\n`;
    const ctx = stubCtx({
      '/llms.txt': { body },
      '/docs/start': {}, '/pricing': {},
    }, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('2 H1 titles');
  });

  it('warns on relative link targets', async () => {
    const body = '# Stub\n> Summary line here.\n\n## Docs\n- [Getting started guide](/docs/start): basics\n';
    const ctx = stubCtx({ '/llms.txt': { body }, '/docs/start': {} }, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('relative link target');
  });

  it('warns when no linked URL appears in the sitemap', async () => {
    const otherUrlset = `<urlset><url><loc>http://stub.example/only-this</loc></url></urlset>`;
    const ctx = stubCtx({
      '/llms.txt': { body: GOOD_LLMS },
      '/docs/start': {}, '/pricing': {},
      '/sitemap.xml': { body: otherUrlset, contentType: 'application/xml' },
    }, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('sitemap.xml');
  });

  it('ignores a sitemapindex (children are sitemaps, not pages)', async () => {
    const index = `<sitemapindex><sitemap><loc>http://stub.example/s1.xml</loc></sitemap></sitemapindex>`;
    const ctx = stubCtx({
      '/llms.txt': { body: GOOD_LLMS },
      '/docs/start': {}, '/pricing': {},
      '/sitemap.xml': { body: index, contentType: 'application/xml' },
    }, BASE);
    const r = await llmsTxtLint.run(ctx);
    expect(r.status).toBe('pass');
  });

  it('never fails (heuristic guard-rail)', () => {
    expect(llmsTxtLint.evidence).toBe('heuristic');
  });
});
