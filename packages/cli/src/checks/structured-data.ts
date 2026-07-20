import { parse } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult } from '../types.js';

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const node of parse(html).querySelectorAll('script[type="application/ld+json"]')) {
    try { out.push(JSON.parse(node.textContent)); } catch { /* invalid block ignored */ }
  }
  return out;
}

const RELEVANT_TYPES = new Set([
  'LocalBusiness', 'Organization', 'Corporation', 'OnlineBusiness',
  'Article', 'NewsArticle', 'BlogPosting', 'TechArticle',
  'Store', 'Restaurant', 'Bakery', 'Cafe', 'CafeOrCoffeeShop',
  'WebSite',
]);
const NAP_REQUIRED_TYPES = new Set([
  'LocalBusiness', 'OnlineBusiness', 'Store', 'Restaurant', 'Bakery', 'Cafe', 'CafeOrCoffeeShop',
]);

/** `@type` values of an entity as a string array (handles both string and array forms). */
function typesOf(entity: Record<string, unknown>): string[] {
  const t = entity['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function flatten(blocks: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const b of blocks) {
    if (Array.isArray(b)) out.push(...(b as Record<string, unknown>[]));
    else if (b && typeof b === 'object') {
      const o = b as Record<string, unknown>;
      out.push(o);
      if (Array.isArray(o['@graph'])) out.push(...(o['@graph'] as Record<string, unknown>[]));
    }
  }
  return out;
}

export const jsonLd: Check = {
  id: 'json-ld', family: 'structured-data', maxPoints: 10,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const blocks = extractJsonLd(res.body);
    if (blocks.length > 0) return makeResult(this, 'pass', `${blocks.length} valid JSON-LD block(s)`);
    return makeResult(this, 'fail', 'no valid JSON-LD found',
      'Add a <script type="application/ld+json"> block describing your business or content.');
  },
};

export const twitterCard: Check = {
  id: 'twitter-card', family: 'structured-data', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const root = parse(res.body);
    const tw = (p: string) => root.querySelector(`meta[name="twitter:${p}"]`)?.getAttribute('content')?.trim() ?? '';
    const og = (p: string) => root.querySelector(`meta[property="og:${p}"]`)?.getAttribute('content')?.trim() ?? '';
    const card = tw('card');
    const KNOWN_TYPES = new Set(['summary', 'summary_large_image']);
    const title = tw('title') || og('title');
    const description = tw('description') || og('description');
    const image = tw('image') || og('image');
    const imageAbsoluteHttps = /^https:\/\//i.test(image);

    if (!card) {
      if (title && description && imageAbsoluteHttps) {
        return makeResult(this, 'pass', 'no twitter:card, but a complete Open Graph fallback covers card rendering');
      }
      return makeResult(this, 'fail', 'no Twitter Card and no Open Graph fallback',
        'Add <meta name="twitter:card" content="summary_large_image"> or a complete Open Graph set.');
    }
    if (!KNOWN_TYPES.has(card)) {
      return makeResult(this, 'warn', `twitter:card has a non-standard type (${card})`,
        'Use "summary" or "summary_large_image".');
    }
    if (!title || !description || !imageAbsoluteHttps) {
      return makeResult(this, 'warn', 'Twitter Card missing title/description/absolute image',
        'Set twitter:title/twitter:description/twitter:image, or rely on a complete Open Graph fallback.');
    }
    return makeResult(this, 'pass', `twitter:card=${card} complete`);
  },
};

export const jsonLdEntity: Check = {
  id: 'json-ld-entity', family: 'structured-data', maxPoints: 6,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const entities = flatten(extractJsonLd(res.body));
    const typed = entities.find((e) => typesOf(e).some((t) => RELEVANT_TYPES.has(t)));
    if (!typed) {
      return makeResult(this, 'fail', 'no LocalBusiness/Organization/Article entity',
        'Declare a relevant @type (LocalBusiness subtype, Organization, or Article).');
    }
    const types = typesOf(typed);
    const label = types.join(', ');
    if (types.some((t) => NAP_REQUIRED_TYPES.has(t))) {
      const missing = ['name', 'address', 'telephone'].filter((k) => !typed[k]);
      if (missing.length > 0) {
        return makeResult(this, 'warn', `${label} found but NAP incomplete (missing: ${missing.join(', ')})`,
          'Add name, address and telephone so AI assistants can cite your business consistently.');
      }
    }
    return makeResult(this, 'pass', `relevant entity found: ${label}`);
  },
};
