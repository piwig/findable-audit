import type { AuditReport } from '../runner.js';
import type { ReportDiff } from './diff.js';

/**
 * Bump when the JSON output shape changes incompatibly. Consumers (and our own
 * baseline validation) can check `schemaVersion` before reading fields.
 * Version 1: report fields at the top level + `schemaVersion` + optional `diff`.
 */
export const JSON_SCHEMA_VERSION = 1;

export function renderJson(report: AuditReport, opts: { diff?: ReportDiff } = {}): string {
  // Spread the report first so `schemaVersion` can never be shadowed by a
  // future report field, and older consumers that read report fields directly
  // keep working unchanged.
  const out = {
    ...report,
    schemaVersion: JSON_SCHEMA_VERSION,
    ...(opts.diff ? { diff: opts.diff } : {}),
  };
  return JSON.stringify(out, null, 2);
}
