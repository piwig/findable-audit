import pc from 'picocolors';
import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { FAMILY_LABELS_I18N, FAMILY_SHORT_I18N } from './i18n.js';

/** Terminal output stays English: labels & short chips derive from the EN catalog. */
export const FAMILY_LABELS: Record<Family, string> = FAMILY_LABELS_I18N.en;
export const FAMILY_SHORT: Record<Family, string> = FAMILY_SHORT_I18N.en;

const ICONS: Record<CheckResult['status'], string> = {
  pass: pc.green('OK '), warn: pc.yellow('!! '), fail: pc.red('XX '), skip: pc.dim('-- '),
};

export function renderTerminal(report: AuditReport): string {
  const lines: string[] = [pc.bold(`findable-audit report for ${report.url}`), ''];
  for (const family of Object.keys(FAMILY_LABELS) as Family[]) {
    const results = report.results.filter((x) => x.family === family);
    if (results.length === 0) continue; // families with no checks yet (e.g. performance)
    lines.push(pc.bold(FAMILY_LABELS[family]));
    for (const r of results) {
      lines.push(`  ${ICONS[r.status]}${r.id.padEnd(22)} ${r.points}/${r.maxPoints}  ${r.message}`);
      if (r.fix && r.status !== 'pass' && r.status !== 'skip') lines.push(pc.dim(`      fix: ${r.fix}`));
    }
    lines.push('');
  }
  const color = report.score >= 80 ? pc.green : report.score >= 60 ? pc.yellow : pc.red;
  lines.push(pc.bold(`Score: ${color(`${report.score}/100`)}  ${color(`Grade: ${report.grade}`)}`));
  for (const fs of report.familyScores) {
    lines.push(pc.dim(`  ${FAMILY_LABELS[fs.family].padEnd(30)} ${fs.score}/100  (weight ${Math.round(fs.weight * 100)}%, ${fs.earned}/${fs.max} pts)`));
  }
  return lines.join('\n');
}
