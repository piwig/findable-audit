// Build a graph of the JSON-LD entities across the sampled pages, using the
// existing JSON-LD toolkit (checks/jsonld.ts). Powers the --entity-graph export
// and the entity-graph-connectivity check. Never executes JS: it reads the raw
// HTML the crawler already fetched.

import { extractJsonLd, flatten, typesOf, isRef } from '../checks/jsonld.js';

export interface EntityNode {
  id: string;
  types: string[];
  name?: string;
  pages: string[];
  /** true when the node has no declared @id (inline entity) or is only a dangling reference. */
  synthetic: boolean;
}
export interface EntityEdge { from: string; to: string; property: string }
export interface EntityGraph {
  nodes: EntityNode[];
  edges: EntityEdge[];
  stats: { nodes: number; edges: number; danglingRefs: number; components: number };
}

const ROOT_TYPES = new Set(['Organization', 'WebSite', 'Person', 'LocalBusiness']);

function firstName(entity: Record<string, unknown>): string | undefined {
  const n = entity.name ?? entity.headline ?? entity.legalName;
  return typeof n === 'string' && n.trim() !== '' ? n : undefined;
}

export function buildEntityGraph(pages: { path: string; html: string }[]): EntityGraph {
  const nodes = new Map<string, EntityNode>();
  const edges: EntityEdge[] = [];
  const declaredIds = new Set<string>();      // @id nodes actually defined somewhere
  const referencedIds = new Set<string>();    // @id targets referenced by an edge
  let syntheticSeq = 0;

  const ensureNode = (id: string, types: string[], name: string | undefined, page: string, synthetic: boolean): EntityNode => {
    let node = nodes.get(id);
    if (!node) { node = { id, types: [], pages: [], synthetic }; nodes.set(id, node); }
    for (const t of types) if (!node.types.includes(t)) node.types.push(t);
    if (!node.pages.includes(page)) node.pages.push(page);
    if (name && !node.name) node.name = name;
    if (!synthetic) node.synthetic = false; // a real declaration overrides a prior synthetic guess
    return node;
  };

  // Register one entity (recursively for inline children) and return its node id.
  const register = (entity: Record<string, unknown>, page: string): string => {
    const declaredId = typeof entity['@id'] === 'string' && entity['@id'] ? (entity['@id'] as string) : undefined;
    const types = typesOf(entity);
    const primary = types[0] ?? 'Thing';
    const id = declaredId ?? `${primary}#${syntheticSeq++}@${page}`;
    if (declaredId) declaredIds.add(declaredId);
    ensureNode(id, types, firstName(entity), page, declaredId === undefined);

    for (const [key, value] of Object.entries(entity)) {
      if (key.startsWith('@')) continue;
      for (const v of Array.isArray(value) ? value : [value]) {
        if (isRef(v)) {
          referencedIds.add(v['@id']);
          edges.push({ from: id, to: v['@id'], property: key });
        } else if (v && typeof v === 'object' && (('@type' in v) || ('@id' in v))) {
          const childId = register(v as Record<string, unknown>, page);
          edges.push({ from: id, to: childId, property: key });
        }
      }
    }
    return id;
  };

  for (const { path, html } of pages) {
    for (const entity of flatten(extractJsonLd(html))) {
      // Skip pure wrappers (a bare {@context,@graph} object has neither @type
      // nor @id); flatten already expanded its @graph children as siblings.
      if (typesOf(entity).length === 0 && typeof entity['@id'] !== 'string') continue;
      register(entity, path);
    }
  }

  // Materialize dangling reference targets as synthetic, typeless nodes.
  let danglingRefs = 0;
  for (const ref of referencedIds) {
    if (!declaredIds.has(ref)) {
      danglingRefs++;
      if (!nodes.has(ref)) nodes.set(ref, { id: ref, types: [], pages: [], synthetic: true });
    }
  }

  const nodeList = [...nodes.values()];
  return {
    nodes: nodeList,
    edges,
    stats: { nodes: nodeList.length, edges: edges.length, danglingRefs, components: countComponents(nodeList, edges) },
  };
}

/** Map each node id to a representative id of its connected component (undirected, union-find). */
export function componentIndex(nodes: EntityNode[], edges: EntityEdge[]): Map<string, string> {
  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n.id, n.id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const next = parent.get(x)!; parent.set(x, r); x = next; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const e of edges) { if (parent.has(e.from) && parent.has(e.to)) union(e.from, e.to); }
  const out = new Map<string, string>();
  for (const n of nodes) out.set(n.id, find(n.id));
  return out;
}

/** Connected components over the UNDIRECTED edge graph. */
function countComponents(nodes: EntityNode[], edges: EntityEdge[]): number {
  if (nodes.length === 0) return 0;
  return new Set(componentIndex(nodes, edges).values()).size;
}

/** Root-type entities (Organization/WebSite/Person/LocalBusiness) that are named. */
export const ENTITY_ROOT_TYPES = ROOT_TYPES;

// --- Renderers ---

export function renderEntityGraphJson(g: EntityGraph): string {
  return JSON.stringify(g, null, 2);
}

function label(n: EntityNode): string {
  const name = n.name ?? (n.types[0] ?? n.id);
  const types = n.types.length ? ` (${n.types.join(', ')})` : ' (ref)';
  return `${name}${types}`;
}

export function renderEntityGraphDot(g: EntityGraph): string {
  const idx = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]));
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const lines = ['digraph entities {', '  rankdir=LR;', '  node [shape=box, fontname="sans-serif"];'];
  for (const n of g.nodes) {
    const style = n.synthetic && n.types.length === 0 ? ', style=dashed, color="#b91c1c"' : '';
    lines.push(`  ${idx.get(n.id)} [label="${esc(label(n))}"${style}];`);
  }
  for (const e of g.edges) {
    if (!idx.has(e.from) || !idx.has(e.to)) continue;
    lines.push(`  ${idx.get(e.from)} -> ${idx.get(e.to)} [label="${esc(e.property)}"];`);
  }
  lines.push('}');
  return lines.join('\n');
}

export function renderEntityGraphMermaid(g: EntityGraph): string {
  const idx = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]));
  const esc = (s: string) => s.replace(/["#]/g, ' ').replace(/[[\]{}]/g, ' ').trim();
  const lines = ['graph LR'];
  for (const n of g.nodes) {
    lines.push(`  ${idx.get(n.id)}["${esc(label(n))}"]`);
  }
  for (const e of g.edges) {
    if (!idx.has(e.from) || !idx.has(e.to)) continue;
    lines.push(`  ${idx.get(e.from)} -->|${esc(e.property)}| ${idx.get(e.to)}`);
  }
  return lines.join('\n');
}

/** Choose a renderer from a target file extension. Returns null for an unknown extension. */
export function pickEntityGraphRenderer(file: string): ((g: EntityGraph) => string) | null {
  if (/\.json$/i.test(file)) return renderEntityGraphJson;
  if (/\.dot$/i.test(file)) return renderEntityGraphDot;
  if (/\.mmd$/i.test(file)) return renderEntityGraphMermaid;
  return null;
}
