// Backlog #26 + #51 — are the sources you cite still there?
//
// `broken-internal-links` stops at the origin, and `outbound-citations` only
// asserts that an external link EXISTS. Neither notices that the study you cite
// moved, the documentation you point at was deleted, or the partner you link to
// let the domain lapse. For a page whose credibility rests on its references —
// which is precisely what an answer engine weighs — a dead citation is a real
// defect that nothing in the markup reveals.
//
// This is the only link check that leaves the audited origin, so it is the most
// constrained one in the catalogue:
//
//   - OPT-IN. Without `--check-outbound` the capability is not even wired up
//     (`ctx.fetchOutbound` is absent) and this check skips. The CLI help
//     promises the default audit touches nothing but the audited site; this
//     check exists inside that promise, not around it.
//   - BOUNDED and DEDUPED BY HOST. At most one URL per host, at most
//     MAX_OUTBOUND_LINKS hosts, main content first — so the budget lands on the
//     citations `outbound-citations` reads rather than on a footer's social row.
//   - GUARDED. Every probe goes through the crawler's shared SSRF guard
//     (`src/ssrf.ts`), forced on even in CLI runs: these URLs were written by
//     whoever wrote the audited page.
//   - HONEST ABOUT NOT KNOWING. A timeout, a DNS failure, a blocked address or
//     a bot wall is reported as UNVERIFIABLE and never counted against the site.
//     Only 404 and 410 — "not found" and "gone", the two statuses RFC 9110
//     defines as the resource not being there — count as broken. A network
//     hiccup must never turn into a failed audit.
//
// The `rel` reading of #51 rides along here rather than in its own check: it
// describes the same link set, and on its own it produces no defect worth a
// verdict (declaring `sponsored`/`ugc` is correct usage, and whether a link
// SHOULD be declared paid is not something a crawler can know). It is reported
// in the message so the reader can see their own disclosure posture.

import type { Check, FetchedResource } from '../types.js';
import { makeResult, t } from '../types.js';
import { pagesOf, aggregate } from './aggregate.js';
import { parsePage } from './dom.js';
import { mainContent } from './content.js';
import { mapProbes } from './concurrency.js';

/** Hosts probed per audit. One URL each, so this is also the host count. */
export const MAX_OUTBOUND_LINKS = 10;

/** Statuses that mean the target is not there. Everything else is inconclusive. */
const GONE_STATUSES = new Set([404, 410]);

/** `rel` values that declare a link's nature (Google's paid/UGC/nofollow trio). */
const DECLARED_REL = new Set(['nofollow', 'sponsored', 'ugc']);

export interface OutboundLink {
  /** Absolute, hash-stripped http(s) URL. */
  url: string;
  /** Host, `www.` stripped — the dedup key. */
  host: string;
  /** true when the link sits in the page's main content (a citation, not chrome). */
  contextual: boolean;
  /** true when `rel` declares nofollow/sponsored/ugc. */
  declared: boolean;
}

/** Every off-origin `<a href>` on the sampled pages, main-content links first. */
export function collectOutboundLinks(pages: FetchedResource[], baseUrl: URL): OutboundLink[] {
  const seenUrl = new Set<string>();
  const inMain: OutboundLink[] = [];
  const inChrome: OutboundLink[] = [];

  const absorb = (
    root: ReturnType<typeof parsePage>,
    from: string,
    contextual: boolean,
    bucket: OutboundLink[],
  ): void => {
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      let u: URL;
      try {
        u = new URL(href, from);
      } catch {
        continue;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue; // mailto:/tel:/javascript:
      if (u.origin === baseUrl.origin) continue;
      u.hash = '';
      const url = u.toString();
      if (seenUrl.has(url)) continue;
      seenUrl.add(url);
      const rel = (a.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      bucket.push({
        url,
        host: u.hostname.replace(/^www\./, ''),
        contextual,
        declared: rel.some((r) => DECLARED_REL.has(r)),
      });
    }
  };

  for (const p of pages) {
    const from = p.finalUrl || baseUrl.toString();
    // Main content first so its links claim the URL-dedup slots; the second pass
    // over the whole page then only adds what the chrome contributes on its own.
    absorb(mainContent(p).root, from, true, inMain);
    absorb(parsePage(p), from, false, inChrome);
  }
  return [...inMain, ...inChrome];
}

/** One URL per host, capped — the sample that is actually probed. */
export function pickProbeTargets(links: OutboundLink[]): OutboundLink[] {
  const hosts = new Set<string>();
  const out: OutboundLink[] = [];
  for (const link of links) {
    if (out.length >= MAX_OUTBOUND_LINKS) break;
    if (hosts.has(link.host)) continue;
    hosts.add(link.host);
    out.push(link);
  }
  return out;
}

/** Compact offender label: host + path, which is what a reader needs to find it. */
function labelOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

const OUTBOUND_FIX = 'Update or remove the outbound links returning 404/410: a citation that no longer resolves '
  + 'stops supporting the claim it was there to back, for a reader and for an answer engine alike.';

export const outboundLinkHealth: Check = {
  id: 'outbound-link-health', family: 'technical-seo', evidence: 'measured', maxPoints: 3,
  async run(ctx) {
    // The capability is absent unless the operator asked for it. Skipping here is
    // what keeps "the default audit fetches nothing off your origin" true.
    if (!ctx.fetchOutbound) {
      return makeResult(this, 'skip', 'outbound links not probed — pass --check-outbound to check them');
    }
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const links = collectOutboundLinks(pages, ctx.baseUrl);
    if (links.length === 0) return makeResult(this, 'skip', 'no outbound links on sampled pages');

    const targets = pickProbeTargets(links);
    const declared = links.filter((l) => l.declared).length;
    const probed = await mapProbes(targets, async (link) => ({ link, res: await ctx.fetchOutbound!(link.url) }));

    const gone: string[] = [];
    let alive = 0;
    for (const { link, res } of probed) {
      if (res === null) continue; // unreachable / refused by the guard: we do not know
      if (GONE_STATUSES.has(res.status)) {
        gone.push(labelOf(link.url));
        continue;
      }
      if (res.status < 400) alive += 1;
      // 401/403/429/5xx and friends: a bot wall or a bad day, not a dead link.
    }
    const unverifiable = targets.length - alive - gone.length;

    if (gone.length === 0) {
      return makeResult(this, 'pass',
        t`${alive}/${targets.length} outbound link(s) resolve (${unverifiable} unverifiable, ${declared} declaring rel)`);
    }
    const agg = aggregate(targets.length, gone);
    return makeResult(this, agg.status, t`dead outbound link(s): ${agg.detail}`, OUTBOUND_FIX);
  },
};
