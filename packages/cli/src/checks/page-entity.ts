// #33 — page-level entity clarity: does the page say what it is ABOUT?
//
// A page can carry a flawless entity graph and still never name its own subject.
// `sd-organization`, `sd-entity-grounding` and `entity-graph-connectivity` all
// answer "who publishes this?"; none of them answers "what is this page about?".
// schema.org has a property for exactly that — `about` (the subject matter of a
// CreativeWork) and its sibling `mentions` (entities the work refers to) — and a
// page that leaves it out forces an engine to infer the topic from prose.
//
// Scope, and why it is narrow
// ---------------------------
// Only the homepage and content/article pages are graded:
//
//   * The homepage's subject is the site's primary entity (the organization, the
//     product, the application), and it is the page an engine resolves an
//     identity from.
//   * An Article/BlogPosting exists to discuss a topic; naming that topic as an
//     entity is what connects the page to a knowledge graph.
//   * A navigational interior page — a contact form, a legal notice, a listing —
//     frequently has no single subject entity. Demanding `about` there would ask
//     sites to manufacture markup, which is the opposite of what this tool is for.
//
// A page with no CreativeWork-family node at all has nowhere to put `about`, so
// the check skips rather than penalising a site for markup it never claimed.
//
// Verdict policy: WARN at worst, never fail. "The primary entity is not anchored
// enough" is a bar this project chose, not one a specification publishes — the
// `evidence: 'heuristic'` badge says so, and CLAUDE.md's honesty guard-rails
// forbid failing a site on a judgement call.

import type { Check } from '../types.js';
import { makeResult, t } from '../types.js';
import { pagesOf, pathOf } from './aggregate.js';
import { extractJsonLd, flatten, typesOf, byId, resolveValue, str } from './jsonld.js';
import { sameAsList } from './structured-data.js';

/** Node types that can carry `about` on the homepage: the page itself, or its main work. */
const HOME_SCOPE = [
  'WebPage', 'CollectionPage', 'ItemPage', 'ProfilePage', 'CreativeWork',
  'Article', 'NewsArticle', 'BlogPosting', 'TechArticle',
];

/** Node types that put an interior page in scope: content, not navigation. */
const CONTENT_SCOPE = ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'CreativeWork'];

type Ids = Map<string, Record<string, unknown>>;

/** `about`/`mainEntity` both name the page's primary entity; either one answers the question. */
const PRIMARY_PROPS = ['about', 'mainEntity'];

function valuesOf(node: Record<string, unknown>, prop: string): unknown[] {
  const raw = node[prop];
  if (raw === undefined || raw === null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Is this entity reference anchored — can an engine tell WHICH thing it names?
 *
 * A named node whose `@id` resolves inside the page graph is anchored (the
 * entity is really described somewhere), and so is one carrying a `sameAs` to an
 * external reference. A bare string, an anonymous `{name: "…"}` or a dangling
 * `{"@id": …}` is a label, not an identity.
 */
function isAnchored(value: unknown, ids: Ids): boolean {
  const target = resolveValue(value, ids);
  if (!target || typeof target !== 'object' || Array.isArray(target)) return false;
  const node = target as Record<string, unknown>;
  if (!str(node.name)) return false;
  const id = str(node['@id']);
  if (id && ids.has(id)) return true;
  return sameAsList(node.sameAs).length > 0;
}

/** The first thing wrong with this page's entity declarations, or null when it is clear. */
function problemWith(nodes: Record<string, unknown>[], ids: Ids): string | null {
  const primary = nodes.flatMap((node) => PRIMARY_PROPS.flatMap((prop) => valuesOf(node, prop)));
  if (primary.length === 0) return 'no about/mainEntity';
  if (!primary.some((value) => isAnchored(value, ids))) {
    return 'about/mainEntity declared but not anchored';
  }
  // `mentions` is never required — a page with no secondary entity is not a
  // defect — but a mention that names nothing resolvable is dead weight.
  const mentions = nodes.flatMap((node) => valuesOf(node, 'mentions'));
  if (mentions.length > 0 && !mentions.some((value) => isAnchored(value, ids))) {
    return 'mentions declared but not anchored';
  }
  return null;
}

export const sdPageEntity: Check = {
  id: 'sd-page-entity', family: 'structured-data', evidence: 'heuristic', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    // Same idiom as nap-consistency: after a `/` → `/en/` redirect the homepage
    // no longer sits at '/', but the sampler always puts it first.
    const home = pages.find((page) => pathOf(page) === '/') ?? pages[0];

    const offenders: string[] = [];
    let graded = 0;
    for (const page of pages) {
      const nodes = flatten(extractJsonLd(page.body));
      const scope = page === home ? HOME_SCOPE : CONTENT_SCOPE;
      const inScope = nodes.filter((node) => typesOf(node).some((type) => scope.includes(type)));
      if (inScope.length === 0) continue;
      graded += 1;
      const problem = problemWith(inScope, byId(nodes));
      if (problem) offenders.push(`${pathOf(page)} (${problem})`);
    }

    if (graded === 0) {
      return makeResult(this, 'skip', 'no homepage WebPage/CreativeWork node and no article page to carry about/mentions');
    }
    if (offenders.length === 0) {
      return makeResult(this, 'pass', t`${graded} page(s) name an anchored primary entity`);
    }
    const shown = offenders.slice(0, 3).join(', ');
    const more = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
    return makeResult(this, 'warn', t`page subject left implicit on: ${shown}${more}`,
      'Point the page node at its subject with about (or mainEntity), and give that entity an @id defined in the same graph or a sameAs to a reference like Wikidata.');
  },
};
