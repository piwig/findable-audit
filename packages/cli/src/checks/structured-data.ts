import { parse } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult } from '../types.js';
import {
  extractJsonLd, extractJsonLdBlocks, typesOf, flatten, isRef, isOrganizationType,
  NAP_REQUIRED_TYPES, str,
} from './jsonld.js';

export { extractJsonLd };

const RELEVANT_TYPES = new Set([
  'LocalBusiness', 'Organization', 'Corporation', 'OnlineBusiness',
  'Article', 'NewsArticle', 'BlogPosting', 'TechArticle',
  'Store', 'Restaurant', 'Bakery', 'Cafe', 'CafeOrCoffeeShop',
  'WebSite',
]);

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

// ---------------------------------------------------------------------------
// json-ld-valid
// ---------------------------------------------------------------------------

const SCHEMA_CONTEXT_RE = /^https?:\/\/(www\.)?schema\.org\/?$/i;

function validContext(ctxVal: unknown): boolean {
  if (typeof ctxVal === 'string') return SCHEMA_CONTEXT_RE.test(ctxVal);
  if (ctxVal && typeof ctxVal === 'object' && !Array.isArray(ctxVal)) {
    const v = (ctxVal as Record<string, unknown>)['@vocab'];
    return typeof v === 'string' && SCHEMA_CONTEXT_RE.test(v);
  }
  return false;
}

/** Validates one parsed JSON-LD block (top object, or array of top objects); returns a reason string or null. */
function invalidReason(parsed: unknown): string | null {
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') return 'block is not a JSON object';
    const d = doc as Record<string, unknown>;
    if (!validContext(d['@context'])) return 'missing/non-schema.org @context';
    const graphNodes = Array.isArray(d['@graph']) ? (d['@graph'] as Record<string, unknown>[]) : [d];
    for (const node of graphNodes) {
      if (typesOf(node).length === 0) return 'missing @type';
    }
  }
  return null;
}

export const jsonLdValid: Check = {
  id: 'json-ld-valid', family: 'structured-data', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const blocks = extractJsonLdBlocks(res.body);
    if (blocks.length === 0) {
      return makeResult(this, 'fail', 'no JSON-LD block found',
        'Add a <script type="application/ld+json"> block.');
    }
    for (const b of blocks) {
      if (b.parseError !== undefined) {
        return makeResult(this, 'fail', `invalid JSON-LD block (parse error: ${b.parseError})`,
          'Fix trailing commas/unescaped quotes in the JSON-LD block.');
      }
      const reason = invalidReason(b.parsed);
      if (reason) {
        return makeResult(this, 'fail', `invalid JSON-LD block (${reason})`,
          'Set "@context":"https://schema.org" and an explicit @type on every node.');
      }
    }
    return makeResult(this, 'pass', `${blocks.length} JSON-LD block(s) all valid (parse + @context + @type)`);
  },
};

// ---------------------------------------------------------------------------
// sd-organization
// ---------------------------------------------------------------------------

function logoUrl(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = (value as Record<string, unknown>).url;
    if (typeof v === 'string') return v;
  }
  return '';
}

function sameAsList(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr.filter((v): v is string => typeof v === 'string' && /^https?:\/\//i.test(v));
}

export const sdOrganization: Check = {
  id: 'sd-organization', family: 'structured-data', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const nodes = flatten(extractJsonLd(res.body));
    const entity = nodes.find((n) => typesOf(n).some(isOrganizationType));
    if (!entity) {
      return makeResult(this, 'fail', 'no Organization/LocalBusiness entity found',
        'Add an Organization or LocalBusiness node to the homepage JSON-LD.');
    }
    const name = str(entity.name);
    const url = str(entity.url);
    const logo = logoUrl(entity.logo);
    const logoAbsHttps = /^https:\/\//i.test(logo);
    const sameAs = sameAsList(entity.sameAs);
    const missing: string[] = [];
    if (!name) missing.push('name');
    if (!url) missing.push('url');
    if (!logoAbsHttps) missing.push('logo (absolute https)');
    if (sameAs.length === 0) missing.push('sameAs');
    if (missing.length > 0) {
      return makeResult(this, 'warn', `Organization entity incomplete (missing: ${missing.join(', ')})`,
        'Add name/url/square-logo/sameAs to the homepage @graph.');
    }
    return makeResult(this, 'pass', `Organization entity complete: ${name}`);
  },
};

// ---------------------------------------------------------------------------
// sd-entity-grounding
// ---------------------------------------------------------------------------

const WIKI_KG_RE = /^https?:\/\/([a-z]{2,3}\.)?wikipedia\.org\//i;
const WIKIDATA_KG_RE = /^https?:\/\/(www\.)?wikidata\.org\/(wiki|entity)\/Q\d+/i;

export const sdEntityGrounding: Check = {
  id: 'sd-entity-grounding', family: 'structured-data', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const nodes = flatten(extractJsonLd(res.body));
    const urls = new Set<string>();
    for (const n of nodes) for (const u of sameAsList(n.sameAs)) urls.add(u);
    if (urls.size === 0) {
      return makeResult(this, 'fail', 'weak entity grounding (sameAs)',
        'List official LinkedIn/GitHub/Wikipedia/Wikidata profiles in sameAs.');
    }
    const hasKgAnchor = [...urls].some((u) => WIKI_KG_RE.test(u) || WIKIDATA_KG_RE.test(u));
    if (urls.size >= 2 && hasKgAnchor) {
      return makeResult(this, 'pass', `${urls.size} sameAs profile(s) incl. a knowledge-graph anchor`);
    }
    if (urls.size >= 2) {
      return makeResult(this, 'warn', `${urls.size} sameAs profile(s) but no Wikipedia/Wikidata anchor`,
        'Add a Wikipedia or Wikidata sameAs entry for stronger entity grounding.');
    }
    return makeResult(this, 'warn', 'only 1 sameAs profile URL',
      'List ≥2 official profile URLs in sameAs, including Wikipedia/Wikidata if available.');
  },
};

// ---------------------------------------------------------------------------
// sd-localbusiness
// ---------------------------------------------------------------------------

function isPostalAddressObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const ADDRESS_FIELDS = ['streetAddress', 'addressLocality', 'postalCode', 'addressCountry'];

export const sdLocalBusiness: Check = {
  id: 'sd-localbusiness', family: 'structured-data', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const nodes = flatten(extractJsonLd(res.body));
    const entity = nodes.find((n) => typesOf(n).some((t) => NAP_REQUIRED_TYPES.has(t) || t.endsWith('Business')));
    if (!entity) return makeResult(this, 'skip', 'no LocalBusiness entity on the homepage');
    const address = entity.address;
    if (!address) {
      return makeResult(this, 'fail', 'LocalBusiness NAP/geo/hours incomplete (no structured address)',
        'Add a structured PostalAddress to the LocalBusiness node.');
    }
    const telephone = str(entity.telephone);
    if (!telephone) {
      return makeResult(this, 'fail', 'LocalBusiness NAP/geo/hours incomplete (no telephone)',
        'Add a telephone number to the LocalBusiness node.');
    }
    const warnings: string[] = [];
    if (!isPostalAddressObject(address)) {
      warnings.push('bare-string address, not structured PostalAddress');
    } else {
      const missingFields = ADDRESS_FIELDS.filter((f) => !str((address as Record<string, unknown>)[f]));
      if (missingFields.length > 0) warnings.push(`address missing: ${missingFields.join(', ')}`);
    }
    if (!entity.geo) warnings.push('missing geo');
    if (!entity.openingHoursSpecification) warnings.push('missing openingHoursSpecification');
    if (warnings.length > 0) {
      return makeResult(this, 'warn', `LocalBusiness NAP/geo/hours incomplete (${warnings.join('; ')})`,
        'Use structured PostalAddress + GeoCoordinates + openingHoursSpecification.');
    }
    return makeResult(this, 'pass', 'LocalBusiness NAP + geo + opening hours complete');
  },
};

// ---------------------------------------------------------------------------
// sd-website-searchaction
// ---------------------------------------------------------------------------

function findSearchAction(entity: Record<string, unknown>): Record<string, unknown> | null {
  const pa = entity.potentialAction;
  const candidates = Array.isArray(pa) ? pa : pa ? [pa] : [];
  for (const c of candidates) {
    if (c && typeof c === 'object' && typesOf(c as Record<string, unknown>).includes('SearchAction')) {
      return c as Record<string, unknown>;
    }
  }
  return null;
}

export const sdWebsiteSearchAction: Check = {
  id: 'sd-website-searchaction', family: 'structured-data', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const nodes = flatten(extractJsonLd(res.body));
    const website = nodes.find((n) => typesOf(n).includes('WebSite'));
    if (!website) return makeResult(this, 'skip', 'no WebSite entity on the homepage');
    const action = findSearchAction(website);
    if (!action) {
      return makeResult(this, 'warn', 'WebSite present but no SearchAction (no sitelinks searchbox)',
        'Add potentialAction SearchAction with a urlTemplate and query-input.');
    }
    const target = action.target;
    const urlTemplate = typeof target === 'string' ? target
      : (target && typeof target === 'object' ? str((target as Record<string, unknown>).urlTemplate) : '');
    const queryInput = str(action['query-input']);
    const templateOk = urlTemplate.includes('{search_term_string}');
    const queryOk = queryInput.includes('search_term_string');
    if (!templateOk || !queryOk) {
      return makeResult(this, 'warn', 'SearchAction present but incomplete (target/query-input)',
        'Set target urlTemplate to include {search_term_string} and query-input to "required name=search_term_string".');
    }
    return makeResult(this, 'pass', 'WebSite SearchAction (sitelinks searchbox) valid');
  },
};

// ---------------------------------------------------------------------------
// sd-video
// ---------------------------------------------------------------------------

const VIDEO_EMBED_RE = /(youtube\.com\/embed|youtu\.be|player\.vimeo\.com)/i;

function hasVideoElement(root: ReturnType<typeof parse>): boolean {
  if (root.querySelector('video')) return true;
  for (const iframe of root.querySelectorAll('iframe')) {
    const src = iframe.getAttribute('src') ?? '';
    if (VIDEO_EMBED_RE.test(src)) return true;
  }
  return false;
}

function isIso8601Duration(v: unknown): boolean {
  return typeof v === 'string' && /^P(?=\d|T)(\d+Y)?(\d+M)?(\d+D)?(T(\d+H)?(\d+M)?(\d+S)?)?$/i.test(v);
}

export const sdVideo: Check = {
  id: 'sd-video', family: 'structured-data', maxPoints: 2,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const root = parse(res.body);
    const nodes = flatten(extractJsonLd(res.body));
    const video = nodes.find((n) => typesOf(n).includes('VideoObject'));
    const embedded = hasVideoElement(root);
    if (!embedded && !video) return makeResult(this, 'skip', 'no video content on the homepage');
    if (!video) {
      return makeResult(this, 'fail', 'video present without VideoObject markup',
        'Add a VideoObject JSON-LD node describing the embedded video.');
    }
    const missing: string[] = [];
    if (!str(video.name)) missing.push('name');
    if (!str(video.description)) missing.push('description');
    if (!/^https:\/\//i.test(str(video.thumbnailUrl))) missing.push('absolute thumbnailUrl');
    if (!str(video.uploadDate) || Number.isNaN(Date.parse(str(video.uploadDate)))) missing.push('ISO uploadDate');
    if (missing.length > 0) {
      return makeResult(this, 'fail', `video without complete VideoObject (missing: ${missing.join(', ')})`,
        'Add VideoObject name/description/absolute thumbnailUrl/ISO uploadDate.');
    }
    const bonusMissing: string[] = [];
    if (!str(video.contentUrl) && !str(video.embedUrl)) bonusMissing.push('contentUrl/embedUrl');
    if (!isIso8601Duration(video.duration)) bonusMissing.push('ISO duration');
    if (bonusMissing.length > 0) {
      return makeResult(this, 'warn', `VideoObject missing recommended ${bonusMissing.join(' and ')}`,
        'Add contentUrl/embedUrl and an ISO-8601 duration.');
    }
    return makeResult(this, 'pass', 'VideoObject complete');
  },
};

// ---------------------------------------------------------------------------
// sd-special-types
// ---------------------------------------------------------------------------

function stepsValid(steps: unknown): boolean {
  const arr = Array.isArray(steps) ? steps : steps ? [steps] : [];
  if (arr.length === 0) return false;
  return arr.every((s) => {
    if (typeof s === 'string') return s.trim().length > 0;
    if (s && typeof s === 'object') return !!str((s as Record<string, unknown>).text);
    return false;
  });
}

function validateSpecialType(node: Record<string, unknown>, type: string): string[] {
  const problems: string[] = [];
  if (type === 'HowTo') {
    if (!str(node.name)) problems.push('name');
    if (!stepsValid(node.step)) problems.push('step[].text');
  } else if (type === 'Event') {
    if (!str(node.name)) problems.push('name');
    const start = str(node.startDate);
    if (!start || Number.isNaN(Date.parse(start))) problems.push('ISO startDate');
    if (!node.location) problems.push('location');
  } else if (type === 'Recipe') {
    if (!str(node.name)) problems.push('name');
    if (!node.image) problems.push('image');
    const ingredients = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [];
    if (ingredients.length === 0) problems.push('recipeIngredient[]');
    const instructions = node.recipeInstructions;
    const hasInstructions = Array.isArray(instructions) ? instructions.length > 0 : !!str(instructions as string);
    if (!hasInstructions) problems.push('recipeInstructions');
  }
  return problems;
}

const SPECIAL_TYPES = ['HowTo', 'Event', 'Recipe'];

export const sdSpecialTypes: Check = {
  id: 'sd-special-types', family: 'structured-data', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const nodes = flatten(extractJsonLd(res.body));
    const present = nodes.filter((n) => typesOf(n).some((t) => SPECIAL_TYPES.includes(t)));
    if (present.length === 0) return makeResult(this, 'skip', 'no HowTo/Event/Recipe on the homepage');
    for (const node of present) {
      const type = typesOf(node).find((t) => SPECIAL_TYPES.includes(t))!;
      const problems = validateSpecialType(node, type);
      if (problems.length > 0) {
        return makeResult(this, 'fail', `${type} missing required fields (${problems.join(', ')})`,
          'Fill the required fields for the declared type; ISO dates, structured Place.');
      }
    }
    return makeResult(this, 'pass', `${present.length} special type(s) fully marked up`);
  },
};

// ---------------------------------------------------------------------------
// sd-graph-integrity
// ---------------------------------------------------------------------------

function collectRefs(value: unknown, out: string[]): void {
  if (Array.isArray(value)) { for (const v of value) collectRefs(v, out); return; }
  if (isRef(value)) { out.push(value['@id']); return; }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectRefs(v, out);
  }
}

export const sdGraphIntegrity: Check = {
  id: 'sd-graph-integrity', family: 'structured-data', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const nodes = flatten(extractJsonLd(res.body));
    const idOwners = new Map<string, number>();
    for (const n of nodes) {
      const id = n['@id'];
      if (typeof id === 'string' && id) idOwners.set(id, (idOwners.get(id) ?? 0) + 1);
    }
    if (idOwners.size === 0) return makeResult(this, 'skip', 'no @id used in JSON-LD on the homepage');
    const refs: string[] = [];
    for (const n of nodes) collectRefs(n, refs);
    const dangling = [...new Set(refs)].filter((r) => !idOwners.has(r));
    if (dangling.length > 0) {
      return makeResult(this, 'fail', `dangling @id reference: ${dangling.slice(0, 3).join(', ')}`,
        'Use one @graph with a stable @id per entity; reference by @id.');
    }
    const duplicated = [...idOwners.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    if (duplicated.length > 0) {
      return makeResult(this, 'warn', `duplicated @id: ${duplicated.slice(0, 3).join(', ')}`,
        'Declare each entity once and reference it by @id elsewhere.');
    }
    return makeResult(this, 'pass', `${idOwners.size} @id-linked entities, no dangling references`);
  },
};

// ---------------------------------------------------------------------------
// sd-consistency
// ---------------------------------------------------------------------------

function collectConsistencyValues(nodes: Record<string, unknown>[]): string[] {
  const values: string[] = [];
  for (const n of nodes) {
    const name = str(n.name) || str(n.headline);
    if (name) values.push(name);
    const offers = n.offers;
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const o of offerList) {
      if (o && typeof o === 'object') {
        const price = (o as Record<string, unknown>).price;
        if (price !== undefined && price !== null && String(price).trim()) values.push(String(price).trim());
      }
    }
    const rating = n.aggregateRating;
    if (rating && typeof rating === 'object') {
      const rv = (rating as Record<string, unknown>).ratingValue;
      if (rv !== undefined && rv !== null && String(rv).trim()) values.push(String(rv).trim());
    }
  }
  return values;
}

export const sdConsistency: Check = {
  id: 'sd-consistency', family: 'structured-data', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const nodes = flatten(extractJsonLd(res.body));
    const values = [...new Set(collectConsistencyValues(nodes))];
    if (values.length === 0) return makeResult(this, 'pass', 'no name/headline/price/rating values to verify');
    const root = parse(res.body);
    const bodyText = (root.querySelector('body')?.textContent ?? root.textContent ?? '').toLowerCase();
    const unmatched = values.filter((v) => !bodyText.includes(v.toLowerCase()));
    if (unmatched.length > 0) {
      return makeResult(this, 'warn', `JSON-LD may describe hidden content (unmatched: ${unmatched.slice(0, 3).join(', ')})`,
        'Only mark up content visible on the page.');
    }
    return makeResult(this, 'pass', `${values.length} JSON-LD value(s) confirmed visible on the page`);
  },
};
