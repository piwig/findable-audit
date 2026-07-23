import { describe, it, expect } from 'vitest';
import {
  buildEntityGraph, renderEntityGraphJson, renderEntityGraphDot, renderEntityGraphMermaid,
  pickEntityGraphRenderer,
} from '../src/report/entity-graph.js';

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

const pageA = `<html><body>${ld({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': 'https://ex.com/#org', name: 'Ex Corp' },
    { '@type': 'WebSite', '@id': 'https://ex.com/#site', publisher: { '@id': 'https://ex.com/#org' } },
  ],
})}</body></html>`;

const pageB = `<html><body>${ld([
  { '@type': 'WebSite', '@id': 'https://ex.com/#site' },
  { '@type': 'Article', headline: 'Hi', author: { '@type': 'Person', name: 'Jane' }, about: { '@id': 'https://ex.com/#ghost' } },
])}</body></html>`;

const pages = [{ path: '/', html: pageA }, { path: '/blog', html: pageB }];

describe('buildEntityGraph', () => {
  const g = buildEntityGraph(pages);

  it('merges the same @id seen on two pages', () => {
    const site = g.nodes.find((n) => n.id === 'https://ex.com/#site');
    expect(site).toBeDefined();
    expect(site!.pages.sort()).toEqual(['/', '/blog']);
    expect(site!.types).toContain('WebSite');
  });

  it('creates a synthetic node for an inline entity without @id and an edge to it', () => {
    const person = g.nodes.find((n) => n.types.includes('Person'));
    expect(person).toBeDefined();
    expect(person!.synthetic).toBe(true);
    expect(g.edges.some((e) => e.property === 'author' && e.to === person!.id)).toBe(true);
  });

  it('counts a dangling @id reference and reflects it in stats', () => {
    expect(g.stats.danglingRefs).toBe(1); // #ghost referenced, never defined
    const ghost = g.nodes.find((n) => n.id === 'https://ex.com/#ghost');
    expect(ghost?.synthetic).toBe(true);
    expect(ghost?.types).toEqual([]);
  });

  it('reports the publisher edge from #site to #org', () => {
    expect(g.edges.some((e) => e.property === 'publisher'
      && e.from === 'https://ex.com/#site' && e.to === 'https://ex.com/#org')).toBe(true);
  });

  it('counts connected components (org+site joined; article cluster separate)', () => {
    expect(g.stats.components).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty graph for pages with no JSON-LD', () => {
    const empty = buildEntityGraph([{ path: '/', html: '<html><body>no ld</body></html>' }]);
    expect(empty.nodes).toEqual([]);
    expect(empty.stats.nodes).toBe(0);
    expect(empty.stats.edges).toBe(0);
    expect(empty.stats.danglingRefs).toBe(0);
  });
});

describe('entity-graph renderers', () => {
  const g = buildEntityGraph(pages);

  it('JSON round-trips', () => {
    const parsed = JSON.parse(renderEntityGraphJson(g));
    expect(parsed.stats.nodes).toBe(g.stats.nodes);
    expect(parsed.nodes.length).toBe(g.nodes.length);
  });

  it('DOT is a digraph with a dashed style for dangling nodes', () => {
    const dot = renderEntityGraphDot(g);
    expect(dot).toContain('digraph');
    expect(dot).toContain('dashed');
  });

  it('Mermaid is a graph LR with sanitized ids', () => {
    const mmd = renderEntityGraphMermaid(g);
    expect(mmd).toMatch(/^graph LR/m);
    expect(mmd).not.toMatch(/["#]n\d/); // node ids are plain identifiers
  });
});

describe('pickEntityGraphRenderer', () => {
  it('selects by extension', () => {
    expect(pickEntityGraphRenderer('g.json')).toBe(renderEntityGraphJson);
    expect(pickEntityGraphRenderer('g.dot')).toBe(renderEntityGraphDot);
    expect(pickEntityGraphRenderer('g.mmd')).toBe(renderEntityGraphMermaid);
    expect(pickEntityGraphRenderer('g.txt')).toBe(null);
  });
});
