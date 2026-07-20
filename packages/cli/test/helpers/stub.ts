import type { CrawlContext, FetchedResource } from '../../src/types.js';

/**
 * In-memory CrawlContext: map of pathname -> partial resource (status defaults
 * to 200, contentType to text/plain). Unknown paths return a 404 resource.
 */
export function stubCtx(
  resources: Record<string, Partial<FetchedResource>>,
  base = 'http://stub.example/',
): CrawlContext {
  return {
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
}
