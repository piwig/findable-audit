import type { AuditReport } from '../runner.js';
import type { Family } from '../types.js';

/** Compact per-check outcome kept in history — statuses only, never messages. */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

/**
 * --history <file.json>: an append-only series of past runs, one entry per
 * audit, kept small on purpose (date + scores + check statuses only — never
 * messages or full results, so a committed history stays reviewable in a PR
 * diff). The HTML report turns the series into sparklines (overall + per
 * family) when it holds >= 2 points, and lists per-check transitions
 * (backlog A100) once two runs carry `checks`.
 */
export interface HistoryEntry {
  /** ISO date-time of the run. */
  date: string;
  url: string;
  score: number;
  /** Per-family subscores (0-100), keyed by family id. */
  families: Partial<Record<Family, number>>;
  /**
   * Per-check status of this run, keyed by check id (A100). Optional: series
   * written before this field existed keep parsing, and transitions are only
   * computed between entries that carry it.
   */
  checks?: Record<string, CheckStatus>;
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
    // `checks` is a later addition (A100): absent on old series, but when
    // present it must be a plain id->status map or the file is foreign.
    if (e.checks !== undefined && (typeof e.checks !== 'object' || e.checks === null || Array.isArray(e.checks))) {
      throw new Error('expected "checks" to be an object mapping check id to status');
    }
  }
  return parsed as HistoryEntry[];
}

/** Append this run to the series (immutably), enforcing the cap. */
export function appendHistory(entries: HistoryEntry[], report: AuditReport, now: Date): HistoryEntry[] {
  const families: Partial<Record<Family, number>> = {};
  for (const fs of report.familyScores) families[fs.family] = fs.score;
  // A100: keep the per-check outcome (status only — one short word per check,
  // ~40 checks ≈ a few hundred bytes) so the series can answer "which check
  // regressed when", not just "the score moved".
  const checks: Record<string, CheckStatus> = {};
  for (const r of report.results) checks[r.id] = r.status;
  const next = [...entries, { date: now.toISOString(), url: report.url, score: report.score, families, checks }];
  return next.slice(-HISTORY_MAX_ENTRIES);
}

/** A check whose status moved between the two most recent runs of a series. */
export interface CheckTransition {
  id: string;
  from: CheckStatus;
  to: CheckStatus;
  /** true when the move lost ground (toward warn/fail), false when it gained. */
  regressed: boolean;
}

/** Severity order used to tell a regression from an improvement. */
const STATUS_RANK: Record<CheckStatus, number> = { pass: 0, skip: 1, warn: 2, fail: 3 };

/**
 * Per-check transitions between the last two entries of a (same-url) series
 * that both carry `checks` (A100). Regressions first, then improvements,
 * alphabetical within each group. Checks that appear or disappear between
 * runs (new check in a newer CLI version, or a skip) only count when both
 * sides are present — a missing side is a tooling change, not a site change.
 */
export function checkTransitions(series: HistoryEntry[]): CheckTransition[] {
  const withChecks = series.filter((e) => e.checks !== undefined);
  if (withChecks.length < 2) return [];
  const prev = withChecks[withChecks.length - 2].checks!;
  const curr = withChecks[withChecks.length - 1].checks!;
  const out: CheckTransition[] = [];
  for (const id of Object.keys(curr)) {
    const from = prev[id];
    const to = curr[id];
    if (from === undefined || from === to) continue;
    out.push({ id, from, to, regressed: STATUS_RANK[to] > STATUS_RANK[from] });
  }
  return out.sort((a, b) => Number(b.regressed) - Number(a.regressed) || a.id.localeCompare(b.id));
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
