// #24 — Google rich-result eligibility, layered on top of schema.org validity.
//
// The `sd-*` checks answer one question: is this markup structurally valid
// schema.org? Google answers a different one — will this actually render a rich
// result? — and publishes, per search feature, a table of REQUIRED and
// RECOMMENDED properties that schema.org itself never mandates. A REQUIRED
// property that is absent makes the feature ineligible: an unambiguous,
// verifiable defect against a published specification, so it may `fail`. A
// RECOMMENDED property that is absent only weakens the result, so it `warn`s and
// never more.
//
// Sourcing rules (this is the whole value of the check)
// ----------------------------------------------------
// Every field below is copied from the Google page named in the rule's `source`,
// read on the date in `reviewed`. Nothing is inferred from schema.org, from
// another SEO tool, or from memory. Where a documented field is deliberately NOT
// evaluated, the rule carries a `note` saying which field and why — an omission
// with a reason is honest, an invented rule is not.
//
// Two documented features are absent on purpose:
//
//   * Sitelinks search box (WebSite + SearchAction). Google removed the feature
//     from Search and took the documentation down (changelog, 29 Nov 2024,
//     "no longer available in Google Search results"). There is no current
//     required-field table to encode, so none is invented here; `sd-website-
//     searchaction` still grades the markup structurally against schema.org.
//   * FAQ, HowTo, Q&A. Google restricted or retired these result types; `sd-faq`
//     and `sd-special-types` already grade their markup.
//
// The check never fetches anything: it reads the JSON-LD already extracted from
// the crawled pages.

import type { Check } from '../types.js';
import { makeResult, t } from '../types.js';
import { pagesOf, pathOf } from './aggregate.js';
import {
  extractJsonLd, flatten, typesOf, byId, resolveValue, rollupBySeverity, str,
  type SeverityItem,
} from './jsonld.js';

// ---------------------------------------------------------------------------
// The rule table
// ---------------------------------------------------------------------------

/**
 * Beyond mere presence, the shape a value must have to satisfy a rule. Each one
 * is a format Google states explicitly (ISO 8601 dates and durations, ISO 4217
 * currency codes), never a bar we invented.
 */
export type FieldShape = 'date' | 'duration' | 'currency' | 'number';

export interface FieldRule {
  /**
   * Dotted property path inside the node, e.g. `offers.price`. A `[]` segment
   * (`itemListElement[].name`) means "every element of that array must carry the
   * rest of the path" — the only place Google states a per-element requirement.
   */
  path: string;
  /** Google's "X or Y": any one of these paths satisfies the rule. */
  or?: string[];
  /** How to name the rule in the report; defaults to `path`. Set it when `or` makes the bare path misleading. */
  label?: string;
  /** Format the value must respect, when Google states one. */
  shape?: FieldShape;
  /** Waived when the node is nested inside the item it describes (Google's own exemption). */
  nestedExempt?: boolean;
  /** Why this rule is worded the way it is; kept next to the rule, not in prose elsewhere. */
  note?: string;
}

export interface RichResultRule {
  /** Google's name for the search feature, used verbatim in the report. */
  feature: string;
  /** The documentation page every field below was copied from. */
  source: string;
  /** ISO date the page was read. Bump it when the rules are re-checked. */
  reviewed: string;
  /** schema.org `@type` values that put a node in scope for this feature. */
  types: string[];
  /** Rule applies only when every one of these paths is present on the node. */
  appliesWhen?: string[];
  /** Rule does not apply when any of these paths is present on the node. */
  appliesUnless?: string[];
  /** Absent → the rich result is ineligible. */
  required: FieldRule[];
  /** Absent → eligible but weaker. */
  recommended: FieldRule[];
  /** Documented fields deliberately left out of the lists above, and why. */
  omitted?: string;
}

/**
 * Google's rich-result field requirements, one entry per search feature.
 *
 * Versioned on purpose: when Google moves a field between Required and
 * Recommended (it happened to the whole Article feature), the change is one
 * line here plus a new `reviewed` date, not a hunt through imperative code.
 */
export const GOOGLE_RICH_RESULT_RULES: RichResultRule[] = [
  {
    feature: 'Article',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/article',
    reviewed: '2026-07-27',
    // Google: "must be based on one of these schema.org types: Article,
    // NewsArticle, BlogPosting". TechArticle is a schema.org subtype but is not
    // in Google's list, so it is not claimed here.
    types: ['Article', 'NewsArticle', 'BlogPosting'],
    // Google states it outright: "There are no required properties; instead, add
    // the properties that apply to your content." So this feature can only warn.
    required: [],
    recommended: [
      { path: 'author' },
      { path: 'author.name' },
      { path: 'author.url' },
      { path: 'datePublished', shape: 'date' },
      { path: 'dateModified', shape: 'date' },
      { path: 'headline' },
      { path: 'image' },
    ],
  },
  {
    feature: 'Product snippet',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/product-snippet',
    reviewed: '2026-07-27',
    types: ['Product'],
    // A Product that carries `offers` is a merchant listing and is graded by the
    // stricter rule below instead; grading both would report the same node twice.
    appliesUnless: ['offers'],
    required: [
      { path: 'name' },
      {
        path: 'review',
        or: ['aggregateRating', 'offers'],
        label: 'review, aggregateRating or offers',
        note: 'Google: "Product snippets require either review or aggregateRating or offers."',
      },
    ],
    recommended: [
      { path: 'aggregateRating' },
      { path: 'review' },
    ],
  },
  {
    feature: 'Merchant listing',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/merchant-listing',
    reviewed: '2026-07-27',
    types: ['Product'],
    appliesWhen: ['offers'],
    required: [
      { path: 'name' },
      { path: 'image' },
      { path: 'offers' },
      {
        path: 'offers.price',
        or: ['offers.priceSpecification.price', 'offers.lowPrice'],
        note: 'lowPrice accepted although merchant listings need an Offer, not an AggregateOffer: '
          + 'reporting "no price" on a priced AggregateOffer would be a false finding.',
      },
      { path: 'offers.priceCurrency', or: ['offers.priceSpecification.priceCurrency'], shape: 'currency' },
    ],
    recommended: [
      { path: 'aggregateRating' },
      { path: 'brand.name' },
      { path: 'description' },
      {
        path: 'gtin',
        or: ['gtin8', 'gtin12', 'gtin13', 'gtin14', 'isbn', 'mpn', 'sku'],
        label: 'a product identifier (gtin/isbn/mpn/sku)',
        note: 'Google lists the identifiers separately; any one of them identifies the product.',
      },
      { path: 'offers.availability' },
      { path: 'offers.itemCondition' },
      { path: 'offers.priceValidUntil', shape: 'date' },
      { path: 'offers.url' },
      { path: 'review' },
    ],
    omitted: 'audience, category, color, hasAdultConsideration, hasCertification, inProductGroupWithID, '
      + 'isVariantOf, material, pattern, size, subjectOf, hasMerchantReturnPolicy, shippingDetails, '
      + 'validFrom, validThrough — all documented as Recommended but only meaningful for catalogues a '
      + 'crawl cannot judge (variants, certifications, per-country shipping policies).',
  },
  {
    feature: 'Recipe',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/recipe',
    reviewed: '2026-07-27',
    types: ['Recipe'],
    required: [
      { path: 'name' },
      { path: 'image' },
    ],
    recommended: [
      { path: 'aggregateRating' },
      { path: 'author' },
      { path: 'cookTime', shape: 'duration' },
      { path: 'datePublished', shape: 'date' },
      { path: 'description' },
      { path: 'keywords' },
      { path: 'nutrition.calories' },
      { path: 'prepTime', shape: 'duration' },
      { path: 'recipeCategory' },
      { path: 'recipeCuisine' },
      { path: 'recipeIngredient' },
      { path: 'recipeInstructions' },
      { path: 'recipeYield' },
      { path: 'totalTime', shape: 'duration' },
      { path: 'video' },
    ],
  },
  {
    feature: 'Event',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/event',
    reviewed: '2026-07-27',
    types: ['Event'],
    required: [
      { path: 'name' },
      { path: 'startDate', shape: 'date' },
      {
        path: 'location',
        note: 'Google documents location only with @type Place; "Virtual experiences that have no '
          + 'real-world component aren\'t supported."',
      },
      { path: 'location.address' },
    ],
    recommended: [
      { path: 'description' },
      { path: 'endDate', shape: 'date' },
      { path: 'eventStatus' },
      { path: 'image' },
      { path: 'location.name' },
      { path: 'offers' },
      { path: 'offers.availability' },
      { path: 'offers.price' },
      { path: 'offers.priceCurrency', shape: 'currency' },
      { path: 'offers.url' },
      { path: 'organizer' },
      { path: 'organizer.name' },
      { path: 'performer' },
      { path: 'performer.name' },
    ],
    omitted: 'previousStartDate and offers.validFrom — documented as Recommended but scoped by Google to '
      + 'rescheduled events and to ticket-sale windows; reporting them on every event would be noise.',
  },
  {
    feature: 'Breadcrumb',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
    reviewed: '2026-07-27',
    types: ['BreadcrumbList'],
    required: [
      { path: 'itemListElement' },
      {
        path: 'itemListElement[].name',
        or: ['itemListElement[].item.name'],
        note: 'Google: name is not required when item is a Thing that carries its own name.',
      },
      { path: 'itemListElement[].position', shape: 'number' },
    ],
    recommended: [],
    omitted: 'ListItem.item — required by Google except on the final breadcrumb, an exemption this flat '
      + 'field table cannot express; sd-breadcrumb already validates the ordered chain and its terminal item.',
  },
  {
    feature: 'Video',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/video',
    reviewed: '2026-07-27',
    types: ['VideoObject'],
    required: [
      { path: 'name' },
      { path: 'thumbnailUrl' },
      { path: 'uploadDate', shape: 'date' },
    ],
    recommended: [
      { path: 'contentUrl', or: ['embedUrl'], label: 'contentUrl or embedUrl' },
      { path: 'description' },
      { path: 'duration', shape: 'duration' },
    ],
    omitted: 'expires, hasPart, ineligibleRegion, interactionStatistic, publication, regionsAllowed — '
      + 'documented as Recommended but each conditional on a circumstance a crawl cannot observe '
      + '(the video expires, it has clips, it is a livestream, it is region-locked).',
  },
  {
    feature: 'Review snippet',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/review-snippet',
    reviewed: '2026-07-27',
    types: ['Review'],
    required: [
      { path: 'author' },
      { path: 'itemReviewed', nestedExempt: true },
      { path: 'itemReviewed.name', nestedExempt: true },
      { path: 'reviewRating' },
      { path: 'reviewRating.ratingValue', shape: 'number' },
    ],
    recommended: [
      { path: 'datePublished', shape: 'date' },
      { path: 'reviewRating.bestRating', shape: 'number' },
      { path: 'reviewRating.worstRating', shape: 'number' },
    ],
  },
  {
    feature: 'Aggregate rating',
    source: 'https://developers.google.com/search/docs/appearance/structured-data/review-snippet',
    reviewed: '2026-07-27',
    types: ['AggregateRating'],
    required: [
      { path: 'itemReviewed', nestedExempt: true },
      { path: 'itemReviewed.name', nestedExempt: true },
      { path: 'ratingValue', shape: 'number' },
      {
        path: 'ratingCount',
        or: ['reviewCount'],
        shape: 'number',
        label: 'ratingCount or reviewCount',
        note: 'Google: "At least one of ratingCount or reviewCount is required."',
      },
    ],
    recommended: [
      { path: 'bestRating', shape: 'number' },
      { path: 'worstRating', shape: 'number' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

type Ids = Map<string, Record<string, unknown>>;

/** ISO 8601 duration, the form Google asks for on cookTime/prepTime/duration. */
const ISO_DURATION_RE = /^P(?=\d|T)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+(\.\d+)?H)?(\d+(\.\d+)?M)?(\d+(\.\d+)?S)?)?$/i;

/** A value counts as present when it carries something: no empty string, array or object. */
function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function shapeOk(value: unknown, shape?: FieldShape): boolean {
  if (shape === undefined) return true;
  switch (shape) {
    case 'date': return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'duration': return typeof value === 'string' && ISO_DURATION_RE.test(value.trim());
    // ISO 4217 alphabetic code, the form Google spells out: "three-letter ISO 4217 format".
    case 'currency': return /^[A-Z]{3}$/.test(str(value));
    case 'number': return value !== '' && Number.isFinite(Number(value));
  }
}

/**
 * Every value reachable at a dotted path, resolving `{"@id": …}` references
 * against the page graph and flattening arrays along the way ("any" semantics —
 * one filled element satisfies the path).
 */
function valuesAt(node: Record<string, unknown>, path: string, ids: Ids): unknown[] {
  let current: unknown[] = [node];
  for (const segment of path.split('.')) {
    const next: unknown[] = [];
    for (const value of current) {
      const holder = resolveValue(value, ids);
      for (const item of Array.isArray(holder) ? holder : [holder]) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const raw = resolveValue((item as Record<string, unknown>)[segment], ids);
        if (raw === undefined || raw === null) continue;
        if (Array.isArray(raw)) next.push(...raw);
        else next.push(raw);
      }
    }
    if (next.length === 0) return [];
    current = next;
  }
  return current;
}

type FieldVerdict = 'ok' | 'missing' | 'invalid' | 'n/a';

/** `a.b.c` → `a.b`; a single segment has no parent. */
function parentPath(path: string): string | null {
  const cut = path.lastIndexOf('.');
  return cut === -1 ? null : path.slice(0, cut);
}

/** `itemListElement[].name` → the array path and the per-element suffix. */
function splitEvery(path: string): { array: string; suffix: string } | null {
  const at = path.indexOf('[]');
  if (at === -1) return null;
  return { array: path.slice(0, at), suffix: path.slice(at + 2).replace(/^\./, '') };
}

/** Every element of the array at `array` carries at least one of the `suffixes`. */
function everyElementHas(
  node: Record<string, unknown>, array: string, suffixes: string[], shape: FieldShape | undefined, ids: Ids,
): FieldVerdict {
  const elements = valuesAt(node, array, ids);
  if (elements.length === 0) return 'n/a';
  let sawInvalid = false;
  for (const element of elements) {
    const holder = resolveValue(element, ids);
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return 'missing';
    const found = suffixes.flatMap((s) => valuesAt(holder as Record<string, unknown>, s, ids)).filter(isFilled);
    if (found.length === 0) return 'missing';
    if (!found.some((v) => shapeOk(v, shape))) sawInvalid = true;
  }
  return sawInvalid ? 'invalid' : 'ok';
}

/**
 * Is this field satisfied on this node?
 *
 * `n/a` means the field could not be judged because its container is absent —
 * an Event without `offers` is not "missing offers.price", it simply has no
 * offer, and the `offers` rule alone reports that.
 */
function checkField(node: Record<string, unknown>, field: FieldRule, ids: Ids): FieldVerdict {
  const paths = [field.path, ...(field.or ?? [])];
  const every = splitEvery(field.path);
  if (every) {
    const suffixes = paths.map((p) => splitEvery(p)?.suffix ?? p);
    return everyElementHas(node, every.array, suffixes, field.shape, ids);
  }
  const found = paths.flatMap((p) => valuesAt(node, p, ids)).filter(isFilled);
  if (found.length > 0) return found.some((v) => shapeOk(v, field.shape)) ? 'ok' : 'invalid';
  const parent = parentPath(field.path);
  if (parent && valuesAt(node, parent, ids).filter(isFilled).length === 0) return 'n/a';
  return 'missing';
}

// ---------------------------------------------------------------------------
// Node selection
// ---------------------------------------------------------------------------

/** `https://schema.org/Product` and `schema:Product` both mean `Product`. */
function normalizedTypes(node: Record<string, unknown>): string[] {
  return typesOf(node).map((type) => type.replace(/^https?:\/\/(www\.)?schema\.org\//i, '').replace(/^schema:/i, ''));
}

interface Candidate {
  node: Record<string, unknown>;
  /** true when the node is the value of another node's `review`/`aggregateRating`. */
  nested: boolean;
}

/**
 * Nodes to grade: the flattened graph, plus the `review`/`aggregateRating`
 * objects hanging off it. Those two live inline on the item they describe far
 * more often than they live in a `@graph`, and Google waives `itemReviewed`
 * exactly for that nested case — so they are collected, and marked.
 */
function candidatesOf(nodes: Record<string, unknown>[], ids: Ids): Candidate[] {
  const nested = new Set<Record<string, unknown>>();
  const inline: Record<string, unknown>[] = [];
  const top = new Set(nodes);
  for (const node of nodes) {
    for (const key of ['review', 'aggregateRating']) {
      const raw = resolveValue(node[key], ids);
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const child = value as Record<string, unknown>;
        nested.add(child);
        if (!top.has(child)) inline.push(child);
      }
    }
  }
  const seen = new Set<Record<string, unknown>>();
  const out: Candidate[] = [];
  for (const node of [...nodes, ...inline]) {
    if (seen.has(node)) continue;
    seen.add(node);
    out.push({ node, nested: nested.has(node) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface RuleOutcome {
  feature: string;
  /** Missing (or malformed) REQUIRED fields — the rich result cannot render. */
  required: string[];
  /** Missing (or malformed) RECOMMENDED fields — it renders, weaker. */
  recommended: string[];
}

function label(field: FieldRule, verdict: FieldVerdict): string {
  const name = field.label ?? field.path;
  return verdict === 'invalid' ? `${name} (invalid)` : name;
}

/** Grades one node against one rule; `null` when the rule does not apply to it. */
export function evaluateRule(
  node: Record<string, unknown>, rule: RichResultRule, nested: boolean, ids: Ids,
): RuleOutcome | null {
  const types = normalizedTypes(node);
  if (!types.some((type) => rule.types.includes(type))) return null;
  if (rule.appliesWhen?.some((p) => valuesAt(node, p, ids).filter(isFilled).length === 0)) return null;
  if (rule.appliesUnless?.some((p) => valuesAt(node, p, ids).filter(isFilled).length > 0)) return null;

  const gather = (fields: FieldRule[]): string[] => {
    const gaps: string[] = [];
    for (const field of fields) {
      if (nested && field.nestedExempt) continue;
      const verdict = checkField(node, field, ids);
      if (verdict === 'missing' || verdict === 'invalid') gaps.push(label(field, verdict));
    }
    return gaps;
  };
  return { feature: rule.feature, required: gather(rule.required), recommended: gather(rule.recommended) };
}

/** Up to `max` names, then "+N more" — keeps a long recommended list readable. */
function condense(fields: string[], max = 3): string {
  const shown = fields.slice(0, max).join(', ');
  return fields.length > max ? `${shown} +${fields.length - max} more` : shown;
}

export const richResultEligibility: Check = {
  id: 'rich-result-eligibility', family: 'structured-data', evidence: 'measured', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const items: SeverityItem[] = [];
    let graded = 0;

    for (const page of pages) {
      const nodes = flatten(extractJsonLd(page.body));
      const ids = byId(nodes);
      const gaps: string[] = [];
      let status: 'pass' | 'warn' | 'fail' = 'pass';
      let onThisPage = 0;

      for (const { node, nested } of candidatesOf(nodes, ids)) {
        for (const rule of GOOGLE_RICH_RESULT_RULES) {
          const outcome = evaluateRule(node, rule, nested, ids);
          if (!outcome) continue;
          onThisPage += 1;
          if (outcome.required.length > 0) {
            status = 'fail';
            gaps.push(`${outcome.feature} needs ${condense(outcome.required)}`);
          } else if (outcome.recommended.length > 0) {
            if (status !== 'fail') status = 'warn';
            gaps.push(`${outcome.feature} recommends ${condense(outcome.recommended)}`);
          }
        }
      }

      if (onThisPage === 0) continue;
      graded += onThisPage;
      items.push({ path: pathOf(page), status, reason: gaps.length > 0 ? condense(gaps, 2) : undefined });
    }

    if (graded === 0) {
      return makeResult(this, 'skip', 'no type with published Google rich-result requirements in the sampled JSON-LD');
    }
    const rollup = rollupBySeverity(items);
    if (rollup.status === 'pass') {
      return makeResult(this, 'pass', t`${graded} rich-result candidate(s) carry every field Google requires and recommends`);
    }
    return makeResult(this, rollup.status, t`Google rich-result requirements unmet on: ${rollup.detail}`,
      'Fill the REQUIRED properties Google publishes for each type you mark up — a missing one makes the rich result ineligible, whatever schema.org allows.');
  },
};
