import { describe, it, expect } from 'vitest';
import { stubCtx } from '../helpers/stub.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import { indexingConflicts } from '../../src/checks/indexing-conflicts.js';

const BASE = 'https://ic.example/';

interface PageOpts {
  /** Absolute or relative href for a <link rel="canonical">. */
  canonical?: string;
  /** Value of <meta name="robots" content="…">. */
  robotsMeta?: string;
  /** Value of the X-Robots-Tag response header. */
  xRobots?: string;
}

function page(pathname: string, opts: PageOpts = {}): FetchedResource {
  const head = [
    opts.canonical ? `<link rel="canonical" href="${opts.canonical}">` : '',
    opts.robotsMeta ? `<meta name="robots" content="${opts.robotsMeta}">` : '',
  ].join('');
  return {
    status: 200,
    ok: true,
    contentType: 'text/html',
    body: `<!doctype html><html lang="en"><head>${head}</head><body><h1>page</h1></body></html>`,
    finalUrl: new URL(pathname, BASE).toString(),
    headers: opts.xRobots ? { 'x-robots-tag': opts.xRobots } : {},
  };
}

const urlset = (locs: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    locs.map((l) => `<url><loc>${l}</loc></url>`).join('')
  }</urlset>`;

interface SiteOpts {
  /** robots.txt body; omit for a 404 (no robots.txt at all). */
  robots?: string;
  /** <loc> values for /sitemap.xml; omit for no sitemap. */
  sitemap?: string[];
  /** Sampled pages; omit for an empty sample and a 404 homepage. */
  pages?: FetchedResource[];
}

function siteCtx(opts: SiteOpts): CrawlContext {
  const resources: Record<string, Partial<FetchedResource>> = {};
  if (opts.robots !== undefined) resources['/robots.txt'] = { body: opts.robots, contentType: 'text/plain' };
  if (opts.sitemap) resources['/sitemap.xml'] = { body: urlset(opts.sitemap), contentType: 'application/xml' };
  for (const p of opts.pages ?? []) resources[new URL(p.finalUrl).pathname] = p;
  const ctx = stubCtx(resources, BASE);
  if (opts.pages && opts.pages.length > 0) ctx.sample = { pages: opts.pages, source: 'sitemap' };
  return ctx;
}

const ALLOW_ALL = 'User-agent: *\nAllow: /\n';
const DISALLOW_PRIVATE = 'User-agent: *\nAllow: /\nDisallow: /private/\n';

describe('indexing-conflicts — shape', () => {
  it('is a measured technical-seo check', () => {
    expect(indexingConflicts.id).toBe('indexing-conflicts');
    expect(indexingConflicts.family).toBe('technical-seo');
    expect(indexingConflicts.evidence).toBe('measured');
    expect(indexingConflicts.maxPoints).toBeGreaterThan(0);
  });
});

describe('indexing-conflicts — skip', () => {
  it('skips when nothing was sampled and no sitemap URL exists', async () => {
    const r = await indexingConflicts.run(siteCtx({ robots: DISALLOW_PRIVATE }));
    expect(r.status).toBe('skip');
    expect(r.message).toContain('no sampled page');
    expect(r.points).toBe(0);
  });

  it('skips when robots.txt forbids nothing and there is no sitemap', async () => {
    const r = await indexingConflicts.run(siteCtx({ robots: ALLOW_ALL, pages: [page('/')] }));
    expect(r.status).toBe('skip');
    expect(r.message).toContain('no Disallow rule');
  });

  it('skips when robots.txt forbids nothing and nothing was sampled', async () => {
    const r = await indexingConflicts.run(siteCtx({ robots: ALLOW_ALL, sitemap: [`${BASE}about`] }));
    expect(r.status).toBe('skip');
    expect(r.message).toContain('no Disallow rule');
  });

  it('skips when robots.txt is missing entirely and there is no sitemap', async () => {
    const r = await indexingConflicts.run(siteCtx({ pages: [page('/')] }));
    expect(r.status).toBe('skip');
  });

  it('treats an HTML robots.txt as carrying no rules', async () => {
    const ctx = stubCtx(
      {
        '/robots.txt': { body: '<!doctype html><html><body>Disallow: /private/</body></html>', contentType: 'text/html' },
        '/': page('/'),
      },
      BASE,
    );
    ctx.sample = { pages: [page('/')], source: 'links' };
    const r = await indexingConflicts.run(ctx);
    expect(r.status).toBe('skip');
  });
});

describe('indexing-conflicts — pass', () => {
  it('passes when the sitemap, robots.txt and page directives agree', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: DISALLOW_PRIVATE,
      sitemap: [`${BASE}`, `${BASE}about`],
      pages: [page('/', { canonical: BASE }), page('/about', { canonical: `${BASE}about` })],
    }));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('2 sitemap URL(s)');
    expect(r.message).toContain('2 sampled page(s)');
    expect(r.points).toBe(indexingConflicts.maxPoints);
  });

  it('passes when a noindex page is deliberately kept out of the sitemap', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: DISALLOW_PRIVATE,
      sitemap: [`${BASE}about`],
      pages: [page('/about'), page('/thanks', { robotsMeta: 'noindex' })],
    }));
    expect(r.status).toBe('pass');
  });

  it('ignores cross-origin sitemap entries and cross-origin canonicals', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: DISALLOW_PRIVATE,
      sitemap: [`${BASE}about`, 'https://other.example/private/leak'],
      pages: [page('/about', { canonical: 'https://other.example/private/leak' })],
    }));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('1 sitemap URL(s)');
  });

  it('ignores a Disallow aimed at a single AI agent (deliberate policy, not a contradiction)', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /blog/\n',
      sitemap: [`${BASE}blog/post`],
      pages: [page('/blog/post')],
    }));
    expect(r.status).toBe('pass');
  });
});

describe('indexing-conflicts — fail', () => {
  it('fails when a sitemap URL is Disallow-ed in robots.txt', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: DISALLOW_PRIVATE,
      sitemap: [`${BASE}about`, `${BASE}private/report`],
      pages: [page('/about')],
    }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/private/report (in sitemap but Disallow)');
    expect(r.points).toBe(0);
    expect(r.fix).toBeTruthy();
  });

  it('matches a Disallow rule that includes a query string', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: 'User-agent: *\nDisallow: /*?session=\n',
      sitemap: [`${BASE}deals?session=1`],
      pages: [page('/')],
    }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('in sitemap but Disallow');
  });

  it('fails when a canonical points at a Disallow-ed URL', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: 'User-agent: *\nAllow: /\nDisallow: /archive/\n',
      pages: [page('/old-post', { canonical: `${BASE}archive/old-post` })],
    }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/old-post (canonical to /archive/old-post but Disallow)');
  });

  it('reports a Disallow conflict even when a noindex page is also listed', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: DISALLOW_PRIVATE,
      sitemap: [`${BASE}private/a`, `${BASE}draft`],
      pages: [page('/draft', { robotsMeta: 'noindex' })],
    }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/private/a');
  });

  it('truncates a long offender list with a "(+N more)" tail', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: DISALLOW_PRIVATE,
      sitemap: ['a', 'b', 'c', 'd', 'e'].map((s) => `${BASE}private/${s}`),
      pages: [page('/')],
    }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('(+2 more)');
  });

  it('keeps the English template and its parameters for translation', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: DISALLOW_PRIVATE,
      sitemap: [`${BASE}private/report`],
      pages: [page('/')],
    }));
    expect(r.messageTemplate).toBe('robots.txt Disallow contradicts an indexing directive: {0}');
    expect(r.messageParams).toEqual(['/private/report (in sitemap but Disallow)']);
  });
});

describe('indexing-conflicts — warn', () => {
  it('warns when a sampled noindex page is listed in the sitemap', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: ALLOW_ALL,
      sitemap: [`${BASE}draft`],
      pages: [page('/draft', { robotsMeta: 'noindex' })],
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/draft');
    expect(r.points).toBe(Math.floor(indexingConflicts.maxPoints / 2));
  });

  it('detects noindex coming from the X-Robots-Tag header', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: ALLOW_ALL,
      sitemap: [`${BASE}hidden`],
      pages: [page('/hidden', { xRobots: 'noindex, nofollow' })],
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/hidden');
  });

  it('treats the "none" directive as noindex', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: ALLOW_ALL,
      sitemap: [`${BASE}hidden`],
      pages: [page('/hidden', { robotsMeta: 'none' })],
    }));
    expect(r.status).toBe('warn');
  });

  it('matches the sitemap entry through trailing-slash normalization', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: ALLOW_ALL,
      sitemap: [`${BASE}draft/`],
      pages: [page('/draft', { robotsMeta: 'noindex' })],
    }));
    expect(r.status).toBe('warn');
  });

  it('does not warn on nofollow alone', async () => {
    const r = await indexingConflicts.run(siteCtx({
      robots: ALLOW_ALL,
      sitemap: [`${BASE}draft`],
      pages: [page('/draft', { robotsMeta: 'nofollow' })],
    }));
    expect(r.status).toBe('pass');
  });
});
