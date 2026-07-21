import { describe, it, expect } from 'vitest';
import { stubCtx } from '../helpers/stub.js';
import { crawlableNav } from '../../src/checks/technical-seo.js';

const page = (body: string) =>
  stubCtx({ '/': { contentType: 'text/html', body: `<html><body>${body}</body></html>` } });

describe('crawlable-nav', () => {
  it('passes when navigation uses real hrefs', async () => {
    const r = await crawlableNav.run(page('<a href="/a">A</a><a href="/b">B</a><a href="https://x.com">X</a>'));
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/without JavaScript/);
  });

  it('fails when most navigation needs JavaScript', async () => {
    // 3 JS-only (#, javascript:, #) / 4 total = 75% > 50%
    const r = await crawlableNav.run(page(
      '<a href="#">A</a><a href="javascript:go()">B</a><a href="#">C</a><a href="/real">D</a>'));
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/need JavaScript/);
  });

  it('does not count href-less anchor targets (<a id> / <a name>) as JS-only', async () => {
    // named/scroll targets are link destinations, not navigation — a page full of
    // them next to a couple of real links must still pass.
    const r = await crawlableNav.run(page(
      '<a id="top"></a><a name="section"></a><a href="/a">A</a><a href="/b">B</a>'));
    expect(r.status).toBe('pass');
  });

  it('warns at a moderate JS-only ratio', async () => {
    // 2 JS-only / 6 total = 33% (>20%, <=50%)
    const r = await crawlableNav.run(page(
      '<a href="/a">1</a><a href="/b">2</a><a href="/c">3</a><a href="/d">4</a><a href="#">5</a><a href="javascript:x()">6</a>'));
    expect(r.status).toBe('warn');
  });

  it('ignores in-page #section fragments (not counted as JS-only navigation)', async () => {
    const r = await crawlableNav.run(page('<a href="/a">A</a><a href="#intro">Jump</a><a href="#faq">FAQ</a>'));
    expect(r.status).toBe('pass'); // only /a is a nav anchor; fragments are ignored
  });

  it('warns when there are no crawlable links at all', async () => {
    const r = await crawlableNav.run(page('<div>content but no links</div>'));
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/no crawlable/i);
  });
});
