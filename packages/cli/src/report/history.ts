import type { AuditReport } from '../runner.js';
import type { Family } from '../types.js';

/**
 * --history <file.json>: an append-only series of past runs, one entry per
 * audit, kept small on purpose (date + scores only — never full results, so a
 * committed history stays reviewable in a PR diff). The HTML report turns the
 * series into sparklines (overall + per family) when it holds >= 2 points.
 */
export interface HistoryEntry {
  /** ISO date-time of the run. */
  date: string;
  url: string;
  score: number;
  /** Per-family subscores (0-100), keyed by family id. */
  families: Partial<Record<Family, number>>;
}

/** Hard cap so the file never grows unbounded (oldest entries dropped first). */
export const HISTORY_MAX_ENTRIES = 500;

/**
 * Parse a history file's raw text. Returns the entries, or throws with a
 * human-readable message — the CLI refuses to overwrite a file it cannot
 * parse, so a corrupted (or foreign) JSON file is never silently clobbered.
 */
export function parseHistory(raw: string): HistoryEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array of history entries');
  for (const e of parsed as Partial<HistoryEntry>[]) {
    if (!e || typeof e.date !== 'string' || typeof e.score !== 'number' || typeof e.url !== 'string') {
      throw new Error('expected entries of shape { date, url, score, families }');
    }
  }
  return parsed as HistoryEntry[];
}

/** Append this run to the series (immutably), enforcing the cap. */
export function appendHistory(entries: HistoryEntry[], report: AuditReport, now: Date): HistoryEntry[] {
  const families: Partial<Record<Family, number>> = {};
  for (const fs of report.familyScores) families[fs.family] = fs.score;
  const next = [...entries, { date: now.toISOString(), url: report.url, score: report.score, families }];
  return next.slice(-HISTORY_MAX_ENTRIES);
}

/**
 * An inline SVG sparkline for a 0-100 series. Pure markup (no JS, CSP-safe,
 * printable), sized by the caller via width/height attributes. The last point
 * is marked with a dot so the "now" end of the line is unambiguous.
 */
export function renderSparklineSvg(values: number[], { width = 120, height = 28, stroke = 'currentColor' }: { width?: number; height?: number; stroke?: string } = {}): string {
  if (values.length < 2) return '';
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const x = (i: number) => pad + (i / (values.length - 1)) * w;
  const y = (v: number) => pad + (1 - Math.max(0, Math.min(100, v)) / 100) * h;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true"><polyline fill="none" stroke="${stroke}" stroke-width="1.5" points="${pts}"/><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2" fill="${stroke}"/></svg>`;
}
