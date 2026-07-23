import type { Check, CrawlContext } from '../types.js';
import { makeResult } from '../types.js';
import {
  buildEntityGraph, componentIndex, ENTITY_ROOT_TYPES, type EntityGraph,
} from '../report/entity-graph.js';

/** Build (or reuse) the entity graph from the sampled pages attached to the context. */
function graphFor(ctx: CrawlContext): EntityGraph | null {
  if (ctx.entityGraph) return ctx.entityGraph;
  if (!ctx.sample) return null;
  return buildEntityGraph(ctx.sample.pages.map((p) => {
    let path = '/';
    try { path = new URL(p.finalUrl).pathname; } catch { /* keep '/' */ }
    return { path, html: p.body };
  }));
}

export const entityGraphConnectivity: Check = {
  id: 'entity-graph-connectivity', family: 'structured-data', maxPoints: 4,
  async run(ctx) {
    const g = graphFor(ctx);
    if (!g) return makeResult(this, 'skip', 'no sampled pages to build an entity graph from');

    // Dangling references: an @id referenced but never defined anywhere in the sample.
    const dangling = g.nodes.filter((n) => n.synthetic && n.types.length === 0).map((n) => n.id);
    if (dangling.length > 0) {
      return makeResult(this, 'fail',
        `dangling @id reference(s): ${dangling.slice(0, 3).join(', ')}`,
        'Define every entity referenced by @id somewhere in your JSON-LD (ideally one @graph), so references resolve.');
    }

    if (g.stats.nodes === 0) {
      return makeResult(this, 'warn', 'no JSON-LD entities found across sampled pages',
        'Add JSON-LD (Organization, WebSite, and per-page WebPage/Article) linked by @id so AI engines can build an entity graph.');
    }

    // Are the site's core identity entities linked to each other?
    const comp = componentIndex(g.nodes, g.edges);
    const namedRoots = g.nodes.filter((n) => n.name && n.types.some((t) => ENTITY_ROOT_TYPES.has(t)));
    const rootComponents = new Set(namedRoots.map((n) => comp.get(n.id)));
    if (namedRoots.length >= 2 && rootComponents.size >= 2) {
      return makeResult(this, 'warn',
        `core entities are not linked (${rootComponents.size} disconnected identity clusters)`,
        'Cross-reference Organization ↔ WebSite (and Person/LocalBusiness) with @id so they form one connected entity graph.');
    }

    return makeResult(this, 'pass',
      `${g.stats.nodes} entities, ${g.stats.edges} links, no dangling references (${g.stats.components} component(s))`);
  },
};
