import { parse } from 'node-html-parser';
import type { Check, FetchedResource } from '../types.js';
import { makeResult } from '../types.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import {
  extractJsonLd, flatten, typesOf, byId, resolveValue, isOrganizationType,
  NAP_REQUIRED_TYPES, rollupBySeverity, normalizePhone, addressString, str,
  type SeverityItem,
} from './jsonld.js';

function nodesOf(page: FetchedResource): Record<string, unknown>[] {
  return flatten(extractJsonLd(page.body));
}

// ---------------------------------------------------------------------------
// sd-article
// ---------------------------------------------------------------------------

const ARTICLE_TYPES = ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle'];

function isStructuredPerson(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typesOf(o).includes('Person') && !!str(o.name);
}

function imageOk(image: unknown): boolean {
  if (typeof image === 'string') return !!image;
  if (Array.isArray(image)) return image.length > 0 && image.every((i) => imageOk(i));
  if (image && typeof image === 'object') {
    const o = image as Record<string, unknown>;
    if (typeof o.width === 'number') return o.width >= 1200;
    return !!str(o.url);
  }
  return false;
}

function classifyArticle(
  node: Record<string, unknown>,
  ids: Map<string, Record<string, unknown>>,
): { status: 'pass' | 'warn' | 'fail'; reason?: string } {
  const headline = str(node.headline) || str(node.name);
  if (!headline) return { status: 'fail', reason: 'missing headline' };
  const datePublished = str(node.datePublished);
  if (datePublished && Number.isNaN(Date.parse(datePublished))) {
    return { status: 'fail', reason: 'datePublished is unparseable' };
  }
  const warnings: string[] = [];
  if (headline.length > 110) warnings.push('headline over 110 chars');
  if (!isStructuredPerson(resolveValue(node.author, ids))) warnings.push('author missing/not a structured Person');
  if (!datePublished) warnings.push('missing datePublished');
  if (!str(node.dateModified)) warnings.push('missing dateModified');
  if (!imageOk(resolveValue(node.image, ids))) warnings.push('missing/undersized image');
  const publisher = resolveValue(node.publisher, ids);
  const publisherLogo = publisher && typeof publisher === 'object' ? (publisher as Record<string, unknown>).logo : undefined;
  if (!publisherLogo) warnings.push('missing publisher.logo');
  if (warnings.length === 0) return { status: 'pass' };
  return { status: 'warn', reason: warnings.join('; ') };
}

export const sdArticle: Check = {
  id: 'sd-article', family: 'structured-data', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const items: SeverityItem[] = [];
    let found = false;
    for (const page of pages) {
      const nodes = nodesOf(page);
      const ids = byId(nodes);
      const article = nodes.find((n) => typesOf(n).some((t) => ARTICLE_TYPES.includes(t)));
      if (!article) continue;
      found = true;
      const { status, reason } = classifyArticle(article, ids);
      items.push({ path: pathOf(page), status, reason });
    }
    if (!found) return makeResult(this, 'skip', 'no Article/NewsArticle/BlogPosting page in the sample');
    const rollup = rollupBySeverity(items);
    if (rollup.status === 'pass') return makeResult(this, 'pass', 'Article markup complete on all sampled article pages');
    return makeResult(this, rollup.status, `Article markup incomplete on: ${rollup.detail}`,
      'Add headline/author/datePublished + dateModified/image/publisher.logo.');
  },
};

// ---------------------------------------------------------------------------
// sd-product
// ---------------------------------------------------------------------------

const AVAILABILITY_ENUM = new Set([
  'InStock', 'OutOfStock', 'PreOrder', 'Discontinued', 'InStoreOnly', 'OnlineOnly',
  'LimitedAvailability', 'SoldOut', 'PreSale', 'BackOrder', 'Reserved',
]);

function stripSchemaPrefix(v: string): string {
  return v.replace(/^https?:\/\/schema\.org\//i, '');
}

function classifyProduct(
  node: Record<string, unknown>,
  ids: Map<string, Record<string, unknown>>,
): { status: 'pass' | 'warn' | 'fail'; reason?: string } {
  const offersRaw = resolveValue(node.offers, ids);
  const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
  if (!offer || typeof offer !== 'object') return { status: 'fail', reason: 'missing offers' };
  const o = offer as Record<string, unknown>;
  const price = o.price ?? o.lowPrice;
  const priceOk = price !== undefined && price !== null && !Number.isNaN(Number(price));
  if (!priceOk) return { status: 'fail', reason: 'missing/invalid price' };
  const currency = str(o.priceCurrency);
  if (!/^[A-Z]{3}$/.test(currency)) return { status: 'fail', reason: 'invalid priceCurrency' };
  const rating = resolveValue(node.aggregateRating, ids);
  if (rating && typeof rating === 'object') {
    const r = rating as Record<string, unknown>;
    const ratingValue = Number(r.ratingValue);
    const bestRating = r.bestRating !== undefined ? Number(r.bestRating) : 5;
    if (!Number.isNaN(ratingValue) && (ratingValue < 1 || ratingValue > bestRating)) {
      return { status: 'fail', reason: 'aggregateRating out of range' };
    }
  }
  const warnings: string[] = [];
  if (!str(node.name)) warnings.push('missing name');
  if (!node.image) warnings.push('missing image');
  const availability = stripSchemaPrefix(str(o.availability));
  if (!AVAILABILITY_ENUM.has(availability)) warnings.push('missing/invalid availability');
  if (!node.brand) warnings.push('missing brand');
  if (!rating || typeof rating !== 'object') {
    warnings.push('missing aggregateRating');
  } else {
    const r = rating as Record<string, unknown>;
    if (!r.reviewCount && !r.ratingCount) warnings.push('aggregateRating missing count');
  }
  const hasIdentifier = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn'].some((k) => str(node[k]));
  if (!hasIdentifier) warnings.push('missing gtin/mpn');
  if (warnings.length === 0) return { status: 'pass' };
  return { status: 'warn', reason: warnings.join('; ') };
}

export const sdProduct: Check = {
  id: 'sd-product', family: 'structured-data', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const items: SeverityItem[] = [];
    let found = false;
    for (const page of pages) {
      const nodes = nodesOf(page);
      const ids = byId(nodes);
      const product = nodes.find((n) => typesOf(n).includes('Product'));
      if (!product) continue;
      found = true;
      const { status, reason } = classifyProduct(product, ids);
      items.push({ path: pathOf(page), status, reason });
    }
    if (!found) return makeResult(this, 'skip', 'no Product page in the sample');
    const rollup = rollupBySeverity(items);
    if (rollup.status === 'pass') return makeResult(this, 'pass', 'Product offer markup complete on all sampled product pages');
    return makeResult(this, rollup.status, `Product offer incomplete on: ${rollup.detail}`,
      'Add offers(price/priceCurrency/availability) + brand + gtin/mpn.');
  },
};

// ---------------------------------------------------------------------------
// sd-faq
// ---------------------------------------------------------------------------

const QUESTION_START_RE = /^(what|how|why|when|where|who|which|can|do|does|is|are)\b/i;

function countSchemaFaqPairs(nodes: Record<string, unknown>[], ids: Map<string, Record<string, unknown>>): number {
  let count = 0;
  for (const n of nodes) {
    if (!typesOf(n).some((t) => t === 'FAQPage' || t === 'QAPage')) continue;
    const mainEntity = resolveValue(n.mainEntity, ids);
    const questions = Array.isArray(mainEntity) ? mainEntity : mainEntity ? [mainEntity] : [];
    for (const q of questions) {
      if (!q || typeof q !== 'object') continue;
      const qo = q as Record<string, unknown>;
      if (!typesOf(qo).includes('Question')) continue;
      const answer = resolveValue(qo.acceptedAnswer, ids);
      const answerText = answer && typeof answer === 'object' ? str((answer as Record<string, unknown>).text) : '';
      if (str(qo.name) && answerText) count += 1;
    }
  }
  return count;
}

function countDetailsFaq(root: ReturnType<typeof parse>): number {
  let count = 0;
  for (const details of root.querySelectorAll('details')) {
    const summary = details.querySelector('summary');
    const summaryText = summary?.textContent.trim() ?? '';
    const bodyText = details.textContent.replace(summaryText, '').trim();
    if (summaryText && bodyText.length > 5) count += 1;
  }
  return count;
}

function countHeadingFaq(root: ReturnType<typeof parse>): number {
  let count = 0;
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (h.closest('nav, header, footer, aside')) continue;
    const text = h.textContent.trim();
    const questionLike = text.endsWith('?') || QUESTION_START_RE.test(text);
    if (!questionLike) continue;
    const sibling = h.nextElementSibling;
    if (sibling && sibling.tagName === 'P' && sibling.textContent.trim().length > 10) count += 1;
  }
  return count;
}

export const sdFaq: Check = {
  id: 'sd-faq', family: 'structured-data', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const offenders: string[] = [];
    let faqShapeFound = false;
    for (const page of pages) {
      const nodes = nodesOf(page);
      const ids = byId(nodes);
      const schemaPairs = countSchemaFaqPairs(nodes, ids);
      const root = parse(page.body);
      const detailsPairs = countDetailsFaq(root);
      const headingPairs = countHeadingFaq(root);
      const onPagePairs = Math.max(detailsPairs, headingPairs);
      const hasFaqShape = schemaPairs >= 2 || onPagePairs >= 2;
      if (!hasFaqShape) continue;
      faqShapeFound = true;
      if (schemaPairs < 2) offenders.push(pathOf(page));
    }
    if (!faqShapeFound) return makeResult(this, 'skip', 'no FAQ-shaped content in the sample');
    if (offenders.length === 0) return makeResult(this, 'pass', 'FAQ content backed by FAQPage/QAPage schema');
    const shown = offenders.slice(0, 3).join(', ');
    const more = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
    return makeResult(this, 'warn', `FAQ present without FAQPage schema on: ${shown}${more}`,
      'Mark FAQs as FAQPage → Question → acceptedAnswer.text.');
  },
};

// ---------------------------------------------------------------------------
// sd-breadcrumb
// ---------------------------------------------------------------------------

function validateBreadcrumbList(node: Record<string, unknown>, ids: Map<string, Record<string, unknown>>): boolean {
  const itemsRaw = resolveValue(node.itemListElement, ids);
  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
  if (items.length === 0) return false;
  const objItems = items.map((it) => (it && typeof it === 'object' ? (it as Record<string, unknown>) : null));
  if (objItems.some((it) => !it)) return false;
  const positions = objItems.map((it) => Number(it!.position));
  const expected = Array.from({ length: items.length }, (_, i) => i + 1);
  if (JSON.stringify([...positions].sort((a, b) => a - b)) !== JSON.stringify(expected)) return false;
  const byPosition = [...objItems].sort((a, b) => Number(a!.position) - Number(b!.position));
  for (let i = 0; i < byPosition.length; i++) {
    const it = byPosition[i]!;
    if (!typesOf(it).includes('ListItem')) return false;
    if (!str(it.name)) return false;
    const isTerminal = i === byPosition.length - 1;
    if (!isTerminal && !str(it.item)) return false;
  }
  return true;
}

function hasBreadcrumbNav(root: ReturnType<typeof parse>): boolean {
  return !!root.querySelector('nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i]');
}

export const sdBreadcrumb: Check = {
  id: 'sd-breadcrumb', family: 'structured-data', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const interior = pages.filter((p) => pathOf(p) !== '/');
    if (interior.length === 0) return makeResult(this, 'skip', 'homepage-only sample');
    const offenders: string[] = [];
    for (const page of interior) {
      const nodes = nodesOf(page);
      const ids = byId(nodes);
      const bc = nodes.find((n) => typesOf(n).includes('BreadcrumbList'));
      const schemaOk = !!bc && validateBreadcrumbList(bc, ids);
      const navOk = hasBreadcrumbNav(parse(page.body));
      if (!schemaOk && !navOk) offenders.push(pathOf(page));
    }
    if (offenders.length === 0) return makeResult(this, 'pass', 'breadcrumbs present on all interior pages');
    const shown = offenders.slice(0, 3).join(', ');
    const more = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
    return makeResult(this, 'warn', `no breadcrumbs on interior pages: ${shown}${more}`,
      'Emit BreadcrumbList with ordered position/name/item.');
  },
};

// ---------------------------------------------------------------------------
// nap-consistency
// ---------------------------------------------------------------------------

const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g;
/** Segment separators seen in footer NAP strings: em/en dash, pipe, middle dot. */
const NAP_SEGMENT_RE = /[—–|·]/;

function phonesInFooter(page: FetchedResource): string[] {
  const root = parse(page.body);
  const footer = root.querySelector('footer');
  const scope = footer ?? root.querySelector('body') ?? root;
  const matches = scope.textContent.match(PHONE_RE) ?? [];
  return [...new Set(matches.map(normalizePhone).filter((p) => p.replace(/\D/g, '').length >= 7))];
}

/**
 * Candidate address strings from an actual <footer> (no body/root fallback,
 * unlike phonesInFooter: without a NAP separator to split on, an ordinary
 * prose paragraph almost always has a digit and 6+ letters somewhere, so
 * scanning the whole body/root would false-positive on non-address content).
 * Splits on the same NAP separators used to join name/address/phone, then
 * keeps segments that look like a street address (has a digit and enough
 * letters) rather than a bare business name (no digit) or a phone number
 * (digits, ~0 letters).
 */
function addressesInFooter(page: FetchedResource): string[] {
  const footer = parse(page.body).querySelector('footer');
  if (!footer) return [];
  const segments = footer.textContent.split(NAP_SEGMENT_RE).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    const hasDigit = /\d/.test(seg);
    const letterCount = (seg.match(/[a-z]/gi) ?? []).length;
    if (hasDigit && letterCount >= 6) out.push(addressString(seg));
  }
  return [...new Set(out)];
}

/** Reduces a JSON-LD PostalAddress to street+locality — the part footers reliably echo (postal code/country are often omitted on the page). */
function addressCoreFromEntity(address: unknown): string {
  if (typeof address === 'string') return addressString(address);
  if (address && typeof address === 'object') {
    const a = address as Record<string, unknown>;
    return addressString({ streetAddress: a.streetAddress, addressLocality: a.addressLocality });
  }
  return '';
}

interface PerPageValues { path: string; values: string[] }

/**
 * Majority vote among footer values; ties are broken toward the JSON-LD value
 * when it's among the tied leaders (deterministic, and JSON-LD is the
 * authoritative source when the page itself doesn't clearly prefer either).
 */
function pickCanonical(jsonLdValue: string, perPage: PerPageValues[]): string {
  const freq = new Map<string, number>();
  for (const p of perPage) for (const v of p.values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best = '';
  let bestCount = -1;
  for (const [v, count] of freq) {
    if (count > bestCount || (count === bestCount && v === jsonLdValue)) { best = v; bestCount = count; }
  }
  return best || jsonLdValue;
}

interface DimensionResult { active: boolean; status: 'pass' | 'warn' | 'fail'; detail: string }

/**
 * pass: footers consistent and matching JSON-LD (or nothing to cross-check).
 * warn: minor divergence across footers, or footers agree with each other but
 * not with JSON-LD. fail: footers substantially conflict (spec §3.3).
 */
function evaluateDimension(jsonLdValue: string, perPage: PerPageValues[]): DimensionResult {
  const anyFooterValue = perPage.some((p) => p.values.length > 0);
  if (!jsonLdValue && !anyFooterValue) return { active: false, status: 'pass', detail: '' };
  if (!anyFooterValue) return { active: true, status: 'pass', detail: '' };
  const canonical = pickCanonical(jsonLdValue, perPage);
  const pagesWithValue = perPage.filter((p) => p.values.length > 0);
  const offenders = pagesWithValue.filter((p) => !p.values.includes(canonical)).map((p) => p.path);
  const agg = aggregate(pagesWithValue.length, offenders);
  const jsonLdMismatch = jsonLdValue !== '' && jsonLdValue !== canonical;
  if (agg.status === 'pass' && jsonLdMismatch) {
    return { active: true, status: 'warn', detail: `consistently "${canonical}", never matching JSON-LD ("${jsonLdValue}")` };
  }
  return { active: true, status: agg.status, detail: agg.status === 'pass' ? '' : agg.detail };
}

export const napConsistency: Check = {
  id: 'nap-consistency', family: 'structured-data', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const home = pages.find((p) => pathOf(p) === '/') ?? pages[0];
    let jsonLdPhone = '';
    let jsonLdAddress = '';
    if (home) {
      const nodes = nodesOf(home);
      const org = nodes.find((n) => typesOf(n).some((t) => NAP_REQUIRED_TYPES.has(t) || isOrganizationType(t))
        && (str(n.telephone) || n.address));
      if (org) {
        if (str(org.telephone)) jsonLdPhone = normalizePhone(str(org.telephone));
        if (org.address) jsonLdAddress = addressCoreFromEntity(org.address);
      }
    }
    const perPagePhones: PerPageValues[] = pages.map((p) => ({ path: pathOf(p), values: phonesInFooter(p) }));
    const perPageAddresses: PerPageValues[] = pages.map((p) => ({ path: pathOf(p), values: addressesInFooter(p) }));

    const dims = [
      { label: 'phone', ...evaluateDimension(jsonLdPhone, perPagePhones) },
      { label: 'address', ...evaluateDimension(jsonLdAddress, perPageAddresses) },
    ].filter((d) => d.active);

    if (dims.length === 0) return makeResult(this, 'skip', 'no NAP (phone/address) to check');
    if (dims.every((d) => d.status === 'pass')) return makeResult(this, 'pass', 'NAP consistent across sampled pages');

    const status = dims.some((d) => d.status === 'fail') ? 'fail' : 'warn';
    const detail = dims.filter((d) => d.status !== 'pass').map((d) => `${d.label} ${d.detail}`).join('; ');
    return makeResult(this, status, `inconsistent NAP across pages: ${detail}`,
      'Render one canonical NAP from a single source; match JSON-LD.');
  },
};
