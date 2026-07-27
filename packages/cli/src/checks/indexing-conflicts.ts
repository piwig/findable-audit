// Backlog #23 — contradictions between the site's own indexing directives.
//
// Every signal this check reads has already been fetched by another check:
// robots.txt (ai-access, sitemap discovery), the sitemap body (sitemap*), and the
// sampled pages (everything multi-page). Nothing here touches the network beyond
// those cached resources, so the correlation is free.
//
// What it looks for, and why each pair is a genuine contradiction rather than a
// style preference:
//
//   1. A sitemap entry that robots.txt forbids. A sitemap says "please crawl and
//      index this"; a `Disallow` says "never fetch this". A crawler obeys the
//      Disallow, so it never sees the page — and never sees a `noindex` on it
//      either, which is why a blocked URL can end up listed in search results as a
//      bare URL that the site has no way to remove.
//   2. A canonical pointing at a forbidden URL. The page asks crawlers to
//      consolidate onto a target they are not allowed to fetch, so the signal is
//      simply dropped.
//   3. A sampled page that carries `noindex` while being listed in the sitemap.
//      Fetchable, so the directive *is* read and honoured — the contradiction is
//      real but self-resolving, and `sitemap-urls-valid` / `meta-robots-noindex`
//      already report the page. Capped at `warn` so one defect is not failed three
//      times over.
//
// Deliberately NOT covered: whether a *fetched* sitemap URL is noindex or
// non-canonical. That is `sitemap-urls-valid`, which probes the first ten entries
// over the wire. This check only correlates directives already in hand.

import type { Check, FetchedResource } from '../types.js';
import { makeResult, isPlainText, t } from '../types.js';
import { pagesOf, pathOf } from './aggregate.js';
import { discoverSitemap, parseSitemapEntries } from './sitemap.js';
import { extractCanonicals, canonicalIdentity } from './canonical.js';
import type { RobotsGroups } from '../robots.js';
import { parseRobots, isBlocked, robotsDirectiveSet, hasDirectiveToken } from '../robots.js';

/**
 * The agent whose rule group decides indexability. `isBlocked` implements RFC 9309
 * group selection, so this resolves to the `Googlebot` group when one exists and
 * falls back to `*` otherwise — the rules that apply to any crawler without a
 * dedicated group. A `Disallow` aimed only at, say, GPTBot is deliberate AI policy
 * (`ai-crawlers-allowed`'s subject), not a contradiction, and is left alone.
 */
const INDEXING_AGENT = 'Googlebot';

/** Upper bound on correlated sitemap entries, so a 50,000-URL sitemap stays cheap. */
const MAX_SITEMAP_URLS = 200;

/** Offenders printed before the "(+N more)" tail. */
const MAX_SHOWN = 3;

/** true when the group that governs `INDEXING_AGENT` forbids anything at all. */
function hasDisallowRule(groups: RobotsGroups): boolean {
  const rules = groups[INDEXING_AGENT.toLowerCase()] ?? groups['*'] ?? [];
  return rules.some((rule) => !rule.allow);
}

/** noindex/none via `<meta name="robots">` or the `X-Robots-Tag` header. */
function isNoindex(res: FetchedResource): boolean {
  const set = robotsDirectiveSet(res);
  return hasDirectiveToken(set, 'noindex') || hasDirectiveToken(set, 'none');
}

/** The part of a URL robots.txt rules match against: path plus query string. */
function robotsPath(u: URL): string {
  return `${u.pathname}${u.search}`;
}

function summarize(offenders: string[]): string {
  const shown = offenders.slice(0, MAX_SHOWN).join(', ');
  return offenders.length > MAX_SHOWN ? `${shown} (+${offenders.length - MAX_SHOWN} more)` : shown;
}

export const indexingConflicts: Check = {
  id: 'indexing-conflicts', family: 'technical-seo', evidence: 'measured', maxPoints: 4,
  async run(ctx) {
    const robotsRes = await ctx.fetch('/robots.txt');
    const parsed = robotsRes?.status === 200 && isPlainText(robotsRes) ? parseRobots(robotsRes.body) : null;
    // Non-null only when robots.txt actually forbids something: with no Disallow
    // rule there is no blocking axis to contradict, and the check falls back to
    // the noindex-versus-sitemap correlation alone.
    const blocking = parsed !== null && hasDisallowRule(parsed) ? parsed : null;

    const found = await discoverSitemap(ctx);
    const sitemapUrls: URL[] = [];
    for (const entry of found ? parseSitemapEntries(found.res.body) : []) {
      if (sitemapUrls.length >= MAX_SITEMAP_URLS) break;
      try {
        const u = new URL(entry.loc, ctx.baseUrl);
        // A cross-origin or unparseable <loc> is `sitemap-urls-valid`'s finding.
        if (u.origin === ctx.baseUrl.origin) sitemapUrls.push(u);
      } catch { /* unparseable <loc> ignored */ }
    }
    const sitemapIds = new Set(sitemapUrls.map((u) => canonicalIdentity(u.toString())));

    const pages = await pagesOf(ctx);

    if (pages.length === 0 && sitemapUrls.length === 0) {
      return makeResult(this, 'skip', 'no sampled page and no same-origin sitemap URL to correlate');
    }
    if (blocking === null && (pages.length === 0 || sitemapIds.size === 0)) {
      return makeResult(this, 'skip', 'nothing left to correlate: no Disallow rule in robots.txt, and no sitemap-plus-page overlap to cross-check');
    }

    const conflicts: string[] = [];
    if (blocking !== null) {
      for (const u of sitemapUrls) {
        if (isBlocked(blocking, INDEXING_AGENT, robotsPath(u))) {
          conflicts.push(`${u.pathname} (in sitemap but Disallow)`);
        }
      }
    }

    const noindexListed: string[] = [];
    for (const page of pages) {
      const label = pathOf(page);
      if (blocking !== null) {
        for (const href of extractCanonicals(page)) {
          let target: URL;
          try { target = new URL(href); } catch { continue; }
          if (target.origin !== ctx.baseUrl.origin) continue;
          if (isBlocked(blocking, INDEXING_AGENT, robotsPath(target))) {
            conflicts.push(`${label} (canonical to ${target.pathname} but Disallow)`);
            break; // one offender per page, whatever the number of canonicals
          }
        }
      }
      if (sitemapIds.size > 0 && isNoindex(page) && sitemapIds.has(canonicalIdentity(page.finalUrl))) {
        noindexListed.push(label);
      }
    }

    if (conflicts.length > 0) {
      return makeResult(this, 'fail', t`robots.txt Disallow contradicts an indexing directive: ${summarize(conflicts)}`,
        'A blocked URL can be neither read nor de-indexed. Drop the Disallow, or drop the URL from the sitemap and stop canonicalizing to it.');
    }
    if (noindexListed.length > 0) {
      return makeResult(this, 'warn', t`noindex page(s) listed in the sitemap: ${summarize(noindexListed)}`,
        'A sitemap lists the URLs you want indexed. Remove the noindex, or remove the URL from the sitemap.');
    }
    return makeResult(this, 'pass', t`indexing directives agree across ${sitemapUrls.length} sitemap URL(s) and ${pages.length} sampled page(s)`);
  },
};
