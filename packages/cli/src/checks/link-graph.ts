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

/**
 * In-degree of every internal URL discovered in the graph: how many distinct
 * sampled pages link to it (spec #47 link-equity-map). Targets may lie
 * outside the sample (a URL the crawler discovered but never fetched) — those
 * still get counted. Self-links are excluded: a page linking to itself does
 * not endorse itself.
 */
export function inDegree(graph: LinkGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [from, targets] of graph.outLinks) {
    for (const to of targets) {
      if (to === from) continue;
      counts.set(to, (counts.get(to) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Sample-scoped PageRank over the link graph (spec #47 link-equity-map):
 * damping 0.85, 50 fixed iterations by default. Nodes are the union of
 * sampled pages and every discovered link target (even targets outside the
 * sample, so rank mass that leaves the sample is accounted for rather than
 * vanishing). Dangling mass — rank held by nodes with no internal outlinks —
 * is redistributed uniformly across all nodes every iteration, so the total
 * stays ≈1 throughout. Self-links are excluded from the outbound edge set,
 * consistent with `inDegree`. Node order is the graph's own deterministic
 * insertion order (sample order, then first-seen target order) and the
 * iteration count is fixed, so results are identical across runs. The default
 * of 50 iterations (raised from 20, finding #6) damps the residual period-2
 * oscillation of hub<->leaf graphs well below any margin that would flip a
 * ranking or a 2-decimal printed share.
 */
export function pagerank(graph: LinkGraph, damping = 0.85, iterations = 50): Map<string, number> {
  const nodes: string[] = [];
  const seen = new Set<string>();
  const addNode = (u: string): void => {
    if (!seen.has(u)) { seen.add(u); nodes.push(u); }
  };
  for (const p of graph.pageUrls) addNode(p);
  for (const targets of graph.outLinks.values()) for (const t of targets) addNode(t);

  const n = nodes.length;
  let rank = new Map<string, number>();
  if (n === 0) return rank;
  for (const node of nodes) rank.set(node, 1 / n);

  const outEdges = new Map<string, string[]>();
  for (const node of nodes) {
    const targets = graph.outLinks.get(node);
    outEdges.set(node, targets ? [...targets].filter((t) => t !== node) : []);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    for (const node of nodes) next.set(node, (1 - damping) / n);

    let danglingMass = 0;
    for (const node of nodes) {
      if (outEdges.get(node)!.length === 0) danglingMass += rank.get(node)!;
    }
    if (danglingMass > 0) {
      const danglingShare = (damping * danglingMass) / n;
      for (const node of nodes) next.set(node, next.get(node)! + danglingShare);
    }

    for (const node of nodes) {
      const out = outEdges.get(node)!;
      if (out.length === 0) continue;
      const share = (damping * rank.get(node)!) / out.length;
      for (const t of out) next.set(t, next.get(t)! + share);
    }
    rank = next;
  }
  return rank;
}
