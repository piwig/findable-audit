// #61 — the ownership guard around --submit, exercised through the real CLI.
//
// The property under test is a safety one: findable must not notify a search
// engine about a site the caller cannot prove they own. The proof is the
// IndexNow key file hosted on the site itself, so a run whose `indexnow` check
// does not pass must refuse to submit — without touching the network, and
// without turning a good audit into a failed one.
import { test, expect } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>'
  + '<meta name="description" content="fixture"></head><body><h1>Hi</h1><p>content</p></body></html>';

/** Serves a page everywhere, and the key file only when `key` is given. */
async function withSite(key: string | null, fn: (base: string) => Promise<void>) {
  const server = http.createServer((req, res) => {
    if (key !== null && req.url === `/${key}.txt`) {
      res.setHeader('content-type', 'text/plain');
      res.end(key);
      return;
    }
    if ((req.url ?? '').endsWith('.txt')) { res.statusCode = 404; res.end('nope'); return; }
    res.setHeader('content-type', 'text/html');
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as import('node:net').AddressInfo;
  try { await fn(`http://127.0.0.1:${port}/`); } finally { server.close(); }
}

function runCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ status: err ? (((err as NodeJS.ErrnoException).code as number) ?? 1) : 0, stdout, stderr });
    });
  });
}

test('--submit without --indexnow-key is refused before anything runs', async () => {
  const r = await runCli([DIST, 'https://example.com', '--submit']);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/--submit requires --indexnow-key/);
});

test('--submit refuses when the key file is not hosted on the audited site', async () => {
  await withSite(null, async (base) => {
    const r = await runCli([DIST, base, '--indexnow-key', 'notthere', '--submit', '--no-report', '--min-score', '0', '--max-pages', '1']);
    expect(r.stderr).toMatch(/not submitting/i);
    expect(r.stderr).toMatch(/indexnow/i);
    // The refusal is about ownership, not about the audit: exit code unchanged.
    expect(r.status).toBe(0);
    // Nothing was sent: the endpoint is never even named on the happy path text.
    expect(r.stderr).not.toMatch(/accepted by the IndexNow service/);
  });
});

test('a run without --submit never mentions submitting, even with a valid key file', async () => {
  await withSite('goodkey', async (base) => {
    const r = await runCli([DIST, base, '--indexnow-key', 'goodkey', '--no-report', '--min-score', '0', '--max-pages', '1']);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/submitting/i);
  });
});
