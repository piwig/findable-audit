import type { CrawlContext, FetchedResource } from './types.js';

export class Crawler implements CrawlContext {
  readonly baseUrl: URL;
  private cache = new Map<string, FetchedResource | null>();

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
        body: await res.text(),
        contentType: res.headers.get('content-type') ?? '',
        finalUrl: res.url,
      };
    } catch {
      out = null;
    }
    this.cache.set(target, out);
    return out;
  }
}
