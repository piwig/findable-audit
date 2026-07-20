// SSRF protection for the public URL-audit web app.
//
// This module decides whether a user-supplied URL is safe to fetch from a
// server that sits on a shared VPS behind nginx. The threat is Server-Side
// Request Forgery: a visitor could ask us to "audit" http://127.0.0.1:6379/,
// http://169.254.169.254/ (cloud metadata) or http://10.0.0.5/ and use our
// server as a proxy into private infrastructure.
//
// Two exports:
//   - isBlockedAddress(ip)  -> boolean   (pure, no I/O; the tested core)
//   - assertPublicUrl(raw)  -> URL       (validates scheme/port/creds/host,
//                                          resolves DNS, throws BlockedUrlError)
//
// RESIDUAL RISK (known limitation, future hardening pass):
//   The audited page can issue an HTTP redirect (3xx) to an internal address,
//   and the crawler follows redirects (redirect: 'follow'), so a public host
//   could bounce us to http://169.254.169.254/. We validate the *initial* URL
//   only. Fully closing this needs a custom fetch that re-runs assertPublicUrl
//   on every hop (redirect: 'manual' + per-hop revalidation). Likewise, a host
//   that passes DNS validation here could resolve to a private IP a moment
//   later when the crawler connects (DNS-rebinding / TOCTOU). Both are
//   documented, out of scope for this pass, and should be addressed before
//   this app is exposed to hostile traffic at scale.

import net from 'node:net';
import dns from 'node:dns';

export class BlockedUrlError extends Error {
  /** @param {string} message @param {string} code machine-readable reason */
  constructor(message, code) {
    super(message);
    this.name = 'BlockedUrlError';
    this.code = code;
  }
}

/** Parse a dotted-quad IPv4 string into a uint32, or null if malformed. */
function ipv4ToInt(ip) {
  if (net.isIPv4(ip) !== true) return null;
  const parts = ip.split('.');
  let n = 0;
  for (const p of parts) n = n * 256 + Number(p);
  return n >>> 0;
}

/** True when `ip` (uint32) falls inside base/prefix (CIDR). */
function inCidr4(ip, baseStr, prefix) {
  const base = ipv4ToInt(baseStr);
  if (base === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (base & mask);
}

// IPv4 ranges that must never be reached from the public web app.
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this" network / unspecified (0.0.0.0)
  ['10.0.0.0', 8], // RFC 1918 private
  ['100.64.0.0', 10], // RFC 6598 carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. 169.254.169.254 cloud metadata)
  ['172.16.0.0', 12], // RFC 1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC 1918 private
  ['198.18.0.0', 15], // benchmarking (RFC 2544)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved / future use (incl. 255.255.255.255 broadcast)
];

function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable -> block (defensive default)
  for (const [base, prefix] of BLOCKED_V4) {
    if (inCidr4(n, base, prefix)) return true;
  }
  return false;
}

/**
 * Expand any valid IPv6 literal into its 16 bytes. Handles `::` compression,
 * an embedded IPv4 tail (e.g. `::ffff:192.168.0.1`) and a `%zone` suffix.
 * Returns null when the input cannot be parsed.
 */
function ipv6ToBytes(input) {
  let ip = input.split('%')[0]; // drop zone id

  // Rewrite an embedded IPv4 tail into two hextets so the rest is uniform.
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes('.')) {
    const v4 = ip.slice(lastColon + 1);
    if (net.isIPv4(v4) !== true) return null;
    const o = v4.split('.').map(Number);
    const h1 = ((o[0] << 8) | o[1]).toString(16);
    const h2 = ((o[2] << 8) | o[3]).toString(16);
    ip = ip.slice(0, lastColon + 1) + h1 + ':' + h2;
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  let groups;
  if (halves.length === 1) {
    groups = head;
  } else {
    const tail = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i] === '' ? '0' : groups[i];
    const v = parseInt(g, 16);
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) return null;
    bytes[i * 2] = (v >> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
}

/** True when bytes[start..end) are all zero. */
function zeroRange(bytes, start, end) {
  for (let i = start; i < end; i++) if (bytes[i] !== 0) return false;
  return true;
}

function isBlockedIPv6(ip) {
  const b = ipv6ToBytes(ip);
  if (b === null) return true; // unparseable -> block (defensive default)

  // IPv4-mapped ::ffff:0:0/96  -> evaluate the embedded IPv4 instead.
  if (zeroRange(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // Well-known NAT64 prefix 64:ff9b::/96 -> evaluate embedded IPv4.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeroRange(b, 4, 12)) {
    return isBlockedIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // Deprecated IPv4-compatible ::a.b.c.d (upper 96 bits zero) -> evaluate v4.
  // ::  and ::1 are caught by the explicit checks just below.
  if (zeroRange(b, 0, 12) && !(zeroRange(b, 12, 15) && b[15] <= 1)) {
    return isBlockedIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }

  if (zeroRange(b, 0, 16)) return true; // ::           unspecified
  if (zeroRange(b, 0, 15) && b[15] === 1) return true; // ::1  loopback
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7    unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xff) return true; // ff00::/8    multicast
  return false;
}

/**
 * True when `ip` (a literal IPv4 or IPv6 address string) is one we must not
 * connect to: loopback, private, link-local, unspecified, CGNAT, multicast,
 * reserved, or an internal address hidden inside an IPv6 mapping. Anything
 * that is not a valid IP literal is treated as blocked (defensive default).
 */
export function isBlockedAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedIPv4(ip);
  if (kind === 6) return isBlockedIPv6(ip);
  return true;
}

/**
 * Validate a user-supplied URL and prove it points at a public host.
 *
 * Rejects (throws BlockedUrlError) when: the URL is unparseable; the scheme is
 * not http/https; credentials are embedded (user:pass@); the port is not 80,
 * 443 or the scheme default; the host is localhost / *.localhost / *.local; the
 * host is (or resolves to) any blocked address per isBlockedAddress().
 *
 * @param {string} rawUrl
 * @param {{ lookup?: (host: string, opts: object) => Promise<Array<{address:string,family:number}>> }} [options]
 *        `lookup` is injectable so tests stay hermetic (defaults to dns.promises.lookup).
 * @returns {Promise<URL>} the parsed, validated URL.
 */
export async function assertPublicUrl(rawUrl, options = {}) {
  const lookup = options.lookup ?? ((host, opts) => dns.promises.lookup(host, opts));

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError('That does not look like a valid URL.', 'invalid-url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(
      `Unsupported scheme "${url.protocol.replace(/:$/, '')}". Only http and https are allowed.`,
      'bad-scheme',
    );
  }

  if (url.username !== '' || url.password !== '') {
    throw new BlockedUrlError('URLs with embedded credentials (user:pass@) are not allowed.', 'credentials');
  }

  // Only the default port (empty) or the two standard web ports.
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new BlockedUrlError(`Port ${url.port} is not allowed; only 80 and 443.`, 'bad-port');
  }

  // URL.hostname keeps brackets around IPv6 literals; strip them for net.isIP.
  const rawHost = url.hostname;
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;

  const lowered = host.toLowerCase().replace(/\.$/, ''); // tolerate a trailing FQDN dot
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.local')) {
    throw new BlockedUrlError('Localhost and .local hostnames are not allowed.', 'blocked-host');
  }

  // Literal IP: check it directly, no DNS needed.
  if (net.isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new BlockedUrlError('That address is internal/reserved and cannot be audited.', 'blocked-ip');
    }
    return url;
  }

  // Hostname: resolve every address it maps to and reject if any is blocked.
  let records;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError('Could not resolve that hostname.', 'dns-fail');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new BlockedUrlError('That hostname did not resolve to any address.', 'dns-empty');
  }
  for (const rec of records) {
    if (isBlockedAddress(rec.address)) {
      throw new BlockedUrlError('That hostname resolves to an internal address and cannot be audited.', 'blocked-ip');
    }
  }

  return url;
}
