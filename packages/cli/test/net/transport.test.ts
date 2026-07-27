// The transport probe against real sockets on the loopback interface — the house style:
// a real server, never a mock, because the whole point of this module is what a real
// handshake reports.
import { describe, it, expect, afterAll } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { probeTransport } from '../../src/net/transport.js';
import { makeSelfSigned } from '../helpers/selfsigned.js';

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

/** A raw TCP server that counts connections and hands each one to `onConnection`. */
async function tcpServer(onConnection: (socket: net.Socket) => void): Promise<{ port: number; connections: () => number }> {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    onConnection(socket);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { server.close(() => r()); }));
  const address = server.address();
  return { port: typeof address === 'object' && address ? address.port : 0, connections: () => connections };
}

/** A real TLS server offering `alpn`, with a certificate generated for this run. */
async function tlsServer(alpn: string[], identity: { key: string; cert: string }): Promise<number> {
  const server = tls.createServer({ key: identity.key, cert: identity.cert, ALPNProtocols: alpn }, (socket) => {
    socket.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { server.close(() => r()); }));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

/** Loopback-friendly seams: the real rules exist precisely to reject 127.0.0.1. */
const LOOPBACK_SEAMS = { allowPort: () => true, isBlocked: () => false };

describe('probeTransport — what it refuses to do', () => {
  it('never opens a socket for a plain-HTTP origin', async () => {
    const server = await tcpServer((s) => s.destroy());
    const result = await probeTransport(new URL(`http://127.0.0.1:${server.port}/`), LOOPBACK_SEAMS);
    expect(result).toEqual({ ok: false, reason: 'not-https' });
    expect(server.connections()).toBe(0);
  });

  it('refuses a private address through the shared SSRF guard, without connecting', async () => {
    const server = await tcpServer((s) => s.destroy());
    // Default isBlocked = the real isBlockedAddress: 127.0.0.1 is loopback.
    const result = await probeTransport(new URL(`https://127.0.0.1:${server.port}/`), { allowPort: () => true });
    expect(result).toEqual({ ok: false, reason: 'blocked-address' });
    expect(server.connections()).toBe(0);
  });

  it('refuses a non-standard port before resolving anything', async () => {
    const server = await tcpServer((s) => s.destroy());
    const result = await probeTransport(new URL(`https://127.0.0.1:${server.port}/`), { isBlocked: () => false });
    expect(result).toEqual({ ok: false, reason: 'blocked-port' });
    expect(server.connections()).toBe(0);
  });

  it('reports a hostname that does not resolve', async () => {
    const result = await probeTransport(new URL('https://example.invalid/'), {
      ...LOOPBACK_SEAMS,
      lookup: async () => { throw new Error('ENOTFOUND'); },
    });
    expect(result).toEqual({ ok: false, reason: 'dns' });
  });

  it('reports an empty resolution as a DNS failure', async () => {
    const result = await probeTransport(new URL('https://example.invalid/'), {
      ...LOOPBACK_SEAMS,
      lookup: async () => [],
    });
    expect(result).toEqual({ ok: false, reason: 'dns' });
  });
});

describe('probeTransport — when the handshake cannot complete', () => {
  it('skips (never fails) when the origin hangs up mid-handshake', async () => {
    const server = await tcpServer((socket) => socket.destroy());
    const result = await probeTransport(new URL(`https://127.0.0.1:${server.port}/`), LOOPBACK_SEAMS);
    expect(result).toEqual({ ok: false, reason: 'handshake' });
    expect(server.connections()).toBe(1);
  });

  it('gives up on its own deadline when the origin accepts and stalls', async () => {
    const held: net.Socket[] = [];
    const server = await tcpServer((socket) => { held.push(socket); }); // never answers
    const startedAt = Date.now();
    const result = await probeTransport(new URL(`https://127.0.0.1:${server.port}/`), { ...LOOPBACK_SEAMS, timeoutMs: 300 });
    const elapsed = Date.now() - startedAt;
    expect(result).toEqual({ ok: false, reason: 'handshake' });
    expect(elapsed).toBeLessThan(3000); // the deadline is the probe's, not the server's
    for (const socket of held) socket.destroy();
  });

  it('skips when nothing is listening at all', async () => {
    const result = await probeTransport(new URL('https://127.0.0.1:1/'), { ...LOOPBACK_SEAMS, timeoutMs: 1000 });
    expect(result).toEqual({ ok: false, reason: 'handshake' });
  });
});

// The happy path needs a certificate. It is generated in-process (see helpers/selfsigned)
// so no private key lives in this repository; an environment that cannot produce one
// skips these rather than failing them.
const identity = makeSelfSigned();
/**
 * `localhost` is what the certificate is issued for (SNI + identity), but it resolves to
 * ::1 as readily as to 127.0.0.1 and the test server only listens on the latter — so the
 * resolution is pinned, exactly as the probe pins it in production.
 */
const TLS_SEAMS = {
  ...LOOPBACK_SEAMS,
  lookup: async (): Promise<Array<{ address: string; family: number }>> => [{ address: '127.0.0.1', family: 4 }],
};

describe.skipIf(identity === null)('probeTransport — a completed handshake', () => {
  it('reports h2, the TLS version and the cipher from one connection', async () => {
    const port = await tlsServer(['h2', 'http/1.1'], identity!);
    const result = await probeTransport(new URL(`https://${identity!.host}:${port}/`), {
      ...TLS_SEAMS, ca: identity!.cert,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.probe.alpnProtocol).toBe('h2');
    expect(result.probe.tlsVersion).toMatch(/^TLSv1\.[23]$/);
    expect(result.probe.cipher.length).toBeGreaterThan(0);
  });

  it('reports http/1.1 when the origin offers nothing better', async () => {
    const port = await tlsServer(['http/1.1'], identity!);
    const result = await probeTransport(new URL(`https://${identity!.host}:${port}/`), {
      ...TLS_SEAMS, ca: identity!.cert,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.probe.alpnProtocol).toBe('http/1.1');
  });

  it('keeps certificate validation on: an untrusted origin is a skip, not a verdict', async () => {
    const port = await tlsServer(['h2'], identity!);
    // Same server, no trust anchor handed to the probe.
    const result = await probeTransport(new URL(`https://${identity!.host}:${port}/`), TLS_SEAMS);
    expect(result).toEqual({ ok: false, reason: 'handshake' });
  });
});
