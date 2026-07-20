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

const RELEVANT = /(Business|Organization|Article|Store|Restaurant|WebSite)/;
const NAP_REQUIRED = /(Business|Store|Restaurant)/;

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

export const jsonLdEntity: Check = {
  id: 'json-ld-entity', family: 'structured-data', maxPoints: 6,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const entities = flatten(extractJsonLd(res.body));
    const typed = entities.find((e) => RELEVANT.test(String(e['@type'] ?? '')));
    if (!typed) {
      return makeResult(this, 'fail', 'no LocalBusiness/Organization/Article entity',
        'Declare a relevant @type (LocalBusiness subtype, Organization, or Article).');
    }
    const type = String(typed['@type']);
    if (NAP_REQUIRED.test(type)) {
      const missing = ['name', 'address', 'telephone'].filter((k) => !typed[k]);
      if (missing.length > 0) {
        return makeResult(this, 'warn', `${type} found but NAP incomplete (missing: ${missing.join(', ')})`,
          'Add name, address and telephone so AI assistants can cite your business consistently.');
      }
    }
    return makeResult(this, 'pass', `relevant entity found: ${type}`);
  },
};
