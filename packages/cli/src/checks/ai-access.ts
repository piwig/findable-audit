import type { Check } from '../types.js';
import { makeResult, isPlainText } from '../types.js';
import {
  parseRobots, isBlocked, robotsWellformed,
  robotsDirectiveSet, hasDirectiveToken,
  AI_BOTS, CITATION_BOTS, SEARCH_BOTS,
} from '../robots.js';

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
