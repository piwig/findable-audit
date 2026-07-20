import { describe, it, expect } from 'vitest';
import { aggregate, pagesOf, pathOf } from '../../src/checks/aggregate.js';
import type { CrawlContext, FetchedResource, PageSample } from '../../src/types.js';

const page = (finalUrl: string): FetchedResource =>
  ({ status: 200, ok: true, body: '', contentType: 'text/html', finalUrl, headers: {} });

describe('aggregate', () => {
  it('passes when there are no offenders', () => {
    expect(aggregate(4, [])).toEqual({ status: 'pass', detail: '' });
  });
  it('warns at >= 80% conform', () => {
    expect(aggregate(10, ['/a']).status).toBe('warn'); // 9/10 conform
    expect(aggregate(5, ['/a']).status).toBe('warn'); // 4/5 = 80% conform
  });
  it('fails below the warn ratio and truncates the detail to 3 entries', () => {
    const agg = aggregate(5, ['/a', '/b', '/c', '/d']);
    expect(agg.status).toBe('fail');
    expect(agg.detail).toBe('/a, /b, /c (+1 more)');
  });
});

describe('pathOf', () => {
  it('returns the pathname of finalUrl', () => {
    expect(pathOf(page('http://x.test/a/b.html'))).toBe('/a/b.html');
  });
  it('falls back to "/" on an unparsable finalUrl', () => {
    expect(pathOf(page(''))).toBe('/');
  });
});

describe('pagesOf', () => {
  const home = page('http://x.test/');
  const bare = (): CrawlContext => ({
    baseUrl: new URL('http://x.test/'),
    fetch: async () => home,
  });
  it('returns the sample pages when present', async () => {
    const ctx = bare();
    ctx.sample = { pages: [home, page('http://x.test/a')], source: 'sitemap' } satisfies PageSample;
    expect(await pagesOf(ctx)).toHaveLength(2);
  });
  it('falls back to the homepage without a sample', async () => {
    expect(await pagesOf(bare())).toEqual([home]);
  });
});
