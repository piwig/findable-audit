import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { verdictOf } from './verdict.js';
import { renderCwvMarkdown } from './cwv.js';
import { collectRecommendations } from './recommendations.js';
import { messages, FAMILY_LABELS_I18N, type Lang } from './i18n.js';
import { checkWhy, checkFix } from './check-i18n.js';
import { renderDiffMarkdown, type ReportDiff } from './diff.js';

const ICONS: Record<CheckResult['status'], string> = {
  pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️',
};

/** Escape characters that would break a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderMarkdown(report: AuditReport, now: Date = new Date(), lang: Lang = 'en', opts: { diff?: ReportDiff } = {}): string {
  const m = messages(lang);
  const familyLabels = FAMILY_LABELS_I18N[lang];
  const failCount = report.results.filter((r) => r.status === 'fail').length;
  const lines: string[] = [
    `# ${m.mdTitle} — ${report.url}`,
    '',
    `**${m.mdScore} ${report.score}/100** · **${m.gradeLabel} ${report.grade}** — ${now.toISOString().slice(0, 10)}`,
    '',
    `> ${verdictOf(report.grade, failCount, lang)}`,
    '',
  ];

  if (report.familyScores.length > 0) {
    lines.push(`## ${m.categorySubscores}`, '');
    lines.push(m.mdSubscoreHeader);
    lines.push('|---|---|---|---|');
    for (const fs of report.familyScores) {
      const weightPct = Math.round(fs.weight * 100);
      lines.push(`| ${cell(familyLabels[fs.family])} | ${fs.score}/100 | ${weightPct}% | ${fs.earned}/${fs.max} |`);
    }
    lines.push('');
  }

  if (report.psi) {
    lines.push(renderCwvMarkdown(report.psi, lang), '');
  }

  for (const family of Object.keys(familyLabels) as Family[]) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    lines.push(`## ${familyLabels[family]} (${earned}/${max})`, '');
    lines.push(m.mdCheckHeader);
    lines.push('|---|---|---|---|');
    for (const r of results) {
      const why = checkWhy(r.id, lang);
      const msg = why ? `${cell(r.message)} — _${cell(why)}_` : cell(r.message);
      lines.push(`| ${ICONS[r.status]} | \`${r.id}\` | ${r.points}/${r.maxPoints} | ${msg} |`);
    }
    lines.push('');
  }

  const recs = collectRecommendations(report.results);
  if (recs.length > 0) {
    lines.push(`## ${m.mdRecommendedFixes}`, '');
    for (const r of recs) {
      const link = r.docUrl ? ` — [${m.mdDoc}](${r.docUrl})` : '';
      const fix = checkFix(r.id, lang, r.fix) ?? r.fix;
      lines.push(`- ${ICONS[r.status]} **\`${r.id}\`** (+${r.impact} ${m.pts} · ${m.effortLabel[r.effort]}) — ${fix}${link}`);
    }
    lines.push('');
  }

  if (opts.diff) {
    lines.push(renderDiffMarkdown(opts.diff, lang), '');
  }

  lines.push('---', '', m.mdFooter, '');
  return lines.join('\n');
}
