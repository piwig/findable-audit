import type { Check, FetchedResource } from '../types.js';
import { makeResult, isPlainText } from '../types.js';
import {
  parseRobots, isBlocked, robotsWellformed,
  robotsDirectiveSet, hasDirectiveToken,
  AI_BOTS, CITATION_BOTS, SEARCH_BOTS,
} from '../robots.js';
import { parsePage } from './dom.js';
import { mainContent } from './content.js';
import { rollupBySeverity, type SeverityItem } from './jsonld.js';

export const robotsExists: Check = {
  id: 'robots-exists', family: 'ai-access', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/robots.txt');
    if (res?.status === 200) {
      if (!isPlainText(res)) {
        return makeResult(this, 'warn', `robots.txt served with content-type "${res.contentType}" (SPA fallback?)`,
          'Serve /robots.txt as text/plain, not an HTML fallback page.');
      }
      return makeResult(this, 'pass', 'robots.txt found');
    }
    // A missing robots.txt allows all crawling — not a hard failure.
    return makeResult(this, 'warn', 'robots.txt missing (crawling allowed by default)',
      'Create a robots.txt file at the site root.');
  },
};

export const robotsWellformedCheck: Check = {
  id: 'robots-wellformed', family: 'ai-access', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/robots.txt');
    if (!res || res.status !== 200) {
      return makeResult(this, 'skip', 'robots.txt not found (see robots-exists)');
    }
    const result = robotsWellformed(res);
    if (result.status === 'pass') return makeResult(this, 'pass', 'robots.txt is well-formed');
    if (result.status === 'warn') {
      return makeResult(this, 'warn', `robots.txt malformed (${result.reason})`,
        'Keep only User-agent/Allow/Disallow/Sitemap/Crawl-delay/Host directives, each after a User-agent line.');
    }
    return makeResult(this, 'fail', `robots.txt malformed (${result.reason})`,
      'Serve a valid text/plain robots.txt with a User-agent group and a Sitemap: line; never return HTML for it.');
  },
};

export const searchCrawlersAllowed: Check = {
  id: 'search-crawlers-allowed', family: 'ai-access', maxPoints: 6,
  async run(ctx) {
    const res = await ctx.fetch('/robots.txt');
    if (res?.status !== 200 || !isPlainText(res)) {
      return makeResult(this, 'warn', 'no usable robots.txt — search crawlers allowed by default');
    }
    const groups = parseRobots(res.body);
    const blocked = SEARCH_BOTS.filter((b) => isBlocked(groups, b, '/'));
    if (blocked.length === 0) return makeResult(this, 'pass', 'search crawlers (Googlebot, Bingbot, *) allowed');
    return makeResult(this, 'fail', `search crawlers blocked: ${blocked.join(', ')}`,
      'Remove the site-wide "Disallow: /" rule for these user-agents; scope disallows to cart/search/admin paths.');
  },
};

export const aiCrawlersAllowed: Check = {
  id: 'ai-crawlers-allowed', family: 'ai-access', maxPoints: 12,
  async run(ctx) {
    const res = await ctx.fetch('/robots.txt');
    if (res?.status !== 200 || !isPlainText(res)) {
      return makeResult(this, 'warn', 'no usable robots.txt — AI crawlers allowed by default');
    }
    const groups = parseRobots(res.body);
    const blocked = AI_BOTS.filter((b) => isBlocked(groups, b, '/'));
    if (blocked.length === 0) return makeResult(this, 'pass', 'all AI crawlers (training + citation-time) allowed');
    const citationBlocked = blocked.filter((b) => CITATION_BOTS.includes(b));
    if (citationBlocked.length > 0) {
      return makeResult(this, 'fail', `AI crawlers blocked: ${blocked.join(', ')}`,
        'Never "Disallow: /" a citation-time fetcher (OAI-SearchBot, ChatGPT-User, Perplexity-User, Claude-User, PerplexityBot) — it hides the site from live AI answers.');
    }
    return makeResult(this, 'warn', `AI crawlers blocked: ${blocked.join(', ')}`,
      'These are training-time crawlers only; blocking them is a valid policy choice, but allow them if you want future model training coverage.');
  },
};

export const homepageOk: Check = {
  id: 'homepage-ok', family: 'ai-access', maxPoints: 6,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status === 200) return makeResult(this, 'pass', 'homepage responds 200');
    return makeResult(this, 'fail', `homepage returned ${res?.status ?? 'no response'}`,
      'Ensure the root URL serves a 200 HTML page without requiring JavaScript.');
  },
};

export const robotsDirectives: Check = {
  id: 'robots-directives', family: 'ai-access', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');
    const set = robotsDirectiveSet(res);
    if (hasDirectiveToken(set, 'noindex') || hasDirectiveToken(set, 'noai')) {
      const raw = [set.headerRaw, set.metaRaw].filter(Boolean).join(' | ');
      return makeResult(this, 'warn', `blocking robots directive found: ${raw}`,
        'Remove noindex/noai from the X-Robots-Tag header and <meta name="robots"> unless intentional.');
    }
    return makeResult(this, 'pass', 'no blocking robots directives (X-Robots-Tag / meta robots)');
  },
};

// ---------------------------------------------------------------------------
// ai-serving-parity (#20: cloaking / dynamic-serving detection — does the
// server hand AI crawlers the same document it hands a browser?)
// ---------------------------------------------------------------------------

/** Realistic full UA strings for the probed crawlers (module-local; NOT the crawl default UA). */
const UA_MOBILE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; (+https://openai.com/gptbot)';
const UA_CLAUDEBOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://www.anthropic.com/bot.html)';

/** A page divergence more than this fraction smaller than the default-UA body counts as a soft signal. */
const PARITY_BYTE_SHRINK = 0.3;
/** Default-UA main content at/above this word count is "substantial" (a cloaking baseline). */
const PARITY_SUBSTANTIAL_WORDS = 20;
/** Probed-UA main content below this word count counts as "missing" against a substantial baseline. */
const PARITY_THIN_WORDS = 5;

function statusClass(status: number): number {
  return Math.floor(status / 100);
}

function titleOf(res: FetchedResource): string {
  return parsePage(res).querySelector('title')?.textContent.trim() ?? '';
}

/** pathname + query of a resource's final URL. Probes must keep the query so the
 *  probed resource matches its baseline (finding #5: a bare pathname could hit a
 *  different resource than the sampled `?...` page). */
function pathQueryOf(res: FetchedResource): string {
  try { const u = new URL(res.finalUrl); return u.pathname + u.search; } catch { return '/'; }
}

interface ParityProbe {
  /** Human-readable crawler label for messages (e.g. "GPTBot"). */
  label: string;
  /** Path (with query) probed, relative to baseUrl (e.g. "/" or a sampled page's path+query). */
  path: string;
  /** User-Agent header sent for this probe. */
  ua: string;
  /** true for an AI-crawler UA (GPTBot/ClaudeBot); false for the mobile-browser UA. */
  ai: boolean;
  /** The default-UA resource already fetched for the same path (the parity baseline). */
  baseline: FetchedResource;
}

/**
 * Is this probe a HARD failure worth exactly one retry (finding #3)? A null
 * response, or an edge block (403/451/5xx) while the default-UA baseline is 2xx.
 * These are the transient-prone outcomes; every other divergence is already a
 * stable soft signal (title/size/redirect) that needs no retry.
 */
function isHardProbeFailure(probe: ParityProbe, probed: FetchedResource | null): boolean {
  if (!probed) return true;
  if (statusClass(probe.baseline.status) !== 2) return false;
  return probed.status === 403 || probed.status === 451 || statusClass(probed.status) === 5;
}

/** Diffs one UA probe against its default-UA baseline (spec §"ai-serving-parity"). */
function diffParityProbe(probe: ParityProbe, probed: FetchedResource | null): SeverityItem {
  const item = `${probe.label} on ${probe.path}`;
  if (!probed) {
    // Fail verdicts describe AI-crawler blocking; a mobile-browser probe that
    // fails is a mobile-serving divergence, not AI blocking (finding #4) → warn.
    return probe.ai
      ? { path: item, status: 'fail', reason: 'no response for this UA (network-level block?)' }
      : { path: item, status: 'warn', reason: 'no response for the mobile UA (transient or mobile-only divergence)' };
  }
  const baseClass = statusClass(probe.baseline.status);
  const hardBlocked = probed.status === 403 || probed.status === 451 || statusClass(probed.status) === 5;
  if (hardBlocked && baseClass === 2) {
    // A 403/451/5xx to an AI crawler while browsers get 200 may be deliberate bot
    // management (WAF/CDN rule) rather than malice — stay descriptive, not accusatory.
    // The SAME divergence for the mobile-browser UA is a mobile-serving issue, not
    // AI blocking, so it is only a warn with mobile-accurate wording (finding #4).
    return probe.ai
      ? { path: item, status: 'fail', reason: `AI crawlers appear blocked at the edge (HTTP ${probed.status})` }
      : { path: item, status: 'warn', reason: `mobile UA served HTTP ${probed.status} while the default UA got ${probe.baseline.status}` };
  }
  const baseWords = mainContent(probe.baseline).wordCount;
  const probedWords = mainContent(probed).wordCount;
  if (baseWords >= PARITY_SUBSTANTIAL_WORDS && probedWords < PARITY_THIN_WORDS) {
    return probe.ai
      ? { path: item, status: 'fail', reason: 'main content missing for this UA though present for the default UA' }
      : { path: item, status: 'warn', reason: 'main content missing for the mobile UA though present for the default UA' };
  }
  if (baseClass === 2 && statusClass(probed.status) !== 2) {
    return { path: item, status: 'warn', reason: `HTTP ${probed.status} for this UA vs HTTP ${probe.baseline.status} for the default UA` };
  }
  if (pathQueryOf(probe.baseline) !== pathQueryOf(probed)) {
    return { path: item, status: 'warn', reason: `redirected to a different path (${pathQueryOf(probed)}) for this UA` };
  }
  const baseLen = Buffer.byteLength(probe.baseline.body, 'utf8');
  const probedLen = Buffer.byteLength(probed.body, 'utf8');
  if (baseLen > 0 && (baseLen - probedLen) / baseLen > PARITY_BYTE_SHRINK) {
    const pct = Math.round(((baseLen - probedLen) / baseLen) * 100);
    return { path: item, status: 'warn', reason: `body ${pct}% smaller for this UA` };
  }
  const baseTitle = titleOf(probe.baseline);
  const probedTitle = titleOf(probed);
  if (baseTitle !== probedTitle) {
    return { path: item, status: 'warn', reason: `different <title> for this UA ("${probedTitle}" vs "${baseTitle}")` };
  }
  return { path: item, status: 'pass' };
}

export const aiServingParity: Check = {
  id: 'ai-serving-parity', family: 'ai-access', maxPoints: 8,
  async run(ctx) {
    if (!ctx.fetchWithUA) return makeResult(this, 'skip', 'no per-UA fetch capability (fetchWithUA)');
    const home = await ctx.fetch('/');
    if (!home || home.status !== 200) return makeResult(this, 'skip', 'homepage not reachable');

    const homePath = pathQueryOf(home);
    const probes: ParityProbe[] = [
      { label: 'iPhone Safari', path: homePath, ua: UA_MOBILE_SAFARI, ai: false, baseline: home },
      { label: 'GPTBot', path: homePath, ua: UA_GPTBOT, ai: true, baseline: home },
      { label: 'ClaudeBot', path: homePath, ua: UA_CLAUDEBOT, ai: true, baseline: home },
    ];
    // Budget: at most 2 non-homepage sampled pages, probed only with GPTBot — the
    // default-UA baseline for these comes free from the already-fetched sample,
    // never a fresh request (spec: politeness budget of at most 5 extra fetches).
    const extraPages = (ctx.sample?.pages ?? []).filter((p) => pathQueryOf(p) !== homePath).slice(0, 2);
    for (const p of extraPages) {
      probes.push({ label: 'GPTBot', path: pathQueryOf(p), ua: UA_GPTBOT, ai: true, baseline: p });
    }

    // Real HTTP bound (finding #10): at most 5 probe `fetchWithUA` calls, plus at
    // most ONE retry per hard-failing probe (finding #3). Each `fetchWithUA`
    // internally follows the crawler's own bounded redirect chain (≤
    // MAX_REDIRECT_HOPS hops in guarded mode), so the total request count per
    // audit stays O(1).
    const items: SeverityItem[] = [];
    for (const probe of probes) {
      const probed = await ctx.fetchWithUA(probe.path, probe.ua);
      if (isHardProbeFailure(probe, probed)) {
        // A transient 5xx / network blip must not hard-fail a site on one sample.
        // Retry exactly once — a genuinely fresh request, since `fetchWithUA` does
        // not cache failed responses. Only a REPRODUCED failure stays a fail; a
        // recovered probe is reported as a transient warn.
        const retry = await ctx.fetchWithUA(probe.path, probe.ua);
        if (isHardProbeFailure(probe, retry)) {
          items.push(diffParityProbe(probe, retry)); // reproduced → keep the failure
        } else {
          const retryItem = diffParityProbe(probe, retry);
          items.push(retryItem.status === 'pass'
            ? { path: `${probe.label} on ${probe.path}`, status: 'warn', reason: 'transient failure on first fetch, recovered on retry' }
            : retryItem); // retry recovered but surfaced a real soft divergence — keep that
        }
        continue;
      }
      items.push(diffParityProbe(probe, probed));
    }
    const roll = rollupBySeverity(items);
    if (roll.status === 'pass') {
      return makeResult(this, 'pass', `same document served across ${probes.length} AI/mobile UA probe(s)`);
    }
    return makeResult(this, roll.status, `serving diverges by User-Agent: ${roll.detail}`,
      'Compare what your CDN/WAF/bot-management gives GPTBot/ClaudeBot against a normal browser fetch — AI crawlers must receive the same document, not a blocked or truncated one.');
  },
};
