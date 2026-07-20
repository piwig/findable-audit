import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import { Crawler } from '../src/crawler.js';
import { hreflang } from '../src/checks/links.js';

// The guard rejects real loopback IPs and non-80/443 ports, but every test
// server here is on loopback:<ephemeral-port>. To exercise the guard's redirect
// loop / hreflang path / abort against such servers, two seams are injected:
//   - isBlocked: () => false   -> neutralise the loopback IP block, so we can
//                                 actually reach 127.0.0.1 test servers, and
//   - allowPort: <predicate>   -> stand in for the block decision, per port.
// The REAL isBlockedAddress is covered by ssrf.test.ts and by the
// "real guard blocks loopback end-to-end" test below (no seams).

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

async function listen(server: http.Server): Promise<{ url: string; port: string }> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { url: `http://127.0.0.1:${port}/`, port: String(port) };
}

describe('crawler SSRF guard (blockPrivateHosts)', () => {
  it('(real guard) blocks a loopback target end-to-end, but allows it when OFF', async () => {
    const srv = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('reached');
    }));
    // Guard ON, no seams: real isBlockedAddress(127.0.0.1) + real port policy block it.
    const guarded = new Crawler(srv.url, 2000, undefined, { blockPrivateHosts: true });
    expect(await guarded.fetch('/')).toBeNull();
    // Guard OFF: same fetch succeeds (proves the guard is what blocked it).
    const open = new Crawler(srv.url, 2000);
    expect((await open.fetch('/'))?.status).toBe(200);
  });

  it('(a) does NOT follow a redirect to a blocked target', async () => {
    let targetHits = 0;
    const target = await listen(http.createServer((_req, res) => {
      targetHits++;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('SHOULD NOT BE REACHED');
    }));
    const entry = await listen(http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target.port}/` });
      res.end();
    }));
    // Allow only the entry port; the redirect target's port is "blocked".
    const crawler = new Crawler(entry.url, 2000, undefined, {
      blockPrivateHosts: true,
      isBlocked: () => false,
      allowPort: (p) => p === entry.port,
    });
    const res = await crawler.fetch('/');
    expect(res).toBeNull(); // redirect refused -> unreachable
    expect(targetHits).toBe(0); // the internal target was never contacted
  });

  it('follows a redirect to an ALLOWED target (control for (a))', async () => {
    const target = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('final-body');
    }));
    const entry = await listen(http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target.port}/` });
      res.end();
    }));
    const crawler = new Crawler(entry.url, 2000, undefined, {
      blockPrivateHosts: true,
      isBlocked: () => false,
      allowPort: () => true, // both hops allowed
    });
    const res = await crawler.fetch('/');
    expect(res?.status).toBe(200);
    expect(res?.body).toBe('final-body');
    expect(res?.finalUrl).toBe(`http://127.0.0.1:${target.port}/`);
  });

  it('(b) does NOT fetch an hreflang alternate on a blocked host', async () => {
    let altHits = 0;
    const alt = await listen(http.createServer((_req, res) => {
      altHits++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<link rel="alternate" hreflang="en" href="/">');
    }));
    const mainHtml = (altPort: string) => `<!doctype html><html><head>
      <link rel="alternate" hreflang="en" href="/">
      <link rel="alternate" hreflang="fr" href="http://127.0.0.1:${altPort}/fr">
      </head><body>hi</body></html>`;
    const main = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(mainHtml(alt.port));
    }));

    // Guard ON: allow the main port, block the alternate's port.
    const guarded = new Crawler(main.url, 2000, undefined, {
      blockPrivateHosts: true,
      isBlocked: () => false,
      allowPort: (p) => p === main.port,
    });
    const result = await hreflang.run(guarded);
    expect(result.status).toBe('fail'); // blocked alternate counts as offender
    expect(altHits).toBe(0); // the alternate host was never fetched

    // Contrast: with the guard OFF the same alternate IS fetched.
    const open = new Crawler(main.url, 2000);
    await hreflang.run(open);
    expect(altHits).toBeGreaterThan(0);
  });

  it('(c) with the guard OFF, loopback fixtures behave normally', async () => {
    const srv = await listen(http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ok ${req.url}`);
    }));
    const crawler = new Crawler(srv.url, 2000); // guard OFF (default)
    const res = await crawler.fetch('/robots.txt');
    expect(res?.status).toBe(200);
    expect(res?.body).toContain('ok /robots.txt');
  });

  it('(d) an abort signal cancels an in-flight slow fetch', async () => {
    const slow = await listen(http.createServer((_req, _res) => {
      /* never respond: hold the request open until the client aborts */
    }));
    const ac = new AbortController();
    const crawler = new Crawler(slow.url, 10_000, undefined, { signal: ac.signal });
    const started = Date.now();
    const p = crawler.fetch('/');
    setTimeout(() => ac.abort(), 50);
    const res = await p;
    expect(res).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000); // aborted, not waiting 10s
  });

  it('guarded fetch decompresses gzip response bodies', async () => {
    const original = '<!doctype html><html><head><title>gz</title></head><body>compressed</body></html>';
    const gz = zlib.gzipSync(Buffer.from(original, 'utf8'));
    const srv = await listen(http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
      res.end(gz);
    }));
    const crawler = new Crawler(srv.url, 2000, undefined, {
      blockPrivateHosts: true,
      isBlocked: () => false,
      allowPort: () => true,
    });
    const res = await crawler.fetch('/');
    expect(res?.status).toBe(200);
    expect(res?.body).toBe(original); // gzip transparently decoded
  });
});
