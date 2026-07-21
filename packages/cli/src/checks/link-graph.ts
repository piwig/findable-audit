import type { FetchedResource } from '../types.js';
import { parsePage } from './dom.js';
import { isContentPath } from '../crawl-filters.js';

/**
 * Same-origin internal link graph over a page sample, shared by `internal-linking`
 * and `sitemap-orphans` (spec §3.4). Nodes are normalized absolute URLs; edges
 * are `<a href>` targets that stay on-origin and point at a crawlable content path.
 */
export interface LinkGraph {
  /** Normalized URL of each sampled page (hash stripped), in sample order. */
  pageUrls: string[];
  /** page URL -> set of same-origin internal link targets found on that page. */
  outLinks: Map<string, Set<string>>;
  /** BFS click-depth from the homepage (`/`) within the sample; Infinity if unreachable. */
  depth: Map<string, number>;
}

/** Normalize a URL for graph identity: absolute, hash removed. */
function normalize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Same-origin content-page `<a href>` targets on a single page (normalized). */
export function pageOutLinks(page: FetchedResource, baseUrl: URL): Set<string> {
  const from = page.finalUrl || baseUrl.toString();
  const out = new Set<string>();
  for (const a of parsePage(page).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const norm = normalize(href, from);
    if (!norm) continue;
    let u: URL;
    try {
      u = new URL(norm);
    } catch {
      continue;
    }
    if (u.origin !== baseUrl.origin || !isContentPath(u.pathname)) continue;
    out.add(norm);
  }
  return out;
}

/** Build the internal link graph and BFS depths from the homepage over the sample. */
export function buildLinkGraph(pages: FetchedResource[], baseUrl: URL): LinkGraph {
  const home = new URL('/', baseUrl).toString();
  const pageUrls: string[] = [];
  const outLinks = new Map<string, Set<string>>();
  for (const p of pages) {
    const url = normalize(p.finalUrl || home, home) ?? home;
    pageUrls.push(url);
    outLinks.set(url, pageOutLinks(p, baseUrl));
  }

  const depth = new Map<string, number>();
  for (const u of pageUrls) depth.set(u, Infinity);
  // BFS from the homepage node (if it is part of the sample).
  const start = pageUrls.includes(home) ? home : pageUrls[0];
  if (start !== undefined) {
    depth.set(start, 0);
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const d = depth.get(node)!;
      for (const target of outLinks.get(node) ?? []) {
        if (depth.has(target) && depth.get(target)! > d + 1) {
          depth.set(target, d + 1);
          queue.push(target);
        }
      }
    }
  }
  return { pageUrls, outLinks, depth };
}
