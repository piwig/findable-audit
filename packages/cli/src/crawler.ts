import type { CrawlContext, FetchedResource } from './types.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

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
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export class Crawler implements CrawlContext {
  baseUrl: URL;
  private cache = new Map<string, FetchedResource | null>();
  private originResolved = false;

  constructor(url: string, private timeoutMs = 10_000) {
    this.baseUrl = new URL(url);
  }

  async fetch(path: string): Promise<FetchedResource | null> {
    const target = new URL(path, this.baseUrl).toString();
    if (this.cache.has(target)) return this.cache.get(target)!;
    let out: FetchedResource | null = null;
    try {
      const res = await fetch(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'user-agent': 'findable-audit/0.1 (+https://github.com/piwig/findable-audit)' },
      });
      out = {
        status: res.status,
        ok: res.ok,
        body: await readBody(res),
        contentType: res.headers.get('content-type') ?? '',
        finalUrl: res.url,
        headers: Object.fromEntries(res.headers.entries()),
      };
      // After the very first successful fetch (the homepage), pin every later
      // request to the origin we actually landed on after redirections.
      if (!this.originResolved) {
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
}
