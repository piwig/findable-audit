import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import {
  parseRobots, isBlocked, robotsWellformed, robotsDirectiveSet, directiveValue, hasDirectiveToken,
  AI_BOTS, TRAINING_BOTS, CITATION_BOTS,
} from '../../src/robots.js';
import type { FetchedResource } from '../../src/types.js';
import {
  robotsExists, robotsWellformedCheck, searchCrawlersAllowed, aiCrawlersAllowed,
  homepageOk, robotsDirectives, cloudflareAiDefaults, cloudflareClock,
} from '../../src/checks/ai-access.js';

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

describe('robotsWellformed (RFC 9309 hygiene)', () => {
  const asRes = (body: string, contentType = 'text/plain') =>
    ({ status: 200, ok: true, body, contentType, finalUrl: 'http://x/robots.txt', headers: {} });

  it('passes a clean file with only known directives', () => {
    const r = robotsWellformed(asRes('User-agent: *\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n'));
    expect(r.status).toBe('pass');
  });
  it('warns on Disallow before the first User-agent', () => {
    const r = robotsWellformed(asRes('Disallow: /private\nUser-agent: *\nAllow: /\n'));
    expect(r.status).toBe('warn');
    expect(r.reason).toContain('before the first User-agent');
  });
  it('warns on an unknown directive', () => {
    const r = robotsWellformed(asRes('User-agent: *\nDisallow:\nNoindex: /secret\n'));
    expect(r.status).toBe('warn');
    expect(r.reason).toContain('unknown directive');
  });
  it('fails when served as an HTML error page', () => {
    const r = robotsWellformed(asRes('<html><body>404 Not Found</body></html>', 'text/html'));
    expect(r.status).toBe('fail');
    expect(r.reason).toContain('content-type');
  });
  it('fails on garbled content with no recognizable directives', () => {
    const r = robotsWellformed(asRes('this is not a robots file at all, just prose text.'));
    expect(r.status).toBe('fail');
    expect(r.reason).toContain('garbled');
  });
  it('warns (not fails) on a file of only well-formed unknown directives', () => {
    const r = robotsWellformed(asRes('Noindex: /secret\nCrawl-Budget: 100\n'));
    expect(r.status).toBe('warn');
    expect(r.reason).toContain('unknown directive');
  });
  it('fails when the file exceeds 500KB', () => {
    const huge = 'User-agent: *\nDisallow:\n' + '# padding\n'.repeat(60_000);
    const r = robotsWellformed(asRes(huge));
    expect(r.status).toBe('fail');
    expect(r.reason).toContain('500KB');
  });
});

describe('robots directive tokenizer (space-after-colon and space-separated)', () => {
  const resWith = (headers: Record<string, string>): FetchedResource =>
    ({ status: 200, ok: true, body: '<html></html>', contentType: 'text/html', finalUrl: 'http://x/', headers });

  it('parses "max-snippet: -1" (space after colon) AND an adjacent directive', () => {
    const set = robotsDirectiveSet(resWith({ 'x-robots-tag': 'max-snippet: -1, max-image-preview:none' }));
    expect(directiveValue(set, 'max-snippet')).toBe('-1');
    expect(directiveValue(set, 'max-image-preview')).toBe('none');
  });
  it('still splits space-separated directives like "noindex nofollow"', () => {
    const set = robotsDirectiveSet(resWith({ 'x-robots-tag': 'noindex nofollow' }));
    expect(hasDirectiveToken(set, 'noindex')).toBe(true);
    expect(hasDirectiveToken(set, 'nofollow')).toBe(true);
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
  it('ai-crawlers-allowed fails when a citation-time bot is blocked', async () => {
    const c = await ctx('blocked-ai'); // robots.txt disallows PerplexityBot (citation-time)
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('PerplexityBot');
  });
  it('ai-crawlers-allowed warns when only training-time bots are blocked', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: Bytespider\nUser-agent: CCBot\nDisallow: /\n' },
    });
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Bytespider');
  });
  it('ai-crawlers-allowed fails naming both tiers when training and citation bots are both blocked', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: GPTBot\nUser-agent: PerplexityBot\nDisallow: /\n' },
    });
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('GPTBot');
    expect(r.message).toContain('PerplexityBot');
  });
  it('ai-crawlers-allowed warns (not fails) with no usable robots.txt', async () => {
    const c = await ctx('llm-good');
    expect((await aiCrawlersAllowed.run(c)).status).toBe('warn');
  });
  it('search-crawlers-allowed fails when Googlebot is blocked', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: Googlebot\nDisallow: /\n' },
    });
    const r = await searchCrawlersAllowed.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('Googlebot');
  });
  it('search-crawlers-allowed fails when the wildcard group is disallowed at /', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: *\nDisallow: /\n' },
    });
    const r = await searchCrawlersAllowed.run(c);
    expect(r.status).toBe('fail');
  });
  it('search-crawlers-allowed passes when only a non-search bot is blocked', async () => {
    const c = await ctx('blocked-ai'); // disallows PerplexityBot only; Googlebot/Bingbot/* stay open
    expect((await searchCrawlersAllowed.run(c)).status).toBe('pass');
  });
  it('robots-wellformed passes for a clean robots.txt', async () => {
    const c = await ctx('perfect-site');
    expect((await robotsWellformedCheck.run(c)).status).toBe('pass');
  });
  it('robots-wellformed skips when robots.txt is missing', async () => {
    const c = await ctx('llm-good');
    expect((await robotsWellformedCheck.run(c)).status).toBe('skip');
  });
  it('robots-wellformed warns on an orphan Disallow before the first User-agent', async () => {
    const c = stubCtx({
      '/robots.txt': { body: 'Disallow: /private\nUser-agent: *\nAllow: /\n' },
    });
    const r = await robotsWellformedCheck.run(c);
    expect(r.status).toBe('warn');
  });
  it('robots-wellformed warns on an unknown directive', async () => {
    const c = stubCtx({
      '/robots.txt': { body: 'User-agent: *\nDisallow:\nCrawl-Delay-ish: 5\n' },
    });
    const r = await robotsWellformedCheck.run(c);
    expect(r.status).toBe('warn');
  });
  it('robots-wellformed fails when robots.txt is served as HTML', async () => {
    const c = stubCtx({
      '/robots.txt': { contentType: 'text/html', body: '<html><body>Not Found</body></html>' },
    });
    const r = await robotsWellformedCheck.run(c);
    expect(r.status).toBe('fail');
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

describe('2026 roster (LOT 3 — 28 agents, tiering par intention)', () => {
  it('names at least 27 AI agents with duplicate-free, disjoint tiers', () => {
    expect(AI_BOTS.length).toBeGreaterThanOrEqual(27);
    expect(new Set(AI_BOTS.map((b) => b.toLowerCase())).size).toBe(AI_BOTS.length);
    const training = new Set(TRAINING_BOTS);
    expect(CITATION_BOTS.filter((b) => training.has(b))).toEqual([]);
    expect(AI_BOTS).toEqual([...TRAINING_BOTS, ...CITATION_BOTS]);
  });
  it('ai-crawlers-allowed fails when a NEW citation-time bot (DuckAssistBot) is blocked', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: DuckAssistBot\nDisallow: /\n' },
    });
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('DuckAssistBot');
  });
  it('ai-crawlers-allowed fails when MistralAI-User is blocked via a versioned UA token', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: MistralAI-User/1.0\nDisallow: /\n' },
    });
    expect((await aiCrawlersAllowed.run(c)).status).toBe('fail');
  });
  it('ai-crawlers-allowed warns (not fails) when only NEW training-time bots are blocked', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: Diffbot\nUser-agent: PanguBot\nDisallow: /\n' },
    });
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Diffbot');
    expect(r.message).toContain('PanguBot');
  });
  it('ai-crawlers-allowed calls out Google-Extended specifically when it is blocked (A25)', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: Google-Extended\nDisallow: /\n' },
    });
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Google-Extended');
    expect(r.message).toContain('grounding');
    expect(r.fix).toContain('Gemini');
  });
  it('ai-crawlers-allowed keeps the generic training-time warn when Google-Extended is NOT among blocked bots', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>' },
      '/robots.txt': { body: 'User-agent: Diffbot\nDisallow: /\n' },
    });
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).not.toContain('Google-Extended');
  });
});

describe('cloudflare-ai-defaults', () => {
  const realNow = cloudflareClock.now;
  const BEFORE = Date.UTC(2026, 7, 7);   // 2026-08-07, before the switch
  const AFTER = Date.UTC(2026, 8, 16);   // 2026-09-16, after the switch
  afterAll(() => { cloudflareClock.now = realNow; });

  it('passes when the site is not behind Cloudflare', async () => {
    cloudflareClock.now = () => BEFORE;
    const c = stubCtx({ '/': { contentType: 'text/html', body: '<html></html>', headers: { server: 'nginx' } } });
    const r = await cloudflareAiDefaults.run(c);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('not served via Cloudflare');
  });
  it('skips when the homepage is unreachable', async () => {
    cloudflareClock.now = () => BEFORE;
    const c = stubCtx({});
    const bare: typeof c = { ...c, fetch: async () => null };
    expect((await cloudflareAiDefaults.run(bare)).status).toBe('skip');
  });
  it('warns with the future-dated message before 2026-09-15 behind cf-ray', async () => {
    cloudflareClock.now = () => BEFORE;
    const c = stubCtx({ '/': { contentType: 'text/html', body: '<html></html>', headers: { 'cf-ray': '8f1a2b3c4d5e6f70-CDG' } } });
    const r = await cloudflareAiDefaults.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('become blocked by default on 2026-09-15');
    expect(r.fix).toContain('AI Crawl Control');
  });
  it('warns with the past-dated message after the switch, detected via server header', async () => {
    cloudflareClock.now = () => AFTER;
    const c = stubCtx({ '/': { contentType: 'text/html', body: '<html></html>', headers: { server: 'Cloudflare' } } });
    const r = await cloudflareAiDefaults.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('blocked by default since 2026-09-15');
  });
  it('flags Content Signals in robots.txt behind Cloudflare as non-binding (A33)', async () => {
    cloudflareClock.now = () => BEFORE;
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>', headers: { 'cf-ray': '8f1a2b3c4d5e6f70-CDG' } },
      '/robots.txt': { body: '# Content Signals Policy\nContent-Signal: search=yes, ai-train=no\nUser-agent: *\nDisallow:\n' },
    });
    const r = await cloudflareAiDefaults.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Content Signals');
    expect(r.message).toContain('non-binding');
    expect(r.fix).toContain('AI Crawl Control');
  });
  it('flags Content Signals as non-binding even when the site is not behind Cloudflare', async () => {
    cloudflareClock.now = () => BEFORE;
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>', headers: { server: 'nginx' } },
      '/robots.txt': { body: 'Content-Signal: ai-train=no\nUser-agent: *\nDisallow:\n' },
    });
    const r = await cloudflareAiDefaults.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('non-binding');
  });
  it('still passes off-Cloudflare when robots.txt has no Content Signals', async () => {
    cloudflareClock.now = () => BEFORE;
    const c = stubCtx({
      '/': { contentType: 'text/html', body: '<html></html>', headers: { server: 'nginx' } },
      '/robots.txt': { body: 'User-agent: *\nDisallow:\n' },
    });
    const r = await cloudflareAiDefaults.run(c);
    expect(r.status).toBe('pass');
  });
});
