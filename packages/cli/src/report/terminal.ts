import pc from 'picocolors';
import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';

const FAMILY_LABELS: Record<Family, string> = {
  'ai-access': 'AI crawler access',
  'llm-content': 'Content for LLMs',
  'structured-data': 'Structured data',
  'seo-fundamentals': 'SEO fundamentals',
};

const ICONS: Record<CheckResult['status'], string> = {
  pass: pc.green('OK '), warn: pc.yellow('!! '), fail: pc.red('XX '), skip: pc.dim('-- '),
};

export function renderTerminal(report: AuditReport): string {
  const lines: string[] = [pc.bold(`findable-audit report for ${report.url}`), ''];
  for (const family of Object.keys(FAMILY_LABELS) as Family[]) {
    lines.push(pc.bold(FAMILY_LABELS[family]));
    for (const r of report.results.filter((x) => x.family === family)) {
      lines.push(`  ${ICONS[r.status]}${r.id.padEnd(22)} ${r.points}/${r.maxPoints}  ${r.message}`);
      if (r.fix && r.status !== 'pass' && r.status !== 'skip') lines.push(pc.dim(`      fix: ${r.fix}`));
    }
    lines.push('');
  }
  const color = report.score >= 80 ? pc.green : report.score >= 60 ? pc.yellow : pc.red;
  lines.push(pc.bold(`Score: ${color(`${report.score}/100`)}`));
  return lines.join('\n');
}
