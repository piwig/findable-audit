import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.txt': 'text/plain', '.xml': 'application/xml', '.json': 'application/json',
};

/**
 * Standard security-header set sent on EVERY response so the non-skipping
 * security-header checks (x-content-type-options/csp/clickjacking/referrer-policy/
 * permissions-policy) pass on well-configured fixtures (spec §3.8 / Batch 6b).
 */
const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'",
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), camera=(), microphone=()',
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
      let status = 200;
      try {
        body = await fs.readFile(file);
      } catch (err) {
        if (opts.spaFallback) {
          file = path.join(dir, 'index.html');
          body = await fs.readFile(file);
        } else {
          // If the fixture ships a 404.html, serve it WITH a real 404 status
          // (so soft-404 sees the right status and custom-404 sees a real body).
          // Otherwise fall through to the bare text/plain 404 below.
          const custom = path.join(dir, '404.html');
          body = await fs.readFile(custom); // throws -> bare 404 in the catch
          file = custom;
          status = 404;
        }
      }
      const type = MIME[path.extname(file)] ?? 'application/octet-stream';
      const isText = type.startsWith('text/') || type.includes('xml');
      if (isText) {
        // Allow fixtures to reference the (dynamic) test server origin.
        body = Buffer.from(body.toString('utf8').replaceAll('{{ORIGIN}}', origin));
      }
      const headers: Record<string, string> = { ...SECURITY_HEADERS, 'content-type': type };
      // Compress text responses (spec §3.6 text-compression) so real fixtures exercise the
      // crawler/native-fetch's transparent gzip decoding, same as a well-configured server.
      if (isText) {
        body = zlib.gzipSync(body);
        headers['content-encoding'] = 'gzip';
      }
      res.writeHead(status, headers);
      res.end(body);
    } catch {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain' });
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
