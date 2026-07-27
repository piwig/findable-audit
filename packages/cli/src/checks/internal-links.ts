// Backlog #48/#49/#50 — what the internal link graph actually *says*.
//
// `internal-linking` and `link-equity-map` already answer "who links to whom"
// (depth, orphans, PageRank). Three questions they never ask:
//
//   #48 `anchor-target-profile` — do the words people click describe the page
//       they land on? `anchor-text` only ever computed one site-wide "% generic"
//       figure; it cannot tell you that every link to /pricing/ says "learn more".
//   #49 `internal-link-context` — the graph counts a footer link and a
//       mid-paragraph link the same. Reusing `mainContent()` (which already
//       strips nav/header/footer/aside) separates the links a template repeats
//       on every page from the ones an author wrote on purpose.
//   #50 `internal-equity-leaks` — `rel` was read nowhere in this codebase for
//       internal links. `rel="nofollow"` pointed at your own pages is almost
//       always an accidental plugin setting, and `sponsored`/`ugc` are defined
//       for paid and third-party links, so on a self-link they mean nothing.
//
// Two deliberate scope decisions, both about NOT manufacturing findings:
//
//   - Internal links whose target 3xx-redirects are NOT counted as leaks.
//     Google has stated since 2016 that no PageRank is lost through a 30x, and
//     linking to `/` on a site whose `/` redirects to `/en/` is correct
//     behaviour, not a defect. Redirect hygiene belongs to `redirect-chains`
//     and `trailing-slash`, which own it properly.
//   - Internal links into `noindex` pages are REPORTED but never penalized. A
//     deliberately unindexed demo, login or thank-you page is a normal design
//     choice; `meta-robots-noindex` and `indexing-conflicts` already surface an
//     unintended one. Naming the count lets a reader judge; scoring it would be
//     us deciding for them.

import type { HTMLElement } from 'node-html-parser';
import type { Check, CrawlContext, FetchedResource } from '../types.js';
import { makeResult, t } from '../types.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import { parsePage } from './dom.js';
import { mainContent } from './content.js';
import { canonicalIdentity } from './canonical.js';
import { isContentPath } from '../crawl-filters.js';
import { internalLinks } from './links.js';
import { mapProbes } from './concurrency.js';
import { robotsDirectiveSet, hasDirectiveToken } from '../robots.js';

// ---------------------------------------------------------------------------
// Shared extraction
// ---------------------------------------------------------------------------

export interface InternalLink {
  /** Absolute, hash-stripped, same-origin target. */
  target: string;
  /** Visible anchor text, falling back to a child image's alt. '' when nameless. */
  text: string;
  /** Lower-cased `rel` tokens, in source order. */
  rel: string[];
  /**
   * true when the anchor declares `hreflang` — a language switcher, whose label
   * is a language name ("Français", "Deutsch") by convention and never the
   * target's topic. `hreflang`/`hreflang-x-default` grade these; the anchor
   * checks must not, or every multilingual site looks mislabelled.
   */
  langAlternate: boolean;
}

/** `rel` split into its space-separated tokens (the HTML spec's own grammar). */
function relTokens(a: HTMLElement): string[] {
  return (a.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * What a reader clicks: the visible text, or the alt of the image standing in
 * for it. Mirrors `anchor-text`'s fallback so the two checks agree on what an
 * image link is called.
 */
function anchorLabel(a: HTMLElement): string {
  const text = a.textContent.replace(/\s+/g, ' ').trim();
  if (text) return text;
  for (const img of a.querySelectorAll('img')) {
    const alt = (img.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim();
    if (alt) return alt;
  }
  return '';
}

/**
 * Same-origin content-path `<a href>` links found under `root`, resolved
 * against `from`. Self-links are dropped (by canonical identity, so `/a` and
 * `/a/` are one page): a page does not endorse itself, and a `#section` jump
 * normalizes to exactly that case.
 */
export function internalLinksIn(root: HTMLElement, from: string, baseUrl: URL): InternalLink[] {
  const out: InternalLink[] = [];
  const fromId = canonicalIdentity(from);
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    let u: URL;
    try {
      u = new URL(href, from);
    } catch {
      continue;
    }
    if (u.origin !== baseUrl.origin || !isContentPath(u.pathname)) continue;
    u.hash = '';
    const target = u.toString();
    if (canonicalIdentity(target) === fromId) continue;
    out.push({
      target,
      text: anchorLabel(a),
      rel: relTokens(a),
      langAlternate: (a.getAttribute('hreflang') ?? '').trim() !== '',
    });
  }
  return out;
}

/** The page's own URL, as everything here resolves relative hrefs against it. */
function urlOf(page: FetchedResource, baseUrl: URL): string {
  return page.finalUrl || baseUrl.toString();
}

/**
 * Internal links split by where they sit. `contextual` comes from
 * `mainContent()`'s already-stripped tree, so the definition of "chrome" is the
 * one every content check uses rather than a second opinion living here.
 */
export function classifyPageLinks(page: FetchedResource, baseUrl: URL): {
  all: InternalLink[];
  contextual: InternalLink[];
  wordCount: number;
} {
  const from = urlOf(page, baseUrl);
  const all = internalLinksIn(parsePage(page), from, baseUrl);
  const mc = mainContent(page);
  return { all, contextual: internalLinksIn(mc.root, from, baseUrl), wordCount: mc.wordCount };
}

// ---------------------------------------------------------------------------
// #48 anchor-target-profile
// ---------------------------------------------------------------------------

/**
 * Words that carry no topic, in both site languages we support. Wider than
 * `dom.ts`'s `tokenize` list because an anchor is three words long: "our", "more",
 * "page" or "voir" have to go or every anchor looks meaningful.
 */
const ANCHOR_STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'as',
  'your', 'you', 'we', 'our', 'us', 'my', 'me', 'their', 'they', 'them', 'all', 'about', 'into',
  'over', 'up', 'out', 'no', 'not', 'so', 'if', 'than', 'then', 'here', 'there', 'when', 'more',
  'page', 'home', 'homepage', 'back', 'learn', 'read', 'see', 'view', 'go', 'click', 'link', 'new',
  // French
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'et', 'ou', 'mais', 'donc',
  'dans', 'sur', 'pour', 'avec', 'par', 'chez', 'sans', 'sous', 'est', 'sont', 'etre', 'ete',
  'ce', 'cet', 'cette', 'ces', 'celui', 'celle', 'nos', 'notre', 'nous', 'vos', 'votre', 'vous',
  'leur', 'leurs', 'plus', 'moins', 'tout', 'tous', 'toute', 'toutes', 'ici', 'accueil',
  'retour', 'voir', 'lire', 'savoir', 'suite', 'propos', 'lien', 'aller', 'cliquez',
  'en', 'ne', 'si', 'que', 'qui', 'quoi', 'il', 'ils', 'elle', 'elles', 'on', 'se', 'sa', 'son',
  'ses', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'ete', 'etait', 'cela', 'ceci', 'nouveau',
]);

/**
 * Topic tokens of a label: lower-cased, accent-folded, stopword-free words of
 * two letters or more. Accent folding is what lets "présentation" in an anchor
 * match "presentation" in a title without a second lexicon.
 */
export function topicTokens(text: string): string[] {
  // NFD splits an accented letter into base + combining mark (U+0300..U+036F);
  // stripping that range folds accents without a second lexicon.
  const folded = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return (folded.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !ANCHOR_STOPWORDS.has(w));
}

/** Separators a title conventionally uses between its topic and its brand. */
const TITLE_SEPARATOR = /\s[|\-–—·]\s/;

/**
 * The site's brand tokens, from three sources that cost nothing extra:
 * `og:site_name` on the homepage (the one declaration whose only job is to name
 * the site), the homepage title's trailing segment ("... — Example Bakery"), and
 * the host's first label.
 *
 * Removed from BOTH sides of the comparison. The brand appears in every title
 * and in every logo link, so keeping it would make a logo look perfectly
 * aligned with every page it points at — which is how the French home of our
 * own bilingual site got flagged the first time this ran.
 */
export function brandTokens(pages: FetchedResource[], baseUrl: URL): Set<string> {
  const out = new Set<string>();
  for (const w of topicTokens(baseUrl.hostname.split('.')[0])) out.add(w);
  const homeId = canonicalIdentity(new URL('/', baseUrl).toString());
  const home = pages.find((p) => canonicalIdentity(urlOf(p, baseUrl)) === homeId) ?? pages[0];
  if (!home) return out;
  const root = parsePage(home);
  const siteName = root.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ?? '';
  for (const w of topicTokens(siteName)) out.add(w);
  const title = root.querySelector('title')?.textContent.trim() ?? '';
  const segments = title.split(TITLE_SEPARATOR).map((s) => s.trim()).filter(Boolean);
  if (segments.length >= 2) for (const w of topicTokens(segments[segments.length - 1])) out.add(w);
  return out;
}

/** Targets needed before an anchor profile says anything about a site. */
const MIN_PROFILED_TARGETS = 2;
/** In-content links to one target before repeating the same wording is a signal. */
const MIN_ANCHORS_FOR_DIVERSITY = 3;

interface TargetProfile {
  path: string;
  /** Anchor texts pointing here across the sample, in discovery order. */
  anchors: string[];
  /** The subset written inside main content. */
  contextualAnchors: string[];
  /** Topic tokens of the target's own <title> + <h1>, brand removed. */
  targetTokens: Set<string>;
  /** The most frequent anchor text (ties: first seen). */
  dominantAnchor: string;
  /** Topic tokens of `dominantAnchor`, brand removed — what alignment is judged on. */
  dominantTokens: string[];
}

/** The most frequent anchor text, ties broken by first appearance (stable output). */
function dominant(anchors: string[]): string {
  const counts = new Map<string, number>();
  for (const a of anchors) {
    const key = a.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = anchors[0] ?? '';
  let bestCount = 0;
  for (const a of anchors) {
    const c = counts.get(a.toLowerCase()) ?? 0;
    if (c > bestCount) {
      best = a;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Per-target anchor profiles over the sample. Only targets that were themselves
 * sampled get one — the target's `<title>`/`<h1>` is what the anchor is compared
 * against, and we refuse to fetch a page just to grade a link.
 *
 * The homepage is excluded on purpose: it is reached through a logo, "Home" or
 * "Accueil" by design, and grading those against its title would flag every site
 * on earth. "The homepage" means both `/` AND the page the crawl actually landed
 * on, which differ on every site whose `/` redirects to a language home.
 *
 * Language-alternate anchors are dropped for the same reason (found by auditing
 * our own bilingual site): "Français" is the correct label for a link to the
 * French home and shares no token with any title.
 */
export function buildTargetProfiles(pages: FetchedResource[], baseUrl: URL): TargetProfile[] {
  const brand = brandTokens(pages, baseUrl);
  const homeIds = new Set([canonicalIdentity(new URL('/', baseUrl).toString())]);
  if (pages[0]) homeIds.add(canonicalIdentity(urlOf(pages[0], baseUrl)));
  const byId = new Map<string, TargetProfile>();
  for (const p of pages) {
    const id = canonicalIdentity(urlOf(p, baseUrl));
    if (homeIds.has(id)) continue;
    const root = parsePage(p);
    const title = root.querySelector('title')?.textContent.trim() ?? '';
    const h1 = root.querySelector('h1')?.textContent.trim() ?? '';
    const tokens = new Set([...topicTokens(title), ...topicTokens(h1)].filter((w) => !brand.has(w)));
    byId.set(id, {
      path: pathOf(p), anchors: [], contextualAnchors: [], targetTokens: tokens,
      dominantAnchor: '', dominantTokens: [],
    });
  }
  for (const p of pages) {
    const { all, contextual } = classifyPageLinks(p, baseUrl);
    for (const link of all) {
      if (link.langAlternate) continue;
      byId.get(canonicalIdentity(link.target))?.anchors.push(link.text);
    }
    // One contribution per (target, wording) per page: a passage that repeats
    // the same link three times is one editorial decision, and counting it three
    // times would make the diversity rule fire on a single page.
    const seen = new Set<string>();
    for (const link of contextual) {
      if (link.langAlternate) continue;
      const id = canonicalIdentity(link.target);
      const key = `${id}\n${link.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      byId.get(id)?.contextualAnchors.push(link.text);
    }
  }
  const out = [...byId.values()].filter((p) => p.anchors.length > 0);
  for (const p of out) {
    p.dominantAnchor = dominant(p.anchors);
    p.dominantTokens = topicTokens(p.dominantAnchor).filter((w) => !brand.has(w));
  }
  return out;
}

const ANCHOR_PROFILE_FIX = 'Name the destination in the anchor text: the words people click should share '
  + 'the target page\'s subject, not the site\'s brand or a generic "learn more".';

export const anchorTargetProfile: Check = {
  id: 'anchor-target-profile', family: 'on-page', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    const profiles = buildTargetProfiles(pages, ctx.baseUrl);

    // A target whose dominant anchor keeps no topic token at all (an image with
    // no alt, "read more", the brand alone) says nothing about ALIGNMENT — that
    // is `anchor-text`'s finding, and counting it twice would be a second
    // penalty for one defect. Same for a target whose own title and H1 carry no
    // token to align WITH: nothing to compare means no verdict.
    const gradable = profiles.filter((p) => p.dominantTokens.length > 0 && p.targetTokens.size > 0);
    if (gradable.length < MIN_PROFILED_TARGETS) {
      return makeResult(this, 'skip', 'fewer than 2 internal targets with a gradable anchor profile');
    }

    const misaligned = gradable
      .filter((p) => !p.dominantTokens.some((w) => p.targetTokens.has(w)))
      .map((p) => `${p.path} ("${p.dominantAnchor}")`);
    if (misaligned.length > 0) {
      const agg = aggregate(gradable.length, misaligned);
      // Heuristic: WE chose "shares a token with the title or H1" as the bar, so
      // warn is the ceiling however many targets miss it (CLAUDE.md guard-rails).
      return makeResult(this, 'warn', t`anchor text does not name the target: ${agg.detail}`, ANCHOR_PROFILE_FIX);
    }

    // Diversity is judged only on IN-CONTENT anchors: a nav repeating "About us"
    // on every page is a template doing its job, while three body links to one
    // page using one identical phrase is a pattern worth naming.
    const monotonous = gradable
      .filter((p) => p.contextualAnchors.length >= MIN_ANCHORS_FOR_DIVERSITY
        && new Set(p.contextualAnchors.map((a) => a.toLowerCase())).size === 1)
      .map((p) => `${p.path} ("${p.contextualAnchors[0]}")`);
    if (monotonous.length > 0) {
      const agg = aggregate(gradable.length, monotonous);
      return makeResult(this, 'warn', t`every in-content link repeats one anchor: ${agg.detail}`,
        'Vary the wording of repeated in-content links so each one describes what that passage is pointing at.');
    }
    return makeResult(this, 'pass', t`anchor text names the target on ${gradable.length} internal page(s)`);
  },
};

// ---------------------------------------------------------------------------
// #49 internal-link-context
// ---------------------------------------------------------------------------

/**
 * Pages needed before the contextual/boilerplate split means anything. Below
 * this, the sample is one or two templates and the ratio measures the template,
 * not the site — a three-page brochure whose only links are in its nav is
 * normal, and a check that warns about it is noise.
 */
const MIN_CONTEXT_SAMPLE = 5;
/** Main-content words that make a page substantial enough to be worth reporting on. */
const SUBSTANTIAL_WORDS = 150;
/**
 * Share of internal links that must sit in the body before the graph counts as
 * editorial rather than template-only. Deliberately low: a nav repeated across N
 * pages outnumbers in-content links on ANY site, so this is a floor that only a
 * graph with essentially no authored linking falls through.
 */
const MIN_CONTEXTUAL_SHARE = 0.1;

const CONTEXT_FIX = 'Link from inside your body copy, not only from the nav and footer: a link a crawler finds '
  + 'in a sentence carries the sentence as context, while a sitewide template link carries none.';

export const internalLinkContext: Check = {
  id: 'internal-link-context', family: 'technical-seo', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length < MIN_CONTEXT_SAMPLE) {
      return makeResult(this, 'skip', 'fewer than 5 sampled pages — contextual vs boilerplate links are not separable');
    }
    let total = 0;
    let contextual = 0;
    let bare = 0;
    for (const p of pages) {
      const split = classifyPageLinks(p, ctx.baseUrl);
      total += split.all.length;
      contextual += split.contextual.length;
      if (split.wordCount >= SUBSTANTIAL_WORDS && split.contextual.length === 0) bare += 1;
    }
    if (total === 0) return makeResult(this, 'skip', 'no internal links on sampled pages');

    const pct = Math.round((contextual / total) * 100);
    // The verdict is a property of the GRAPH, not of any one page. A substantial
    // page with no in-content link is common and often right (a contact page, a
    // landing page, a gallery), so those pages are named in the message and left
    // out of the verdict — a per-page rule here produced a list nobody could act
    // on uniformly when it was tried against our own site.
    if (contextual / total < MIN_CONTEXTUAL_SHARE) {
      return makeResult(this, 'warn', t`only ${pct}% of internal links sit in the main content (${contextual}/${total})`,
        CONTEXT_FIX);
    }
    if (bare > 0) {
      return makeResult(this, 'pass',
        t`${pct}% of internal links sit in the main content (${contextual}/${total}); ${bare} substantial page(s) link out only from the template`);
    }
    return makeResult(this, 'pass', t`${pct}% of internal links sit in the main content (${contextual}/${total})`);
  },
};

// ---------------------------------------------------------------------------
// #50 internal-equity-leaks
// ---------------------------------------------------------------------------

/** `rel` values that stop, or misdescribe, a link to your own pages. */
const LEAKING_REL = new Set(['nofollow', 'sponsored', 'ugc']);

/** Compact offender label. */
function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const LEAK_FIX = 'Remove rel="nofollow" from links to your own pages — it stops them being followed for no gain — '
  + 'and keep rel="sponsored"/"ugc" for paid and third-party links, which is what they are defined for.';

export const internalEquityLeaks: Check = {
  id: 'internal-equity-leaks', family: 'technical-seo', evidence: 'measured', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');

    const offenders: string[] = [];
    let total = 0;
    const seen = new Set<string>();
    for (const p of pages) {
      const from = urlOf(p, ctx.baseUrl);
      for (const link of internalLinksIn(parsePage(p), from, ctx.baseUrl)) {
        total += 1;
        const bad = link.rel.filter((r) => LEAKING_REL.has(r));
        if (bad.length === 0) continue;
        // One offender per (target, rel) pair: a sitewide nofollowed footer link
        // is one mistake in one template, not one per page it appears on.
        const key = `${canonicalIdentity(link.target)}\n${bad.join(' ')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        offenders.push(`${shortPath(link.target)} (rel="${bad.join(' ')}")`);
      }
    }
    if (total === 0) return makeResult(this, 'skip', 'no internal links on sampled pages');

    if (offenders.length > 0) {
      const agg = aggregate(total, offenders);
      // Capped at warn even though the reading is measured: `rel="nofollow"` on
      // an internal link is unambiguous but not always wrong (a login or cart
      // URL is a defensible target), and calling a deliberate choice a failure
      // would overstate what the markup proves.
      return makeResult(this, 'warn', t`internal links that block their own equity: ${agg.detail}`, LEAK_FIX);
    }

    // Dead ends, reported for context only. The probe list is `internalLinks`'
    // own — the same URLs, in the same order, that `broken-internal-links`
    // requests — so the crawler cache serves every one and this costs the
    // audited site nothing.
    const dead = await countDeadEnds(ctx, pages);
    if (dead.noindex > 0 || dead.broken > 0) {
      return makeResult(this, 'pass',
        t`no rel="nofollow" on ${total} internal link(s); ${dead.noindex} point at a noindex page, ${dead.broken} at an error page`);
    }
    return makeResult(this, 'pass', t`no equity-blocking rel on ${total} internal link(s)`);
  },
};

/** Internal link targets that answer >= 400, or answer 200 with a noindex directive. */
async function countDeadEnds(ctx: CrawlContext, pages: FetchedResource[]): Promise<{ noindex: number; broken: number }> {
  const targets = internalLinks(pages, ctx.baseUrl);
  if (targets.length === 0) return { noindex: 0, broken: 0 };
  const probed = await mapProbes(targets, async (url) => ctx.fetch(url));
  let noindex = 0;
  let broken = 0;
  for (const res of probed) {
    if (res === null) continue; // unreachable is ambiguous; broken-internal-links owns it
    if (res.status >= 400) {
      broken += 1;
      continue;
    }
    const set = robotsDirectiveSet(res);
    if (hasDirectiveToken(set, 'noindex') || hasDirectiveToken(set, 'none')) noindex += 1;
  }
  return { noindex, broken };
}
