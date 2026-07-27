// Server-side inline SVG dataviz shared by the HTML reports (single audit +
// compare). Pure string builders: no dependency, no date, no randomness —
// identical inputs yield byte-identical markup (the web server and the CLI's
// standalone HTML report both go through these).
//
// Design notes (skill: dataviz):
// - Status colors (#1a7f37 / #9a6700 / #b42318) are the report's existing
//   tokens; they are used only where color MEANS good/warn/bad (gauge arc,
//   priority bars). Text always wears ink tokens, never a series color.
// - COMPARE_SERIES is a fixed categorical order (entity -> hue, never cycled;
//   validated: worst adjacent CVD ΔE 13.0 ≥ 8, normal-vision 16.3 ≥ 15,
//   contrast ≥ 3:1 on white). More than 3 sites -> no chart (series cap).
// - Every <svg> is role="img" with a localized aria-label + <title>; per-row
//   <g><title> gives native browser tooltips with zero client JS.

import type { AuditReport } from '../runner.js';
import type { Family } from '../types.js';
import type { FamilyScore } from '../scoring.js';
import { componentIndex, type EntityGraph, type EntityNode, type EntityEdge } from './entity-graph.js';
import { messages, FAMILY_LABELS_I18N, FAMILY_SHORT_I18N, type Lang } from './i18n.js';

/** Fixed categorical series colors for compare mode: you, competitor 1, competitor 2. */
export const COMPARE_SERIES = ['#1a7f37', '#2a78d6', '#4a3aa7'] as const;

const FONT = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

/**
 * Neutral tokens as CSS variables with their light-theme value as fallback.
 * Inline SVG in an HTML document resolves custom properties, so the dark theme
 * flips them with the rest of the report; a chart lifted out of the document
 * (or rendered without the stylesheet) still gets the literal light values.
 * Status colours stay literal — they MEAN good/warn/bad and must not drift.
 */
const INK = 'var(--ink, #1a1a1a)';
const MUTED = 'var(--muted, #555)';
const FAINT = 'var(--faint, #888)';
const TRACK = 'var(--track, #eee)';
const TRACK_BAR = 'var(--track, #f2f2f2)';

/** Canonical family order (same source as every renderer). */
const CANON = Object.keys(FAMILY_LABELS_I18N.en) as Family[];

/** Status band color — same thresholds as the report's scoreClass. */
function statusColor(score: number): string {
  return score >= 80 ? '#1a7f37' : score >= 60 ? '#9a6700' : '#b42318';
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hostOf(url: string): string {
  try { return new URL(url).hostname || url; } catch { return url; }
}

/**
 * Horizontal bar with a 4px rounded data-end and a square baseline end
 * (mark spec). Bars thinner than the radius fall back to a plain rect;
 * zero width renders nothing (the track alone carries the row).
 */
function bar(x: number, y: number, w: number, h: number, fill: string): string {
  if (w <= 0) return '';
  if (w < 4) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  return `<path d="M${x} ${y} h${w - 4} q4 0 4 4 v${h - 8} q0 4 -4 4 h-${w - 4} z" fill="${fill}"/>`;
}

/**
 * Score gauge: a donut whose arc is drawn with `pathLength="100"` + an integer
 * stroke-dasharray — exact for every score with zero floating-point arc math.
 * dashoffset 25 starts the arc at 12 o'clock; score 0 omits the arc entirely
 * (a zero-length round-capped dash would render a stray dot).
 */
export function renderScoreGauge(score: number, grade: string, lang: Lang): string {
  const s = Math.round(Math.min(100, Math.max(0, score)));
  const label = messages(lang).vizScoreLabel(s, grade);
  const arc = s > 0
    ? `\n<circle cx="60" cy="60" r="52" fill="none" stroke="${statusColor(s)}" stroke-width="10" pathLength="100" stroke-dasharray="${s} ${100 - s}" stroke-dashoffset="25" stroke-linecap="round"/>`
    : '';
  return `<svg class="viz-gauge" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">
<title>${esc(label)}</title>
<circle cx="60" cy="60" r="52" fill="none" stroke="${TRACK}" stroke-width="10"/>${arc}
<text x="60" y="66" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="${INK}">${s}</text>
<text x="60" y="84" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${MUTED}">/100 · ${esc(grade)}</text>
</svg>`;
}

/**
 * Priority bars: one row per family, the bar encoding POINTS LOST
 * (max - earned), sorted most-lost-first (ties: canonical family order) —
 * the visual "where to regain points" tool. The bar wears the family's status
 * color; a full-scale track gives every row the same reference width.
 */
export function renderPriorityBars(familyScores: FamilyScore[], lang: Lang): string {
  const m = messages(lang);
  const longLabel = FAMILY_LABELS_I18N[lang];
  const shortLabel = FAMILY_SHORT_I18N[lang];
  const rows = familyScores
    .map((f) => ({ ...f, lost: f.max - f.earned }))
    .sort((a, b) => (b.lost - a.lost) || (CANON.indexOf(a.family) - CANON.indexOf(b.family)));
  const maxLost = Math.max(0, ...rows.map((r) => r.lost));
  const height = 8 + rows.length * 32;
  const body = rows.map((r, i) => {
    const y0 = 4 + i * 32;
    const w = maxLost === 0 ? 0 : Math.round((r.lost / maxLost) * 330);
    const lostLabel = r.lost > 0 ? `−${r.lost} ${m.pts}` : `0 ${m.pts}`;
    // Direct label at the data end: inside the bar when it comfortably fits,
    // otherwise just past the tip (never clipped by its own mark).
    const lostText = w >= 60
      ? `<text x="${150 + w - 6}" y="${y0 + 20}" text-anchor="end" font-family="${FONT}" font-size="11" fill="#fff">${lostLabel}</text>`
      : `<text x="${150 + w + 6}" y="${y0 + 20}" font-family="${FONT}" font-size="11" fill="${MUTED}">${lostLabel}</text>`;
    return `<g><title>${esc(longLabel[r.family])}: ${r.score}/100, ${lostLabel}</title>
<text x="142" y="${y0 + 20}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${INK}">${esc(shortLabel[r.family])}</text>
<rect x="150" y="${y0 + 9}" width="330" height="14" rx="4" fill="${TRACK_BAR}"/>
${bar(150, y0 + 9, w, 14, statusColor(r.score))}
${lostText}
<text x="556" y="${y0 + 20}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${FAINT}">${r.score}/100</text>
</g>`;
  }).join('\n');
  return `<svg class="viz-bars-svg" viewBox="0 0 560 ${height}" role="img" aria-label="${esc(m.vizTitle)}" xmlns="http://www.w3.org/2000/svg">
<title>${esc(m.vizTitle)}</title>
${body}
</svg>`;
}

/**
 * Compare chart: grouped horizontal bars per family, one bar per site on a
 * FIXED 0-100 -> 330px axis (family subscores are already 0-100, so rows are
 * directly comparable). Series colors follow the entity in COMPARE_SERIES
 * order — never recycled: past 3 sites the chart is omitted and the table
 * remains the view. Includes the mandatory legend (>= 2 series).
 */
export function renderCompareChart(reports: AuditReport[], lang: Lang): string {
  if (reports.length < 2 || reports.length > COMPARE_SERIES.length) return '';
  const m = messages(lang);
  const longLabel = FAMILY_LABELS_I18N[lang];
  const shortLabel = FAMILY_SHORT_I18N[lang];
  const cols = reports.map((r, i) => ({
    host: hostOf(r.url),
    you: i === 0,
    fam: new Map(r.familyScores.map((f) => [f.family, f.score])),
  }));
  const fams = CANON.filter((f) => cols.some((c) => c.fam.has(f)));
  if (fams.length === 0) return '';
  const n = cols.length;
  const pitch = n * 12 + 12; // 10px bars + 2px surface gap, 12px row padding
  const height = 8 + fams.length * pitch;
  const rows = fams.map((fam, i) => {
    const y0 = 4 + i * pitch;
    const labelY = y0 + Math.round((n * 12 - 2) / 2) + 4;
    const bars = cols.map((c, j) => {
      const score = c.fam.get(fam);
      if (score == null) return ''; // family missing on this site: no bar, slot kept
      const w = Math.round((Math.min(100, Math.max(0, score)) / 100) * 330);
      const mark = bar(150, y0 + j * 12, w, 10, COMPARE_SERIES[j]);
      if (mark === '') return '';
      return `<g><title>${esc(c.host)} — ${esc(longLabel[fam])}: ${score}/100</title>${mark}<text x="${150 + w + 6}" y="${y0 + j * 12 + 9}" font-family="${FONT}" font-size="10" fill="#555">${score}</text></g>`;
    }).filter(Boolean).join('\n');
    return `<g><title>${esc(longLabel[fam])}</title>
<text x="142" y="${labelY}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#1a1a1a">${esc(shortLabel[fam])}</text>
${bars}
</g>`;
  }).join('\n');
  const legend = `<p class="cmp-legend">${cols.map((c, i) =>
    `<span class="sw" style="background:${COMPARE_SERIES[i]}"></span>${esc(c.host)}${c.you ? ` (${esc(m.compareYou)})` : ''}`).join(' ')}</p>`;
  return `<div class="cmp-viz">
${legend}
<svg viewBox="0 0 560 ${height}" role="img" aria-label="${esc(m.compareChartLabel)}" xmlns="http://www.w3.org/2000/svg">
<title>${esc(m.compareChartLabel)}</title>
${rows}
</svg>
</div>`;
}

// --- JSON-LD entity graph (#58) --------------------------------------------
//
// The runner builds this graph on every audit (it feeds
// entity-graph-connectivity); until now only `--entity-graph` exported it, so
// the reader never saw it. Drawn here as inline SVG rather than Mermaid: the
// report ships with zero client JS, and that constraint is not worth trading
// for a diagram.
//
// Layout is a deterministic layered BFS — root of each component is its
// highest-degree node, depth becomes the column, discovery order becomes the
// row. Components stack vertically, never overlap. No force simulation: it
// would need randomness, and identical inputs must yield identical markup.

/** Above this many entities the drawing stops being readable — we say so instead of truncating. */
export const ENTITY_GRAPH_NODE_CAP = 24;

const EG = { nodeW: 132, nodeH: 34, colGap: 56, rowGap: 14, pad: 10, componentGap: 26 };

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Collapse the per-entity graph to a TYPE-level one: every entity sharing a
 * type signature becomes a single box carrying a ×N count, and parallel
 * references between two signatures merge into one arrow.
 *
 * Why: a 6-page crawl of our own site yields 43 entities and 52 references —
 * six near-identical WebPage/BreadcrumbList/ListItem clusters. Drawn one box
 * per entity that is an unreadable hairball; drawn per type it is the eight
 * boxes a reader actually wants ("what can an engine assemble about you?").
 * Per-entity identity is not lost, it lives in the uncapped --entity-graph
 * export.
 */
function collapseByType(graph: EntityGraph): {
  nodes: EntityNode[];
  edges: EntityEdge[];
  count: Map<string, number>;
  samples: Map<string, string[]>;
} {
  const key = (n: EntityNode) => (n.types.length ? n.types.join(' + ') : ' ref');
  const byKey = new Map<string, EntityNode>();
  const count = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const idToKey = new Map<string, string>();
  for (const n of graph.nodes) {
    const k = key(n);
    idToKey.set(n.id, k);
    count.set(k, (count.get(k) ?? 0) + 1);
    if (n.name) {
      const list = samples.get(k) ?? samples.set(k, []).get(k)!;
      if (!list.includes(n.name)) list.push(n.name);
    }
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, { id: k, types: [...n.types], name: n.name, pages: [...n.pages], synthetic: n.synthetic });
      continue;
    }
    for (const p of n.pages) if (!existing.pages.includes(p)) existing.pages.push(p);
    if (!existing.name && n.name) existing.name = n.name;
    if (!n.synthetic) existing.synthetic = false;
  }
  const merged = new Map<string, EntityEdge>();
  for (const e of graph.edges) {
    const from = idToKey.get(e.from);
    const to = idToKey.get(e.to);
    if (from === undefined || to === undefined || from === to) continue; // self-loops add noise, not information
    const pairKey = `${from} ${to}`;
    const existing = merged.get(pairKey);
    if (!existing) merged.set(pairKey, { from, to, property: e.property });
    else if (!existing.property.split(', ').includes(e.property)) existing.property += `, ${e.property}`;
  }
  return { nodes: [...byKey.values()], edges: [...merged.values()], count, samples };
}

/**
 * Inline SVG of the JSON-LD entity graph, one box per entity TYPE (see
 * `collapseByType`) and one arrow per reference between two types — the
 * property lives in the arrow's <title>, discoverable without cluttering the
 * diagram. Returns '' for an empty graph, and a plain note — not a truncated
 * picture — above the node cap.
 */
export function renderEntityGraphSvg(graph: EntityGraph, lang: Lang): string {
  const m = messages(lang);
  const { nodes, edges, count, samples } = collapseByType(graph);
  if (nodes.length === 0) return '';
  if (nodes.length > ENTITY_GRAPH_NODE_CAP) {
    return `<p class="eg-note">${esc(m.egTooBig(graph.nodes.length, graph.edges.length))}</p>`;
  }

  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const degree = (id: string) => adj.get(id)!.length;

  // Group by connected component, biggest first (ties: earliest declared).
  const comp = componentIndex(nodes, edges);
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const key = comp.get(n.id)!;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n.id);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    b.length - a.length || order.get(a[0])! - order.get(b[0])!);

  const pos = new Map<string, { x: number; y: number }>();
  let top = EG.pad;
  let maxDepth = 0;
  for (const ids of ordered) {
    const root = [...ids].sort((a, b) => degree(b) - degree(a) || order.get(a)! - order.get(b)!)[0];
    const depth = new Map<string, number>([[root, 0]]);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      for (const next of [...adj.get(cur)!].sort((a, b) => order.get(a)! - order.get(b)!)) {
        if (depth.has(next)) continue;
        depth.set(next, depth.get(cur)! + 1);
        queue.push(next);
      }
    }
    // An id unreachable from the root cannot happen inside one component, but
    // a defensive default keeps a malformed graph drawable instead of crashing.
    const columns = new Map<number, string[]>();
    for (const id of ids) {
      const d = depth.get(id) ?? 0;
      (columns.get(d) ?? columns.set(d, []).get(d)!).push(id);
    }
    let rows = 0;
    for (const [d, column] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
      maxDepth = Math.max(maxDepth, d);
      rows = Math.max(rows, column.length);
      column.forEach((id, i) => pos.set(id, {
        x: EG.pad + d * (EG.nodeW + EG.colGap),
        y: top + i * (EG.nodeH + EG.rowGap),
      }));
    }
    top += rows * (EG.nodeH + EG.rowGap) - EG.rowGap + EG.componentGap;
  }
  const width = EG.pad * 2 + maxDepth * (EG.nodeW + EG.colGap) + EG.nodeW;
  const height = top - EG.componentGap + EG.pad;

  const edgeMarkup = edges.map((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return '';
    const forward = b.x >= a.x;
    const x1 = forward ? a.x + EG.nodeW : a.x;
    const x2 = forward ? b.x - 5 : b.x + EG.nodeW + 5;
    const y1 = a.y + EG.nodeH / 2;
    const y2 = b.y + EG.nodeH / 2;
    // Same-column pairs get a sideways bow so the line never hides under a box.
    const bow = Math.abs(x2 - x1) < 1 ? (forward ? 34 : -34) : (x2 - x1) / 2;
    const d = `M${x1} ${y1} C${x1 + bow} ${y1}, ${x2 - bow} ${y2}, ${x2} ${y2}`;
    return `<g><title>${esc(e.property)}</title><path class="eg-edge" d="${d}" fill="none" stroke="${FAINT}" stroke-width="1.2" marker-end="url(#eg-arrow)"/></g>`;
  }).filter(Boolean).join('\n');

  const nodeMarkup = nodes.map((n) => {
    const p = pos.get(n.id)!;
    const broken = n.synthetic && n.types.length === 0;
    const n0 = count.get(n.id) ?? 1;
    const named = samples.get(n.id) ?? [];
    // The box is keyed on the whole type signature, so the label must carry it:
    // a site with `WebPage` and `WebPage + FAQPage` gets two boxes, and showing
    // only the first type would print the same word on both.
    const signature = n.types.length ? n.types.join(' + ') : m.egBroken;
    // One entity of its type → show who it is, with the signature underneath.
    // Several → the signature is the identity, and ×N says how many.
    const alone = n0 === 1 && named.length === 1;
    const line1 = alone ? named[0] : signature;
    const line2 = n0 > 1 ? `×${n0}` : (alone ? signature : '');
    const detail = [
      n.types.length ? n.types.join(', ') : m.egBroken,
      n0 > 1 ? `×${n0}` : '',
      named.slice(0, 3).join(' · '),
      n.pages.length ? n.pages.join(', ') : '',
    ].filter(Boolean).join(' — ');
    return `<g class="eg-node" data-y="${p.y}">
<title>${esc(detail)}</title>
<rect class="eg-box${broken ? ' eg-node-broken' : ''}" x="${p.x}" y="${p.y}" width="${EG.nodeW}" height="${EG.nodeH}" rx="6" fill="${'var(--panel, #fff)'}" stroke="${broken ? '#b42318' : 'var(--panel-line, #ddd)'}"${broken ? ' stroke-dasharray="4 3"' : ''}/>
<text x="${p.x + 9}" y="${line2 ? p.y + 15 : p.y + 21}" font-family="${FONT}" font-size="11" font-weight="600" fill="${INK}">${esc(clip(line1, 18))}</text>
${line2 ? `<text x="${p.x + 9}" y="${p.y + 27}" font-family="${FONT}" font-size="9.5" fill="${MUTED}">${esc(clip(line2, 22))}</text>` : ''}
</g>`;
  }).join('\n');

  const label = m.egLabel(nodes.length, edges.length); // counts of what is DRAWN: types and merged references
  return `<svg class="eg-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">
<title>${esc(label)}</title>
<defs><marker id="eg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="${FAINT}"/></marker></defs>
${edgeMarkup}
${nodeMarkup}
</svg>`;
}
