// #65 — the real sameAs loop: are the profiles a site *declares* actually its own?
//
// `sd-entity-grounding` reads the declaration and stops there, because reading
// is free and anyone can write `sameAs: ["https://linkedin.com/company/apple"]`
// into their own markup. What turns a claim into an identity is the return
// link: only whoever controls that profile can make it point back. This check
// fetches the declared profiles and looks for that link.
//
// The line this check refuses to cross, and why
// ---------------------------------------------
// It only ever looks at profiles the site DECLARED. It never goes hunting for a
// presence the site did not claim — searching LinkedIn or Crunchbase for a name
// and reporting what turns up is not verifiable from a crawl, and a plausible
// guess dressed as a finding is exactly what this project refuses to ship.
//
// Verdict policy: warn at worst, never fail. The dominant failure mode is not a
// fake profile, it is a platform that refuses robots — LinkedIn answers 999,
// Instagram and X serve a login wall, Cloudflare challenges anything without a
// browser fingerprint. "We could not read it" and "it does not link back" are
// different facts, and only the second is about the audited site. Anything we
// could not read is reported as unverifiable and costs the site nothing.

import type { Check, CrawlContext } from '../types.js';
import { makeResult, t } from '../types.js';
import { extractJsonLd, flatten } from './jsonld.js';
import { mapProbes } from './concurrency.js';

/** Profiles verified per audit. The crawler's own budget is the hard stop. */
const MAX_PROFILES = 6;

/** `sameAs` may be a string or an array of them; keep only absolute http(s) URLs. */
function declaredProfiles(node: Record<string, unknown>): string[] {
  const raw = node.sameAs;
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    try {
      const u = new URL(v);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push(u.toString());
    } catch { /* not a URL: ignored, sd-entity-grounding already grades the declaration */ }
  }
  return out;
}

/**
 * Does this profile page point back at the audited site?
 *
 * Matching on the HOST, not the exact URL: a profile links to the homepage, or
 * to a campaign URL with tracking parameters, or to the apex while the audit ran
 * on www. Requiring an exact match would report "no backlink" on profiles that
 * plainly link back. Matching the host is the claim we can actually stand
 * behind — "this page links somewhere on your domain".
 */
function linksBackTo(body: string, host: string): boolean {
  const bare = host.replace(/^www\./i, '');
  // Look for the host inside an href, not merely anywhere in the page: a profile
  // that mentions the brand name in prose has not linked to it.
  const hrefs = body.matchAll(/href\s*=\s*["']([^"']+)["']/gi);
  for (const m of hrefs) {
    try {
      const target = new URL(m[1], `https://${host}/`);
      if (target.host.replace(/^www\./i, '').toLowerCase() === bare.toLowerCase()) return true;
    } catch { /* unparseable href ignored */ }
  }
  return false;
}

type Outcome = 'reciprocal' | 'no-backlink' | 'unverifiable';

export const sameAsVerified: Check = {
  id: 'sameas-verified', family: 'structured-data', evidence: 'measured', maxPoints: 3,
  async run(ctx: CrawlContext) {
    if (!ctx.fetchExternal) {
      return makeResult(this, 'skip', 'profile verification is opt-in (run with --verify-profiles)');
    }
    const home = await ctx.fetch('/');
    if (home?.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');

    const profiles = new Set<string>();
    for (const node of flatten(extractJsonLd(home.body))) {
      for (const url of declaredProfiles(node)) profiles.add(url);
    }
    if (profiles.size === 0) {
      return makeResult(this, 'skip', 'no sameAs profile declared (see sd-entity-grounding)');
    }

    const host = new URL(home.finalUrl || ctx.baseUrl.toString()).host;
    const targets = [...profiles].slice(0, MAX_PROFILES);
    const outcomes = await mapProbes(targets, async (url): Promise<Outcome> => {
      const res = await ctx.fetchExternal!(url);
      if (res === null || res.status >= 400) return 'unverifiable';
      return linksBackTo(res.body, host) ? 'reciprocal' : 'no-backlink';
    });

    const reciprocal = outcomes.filter((o) => o === 'reciprocal').length;
    const unverifiable = outcomes.filter((o) => o === 'unverifiable').length;
    const readable = targets.length - unverifiable;
    const tail = unverifiable > 0 ? `, ${unverifiable} unverifiable (platform refused)` : '';

    // Nothing could be read: we learned nothing about this site, so we say so
    // and grade nothing. A skip here is the honest answer, not a soft failure.
    if (readable === 0) {
      return makeResult(this, 'skip', t`could not read any of the ${targets.length} declared profile(s) — all unverifiable (platform refused)`);
    }
    if (reciprocal === readable) {
      return makeResult(this, 'pass', t`${reciprocal} of ${readable} readable profile(s) link back to the site${tail}`);
    }
    if (reciprocal > 0) {
      return makeResult(this, 'warn', t`only ${reciprocal} of ${readable} readable profile(s) link back${tail}`,
        'Add your website link to the profiles you list in sameAs — the return link is what makes the identity verifiable.');
    }
    return makeResult(this, 'warn', t`no link back from ${readable} readable profile(s)${tail}`,
      'Add your website link to the profiles you list in sameAs; without it, anyone could claim them.');
  },
};
