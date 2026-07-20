import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { parseRobots, isBlocked } from '../../src/robots.js';
import { robotsExists, aiCrawlersAllowed, homepageOk } from '../../src/checks/ai-access.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('parseRobots', () => {
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
});

describe('ai-access checks', () => {
  it('robots-exists passes when robots.txt is 200', async () => {
    const c = await ctx('mini');
    expect((await robotsExists.run(c)).status).toBe('pass');
  });
  it('ai-crawlers-allowed fails when bots are blocked', async () => {
    const c = await ctx('blocked-ai');
    const r = await aiCrawlersAllowed.run(c);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('GPTBot');
  });
  it('homepage-ok fails on 404 homepage', async () => {
    const c = await ctx('mini'); // mini has no index.html
    expect((await homepageOk.run(c)).status).toBe('fail');
  });
  it('homepage-ok passes on 200 homepage', async () => {
    const c = await ctx('blocked-ai');
    expect((await homepageOk.run(c)).status).toBe('pass');
  });
});
