import { XMLValidator } from 'fast-xml-parser';
import type { Check } from '../types.js';
import { makeResult } from '../types.js';

export const sitemapCheck: Check = {
  id: 'sitemap', family: 'structured-data', maxPoints: 10,
  async run(ctx) {
    const res = await ctx.fetch('/sitemap.xml');
    if (res?.status !== 200) {
      return makeResult(this, 'fail', 'sitemap.xml missing', 'Generate a sitemap.xml and reference it in robots.txt.');
    }
    if (XMLValidator.validate(res.body) !== true) {
      return makeResult(this, 'fail', 'sitemap.xml is not valid XML', 'Regenerate the sitemap with your framework integration.');
    }
    const robots = await ctx.fetch('/robots.txt');
    const referenced = robots?.status === 200 && /^sitemap\s*:/im.test(robots.body);
    if (referenced) return makeResult(this, 'pass', 'valid sitemap, referenced in robots.txt');
    return makeResult(this, 'warn', 'valid sitemap but not referenced in robots.txt',
      'Add a "Sitemap: https://your-site/sitemap.xml" line to robots.txt.');
  },
};

export function indexnowCheck(key?: string): Check {
  return {
    id: 'indexnow', family: 'structured-data', maxPoints: 4,
    async run(ctx) {
      if (!key) return makeResult(this, 'skip', 'no IndexNow key provided (use --indexnow-key to enable)');
      const res = await ctx.fetch(`/${key}.txt`);
      if (res?.status === 200 && res.body.trim() === key) {
        return makeResult(this, 'pass', 'IndexNow key file verified');
      }
      return makeResult(this, 'fail', `IndexNow key file /${key}.txt missing or mismatched`,
        'Publish a text file named <key>.txt at the site root containing exactly the key.');
    },
  };
}
