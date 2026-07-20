import { XMLValidator } from 'fast-xml-parser';
import type { Check, CrawlContext, FetchedResource } from '../types.js';
import { makeResult, isPlainText, isXml } from '../types.js';

/** Absolute sitemap URLs declared by `Sitemap:` lines in robots.txt. */
function sitemapsFromRobots(robots: FetchedResource | null, baseUrl: URL): string[] {
  if (robots?.status !== 200 || !isPlainText(robots)) return [];
  const out: string[] = [];
  for (const m of robots.body.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)) {
    try { out.push(new URL(m[1], baseUrl).toString()); } catch { /* invalid URL ignored */ }
  }
  return out;
}

export async function discoverSitemap(ctx: CrawlContext): Promise<{ res: FetchedResource; fromRobots: boolean } | null> {
  const robotsUrls = sitemapsFromRobots(await ctx.fetch('/robots.txt'), ctx.baseUrl);
  const fallbacks = ['/sitemap.xml', '/sitemap-index.xml', '/sitemap_index.xml'];
  const candidates = [...robotsUrls, ...fallbacks];
  for (const [i, candidate] of candidates.entries()) {
    const res = await ctx.fetch(candidate);
    if (res?.status !== 200 || !isXml(res)) continue;
    return { res, fromRobots: i < robotsUrls.length };
  }
  return null;
}

export const sitemapCheck: Check = {
  id: 'sitemap', family: 'technical-seo', maxPoints: 10,
  async run(ctx) {
    const found = await discoverSitemap(ctx);
    if (!found) {
      return makeResult(this, 'fail', 'no sitemap found (robots.txt Sitemap lines, /sitemap.xml, /sitemap-index.xml, /sitemap_index.xml)',
        'Generate a sitemap.xml and reference it in robots.txt.');
    }
    const { res, fromRobots } = found;
    if (XMLValidator.validate(res.body) !== true) {
      return makeResult(this, 'fail', 'sitemap is not valid XML', 'Regenerate the sitemap with your framework integration.');
    }
    if (!/<(urlset|sitemapindex)[\s/>]/.test(res.body) || !/<loc[\s>]/.test(res.body)) {
      return makeResult(this, 'fail', 'sitemap XML has no <urlset>/<sitemapindex> root or no <loc> entry',
        'A sitemap must have a urlset or sitemapindex root element listing at least one <loc>.');
    }
    if (fromRobots) return makeResult(this, 'pass', 'valid sitemap, referenced in robots.txt');
    return makeResult(this, 'warn', 'valid sitemap but not referenced in robots.txt',
      'Add a "Sitemap: https://your-site/sitemap.xml" line to robots.txt.');
  },
};

export function indexnowCheck(key?: string): Check {
  return {
    id: 'indexnow', family: 'technical-seo', maxPoints: 4,
    async run(ctx) {
      if (!key) return makeResult(this, 'skip', 'no IndexNow key provided (use --indexnow-key to enable)');
      const res = await ctx.fetch(`/${key}.txt`);
      if (res?.status === 200 && isPlainText(res) && res.body.trim() === key) {
        return makeResult(this, 'pass', 'IndexNow key file verified');
      }
      return makeResult(this, 'fail', `IndexNow key file /${key}.txt missing or mismatched`,
        'Publish a text file named <key>.txt at the site root containing exactly the key.');
    },
  };
}
