// A8 — structured social proof: is the reputation a site earns actually
// machine-readable?
//
// Reviews and ratings exist on most commercial sites — as images, widgets or
// prose. None of that is visible to an engine assembling an answer: what gets
// read is `AggregateRating` / `Review` in JSON-LD. For a TPE/local business,
// this is often the single cheapest high-impact markup fix, which is why this
// check exists as a first-class finding rather than a footnote of `sd-product`.
//
// Boundaries, and why
// -------------------
// * Only graded where reviews plausibly belong: pages declaring Product,
//   Service, LocalBusiness (any subtype) or Organization. A blog has no
//   business being warned about missing star ratings, so everything else is
//   out of scope and the check skips when no relevant node exists at all.
// * `warn` at worst, never `fail`. Absence of review markup is a missed
//   opportunity, not a defect against any published specification. Which pages
//   "should" carry reviews is our judgment, so the check declares itself
//   heuristic.
// * Presence and shape only. Whether the declared rating is *true* is not
//   verifiable from a crawl, and `rich-result-eligibility` already grades
//   Google's per-field requirements when the markup exists. This check answers
//   the earlier, simpler question: is there anything there at all?

import type { Check, CrawlContext } from '../types.js';
import { makeResult, t } from '../types.js';
import { pagesOf, pathOf } from './aggregate.js';
import { extractJsonLd, flatten, typesOf, NAP_REQUIRED_TYPES, isOrganizationType } from './jsonld.js';

/** Types where review/rating markup plausibly belongs (plus every LocalBusiness subtype). */
const RELEVANT_TYPES = new Set(['Product', 'Service', 'Organization', 'OnlineStore']);

/**
 * LocalBusiness trade subtypes that carry no Business/Store suffix and sit outside
 * the shared hints — the plumbers and dentists this check exists for.
 */
const LOCAL_TRADE_TYPES = new Set([
  'Plumber', 'Electrician', 'Locksmith', 'HousePainter', 'RoofingContractor', 'GeneralContractor',
  'MovingCompany', 'AutoRepair', 'Attorney', 'Notary', 'Dentist', 'Physician', 'Optician',
  'VeterinaryCare', 'BeautySalon', 'HairSalon', 'DaySpa', 'NailSalon', 'Florist', 'Bakery',
  'RealEstateAgent', 'InsuranceAgency', 'TravelAgency', 'AccountingService', 'LegalService',
]);

function isRelevant(types: string[]): boolean {
  return types.some((ty) => RELEVANT_TYPES.has(ty) || NAP_REQUIRED_TYPES.has(ty) || LOCAL_TRADE_TYPES.has(ty) || isOrganizationType(ty));
}

/** An AggregateRating node is usable when it carries a value and a count. */
function ratingComplete(node: Record<string, unknown>): boolean {
  const count = node.ratingCount ?? node.reviewCount;
  return node.ratingValue !== undefined && count !== undefined;
}

/** A Review node is usable when it names an author and carries a rating. */
function reviewComplete(node: Record<string, unknown>): boolean {
  return node.author !== undefined && node.reviewRating !== undefined;
}

function asNodes(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
}

export const socialProof: Check = {
  id: 'social-proof', family: 'structured-data', evidence: 'heuristic', maxPoints: 2,
  async run(ctx: CrawlContext) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page could be read');

    let relevantPages = 0;
    let complete = 0;
    const incomplete: string[] = [];

    for (const page of pages) {
      const nodes = flatten(extractJsonLd(page.body));
      const pageRelevant = nodes.some((n) => isRelevant(typesOf(n)));
      if (pageRelevant) relevantPages++;

      let pageComplete = 0;
      let pageDeclared = 0;
      for (const node of nodes) {
        // Ratings attached to an item (`aggregateRating` / `review` properties)
        // and standalone nodes (`@type: AggregateRating` / `Review`) both count.
        const rated = [
          ...asNodes(node.aggregateRating),
          ...(typesOf(node).includes('AggregateRating') ? [node] : []),
        ];
        const reviews = [
          ...asNodes(node.review),
          ...(typesOf(node).includes('Review') ? [node] : []),
        ];
        pageDeclared += rated.length + reviews.length;
        pageComplete += rated.filter(ratingComplete).length + reviews.filter(reviewComplete).length;
      }
      if (pageComplete > 0) complete += pageComplete;
      else if (pageDeclared > 0) incomplete.push(pathOf(page));
    }

    if (relevantPages === 0 && complete === 0 && incomplete.length === 0) {
      return makeResult(this, 'skip', 'no Product, Service, LocalBusiness or Organization markup in the sample — social proof is not expected here');
    }
    if (complete > 0) {
      const tail = incomplete.length > 0
        ? makeResult(this, 'warn', t`${complete} usable rating/review node(s) found, but the markup on ${incomplete.slice(0, 3).join(', ')} is incomplete`,
          'Give every AggregateRating a ratingValue and a ratingCount (or reviewCount), and every Review an author and a reviewRating.')
        : makeResult(this, 'pass', t`${complete} usable AggregateRating/Review node(s) declared across the sampled pages`);
      return tail;
    }
    if (incomplete.length > 0) {
      return makeResult(this, 'warn', t`rating markup is declared on ${incomplete.length} page(s) but unusable (${incomplete.slice(0, 3).join(', ')})`,
        'An AggregateRating needs ratingValue plus ratingCount (or reviewCount); a Review needs an author and a reviewRating. Without them the declaration conveys nothing.');
    }
    return makeResult(this, 'warn', t`no AggregateRating or Review markup on ${relevantPages} page(s) declaring Product/Service/LocalBusiness/Organization`,
      'If you already collect reviews, expose them as AggregateRating (ratingValue + ratingCount) on the entity customers actually rate — it is often the cheapest markup with a visible payoff.');
  },
};
