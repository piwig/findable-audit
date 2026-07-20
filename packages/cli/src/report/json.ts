import type { AuditReport } from '../runner.js';
export function renderJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
