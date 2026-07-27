import { describe, it, expect } from 'vitest';
import { renderEntityGraphSvg, ENTITY_GRAPH_NODE_CAP } from '../../src/report/charts.js';
import type { EntityGraph, EntityNode, EntityEdge } from '../../src/report/entity-graph.js';

function graphOf(nodes: Partial<EntityNode>[], edges: EntityEdge[] = []): EntityGraph {
  const full = nodes.map((n, i) => ({
    id: n.id ?? `#n${i}`, types: n.types ?? ['Thing'], name: n.name,
    pages: n.pages ?? ['/'], synthetic: n.synthetic ?? false,
  }));
  return {
    nodes: full,
    edges,
    stats: { nodes: full.length, edges: edges.length, danglingRefs: full.filter((n) => n.types.length === 0).length, components: 1 },
  };
}

const SITE = graphOf(
  [
    { id: '#org', types: ['Organization'], name: 'Acme' },
    { id: '#site', types: ['WebSite'], name: 'acme.com' },
    { id: '#page', types: ['WebPage'], name: 'Home' },
  ],
  [
    { from: '#site', to: '#org', property: 'publisher' },
    { from: '#page', to: '#site', property: 'isPartOf' },
  ],
);

describe('renderEntityGraphSvg', () => {
  it('renders nothing for a graph with no entity at all', () => {
    expect(renderEntityGraphSvg(graphOf([]), 'en')).toBe('');
  });

  it('draws one node group and one edge path per entity and reference', () => {
    const svg = renderEntityGraphSvg(SITE, 'en');
    expect([...svg.matchAll(/class="eg-node"/g)]).toHaveLength(3);
    expect([...svg.matchAll(/class="eg-edge"/g)]).toHaveLength(2);
  });

  it('collapses entities of the same type into one box carrying a count', () => {
    // A 6-page crawl repeats WebPage/BreadcrumbList per page; drawn one box per
    // entity that is a hairball, so identical types merge and say how many.
    const g = graphOf(
      [
        { id: '#site', types: ['WebSite'], name: 'acme.com' },
        { id: '#p1', types: ['WebPage'], name: 'Home', pages: ['/'] },
        { id: '#p2', types: ['WebPage'], name: 'About', pages: ['/about'] },
        { id: '#p3', types: ['WebPage'], name: 'Contact', pages: ['/contact'] },
      ],
      [
        { from: '#p1', to: '#site', property: 'isPartOf' },
        { from: '#p2', to: '#site', property: 'isPartOf' },
        { from: '#p3', to: '#site', property: 'isPartOf' },
      ],
    );
    const svg = renderEntityGraphSvg(g, 'en');
    expect([...svg.matchAll(/class="eg-node"/g)]).toHaveLength(2);   // WebSite + WebPage×3
    expect([...svg.matchAll(/class="eg-edge"/g)]).toHaveLength(1);   // three isPartOf merge into one
    expect(svg).toContain('×3');
    expect(svg).toContain('acme.com');                                // the lone WebSite keeps its name
    expect(svg).toContain('About');                                   // sample names survive in the tooltip
  });

  it('lists every distinct property when several link the same two types', () => {
    const g = graphOf(
      [{ id: '#a', types: ['WebPage'] }, { id: '#b', types: ['Organization'] }],
      [
        { from: '#a', to: '#b', property: 'publisher' },
        { from: '#a', to: '#b', property: 'author' },
        { from: '#a', to: '#b', property: 'publisher' },
      ],
    );
    const svg = renderEntityGraphSvg(g, 'en');
    expect([...svg.matchAll(/class="eg-edge"/g)]).toHaveLength(1);
    expect(svg).toMatch(/<title>publisher, author<\/title>/);
  });

  it('shows the full type signature, not just the first type', () => {
    const g = graphOf([
      { id: '#a', types: ['WebPage'] },
      { id: '#b', types: ['WebPage', 'FAQPage'] },
    ]);
    const svg = renderEntityGraphSvg(g, 'en');
    expect([...svg.matchAll(/class="eg-node"/g)]).toHaveLength(2); // distinct signatures stay distinct
    expect(svg).toContain('WebPage + FAQPage');
  });

  it('labels a node with its name and its type', () => {
    const svg = renderEntityGraphSvg(SITE, 'en');
    expect(svg).toContain('Acme');
    expect(svg).toContain('Organization');
  });

  it('names the reference property in the edge title, for a native tooltip', () => {
    const svg = renderEntityGraphSvg(SITE, 'en');
    expect(svg).toMatch(/<title>[^<]*publisher[^<]*<\/title>/);
    expect(svg).toMatch(/<title>[^<]*isPartOf[^<]*<\/title>/);
  });

  it('marks a dangling reference (referenced, never declared) as broken', () => {
    const g = graphOf(
      [{ id: '#org', types: ['Organization'], name: 'Acme' }, { id: '#ghost', types: [], synthetic: true }],
      [{ from: '#org', to: '#ghost', property: 'parentOrganization' }],
    );
    const svg = renderEntityGraphSvg(g, 'en');
    expect(svg).toContain('eg-node-broken');
    expect(svg).toContain('stroke-dasharray');
  });

  it('is accessible: role, localized aria-label, and a title', () => {
    const en = renderEntityGraphSvg(SITE, 'en');
    const fr = renderEntityGraphSvg(SITE, 'fr');
    expect(en).toContain('role="img"');
    expect(en).toMatch(/aria-label="[^"]+"/);
    expect(fr).toMatch(/aria-label="[^"]+"/);
    // The accessible name is translated, not the same string in both languages.
    const nameOf = (s: string) => /aria-label="([^"]+)"/.exec(s)![1];
    expect(nameOf(en)).not.toBe(nameOf(fr));
  });

  it('escapes a hostile entity name instead of breaking out of the markup', () => {
    const g = graphOf([{ id: '#x', types: ['Organization'], name: '<script>alert(1)</script>' }]);
    const svg = renderEntityGraphSvg(g, 'en');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain('&lt;script&gt;');
  });

  it('says out loud when a graph is too large to draw, rather than truncating silently', () => {
    const many = graphOf(Array.from({ length: ENTITY_GRAPH_NODE_CAP + 1 }, (_, i) => ({ id: `#n${i}`, types: [`Type${i}`], name: `E${i}` })));
    const svg = renderEntityGraphSvg(many, 'en');
    expect(svg).not.toContain('<svg');
    expect(svg).toContain(String(ENTITY_GRAPH_NODE_CAP + 1));
    expect(svg).toMatch(/entity-graph/); // points at the export flag that has no cap
  });

  it('lays disconnected components out without overlapping them', () => {
    const g = graphOf(
      [{ id: '#a', types: ['Organization'], name: 'A' }, { id: '#b', types: ['WebSite'], name: 'B' }, { id: '#lonely', types: ['Person'], name: 'C' }],
      [{ from: '#a', to: '#b', property: 'about' }],
    );
    const svg = renderEntityGraphSvg(g, 'en');
    const ys = [...svg.matchAll(/class="eg-node"[^>]*data-y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(3);
    // The isolated node sits below the connected pair, never on top of them.
    expect(new Set(ys).size).toBeGreaterThan(1);
  });

  it('is byte-identical across calls', () => {
    expect(renderEntityGraphSvg(SITE, 'en')).toBe(renderEntityGraphSvg(SITE, 'en'));
  });
});
