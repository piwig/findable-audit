import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import { parseRobots, isBlocked } from '../../src/robots.js';
import { robotsExists, aiCrawlersAllowed, homepageOk, robotsDirectives } from '../../src/checks/ai-access.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('parseRobots / isBlocked (RFC 9309)', () => {
  it('groups consecutive user-agents', () => {
    const g = parseRobots('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow:');
    expect(isBlocked(g, 'GPTBot')).toBe(true);
    expect(isBlocked(g, 'ClaudeBot')).toBe(true);
    expect(isBlocked(g, 'PerplexityBot')).toBe(false);
  });
  it('falls back to *', () => {
    const g = parseRobots('User-agent: *\nDisallow: /');
    expect(isBlocked(g, 'GPTBot')).toBe(true);
  });
  it('treats "Disallow: /*" as blocking everything', () => {
    const g = parseRobots('User-agent: *\nDisallow: /*');
    expect(isBlocked(g, 'GPTBot', '/')).toBe(true);
    expect(isBlocked(g, 'GPTBot', '/page')).toBe(true);
  });
  it('applies longest-match between Allow and Disallow', () => {
    const g = parseRobots('User-agent: *\nDisallow: /\nAllow: /public');
    expect(isBlocked(g, 'GPTBot', '/')).toBe(true);
    expect(isBlocked(g, 'GPTBot', '/public/page')).toBe(false);
    expect(isBlocked(g, 'GPTBot', '/private')).toBe(true);
  });
  it('Allow wins on equal-length tie', () => {
    const g = parseRobots('User-agent: *\nDisallow: /page\nAllow: /page');
    expect(isBlocked(g, 'GPTBot', '/page')).toBe(false);
  });
  it('honours the $ end anchor', () => {
    const g = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isBlocked(g, 'GPTBot', '/doc.pdf')).toBe(true);
    expect(isBlocked(g, 'GPTBot', '/doc.pdf.html')).toBe(false);
  });
  it('matches the product token of "User-agent: GPTBot/1.0" case-insensitively', () => {
    const g = parseRobots('User-agent: GPTBot/1.0\nDisallow: /');
    expect(isBlocked(g, 'gptbot')).toBe(true);
    expect(isBlocked(g, 'GPTBot')).toBe(true);
    expect(isBlocked(g, 'ClaudeBot')).toBe(false);
  });
  it('escapes regex metacharacters in rule paths', () => {
    const g = parseRobots('User-agent: *\nDisallow: /a+b(c)');
    expect(isBlocked(g, 'GPTBot', '/a+b(c)')).toBe(true);
    expect(isBlocked(g, 'GPTBot', '/aab')).toBe(false);
  });
});

describe('ai-access checks', () => {
  it('robots-exists passes when robots.txt is 200 text/plain', async () => {
    const c = await ctx('mini');
    expect((await robotsExists.run(c)).status).toBe('pass');
  });
  it('robots-exists warns (not fails) on 404', async () => {
    const c = await ctx('llm-good'); // llm-good has no robots.txt
    expect((await robotsExists.run(c)).status).toBe('warn');
  });
  it('robots-exists warns on an HTML SPA fallback', async () => {
    const srv = await serveFixture(path.join(fixtures, 'spa-fallback'), { spaFallback: true });
    closers.push(srv.close);
    const r = await robotsExists.run(new Crawler(srv.url));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('text/html');
  });
  it('ai-crawlers-allowed fails when a critical bot is blocked', async () => {
    const c = await ctx('blocked-ai');
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('GPTBot');
  });
  it('ai-crawlers-allowed warns when only extended bots are blocked', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: Bytespider\nUser-agent: CCBot\nDisallow: /\n' },
    });
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Bytespider');
  });
  it('homepage-ok fails on 404 homepage', async () => {
    const c = await ctx('mini'); // mini has no index.html
    expect((await homepageOk.run(c)).status).toBe('fail');
  });
  it('homepage-ok passes on 200 homepage', async () => {
    const c = await ctx('blocked-ai');
    expect((await homepageOk.run(c)).status).toBe('pass');
  });
  it('robots-directives warns on meta robots noindex', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html><head><meta name="robots" content="noindex, nofollow"></head></html>' },
    });
    expect((await robotsDirectives.run(c)).status).toBe('warn');
  });
  it('robots-directives warns on X-Robots-Tag noai header', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>', headers: { 'x-robots-tag': 'noai' } },
    });
    expect((await robotsDirectives.run(c)).status).toBe('warn');
  });
  it('robots-directives passes on a clean homepage', async () => {
    const c = await ctx('blocked-ai');
    expect((await robotsDirectives.run(c)).status).toBe('pass');
  });
});
