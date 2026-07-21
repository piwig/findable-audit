import type { CrawlContext, FetchedResource, FetchChainResult } from '../../src/types.js';

export interface StubOptions {
  /**
   * Canned no-follow chains for `ctx.fetchChain`, keyed by the resolved absolute
   * URL (or the raw path passed to fetchChain, or `'*'` as a wildcard fallback).
   * When omitted, `ctx.fetchChain` is left undefined so checks that require it skip.
   */
  chains?: Record<string, FetchChainResult>;
}

/**
 * In-memory CrawlContext: map of pathname -> partial resource (status defaults
 * to 200, contentType to text/plain). Unknown paths return a 404 resource.
 * When `opts.chains` is given, a matching `fetchChain` is provided too.
 */
export function stubCtx(
  resources: Record<string, Partial<FetchedResource>>,
  base = 'http://stub.example/',
  opts: StubOptions = {},
): CrawlContext {
  const ctx: CrawlContext = {
    baseUrl: new URL(base),
    async fetch(path: string) {
      const url = new URL(path, base);
      const r = resources[url.pathname];
      if (!r) {
        return { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
      }
      return { status: 200, ok: true, body: '', contentType: 'text/plain', finalUrl: url.toString(), headers: {}, ...r };
    },
  };
  if (opts.chains) {
    const chains = opts.chains;
    ctx.fetchChain = async (path: string) => {
      let full: string;
      try { full = new URL(path, base).toString(); } catch { full = path; }
      return chains[full] ?? chains[path] ?? chains['*'] ?? null;
    };
  }
  return ctx;
}
