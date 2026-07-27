// Status badge — the README/CI artefact of an audit, written by `--report <file>.svg`.
//
// Unlike `charts.ts`, this SVG is rendered ALONE: GitHub serves it through its
// image proxy, outside any document. So it carries literal colours (no
// `var(--token, …)` to resolve), no script, and no external reference.
//
// Glyph widths are estimated from a small table rather than measured — a
// standalone SVG has no layout engine to ask. `textLength` +
// `lengthAdjust="spacingAndGlyphs"` then pins each run to the box it was
// measured for, so the badge stays correctly filled even when the viewer
// substitutes a different sans-serif. Pure string builder: same report in,
// byte-identical markup out.

import type { AuditReport } from '../runner.js';

const FONT = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
const FONT_SIZE = 11;
/** Brand ink from the landing ("Aube verte"), carrying the label segment. */
const INK = '#1c2230';
const HEIGHT = 20;
/** Horizontal breathing room on each side of a segment's text. */
const PAD = 7;
const LABEL = 'findable';

/** Same bands as the report's `scoreClass` / `charts.ts`: good / average / poor. */
function statusColor(score: number): string {
  return score >= 80 ? '#1a7f37' : score >= 60 ? '#9a6700' : '#b42318';
}

/**
 * Advance widths at 11px for the sans-serif stack above, covering the glyphs
 * this badge can actually print (the label, a grade letter, digits, "/" and a
 * space). Anything else falls back to a mid-width em — the badge would still
 * tile correctly, only its padding would breathe slightly differently.
 */
const GLYPH: Record<string, number> = {
  ' ': 3.5, '/': 4.6,
  '0': 6.9, '1': 6.9, '2': 6.9, '3': 6.9, '4': 6.9, '5': 6.9, '6': 6.9, '7': 6.9, '8': 6.9, '9': 6.9,
  A: 7.5, B: 7.3, C: 7.3, D: 7.9, E: 6.7, F: 6.2,
  a: 6.2, b: 6.6, d: 6.6, e: 6.2, f: 4.0, i: 3.0, l: 3.0, n: 6.6,
};

function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += GLYPH[ch] ?? 6.5;
  return Math.round(w * 10) / 10;
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
 * A two-segment status badge: `findable | <grade> <score>/100`, the value
 * segment wearing the score's status colour.
 *
 * The title (a native tooltip, and the accessible name) carries the audited
 * host and — only when the report has one — the audit date, so a badge
 * committed months ago says how old it is instead of implying freshness.
 */
export function renderBadge(report: AuditReport): string {
  const score = Math.round(Math.min(100, Math.max(0, report.score)));
  const value = `${report.grade} ${score}/100`;

  const labelTextW = textWidth(LABEL);
  const valueTextW = textWidth(value);
  const labelW = Math.round((labelTextW + PAD * 2) * 10) / 10;
  const valueW = Math.round((valueTextW + PAD * 2) * 10) / 10;
  const width = Math.round((labelW + valueW) * 10) / 10;

  const date = report.generatedAt ? report.generatedAt.slice(0, 10) : '';
  const title = `findable-audit: ${score}/100 (grade ${report.grade}) — ${hostOf(report.url)}`
    + (date ? `, audited ${date}` : '');
  const safeTitle = esc(title);

  // Rounded outline as a clip path: keeps the two segment rects square-edged
  // (so they tile to exactly `width`) while the badge as a whole reads as the
  // usual pill. A <path> rather than a <rect> so the only rects in this
  // document are the two segments.
  const r = 3;
  const outline = `M${r} 0 h${width - r * 2} a${r} ${r} 0 0 1 ${r} ${r} v${HEIGHT - r * 2} `
    + `a${r} ${r} 0 0 1 -${r} ${r} h-${width - r * 2} a${r} ${r} 0 0 1 -${r} -${r} `
    + `v-${HEIGHT - r * 2} a${r} ${r} 0 0 1 ${r} -${r} z`;

  const text = (x: number, w: number, weight: number, body: string) =>
    `<text x="${x}" y="14" text-anchor="middle" font-family="${FONT}" font-size="${FONT_SIZE}" `
    + `font-weight="${weight}" fill="#ffffff" textLength="${w}" lengthAdjust="spacingAndGlyphs">${body}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="${safeTitle}">
<title>${safeTitle}</title>
<clipPath id="findable-badge-clip"><path d="${outline}"/></clipPath>
<g clip-path="url(#findable-badge-clip)">
<rect x="0" y="0" width="${labelW}" height="${HEIGHT}" fill="${INK}"/>
<rect x="${labelW}" y="0" width="${valueW}" height="${HEIGHT}" fill="${statusColor(score)}"/>
</g>
${text(labelW / 2, labelTextW, 400, LABEL)}
${text(labelW + valueW / 2, valueTextW, 600, esc(value))}
</svg>`;
}
