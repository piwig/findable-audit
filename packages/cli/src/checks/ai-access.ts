import type { Check } from '../types.js';
import { makeResult } from '../types.js';
import { parseRobots, isBlocked } from '../robots.js';

export const AI_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];

export const robotsExists: Check = {
  id: 'robots-exists', family: 'ai-access', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/robots.txt');
    if (res?.status === 200) return makeResult(this, 'pass', 'robots.txt found');
    return makeResult(this, 'fail', 'robots.txt missing', 'Create a robots.txt file at the site root.');
  },
};

export const aiCrawlersAllowed: Check = {
  id: 'ai-crawlers-allowed', family: 'ai-access', maxPoints: 12,
  async run(ctx) {
    const res = await ctx.fetch('/robots.txt');
    if (res?.status !== 200) return makeResult(this, 'warn', 'no robots.txt — AI crawlers allowed by default');
    const groups = parseRobots(res.body);
    const blocked = AI_BOTS.filter((b) => isBlocked(groups, b));
    if (blocked.length === 0) return makeResult(this, 'pass', 'all AI crawlers allowed');
    return makeResult(this, 'fail', `AI crawlers blocked: ${blocked.join(', ')}`,
      'Remove the "Disallow: /" rules for these user-agents in robots.txt.');
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
