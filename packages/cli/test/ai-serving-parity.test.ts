import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import type { CrawlContext } from '../src/types.js';
import { stubCtx } from './helpers/stub.js';
import { Crawler } from '../src/crawler.js';
import { aiServingParity } from '../src/checks/ai-access.js';

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${port}`;
}

const MAIN_TEXT = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';

function homeHtml(title: string, extra = ''): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><header>nav</header><main><p>${MAIN_TEXT}</p></main>${extra}<footer>f</footer></body></html>`;
}

describe('ai-serving-parity', () => {
  it('(a) passes when AI and mobile crawlers get an identical document', async () => {
    const url = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml('Home'));
    }));
    const crawler = new Crawler(url);
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('pass');
  });

  it('(b) fails when GPTBot gets a 403 while the default UA gets 200 (edge block, no accusation)', async () => {
    const url = await listen(http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      if (ua.includes('GPTBot')) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('forbidden');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml('Home'));
    }));
    const crawler = new Crawler(url);
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/edge/i);
    expect(r.message).not.toMatch(/deliberately|malicious|intentionally/i);
  });

  it('(c) warns when the AI UA gets a body 30%+ smaller than the default UA', async () => {
    const filler = `<div class="widgets">${'x'.repeat(4000)}</div>`;
    const url = await listen(http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      const isGptBot = ua.includes('GPTBot');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml('Home', isGptBot ? '' : filler));
    }));
    const crawler = new Crawler(url);
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/smaller/i);
  });

  it('(d) warns when the AI UA gets a different <title> than the default UA', async () => {
    const url = await listen(http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      const isGptBot = ua.includes('GPTBot');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml(isGptBot ? 'Untitled' : 'Home — Example Site'));
    }));
    const crawler = new Crawler(url);
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/title/i);
  });

  it('(e) skips when ctx has no fetchWithUA capability', async () => {
    const c = stubCtx({
      '/': { contentType: 'text/html', body: homeHtml('Home') },
    });
    expect(c.fetchWithUA).toBeUndefined();
    const r = await aiServingParity.run(c);
    expect(r.status).toBe('skip');
  });

  it('(f) skips when the default-UA homepage itself is unreachable (never probes)', async () => {
    let uaCalls = 0;
    const ctx: CrawlContext = {
      baseUrl: new URL('http://stub.example/'),
      async fetch() { return null; },
      async fetchWithUA() { uaCalls += 1; return null; },
    };
    const r = await aiServingParity.run(ctx);
    expect(r.status).toBe('skip');
    expect(uaCalls).toBe(0);
  });

  it('(h) retries a transient 5xx for an AI UA and warns (not fails) when the retry recovers', async () => {
    let gptHits = 0;
    const url = await listen(http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      if (ua.includes('GPTBot')) {
        gptHits += 1;
        if (gptHits === 1) { res.writeHead(503, { 'content-type': 'text/plain' }); res.end('busy'); return; }
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml('Home'));
    }));
    const crawler = new Crawler(url);
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/transient/i);
    expect(gptHits).toBe(2); // one failed probe + exactly one retry
  });

  it('(i) keeps a reproduced AI-UA failure as fail when the retry also fails', async () => {
    const url = await listen(http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      if (ua.includes('GPTBot')) { res.writeHead(503, { 'content-type': 'text/plain' }); res.end('busy'); return; }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml('Home'));
    }));
    const crawler = new Crawler(url);
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/edge/i);
    expect(r.message).not.toMatch(/transient/i);
  });

  it('(j) warns (not fails) and does not accuse AI blocking when only the mobile UA is blocked', async () => {
    const url = await listen(http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      if (ua.includes('iPhone')) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return; }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml('Home'));
    }));
    const crawler = new Crawler(url);
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/mobile/i);
    expect(r.message).not.toMatch(/AI crawlers appear blocked/i);
  });

  it('(k) probes a sampled page INCLUDING its query string, not just the pathname (finding #5)', async () => {
    const gptProbed: string[] = [];
    const url = await listen(http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      if (ua.includes('GPTBot')) gptProbed.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml('Home'));
    }));
    const crawler = new Crawler(url);
    const home = await crawler.fetch('/');
    const search = await crawler.fetch('/search?q=bread');
    crawler.sample = { pages: [home!, search!], source: 'links' };
    await aiServingParity.run(crawler);
    expect(gptProbed).toContain('/search?q=bread'); // full path+query, not '/search'
  });

  it('(g) stays within budget: <= 5 extra fetches (home x3 UAs + 2 pages x GPTBot)', async () => {
    const requests: Array<{ path: string; ua: string }> = [];
    const server = http.createServer((req, res) => {
      const p = (req.url ?? '/').split('?')[0];
      requests.push({ path: p, ua: req.headers['user-agent'] ?? '' });
      if (!['/', '/page-a', '/page-b'].includes(p)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(homeHtml(p === '/' ? 'Home' : p));
    });
    const url = await listen(server);
    const crawler = new Crawler(url);
    const home = await crawler.fetch('/');
    const pageA = await crawler.fetch('/page-a');
    const pageB = await crawler.fetch('/page-b');
    crawler.sample = { pages: [home!, pageA!, pageB!], source: 'links' };

    const before = requests.length;
    const r = await aiServingParity.run(crawler);
    expect(r.status).toBe('pass'); // identical content regardless of UA
    expect(requests.length - before).toBeLessThanOrEqual(5);
  });
});
