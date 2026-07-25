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
import { messages, FAMILY_LABELS_I18N, FAMILY_SHORT_I18N, type Lang } from './i18n.js';

/** Fixed categorical series colors for compare mode: you, competitor 1, competitor 2. */
export const COMPARE_SERIES = ['#1a7f37', '#2a78d6', '#4a3aa7'] as const;

const FONT = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

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
<circle cx="60" cy="60" r="52" fill="none" stroke="#eee" stroke-width="10"/>${arc}
<text x="60" y="66" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="#1a1a1a">${s}</text>
<text x="60" y="84" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#555">/100 · ${esc(grade)}</text>
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
      : `<text x="${150 + w + 6}" y="${y0 + 20}" font-family="${FONT}" font-size="11" fill="#555">${lostLabel}</text>`;
    return `<g><title>${esc(longLabel[r.family])}: ${r.score}/100, ${lostLabel}</title>
<text x="142" y="${y0 + 20}" text-anchor="end" font-family="${FONT}" font-size="12" fill="#1a1a1a">${esc(shortLabel[r.family])}</text>
<rect x="150" y="${y0 + 9}" width="330" height="14" rx="4" fill="#f2f2f2"/>
${bar(150, y0 + 9, w, 14, statusColor(r.score))}
${lostText}
<text x="556" y="${y0 + 20}" text-anchor="end" font-family="${FONT}" font-size="11" fill="#888">${r.score}/100</text>
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
