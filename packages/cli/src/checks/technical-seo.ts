import type { Check, CrawlContext, FetchedResource, FetchChainResult } from '../types.js';
import { makeResult } from '../types.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import { parsePage, isValidBcp47 } from './dom.js';
import { extractCanonicals, isSelfReferential, canonicalIdentity } from './canonical.js';
import { buildLinkGraph, pageOutLinks } from './link-graph.js';
import { isLocalOrPrivateHost } from './fundamentals.js';
import { robotsDirectiveSet, hasDirectiveToken } from '../robots.js';

const MAX_CANONICALS = 10;
const MAX_SAMPLE = 10;

/** noindex/none via meta robots or X-Robots-Tag. */
function hasNoindex(res: FetchedResource): boolean {
  const set = robotsDirectiveSet(res);
  return hasDirectiveToken(set, 'noindex') || hasDirectiveToken(set, 'none');
}

/** A truncated offender list, matching the other MP checks. */
function offenderList(paths: string[]): string {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` (+${paths.length - 3} more)` : '');
}

const isRedirect = (s: number): boolean => s >= 300 && s < 400;

// ---------------------------------------------------------------------------
// canonical-resolves
// ---------------------------------------------------------------------------

export const canonicalResolves: Check = {
  id: 'canonical-resolves', family: 'technical-seo', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no pages sampled');
    const declared = new Set<string>();
    for (const p of pages) for (const c of extractCanonicals(p)) declared.add(c);
    if (declared.size === 0) return makeResult(this, 'skip', 'no canonical declared on any sampled page');

    const hard: string[] = []; // 4xx/5xx/unreachable/noindex
    const soft: string[] = []; // redirecting canonical
    for (const c of [...declared].slice(0, MAX_CANONICALS)) {
      let u: URL;
      try { u = new URL(c); } catch { hard.push(`${c} (invalid)`); continue; }
      const label = u.pathname + u.search;
      const res = await ctx.fetch(u.toString());
      if (res === null || res.status !== 200) { hard.push(`${label} (${res?.status ?? 'unreachable'})`); continue; }
      if (hasNoindex(res)) { hard.push(`${label} (noindex)`); continue; }
      if (canonicalIdentity(res.finalUrl) !== canonicalIdentity(u.toString())) soft.push(`${label} (redirects)`);
    }
    if (hard.length === 0 && soft.length === 0) {
      return makeResult(this, 'pass', `${Math.min(declared.size, MAX_CANONICALS)} declared canonical(s) resolve 200 and are indexable`);
    }
    if (hard.length > 0) {
      return makeResult(this, 'fail', `canonical target broken/noindexed: ${offenderList([...hard, ...soft])}`,
        'Point canonicals only at live (200), indexable, non-redirecting URLs.');
    }
    return makeResult(this, 'warn', `canonical target redirects: ${offenderList(soft)}`,
      'A canonical should be the final URL, not one that redirects.');
  },
};

// ---------------------------------------------------------------------------
// www-consolidation (no-follow, skip local)
// ---------------------------------------------------------------------------

export const wwwConsolidation: Check = {
  id: 'www-consolidation', family: 'technical-seo', maxPoints: 5,
  async run(ctx) {
    if (isLocalOrPrivateHost(ctx.baseUrl.hostname)) return makeResult(this, 'skip', 'local/IP host has no www variant');
    if (!ctx.fetchChain) return makeResult(this, 'skip', 'no-follow fetch unavailable');
    const host = ctx.baseUrl.host;
    const isWww = host.toLowerCase().startsWith('www.');
    const apexUrl = `${ctx.baseUrl.protocol}//${isWww ? host.slice(4) : host}/`;
    const wwwUrl = `${ctx.baseUrl.protocol}//${isWww ? host : `www.${host}`}/`;
    const apex = await ctx.fetchChain(apexUrl);
    const www = await ctx.fetchChain(wwwUrl);
    const a0 = apex?.hops[0];
    const w0 = www?.hops[0];
    if (!a0 && !w0) return makeResult(this, 'warn', 'neither www nor apex host is reachable',
      'Serve the site on one canonical host and 301 the other to it.');
    // Classify from the FULL hop list, not just hops[0]: a variant whose chain loops
    // (never reaches a terminal status) or takes more than one redirect hop is broken,
    // regardless of its opening status — e.g. a www↔apex loop opening with 302.
    const brokenChain = (c: FetchChainResult | null | undefined): boolean => {
      if (!c) return false;
      return isRedirect(c.finalStatus) || c.hops.filter((h) => isRedirect(h.status)).length > 1;
    };
    if (brokenChain(apex) || brokenChain(www)) {
      return makeResult(this, 'fail', 'www/apex redirect chain or loop between hosts',
        'Point the non-canonical host at the canonical host with a single 301, not a chain or loop.');
    }
    const a200 = a0?.status === 200;
    const w200 = w0?.status === 200;
    // Only one host live at all -> effectively consolidated.
    if (a200 && !w0) return makeResult(this, 'pass', 'apex serves 200; www host not live');
    if (w200 && !a0) return makeResult(this, 'pass', 'www serves 200; apex host not live');
    if (a200 && w200) return makeResult(this, 'fail', 'both www and apex serve 200 (duplicate hosts)',
      '301 the non-canonical host to the chosen one so search engines index a single host.');
    const liveIsApex = a200 && !w200;
    const liveIsWww = w200 && !a200;
    if (liveIsApex || liveIsWww) {
      const redir = liveIsApex ? w0 : a0;
      if (redir && (redir.status === 301 || redir.status === 308)) {
        return makeResult(this, 'pass', `${liveIsApex ? 'www' : 'apex'} host 301s to the ${liveIsApex ? 'apex' : 'www'} host`);
      }
      if (redir && isRedirect(redir.status)) {
        return makeResult(this, 'warn', `non-canonical host uses a ${redir.status} (should be 301)`,
          'Make the host redirect a permanent 301, not a temporary redirect.');
      }
    }
    return makeResult(this, 'fail', 'www/apex not consolidated (no clean 200 + 301 pair)',
      '301 the non-canonical host to a single canonical host.');
  },
};

// ---------------------------------------------------------------------------
// trailing-slash (no-follow, skip local)
// ---------------------------------------------------------------------------

/** The slash-toggled variant of a path: add a trailing slash, or remove it. */
function toggleSlash(pathname: string): string | null {
  if (pathname === '/' || pathname === '') return null;
  return pathname.endsWith('/') ? pathname.slice(0, -1) : `${pathname}/`;
}

export const trailingSlash: Check = {
  id: 'trailing-slash', family: 'technical-seo', maxPoints: 4,
  async run(ctx) {
    if (isLocalOrPrivateHost(ctx.baseUrl.hostname)) return makeResult(this, 'skip', 'local/IP host — trailing-slash check skipped');
    if (!ctx.fetchChain) return makeResult(this, 'skip', 'no-follow fetch unavailable');
    const pages = await pagesOf(ctx);
    const paths = [...new Set(pages.map((p) => new URL(p.finalUrl || ctx.baseUrl).pathname))].filter((p) => toggleSlash(p) !== null).slice(0, MAX_SAMPLE);
    if (paths.length === 0) return makeResult(this, 'skip', 'no non-root paths to test');
    const dupes: string[] = [];
    const warns: string[] = [];
    for (const p of paths) {
      const toggled = toggleSlash(p)!;
      const chain = await ctx.fetchChain(new URL(toggled, ctx.baseUrl).toString());
      const first = chain?.hops[0];
      if (!first) continue; // toggled variant unreachable -> no duplicate
      if (first.status === 200) dupes.push(p);
      else if (first.status === 302 || first.status === 307) warns.push(p);
      // 301/308 or 404 -> healthy (canonical enforced, or variant simply absent)
    }
    if (dupes.length > 0) {
      return makeResult(this, 'fail', `trailing-slash duplicates (both 200): ${offenderList(dupes)}`,
        'Enforce one slash convention with a 301 from the other form.');
    }
    if (warns.length > 0) {
      return makeResult(this, 'warn', `trailing-slash variant uses a temporary redirect: ${offenderList(warns)}`,
        'Use a permanent 301, not a 302/307, to the canonical slash form.');
    }
    return makeResult(this, 'pass', `slash-toggled variants of ${paths.length} path(s) do not duplicate`);
  },
};

// ---------------------------------------------------------------------------
// redirect-chains (no-follow, skip local)
// ---------------------------------------------------------------------------

/** Classify a single fetchChain result for the redirect-chains check. */
function classifyChain(chain: FetchChainResult): 'ok' | 'temp' | 'chain' {
  const redirects = chain.hops.filter((h) => isRedirect(h.status));
  if (redirects.length === 0) return 'ok';
  // Never reached a terminal status (loop / too many hops), or more than one hop.
  if (isRedirect(chain.finalStatus) || redirects.length > 1) return 'chain';
  return (redirects[0].status === 301 || redirects[0].status === 308) ? 'ok' : 'temp';
}

export const redirectChains: Check = {
  id: 'redirect-chains', family: 'technical-seo', maxPoints: 4,
  async run(ctx) {
    if (isLocalOrPrivateHost(ctx.baseUrl.hostname)) return makeResult(this, 'skip', 'local/IP host — redirect-chains check skipped');
    if (!ctx.fetchChain) return makeResult(this, 'skip', 'no-follow fetch unavailable');
    const pages = await pagesOf(ctx);
    const urls = new Set<string>([new URL('/', ctx.baseUrl).toString()]);
    for (const p of pages.slice(0, MAX_SAMPLE)) urls.add(p.finalUrl || ctx.baseUrl.toString());
    const chains: string[] = []; // hard: chain/loop
    const temps: string[] = []; // warn: single non-301 hop
    for (const url of urls) {
      const chain = await ctx.fetchChain(url);
      if (!chain) continue;
      const verdict = classifyChain(chain);
      const label = new URL(url).pathname;
      if (verdict === 'chain') chains.push(label);
      else if (verdict === 'temp') temps.push(label);
    }
    if (chains.length > 0) {
      return makeResult(this, 'fail', `redirect chain/loop: ${offenderList(chains)}`,
        'Collapse multi-hop redirects into a single 301 to the final URL.');
    }
    if (temps.length > 0) {
      return makeResult(this, 'warn', `temporary redirect where permanent expected: ${offenderList(temps)}`,
        'Use 301/308 for permanent moves, not 302/307.');
    }
    return makeResult(this, 'pass', `no redirect chains across ${urls.size} URL(s)`);
  },
};

// ---------------------------------------------------------------------------
// soft-404 (no-follow probe)
// ---------------------------------------------------------------------------

function probePath(): string {
  return `/findable-audit-404-probe-${Math.random().toString(36).slice(2, 10)}`;
}

export const soft404: Check = {
  id: 'soft-404', family: 'technical-seo', maxPoints: 6,
  async run(ctx) {
    if (!ctx.fetchChain) return makeResult(this, 'skip', 'no-follow fetch unavailable');
    const probe = probePath();
    const chain = await ctx.fetchChain(new URL(probe, ctx.baseUrl).toString());
    if (!chain) return makeResult(this, 'skip', 'missing-route probe was unreachable');
    const first = chain.hops[0];
    if (first && isRedirect(first.status) && first.location) {
      const homeId = canonicalIdentity(new URL('/', ctx.baseUrl).toString());
      let targetId = '';
      try { targetId = canonicalIdentity(new URL(first.location, first.url).toString()); } catch { /* ignore */ }
      if (targetId === homeId) {
        return makeResult(this, 'fail', 'missing route 301s to the homepage (soft-404)',
          'Return a real 404/410 for missing routes instead of redirecting to the homepage.');
      }
    }
    if (chain.finalStatus === 404 || chain.finalStatus === 410) {
      return makeResult(this, 'pass', `missing route returns ${chain.finalStatus}`);
    }
    if (chain.finalStatus === 200) {
      return makeResult(this, 'fail', 'missing route returns 200 (soft-404)',
        'Make missing routes return a real 404/410 status, not 200.');
    }
    return makeResult(this, 'warn', `missing route returns ${chain.finalStatus} (expected 404/410)`,
      'Return 404 or 410 for missing routes.');
  },
};

// ---------------------------------------------------------------------------
// custom-404
// ---------------------------------------------------------------------------

export const custom404: Check = {
  id: 'custom-404', family: 'technical-seo', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch(new URL(probePath(), ctx.baseUrl).toString());
    if (res === null) return makeResult(this, 'skip', 'missing-route probe was unreachable');
    const root = parsePage(res);
    const internalLinks = pageOutLinks(res, ctx.baseUrl).size;
    const hasNav = root.querySelector('nav') !== null;
    const hasSearch = root.querySelector('input[type="search"], form[role="search"], form[action*="search"]') !== null;
    if (internalLinks > 0 || hasNav || hasSearch) {
      return makeResult(this, 'pass', '404 page offers a way back (links/nav/search)');
    }
    return makeResult(this, 'warn', '404 page is a dead end (no links, nav, or search)',
      'Return a branded 404 (with a 404 status) that links home and to key sections.');
  },
};

// ---------------------------------------------------------------------------
// url-structure
// ---------------------------------------------------------------------------

const SESSION_PARAM_RE = /^(utm_|sessionid$|session_id$|phpsessid$|jsessionid$|sid$|s$|token$)/i;

/** Collect issues for one URL; empty array = clean. */
function urlIssues(u: URL): string[] {
  const issues: string[] = [];
  const pathAndQuery = u.pathname + u.search;
  if (pathAndQuery.length > 115) issues.push('too long');
  if (/[A-Z]/.test(u.pathname)) issues.push('uppercase');
  if (u.pathname.includes('_')) issues.push('underscore');
  if (u.pathname.split('/').filter(Boolean).length > 4) issues.push('deep');
  for (const key of u.searchParams.keys()) {
    if (SESSION_PARAM_RE.test(key)) { issues.push('session/tracking param'); break; }
  }
  return issues;
}

export const urlStructure: Check = {
  id: 'url-structure', family: 'technical-seo', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no pages sampled');
    const urls = new Set<string>();
    for (const p of pages) {
      urls.add(p.finalUrl || ctx.baseUrl.toString());
      for (const target of pageOutLinks(p, ctx.baseUrl)) urls.add(target);
    }
    const offenders: string[] = [];
    for (const url of urls) {
      let u: URL;
      try { u = new URL(url); } catch { continue; }
      const issues = urlIssues(u);
      if (issues.length > 0) offenders.push(`${u.pathname} (${issues[0]})`);
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `${urls.size} sampled URL(s) are clean and readable`);
    const agg = aggregate(urls.size, offenders);
    return makeResult(this, agg.status, `poor URL structure: ${agg.detail}`,
      'Use short, lowercase, hyphenated paths; strip session/tracking params from canonical URLs.');
  },
};

// ---------------------------------------------------------------------------
// pagination-canonical
// ---------------------------------------------------------------------------

/** Page number from a URL (?page=N or /page/N), or null when not paginated. */
function pageNumber(u: URL): number | null {
  const q = u.searchParams.get('page');
  if (q && /^\d+$/.test(q)) return Number(q);
  const m = /\/page\/(\d+)(?:\/|$)/.exec(u.pathname);
  if (m) return Number(m[1]);
  return null;
}

export const paginationCanonical: Check = {
  id: 'pagination-canonical', family: 'technical-seo', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const paginated = pages.filter((p) => {
      const u = new URL(p.finalUrl || ctx.baseUrl);
      if (pageNumber(u) !== null) return true;
      const root = parsePage(p);
      return root.querySelector('link[rel="next"], link[rel="prev"]') !== null;
    });
    if (paginated.length === 0) return makeResult(this, 'skip', 'no pagination detected (single page series)');
    const offenders: string[] = [];
    for (const p of paginated) {
      const u = new URL(p.finalUrl || ctx.baseUrl);
      const n = pageNumber(u);
      if (n === null || n <= 1) continue; // page 1 canonicalizing to itself is fine
      const canonicals = extractCanonicals(p);
      if (canonicals.length === 0) continue;
      const selfRef = canonicals.some((c) => isSelfReferential(c, p.finalUrl));
      if (!selfRef) offenders.push(pathOf(p));
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `${paginated.length} paginated page(s) self-canonical`);
    return makeResult(this, 'fail', `pagination canonicalized to page 1: ${offenderList(offenders)}`,
      'Self-reference each paginated page; keep every page indexable.');
  },
};

// ---------------------------------------------------------------------------
// meta-refresh
// ---------------------------------------------------------------------------

export const metaRefresh: Check = {
  id: 'meta-refresh', family: 'technical-seo', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no pages sampled');
    const offenders: string[] = [];
    for (const p of pages) {
      for (const meta of parsePage(p).querySelectorAll('meta[http-equiv]')) {
        if ((meta.getAttribute('http-equiv') ?? '').toLowerCase() !== 'refresh') continue;
        const content = meta.getAttribute('content') ?? '';
        if (/\burl\s*=/i.test(content)) { offenders.push(pathOf(p)); break; }
      }
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `no meta-refresh redirects on ${pages.length} sampled page(s)`);
    return makeResult(this, 'fail', `meta-refresh redirect on: ${offenderList(offenders)}`,
      'Replace <meta http-equiv="refresh"> redirects with a server 301.');
  },
};

// ---------------------------------------------------------------------------
// hreflang-x-default
// ---------------------------------------------------------------------------

interface HreflangEntry { lang: string; href: string; }

function hreflangEntries(root: ReturnType<typeof parsePage>): HreflangEntry[] {
  const out: HreflangEntry[] = [];
  for (const l of root.querySelectorAll('link[rel="alternate"][hreflang]')) {
    const lang = (l.getAttribute('hreflang') ?? '').trim();
    const href = (l.getAttribute('href') ?? '').trim();
    if (lang) out.push({ lang, href });
  }
  return out;
}

export const hreflangXDefault: Check = {
  id: 'hreflang-x-default', family: 'technical-seo', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const withHreflang = pages.filter((p) => hreflangEntries(parsePage(p)).length > 0);
    if (withHreflang.length === 0) return makeResult(this, 'skip', 'single-language site (no hreflang annotations)');

    const invalidCodes: string[] = [];
    const missingXDefault: string[] = [];
    const missingSelf: string[] = [];
    const relativeHrefs: string[] = [];
    for (const p of withHreflang) {
      const entries = hreflangEntries(parsePage(p));
      const label = pathOf(p);
      const langs = entries.map((e) => e.lang.toLowerCase());
      if (!langs.includes('x-default')) missingXDefault.push(label);
      for (const e of entries) {
        if (e.lang.toLowerCase() === 'x-default') continue;
        if (!isValidBcp47(e.lang)) invalidCodes.push(`${label} (${e.lang})`);
      }
      for (const e of entries) {
        if (e.href && !/^https?:\/\//i.test(e.href)) relativeHrefs.push(label);
      }
      const selfId = canonicalIdentity(p.finalUrl);
      const selfRef = entries.some((e) => {
        try { return canonicalIdentity(new URL(e.href, p.finalUrl).toString()) === selfId; } catch { return false; }
      });
      if (!selfRef) missingSelf.push(label);
    }
    if (invalidCodes.length > 0) {
      return makeResult(this, 'fail', `invalid hreflang code(s): ${offenderList(invalidCodes)}`,
        'Use valid BCP-47 language codes for every hreflang value.');
    }
    const warns: string[] = [];
    if (missingXDefault.length > 0) warns.push(`no x-default on ${offenderList(missingXDefault)}`);
    if (missingSelf.length > 0) warns.push(`no self hreflang on ${offenderList(missingSelf)}`);
    if (relativeHrefs.length > 0) warns.push(`relative hreflang href on ${offenderList([...new Set(relativeHrefs)])}`);
    if (warns.length > 0) {
      return makeResult(this, 'warn', `hreflang set incomplete: ${warns.join('; ')}`,
        'Add an x-default alternate and a self-referencing hreflang; use absolute URLs.');
    }
    return makeResult(this, 'pass', `hreflang set complete on ${withHreflang.length} page(s)`);
  },
};

// ---------------------------------------------------------------------------
// internal-linking
// ---------------------------------------------------------------------------

const MAX_CLICK_DEPTH = 3;

export const internalLinking: Check = {
  id: 'internal-linking', family: 'technical-seo', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length < 2) return makeResult(this, 'skip', 'fewer than 2 sampled pages');
    const graph = buildLinkGraph(pages, ctx.baseUrl);
    const homeId = new URL('/', ctx.baseUrl).toString();
    // Inbound reference set: any URL that some page links to.
    const referenced = new Set<string>();
    for (const set of graph.outLinks.values()) for (const t of set) referenced.add(canonicalIdentity(t));

    const offenders: string[] = [];
    for (const url of graph.pageUrls) {
      const label = safePath(url);
      const out = graph.outLinks.get(url) ?? new Set();
      const isHome = canonicalIdentity(url) === canonicalIdentity(homeId);
      const reasons: string[] = [];
      if (out.size === 0) reasons.push('no internal outlink');
      if (!isHome && !referenced.has(canonicalIdentity(url))) reasons.push('orphan');
      if ((graph.depth.get(url) ?? Infinity) > MAX_CLICK_DEPTH) reasons.push('deep');
      if (reasons.length > 0) offenders.push(`${label} (${reasons[0]})`);
    }
    if (offenders.length === 0) return makeResult(this, 'pass', `${graph.pageUrls.length} sampled page(s) linked and shallow`);
    const agg = aggregate(graph.pageUrls.length, offenders);
    return makeResult(this, agg.status, `orphan/deep pages: ${agg.detail}`,
      'Add contextual internal links via hub pages; keep key pages within 3 clicks of the homepage.');
  },
};

function safePath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}
