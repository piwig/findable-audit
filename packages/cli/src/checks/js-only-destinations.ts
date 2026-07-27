import type { HTMLElement } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult, t } from '../types.js';
import { parsePage } from './dom.js';
import { pagesOf, pathOf } from './aggregate.js';
import { canonicalIdentity } from './canonical.js';
import { isContentPath, NON_PAGE_EXT } from '../crawl-filters.js';

// ---------------------------------------------------------------------------
// Backlog #21 — internal destinations only JavaScript can reach.
//
// `crawlable-nav` answers a different question: of the `<a>` elements on a page,
// what SHARE of them need JavaScript to work (no href, href="#", javascript:)?
// It never looks outside `<a>`, and it never extracts WHERE any of them go.
//
// This check starts from the elements `crawlable-nav` cannot see — a `<div>`, a
// `<span>`, a `<button>` wired up with `onclick="location.href=…"` or a
// `data-href` — pulls the URL back out of the markup, and then asks the only
// question that decides whether a page gets discovered: is that same URL ALSO
// exposed as a real `<a href>` somewhere in the sample? A pseudo-link that
// duplicates a real link costs nothing. One that does not is a page no non-JS
// crawler (GPTBot, ClaudeBot, PerplexityBot, CCBot, and Google's first pass)
// will ever find, whatever `crawlable-nav`'s ratio says.
//
// Evidence is `heuristic` and the worst verdict is `warn`: no specification
// enumerates `data-href` or `onclick="location.href="` as link affordances —
// that lexicon is ours, so the bar is ours (CLAUDE.md § honesty guard-rails).
// The sample is also bounded, so a destination could be linked from a page we
// never fetched; naming that a failure would overstate what we measured.
// ---------------------------------------------------------------------------

/** Inline handler attributes: where a scripted navigation hides in server-sent HTML. */
const HANDLER_ATTRS = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeypress'];

/** `data-*` attributes a click handler conventionally reads to navigate. */
const DATA_URL_ATTRS = ['data-href', 'data-url', 'data-link', 'data-route', 'data-target-url'];

/**
 * Elements worth inspecting: every anchor/area (not all of them are real links)
 * plus anything carrying a handler or a `data-*` URL. A comma selector matches
 * each element once, so an element with both an `onclick` and a `data-href` is
 * visited a single time.
 */
const CANDIDATE_SELECTOR = ['a', 'area', ...[...HANDLER_ATTRS, ...DATA_URL_ATTRS].map((a) => `[${a}]`)].join(', ');

/**
 * Scripted navigations, each capturing the URL literal in group 2. Covers plain
 * DOM navigation (`location.href=`, `location.assign/replace`, `window.open`)
 * and the router calls that show up inline in framework-generated markup.
 */
const NAV_PATTERNS: RegExp[] = [
  /\blocation\s*\.\s*(?:href|pathname)\s*=\s*(['"])([^'"]+)\1/gi,
  /\blocation\s*\.\s*(?:assign|replace)\s*\(\s*(['"])([^'"]+)\1/gi,
  /\bwindow\s*\.\s*open\s*\(\s*(['"])([^'"]+)\1/gi,
  /\b(?:(?:window|document|self|top)\s*\.\s*)?location\s*=\s*(['"])([^'"]+)\1/gi,
  /\b(?:\$?router\s*\.\s*(?:push|replace)|navigate|redirectTo)\s*\(\s*(['"])([^'"]+)\1/gi,
];

/** URL literals a scripted navigation inside `code` would send the browser to. */
export function scriptedTargets(code: string): string[] {
  const out: string[] = [];
  // matchAll clones the regex, so the shared /g patterns keep no lastIndex state.
  for (const re of NAV_PATTERNS) for (const m of code.matchAll(re)) out.push(m[2]);
  return out;
}

/** true when the element is a hyperlink a crawler already follows without JavaScript. */
export function isRealHyperlink(el: HTMLElement): boolean {
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag !== 'A' && tag !== 'AREA') return false;
  const href = (el.getAttribute('href') ?? '').trim();
  if (href === '' || href === '#' || /^javascript:/i.test(href)) return false;
  return true;
}

/**
 * true when a non-anchor element is dressed as something a visitor clicks. A
 * bare `data-url` on an inert `<div>` is far more often an analytics or fetch
 * endpoint than a link, so a `data-*` URL only counts on an element that also
 * declares interactivity.
 */
export function looksInteractive(el: HTMLElement): boolean {
  if ((el.tagName ?? '').toUpperCase() === 'BUTTON') return true;
  const role = (el.getAttribute('role') ?? '').trim().toLowerCase();
  if (role === 'link' || role === 'button' || role === 'menuitem') return true;
  if (HANDLER_ATTRS.some((a) => el.hasAttribute(a))) return true;
  return el.hasAttribute('tabindex');
}

/** Destinations an element declares WITHOUT being a real link (empty for real links). */
export function elementTargets(el: HTMLElement): string[] {
  if (isRealHyperlink(el)) return [];
  const out: string[] = [];
  const href = (el.getAttribute('href') ?? '').trim();
  if (/^javascript:/i.test(href)) out.push(...scriptedTargets(href));
  for (const attr of HANDLER_ATTRS) {
    const code = el.getAttribute(attr);
    if (code) out.push(...scriptedTargets(code));
  }
  if (looksInteractive(el)) {
    for (const attr of DATA_URL_ATTRS) {
      const value = (el.getAttribute(attr) ?? '').trim();
      if (value) out.push(value);
    }
  }
  return out;
}

/** Normalized identity of a same-origin destination, or null when it is not one. */
function internalIdentity(raw: string, from: string, baseUrl: URL): string | null {
  const value = raw.trim();
  if (value === '' || value.startsWith('#')) return null;
  let u: URL;
  try {
    u = new URL(value, from);
  } catch {
    return null;
  }
  if (u.origin !== baseUrl.origin) return null;
  if (!isContentPath(u.pathname)) return null;
  return canonicalIdentity(u.toString());
}

/** Compact offender label: path plus query, never the origin. */
function labelOf(identity: string): string {
  try {
    const u = new URL(identity);
    return `${u.pathname}${u.search}`;
  } catch {
    return identity;
  }
}

export const jsOnlyDestinations: Check = {
  id: 'js-only-destinations', family: 'technical-seo', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no pages sampled');

    /** Identities a non-JS crawler already knows: sampled pages and real `<a href>` targets. */
    const reachable = new Set<string>();
    /** Destination identity -> the sampled page whose markup first declared it. */
    const scripted = new Map<string, string>();

    for (const page of pages) {
      reachable.add(canonicalIdentity(page.finalUrl));
      const from = page.finalUrl || ctx.baseUrl.toString();
      const where = pathOf(page);
      for (const el of parsePage(page).querySelectorAll(CANDIDATE_SELECTOR)) {
        if (isRealHyperlink(el)) {
          const id = internalIdentity(el.getAttribute('href') ?? '', from, ctx.baseUrl);
          if (id) reachable.add(id);
          continue;
        }
        for (const raw of elementTargets(el)) {
          const id = internalIdentity(raw, from, ctx.baseUrl);
          // A scripted window.open of an asset (PDF, image) is not a page nobody can find.
          if (!id || NON_PAGE_EXT.test(new URL(id).pathname)) continue;
          if (!scripted.has(id)) scripted.set(id, where);
        }
      }
    }

    if (scripted.size === 0) {
      return makeResult(this, 'pass', t`${pages.length} page(s) inspected; every internal destination is a real <a href>`);
    }
    const hidden = [...scripted].filter(([id]) => !reachable.has(id));
    if (hidden.length === 0) {
      return makeResult(this, 'pass', t`${scripted.size} scripted destination(s), all also exposed as a real <a href>`);
    }
    const shown = hidden.slice(0, 3).map(([id, where]) => `${labelOf(id)} (on ${where})`).join(', ');
    const detail = hidden.length > 3 ? `${shown} (+${hidden.length - 3} more)` : shown;
    return makeResult(this, 'warn',
      t`${hidden.length} internal URL(s) reachable only by running JavaScript: ${detail}`,
      'Expose every destination as a real <a href="/path"> link. A crawler that does not run JavaScript never sees a URL that exists only inside an onclick handler or a data-href attribute, so the page behind it is never discovered — keep the click handler if you need it, but wrap the same destination in an anchor.');
  },
};
