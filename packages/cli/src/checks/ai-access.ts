import { parse } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult, isPlainText } from '../types.js';
import { parseRobots, isBlocked } from '../robots.js';

export const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User',
  'CCBot', 'Bytespider', 'Amazonbot', 'meta-externalagent',
  'Google-Extended',
];

/** Core crawlers: blocking any of these is a hard fail; blocking only extended ones is a warn. */
export const CRITICAL_AI_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'OAI-SearchBot', 'Google-Extended'];

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

export const aiCrawlersAllowed: Check = {
  id: 'ai-crawlers-allowed', family: 'ai-access', maxPoints: 12,
  async run(ctx) {
    const res = await ctx.fetch('/robots.txt');
    if (res?.status !== 200 || !isPlainText(res)) {
      return makeResult(this, 'warn', 'no usable robots.txt — AI crawlers allowed by default');
    }
    const groups = parseRobots(res.body);
    const blocked = AI_BOTS.filter((b) => isBlocked(groups, b, '/'));
    if (blocked.length === 0) return makeResult(this, 'pass', 'all AI crawlers allowed');
    const critical = blocked.filter((b) => CRITICAL_AI_BOTS.includes(b));
    if (critical.length > 0) {
      return makeResult(this, 'fail', `AI crawlers blocked: ${blocked.join(', ')}`,
        'Remove the "Disallow: /" rules for these user-agents in robots.txt.');
    }
    return makeResult(this, 'warn', `secondary AI crawlers blocked: ${blocked.join(', ')}`,
      'Consider allowing these user-agents in robots.txt unless blocking them is intentional.');
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
    const directives: string[] = [];
    const header = res.headers['x-robots-tag'];
    if (header) directives.push(header);
    const meta = parse(res.body).querySelector('meta[name="robots"]')?.getAttribute('content');
    if (meta) directives.push(meta);
    const joined = directives.join(',').toLowerCase();
    if (/\bnoindex\b/.test(joined) || /\bnoai\b/.test(joined)) {
      return makeResult(this, 'warn', `blocking robots directive found: ${directives.join(' | ')}`,
        'Remove noindex/noai from the X-Robots-Tag header and <meta name="robots"> unless intentional.');
    }
    return makeResult(this, 'pass', 'no blocking robots directives (X-Robots-Tag / meta robots)');
  },
};
