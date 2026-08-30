// Shields.io endpoint JSON — the machine twin of `badge.ts`, written by
// `--report <file>.shields.json` (#A95).
//
// Shields' "endpoint" badge (https://shields.io/badges/endpoint-badge) fetches
// a JSON document of this exact shape and renders the badge itself, so a site
// that publishes this file (e.g. at /findable.shields.json) gets a live badge
// via `https://img.shields.io/endpoint?url=...` without committing an SVG.
// Same inputs as the static badge: label "findable", value "<grade> <score>/100",
// colour from the same good/average/poor bands as `scoreClass` / `charts.ts`.
// Pure string builder: same report in, byte-identical JSON out.

import type { AuditReport } from '../runner.js';

/** Same bands as `badge.ts` / the report's `scoreClass`: good / average / poor. */
function statusColor(score: number): string {
  return score >= 80 ? '#1a7f37' : score >= 60 ? '#9a6700' : '#b42318';
}

/**
 * The shields.io endpoint document for an audit. `schemaVersion: 1` is the
 * only version shields defines today; `message` mirrors the SVG badge's value
 * segment so both artefacts always tell the same story.
 */
export function renderShieldsJson(report: AuditReport): string {
  const score = Math.round(Math.min(100, Math.max(0, report.score)));
  return JSON.stringify(
    {
      schemaVersion: 1,
      label: 'findable',
      message: `${report.grade} ${score}/100`,
      color: statusColor(score),
    },
    null,
    2,
  ) + '\n';
}
