// SSRF protection for the public URL-audit web app (first-hop URL validation).
//
// This module decides whether a user-supplied URL is safe to hand to the
// crawler. The threat is Server-Side Request Forgery: a visitor could ask us to
// "audit" http://127.0.0.1:6379/, http://169.254.169.254/ (cloud metadata) or
// http://10.0.0.5/ and use our server as a proxy into private infrastructure.
//
// Two exports:
//   - isBlockedAddress(ip)  -> boolean   (the canonical IP-range predicate,
//                                          imported from the CLI build so there
//                                          is ONE copy of the range table)
//   - assertPublicUrl(raw)  -> URL       (validates scheme/port/creds/host,
//                                          resolves DNS, throws BlockedUrlError)
//
// DEFENCE IN DEPTH. assertPublicUrl validates only the *initial* URL. The
// deeper vectors — a 3xx redirect that bounces the crawler to an internal host,
// an hreflang <link> that points at loopback, and DNS-rebinding (a host that
// validates here but resolves to a private IP when the crawler connects) — are
// now closed at the fetch layer by the crawler's `blockPrivateHosts` guard
// (packages/cli/src/crawler.ts): it re-runs the same isBlockedAddress check on
// every hop and pins the socket to the validated IP. This module remains the
// fast first gate that rejects obviously-bad input before an audit is queued.

import net from 'node:net';
import dns from 'node:dns';

// Single source of truth for the IP-range block logic. Requires the CLI to be
// built (`npm run build` in packages/cli) so dist/ssrf.js exists.
import { isBlockedAddress } from '../../../packages/cli/dist/ssrf.js';

export { isBlockedAddress };

export class BlockedUrlError extends Error {
  /** @param {string} message @param {string} code machine-readable reason */
  constructor(message, code) {
    super(message);
    this.name = 'BlockedUrlError';
    this.code = code;
  }
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
