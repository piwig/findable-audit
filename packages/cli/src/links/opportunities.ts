import type { FetchedResource } from '../types.js';
import { parsePage } from '../checks/dom.js';
import { mainContent } from '../checks/content.js';
import { pageOutLinks } from '../checks/link-graph.js';

export interface LinkOpportunity {
  sourcePath: string;
  targetPath: string;
  anchor: string;
  excerpt: string;
  basis: 'existing-anchor';
  reviewRequired: true;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const stop = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'et', 'en', 'a', 'à', 'au', 'aux', 'pour', 'votre', 'notre', 'the', 'a', 'an', 'and', 'of', 'for', 'your', 'our', 'to', 'in']);
const pattern = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])(${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}\\p{N}])`, 'iu');

/** Conservative review candidates: exact existing phrase, sampled destination, no new fetches. */
export function buildLinkOpportunities(pages: FetchedResource[], baseUrl: URL): LinkOpportunity[] {
  const prepared = pages.flatMap((page) => {
    let url: URL;
    try { url = new URL(page.finalUrl); } catch { return []; }
    if (url.origin !== baseUrl.origin || page.status !== 200) return [];
    const dom = parsePage(page);
    const directives = [page.headers['x-robots-tag'] ?? '', ...dom.querySelectorAll('meta').filter(el => /^(robots|googlebot)$/i.test(el.getAttribute('name') ?? '')).map(el => el.getAttribute('content') ?? '')].join(',');
    if (/(?:^|[\s,:])(?:noindex|none)(?:$|[\s,])/i.test(directives)) return [];
    const canonical = dom.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canonical) {
      try {
        const preferred = new URL(canonical, url);
        preferred.hash = '';
        url.hash = '';
        if (preferred.toString() !== url.toString()) return [];
      } catch { return []; }
    }
    url.hash = '';
    const phrases = [...new Set([dom.querySelector('h1')?.textContent ?? '', (dom.querySelector('title')?.textContent ?? '').split(/\s+[|—–]\s+/)[0]].map(clean))]
      .filter(value => value.length >= 8 && value.length <= 80 && (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !stop.has(word)).length >= 2);
    const root = mainContent(page).root;
    // Drop whole blocks carrying excluded descendants so removal cannot invent
    // a phrase by joining text from opposite sides of an existing link.
    const excluded = 'a, script, style, noscript, [hidden], [aria-hidden="true"], [inert]';
    const paragraphs = root.querySelectorAll('p, li, dd').filter(el => {
      if (el.querySelector(`p, li, dd, ${excluded}`)) return false;
      if (el.querySelectorAll('[aria-hidden]').some(child => child.getAttribute('aria-hidden')?.toLowerCase() === 'true')) return false;
      for (let parent = el; parent; parent = parent.parentNode) {
        if (parent.tagName === 'A' || parent.hasAttribute('hidden') || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden')?.toLowerCase() === 'true') return false;
      }
      return true;
    }).map(el => clean(el.textContent)).filter(Boolean);
    return [{ url: url.toString(), path: url.pathname + url.search, phrases, paragraphs, links: pageOutLinks(page, baseUrl) }];
  });
  const result: LinkOpportunity[] = [];
  for (const source of prepared) {
    for (const target of prepared) {
      if (result.length >= 20) return result;
      if (source.url === target.url || source.links.has(target.url)) continue;
      let chosen: { anchor: string; excerpt: string } | undefined;
      for (const phrase of target.phrases) {
        for (const paragraph of source.paragraphs) {
          const match = pattern(phrase).exec(paragraph);
          if (!match) continue;
          const start = Math.max(0, match.index - 100);
          chosen = { anchor: match[1], excerpt: (start ? '…' : '') + paragraph.slice(start, start + 316) + (paragraph.length > start + 316 ? '…' : '') };
          break;
        }
        if (chosen) break;
      }
      if (chosen) result.push({ sourcePath: source.path, targetPath: target.path, ...chosen, basis: 'existing-anchor', reviewRequired: true });
    }
  }
  return result;
}
