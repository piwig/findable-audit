import { parse } from 'node-html-parser';
import type { Check, FetchedResource } from '../types.js';
import { makeResult } from '../types.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import {
  extractJsonLd, flatten, typesOf, byId, resolveValue, isOrganizationType,
  NAP_REQUIRED_TYPES, rollupBySeverity, normalizePhone, str,
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

function phonesInFooter(page: FetchedResource): string[] {
  const root = parse(page.body);
  const footer = root.querySelector('footer');
  const scope = footer ?? root.querySelector('body') ?? root;
  const matches = scope.textContent.match(PHONE_RE) ?? [];
  return [...new Set(matches.map(normalizePhone).filter((p) => p.replace(/\D/g, '').length >= 7))];
}

export const napConsistency: Check = {
  id: 'nap-consistency', family: 'structured-data', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    const home = pages.find((p) => pathOf(p) === '/') ?? pages[0];
    let jsonLdPhone = '';
    if (home) {
      const nodes = nodesOf(home);
      const org = nodes.find((n) => typesOf(n).some((t) => NAP_REQUIRED_TYPES.has(t) || isOrganizationType(t)) && str(n.telephone));
      if (org) jsonLdPhone = normalizePhone(str(org.telephone));
    }
    const perPagePhones = pages.map((p) => ({ path: pathOf(p), phones: phonesInFooter(p) }));
    const anyFooterPhone = perPagePhones.some((p) => p.phones.length > 0);
    if (!jsonLdPhone && !anyFooterPhone) return makeResult(this, 'skip', 'no NAP (phone) to check');
    if (!anyFooterPhone) {
      return makeResult(this, 'pass', 'JSON-LD NAP present, no page footer phone to cross-check');
    }
    let canonical = jsonLdPhone;
    if (!canonical) {
      const freq = new Map<string, number>();
      for (const p of perPagePhones) for (const ph of p.phones) freq.set(ph, (freq.get(ph) ?? 0) + 1);
      canonical = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    }
    const pagesWithPhone = perPagePhones.filter((p) => p.phones.length > 0);
    const offenders = pagesWithPhone.filter((p) => !p.phones.includes(canonical)).map((p) => p.path);
    const jsonLdMismatch = jsonLdPhone !== '' && !perPagePhones.some((p) => p.phones.includes(jsonLdPhone));
    const agg = aggregate(pagesWithPhone.length, offenders);
    if (agg.status === 'pass' && jsonLdMismatch) {
      return makeResult(this, 'warn', `inconsistent NAP across pages: footer phone(s) never match JSON-LD (${jsonLdPhone})`,
        'Render one canonical NAP from a single source; match JSON-LD.');
    }
    if (agg.status === 'pass') return makeResult(this, 'pass', 'NAP phone consistent across sampled pages');
    return makeResult(this, agg.status, `inconsistent NAP across pages: ${agg.detail}`,
      'Render one canonical NAP from a single source; match JSON-LD.');
  },
};
