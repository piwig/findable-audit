// Modern transport probe (#22) — the one connection an audit opens outside the crawl.
//
// WHY IT EXISTS. The crawl runs on undici's `fetch`, which speaks HTTP/1.1 and exposes
// nothing about the transport underneath: no negotiated protocol, no TLS version, no
// cipher. ALPN settles the protocol during the TLS handshake, so a single `tls.connect`
// answers "h2 or http/1.1?", "which TLS version?" and "which cipher?" at once — without
// sending a single HTTP request. `node:http2` would only stack an HTTP/2 session on top
// of the very same handshake and tell us nothing more, so it is not used.
//
// WHAT IT DELIBERATELY DOES NOT DO.
//
// - **HTTP/3 / QUIC.** Detecting QUIC means speaking QUIC, and Node 20/22 ship no QUIC
//   client (`node:quic` landed later, experimental and flagged). An `Alt-Svc: h3=":443"`
//   header is an *advertisement* a server may publish whether or not h3 actually answers,
//   so it is reported as an unverified claim and never graded. Guessing here would be
//   exactly the "approximate detection" this tool refuses to sell as a measurement.
// - **The server's full protocol/version matrix.** One connection reports what a modern
//   client negotiates, not everything the server would still accept. Enumerating that
//   needs one handshake per version, which is not a cost an audit gets to spend on
//   someone else's server.
//
// SAFETY. The probe resolves the host itself and refuses every address `isBlockedAddress`
// rejects (the single SSRF source of truth in ../ssrf.ts — there is no second validator
// here), then pins the socket to the validated IP so nothing can re-resolve it to an
// internal address between the check and the connect. It is refused unconditionally, not
// only when the crawler's `blockPrivateHosts` is on: an extra capability opening extra
// sockets is the wrong place to be permissive.
//
// FAILURE. Every outcome that is not a completed handshake is a typed reason, never an
// exception and never a failing verdict — a firewalled CI runner, a blocked port or a
// server that accepts and stalls all end as `skip`.

import net from 'node:net';
import dns from 'node:dns';
import tls from 'node:tls';
import { isBlockedAddress } from '../ssrf.js';

/** What one completed handshake told us. Facts, all of them observed on the wire. */
export interface TransportProbe {
  /**
   * The protocol the server picked out of `['h2', 'http/1.1']`, or `''` when it
   * answered the ALPN extension with nothing (the connection then falls back to
   * HTTP/1.1).
   */
  alpnProtocol: string;
  /** Negotiated TLS version, as OpenSSL names it: 'TLSv1.3', 'TLSv1.2', … ('' if unreported). */
  tlsVersion: string;
  /** Negotiated cipher suite: the IANA name when the socket exposes one, else OpenSSL's. */
  cipher: string;
}

/** Why no handshake happened. Each maps to its own reader-facing skip message. */
export type TransportSkipReason =
  /** The audited origin is plain HTTP: there is no TLS layer to negotiate anything on. */
  | 'not-https'
  /** The origin answers on a port this probe does not open connections to. */
  | 'blocked-port'
  /** The origin resolves to a private/reserved address — the SSRF guard refused it. */
  | 'blocked-address'
  /** The hostname did not resolve. */
  | 'dns'
  /** Connect, handshake or timeout failure — including a runner with no outbound network. */
  | 'handshake';

export type TransportResult =
  | { ok: true; probe: TransportProbe }
  | { ok: false; reason: TransportSkipReason };

/**
 * Short and strict on purpose: this runs alongside the crawl, and an origin that has
 * not completed a TLS handshake in four seconds is telling us something we can report
 * as "not measurable" without holding the audit up any longer.
 */
export const PROBE_TIMEOUT_MS = 4_000;

interface ResolvedAddress { address: string; family: number; }

/** Default policy: the scheme-default port, or an explicit 443. */
function defaultAllowedPort(port: string): boolean {
  return port === '' || port === '443';
}

export interface ProbeOptions {
  /** Handshake deadline in ms (default `PROBE_TIMEOUT_MS`). */
  timeoutMs?: number;
  // --- Test seams (default to the real implementations), mirroring Crawler's. They
  //     exist so the probe can be exercised against a loopback TLS server without the
  //     real address/port rules — which are precisely what would reject 127.0.0.1 —
  //     having to be weakened in shipped code. Never set in production. ---
  lookup?: (host: string) => Promise<ResolvedAddress[]>;
  isBlocked?: (ip: string) => boolean;
  allowPort?: (port: string) => boolean;
  /** Extra trust anchor for a test server's self-signed certificate. */
  ca?: string | string[];
}

/**
 * Open ONE ALPN connection to `target`'s origin and report what was negotiated.
 *
 * Never throws and never leaves a socket behind: every path clears its timer, drops its
 * listeners and destroys the socket before resolving. (`process.exitCode` — never
 * `process.exit` — is what makes that matter: a socket in flight at exit is the Windows
 * crash this codebase keeps away from.)
 */
export async function probeTransport(target: URL, opts: ProbeOptions = {}): Promise<TransportResult> {
  if (target.protocol !== 'https:') return { ok: false, reason: 'not-https' };

  const allowPort = opts.allowPort ?? defaultAllowedPort;
  if (!allowPort(target.port)) return { ok: false, reason: 'blocked-port' };

  const rawHost = target.hostname;
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  const isBlocked = opts.isBlocked ?? isBlockedAddress;

  const literal = net.isIP(host);
  let addrs: ResolvedAddress[];
  if (literal !== 0) {
    addrs = [{ address: host, family: literal }];
  } else {
    try {
      addrs = opts.lookup ? await opts.lookup(host) : await dns.promises.lookup(host, { all: true });
    } catch {
      return { ok: false, reason: 'dns' };
    }
  }
  if (!addrs || addrs.length === 0) return { ok: false, reason: 'dns' };
  // EVERY resolved address must be acceptable, not just the one we connect to: a host
  // that also answers on an internal address is refused outright.
  for (const a of addrs) if (isBlocked(a.address)) return { ok: false, reason: 'blocked-address' };

  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const port = Number(target.port || '443');

  return new Promise<TransportResult>((resolve) => {
    let settled = false;
    let socket: tls.TLSSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: TransportResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
      }
      resolve(result);
    };

    timer = setTimeout(() => finish({ ok: false, reason: 'handshake' }), timeoutMs);
    // A pending probe must never be the reason a process stays alive.
    timer.unref?.();

    try {
      socket = tls.connect({
        host: addrs[0].address, // pinned: no second DNS resolution at connect time
        port,
        // SNI + certificate identity follow the URL's hostname, so pinning the IP does
        // not weaken TLS. An IP literal gets no SNI: RFC 6066 forbids it there.
        servername: literal === 0 ? host : undefined,
        ALPNProtocols: ['h2', 'http/1.1'],
        // Certificate validation stays ON. The crawl already fetched this origin over
        // https, so a valid chain is a given; turning it off would only let the probe
        // report a transport no real client would accept.
        rejectUnauthorized: true,
        ...(opts.ca ? { ca: opts.ca } : {}),
      });
    } catch {
      finish({ ok: false, reason: 'handshake' });
      return;
    }

    socket.setTimeout(timeoutMs, () => finish({ ok: false, reason: 'handshake' }));
    socket.once('secureConnect', () => {
      const cipher = socket?.getCipher();
      finish({
        ok: true,
        probe: {
          alpnProtocol: typeof socket?.alpnProtocol === 'string' ? socket.alpnProtocol : '',
          tlsVersion: socket?.getProtocol() ?? '',
          cipher: cipher?.standardName || cipher?.name || '',
        },
      });
    });
    socket.once('error', () => finish({ ok: false, reason: 'handshake' }));
    // A server that accepts the TCP connection and hangs up mid-handshake resolves here.
    socket.once('close', () => finish({ ok: false, reason: 'handshake' }));
  });
}
