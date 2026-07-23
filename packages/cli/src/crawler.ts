import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import zlib from 'node:zlib';
import type { CrawlContext, FetchedResource, PageSample, FetchChainResult, FetchHop } from './types.js';
import type { PsiResult } from './perf/psi.js';
import { isBlockedAddress } from './ssrf.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_REDIRECT_HOPS = 5; // guarded mode: bound manual redirect following
const MAX_CHAIN_HOPS = 5; // fetchChain: bound the no-follow hop list

function charsetFrom(contentType: string): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  return m ? m[1] : 'utf-8';
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      chunks.push(value.subarray(0, value.byteLength - (size - MAX_BODY_BYTES)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetFrom(res.headers.get('content-type') ?? ''));
  } catch {
    decoder = new TextDecoder(); // unknown label -> fall back to utf-8
  }
  return decoder.decode(Buffer.concat(chunks));
}

/** Read (and decompress + decode) a node:http response body, capped at 5 MB. */
function readNodeBody(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
    let stream: NodeJS.ReadableStream = res;
    if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
    else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
    else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(charsetFrom(String(res.headers['content-type'] ?? '')));
      } catch {
        decoder = new TextDecoder();
      }
      resolve(decoder.decode(Buffer.concat(chunks)));
    };
    stream.on('data', (c: Buffer) => {
      size += c.byteLength;
      if (size > MAX_BODY_BYTES) {
        chunks.push(c.subarray(0, c.byteLength - (size - MAX_BODY_BYTES)));
        res.destroy();
        finish();
        return;
      }
      chunks.push(c);
    });
    stream.on('end', finish);
    stream.on('error', finish);
    res.on('error', finish);
  });
}

export const DEFAULT_UA = 'findable-audit/0.1 (+https://github.com/piwig/findable-audit)';

/** Default policy: only the scheme-default port (empty) or the two web ports. */
function defaultAllowedPort(port: string): boolean {
  return port === '' || port === '80' || port === '443';
}

interface ResolvedAddress { address: string; family: number; }
type GuardResult = { ok: false } | { ok: true; address: string; family: number };

export interface CrawlerOptions {
  /**
   * Opt-in SSRF guard. When true, EVERY fetch (initial URL, sitemap, sampled
   * pages, and discovered URLs like hreflang alternates) resolves its host and
   * refuses to connect to any blocked address, re-validates each redirect hop,
   * and pins the socket to the validated IP. Default OFF so the CLI can audit
   * loopback fixtures. The public web app turns it ON.
   */
  blockPrivateHosts?: boolean;
  /** External abort signal, combined with the per-request timeout on every fetch. */
  signal?: AbortSignal;
  // --- Test seams (default to the real implementations). Injectable so the
  //     guard's redirect/hreflang/abort behaviour can be exercised against
  //     loopback servers without the real port/loopback rules rejecting them. ---
  lookup?: (host: string) => Promise<ResolvedAddress[]>;
  isBlocked?: (ip: string) => boolean;
  allowPort?: (port: string) => boolean;
}

export class Crawler implements CrawlContext {
  baseUrl: URL;
  /** Sampled pages, attached by the runner after the homepage fetch. */
  sample?: PageSample;
  /** Core Web Vitals data, attached by the runner when `--cwv` is set. */
  psi?: PsiResult | null;
  /** JSON-LD entity graph, attached by the runner after sampling. */
  entityGraph?: import('./report/entity-graph.js').EntityGraph;
  private cache = new Map<string, FetchedResource | null>();
  private originResolved = false;

  constructor(
    url: string,
    private timeoutMs = 10_000,
    private userAgent = DEFAULT_UA,
    private opts: CrawlerOptions = {},
  ) {
    this.baseUrl = new URL(url);
  }

  /** Per-request signal: the timeout combined with any caller-supplied signal. */
  private buildSignal(): AbortSignal {
    const signals = [AbortSignal.timeout(this.timeoutMs), this.opts.signal].filter(Boolean) as AbortSignal[];
    return AbortSignal.any(signals);
  }

  async fetch(path: string): Promise<FetchedResource | null> {
    const target = new URL(path, this.baseUrl).toString();
    if (this.cache.has(target)) return this.cache.get(target)!;
    const signal = this.buildSignal();
    let out: FetchedResource | null = null;
    try {
      if (this.opts.blockPrivateHosts) {
        out = await this.guardedFetch(target, signal);
      } else {
        const res = await fetch(target, {
          redirect: 'follow',
          signal,
          headers: { 'user-agent': this.userAgent },
        });
        out = {
          status: res.status,
          ok: res.ok,
          body: await readBody(res),
          contentType: res.headers.get('content-type') ?? '',
          finalUrl: res.url,
          headers: Object.fromEntries(res.headers.entries()),
        };
      }
      // After the very first successful fetch (the homepage), pin every later
      // request to the origin we actually landed on after redirections.
      if (out && !this.originResolved) {
        this.originResolved = true;
        const final = new URL(out.finalUrl || target);
        if (final.origin !== this.baseUrl.origin) this.baseUrl = new URL(`${final.origin}/`);
      }
    } catch {
      out = null;
    }
    this.cache.set(target, out);
    return out;
  }

  // -------------------------------------------------------------------------
  // Manual, no-follow fetch chain (shared by crawl-hygiene checks)
  // -------------------------------------------------------------------------

  /**
   * Fetch `path` WITHOUT following redirects, returning every hop's
   * status + Location so callers can distinguish 301 from 302, detect chains
   * and loops, and see whether a missing route 200s or redirects home.
   *
   * SECURITY: when `blockPrivateHosts` is on, EVERY hop (the initial URL and
   * each redirect target) is re-validated through the same SSRF guard the
   * follow-mode `guardedFetch` uses — host+port allowlist, `isBlockedAddress`,
   * and a socket pinned to the validated IP (DNS-rebinding-safe). A hop whose
   * target is blocked aborts the whole chain (returns null) BEFORE any request
   * is sent to it. It never consults or populates the follow-mode cache.
   */
  async fetchChain(path: string, opts: { maxHops?: number } = {}): Promise<FetchChainResult | null> {
    const maxHops = opts.maxHops ?? MAX_CHAIN_HOPS;
    const signal = this.buildSignal();
    let currentUrl: string;
    try {
      currentUrl = new URL(path, this.baseUrl).toString();
    } catch {
      return null;
    }
    const hops: FetchHop[] = [];
    const visited = new Set<string>();
    for (let hop = 0; hop <= maxHops; hop++) {
      let url: URL;
      try {
        url = new URL(currentUrl);
      } catch {
        return null;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      const key = url.toString();
      if (visited.has(key)) {
        // Redirect loop: the previous hop already pointed back here. Report the
        // chain so far with its still-redirecting terminal status.
        const last = hops[hops.length - 1];
        return { hops, finalStatus: last?.status ?? 0, finalUrl: key };
      }
      visited.add(key);

      let res: http.IncomingMessage;
      try {
        if (this.opts.blockPrivateHosts) {
          const guard = await this.resolveGuard(url);
          if (!guard.ok) return null; // blocked host/port -> refuse the whole chain
          res = await this.nodeRequest(url, guard.address, guard.family, signal);
        } else {
          res = await this.nodeRequestPlain(url, signal);
        }
      } catch {
        return null;
      }
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      const location = typeof loc === 'string' && loc !== '' ? loc : undefined;
      res.resume(); // drain and discard the body (checks only need status/Location)
      hops.push({ url: key, status, location });

      if (status >= 300 && status < 400 && location) {
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return null;
        }
        currentUrl = next.toString();
        continue;
      }
      return { hops, finalStatus: status, finalUrl: key };
    }
    // Exceeded maxHops without reaching a terminal status: report the chain,
    // finalStatus stays the last (redirecting) status so callers flag a chain.
    const last = hops[hops.length - 1];
    return { hops, finalStatus: last?.status ?? 0, finalUrl: last?.url ?? currentUrl };
  }

  /** One no-follow node GET, no SSRF guard/pinning (blockPrivateHosts off). */
  private nodeRequestPlain(url: URL, signal: AbortSignal): Promise<http.IncomingMessage> {
    const mod = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request(
        url,
        {
          method: 'GET',
          signal,
          headers: {
            'user-agent': this.userAgent,
            'accept-encoding': 'gzip, deflate, br',
            accept: '*/*',
          },
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
  }

  // -------------------------------------------------------------------------
  // Guarded fetch (blockPrivateHosts === true)
  // -------------------------------------------------------------------------

  /**
   * Resolve `url`'s host and decide whether it is safe to connect to.
   * Rejects (returns ok:false) when the port is not allowed, the host does not
   * resolve, or ANY resolved address is blocked. On success returns the first
   * resolved address, which the caller pins the socket to.
   */
  private async resolveGuard(url: URL): Promise<GuardResult> {
    const allowPort = this.opts.allowPort ?? defaultAllowedPort;
    if (!allowPort(url.port)) return { ok: false };

    const rawHost = url.hostname;
    const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
    const isBlocked = this.opts.isBlocked ?? isBlockedAddress;

    let addrs: ResolvedAddress[];
    const literal = net.isIP(host);
    if (literal !== 0) {
      addrs = [{ address: host, family: literal }];
    } else {
      try {
        addrs = this.opts.lookup
          ? await this.opts.lookup(host)
          : await dns.promises.lookup(host, { all: true });
      } catch {
        return { ok: false };
      }
    }
    if (!addrs || addrs.length === 0) return { ok: false };
    for (const a of addrs) if (isBlocked(a.address)) return { ok: false };
    return { ok: true, address: addrs[0].address, family: addrs[0].family };
  }

  /**
   * Fetch with the SSRF guard active. Follows redirects MANUALLY: each hop
   * (including the initial URL) is host/port/IP-validated BEFORE connecting,
   * and the connection is pinned to the exact validated address so it cannot be
   * re-resolved to an internal IP between check and connect (DNS-rebinding).
   * Returns null on any rejection or transport error (checks treat null as
   * unreachable); logs nothing sensitive.
   */
  private async guardedFetch(target: string, signal: AbortSignal): Promise<FetchedResource | null> {
    let currentUrl = target;
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      let url: URL;
      try {
        url = new URL(currentUrl);
      } catch {
        return null;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

      const guard = await this.resolveGuard(url);
      if (!guard.ok) return null;

      let res: http.IncomingMessage;
      try {
        res = await this.nodeRequest(url, guard.address, guard.family, signal);
      } catch {
        return null;
      }

      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
        res.resume(); // drain and discard the redirect body
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return null;
        }
        currentUrl = next.toString();
        continue; // re-run the guard on the redirect target before following
      }

      const body = await readNodeBody(res);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        headers[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      }
      return {
        status,
        ok: status >= 200 && status < 300,
        body,
        contentType: String(res.headers['content-type'] ?? ''),
        finalUrl: currentUrl,
        headers,
      };
    }
    return null; // too many redirects
  }

  /**
   * One node:http(s) GET, with the connection pinned to `address` via the
   * `lookup` option so no second DNS resolution can happen at connect time.
   * TLS SNI/cert validation still uses the URL hostname, so HTTPS stays valid.
   */
  private nodeRequest(
    url: URL,
    address: string,
    family: number,
    signal: AbortSignal,
  ): Promise<http.IncomingMessage> {
    const mod = url.protocol === 'https:' ? https : http;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pinnedLookup = (_hostname: string, options: any, cb: any): void => {
      if (options && options.all) cb(null, [{ address, family }]);
      else cb(null, address, family);
    };
    return new Promise((resolve, reject) => {
      const req = mod.request(
        url,
        {
          method: 'GET',
          signal,
          headers: {
            'user-agent': this.userAgent,
            'accept-encoding': 'gzip, deflate, br',
            accept: '*/*',
          },
          lookup: pinnedLookup,
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
  }
}
