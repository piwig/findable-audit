import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.txt': 'text/plain', '.xml': 'application/xml', '.json': 'application/json',
};

export interface ServeOptions {
  /** Serve index.html (200 text/html) for any missing path, like a SPA host fallback. */
  spaFallback?: boolean;
}

export async function serveFixture(
  dir: string,
  opts: ServeOptions = {},
): Promise<{ url: string; close(): Promise<void> }> {
  let origin = '';
  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    let file = path.join(dir, rel);
    try {
      let body: Buffer;
      try {
        body = await fs.readFile(file);
      } catch (err) {
        if (!opts.spaFallback) throw err;
        file = path.join(dir, 'index.html');
        body = await fs.readFile(file);
      }
      const type = MIME[path.extname(file)] ?? 'application/octet-stream';
      if (type.startsWith('text/') || type.includes('xml')) {
        // Allow fixtures to reference the (dynamic) test server origin.
        body = Buffer.from(body.toString('utf8').replaceAll('{{ORIGIN}}', origin));
      }
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  origin = `http://127.0.0.1:${port}`;
  return {
    url: origin,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
