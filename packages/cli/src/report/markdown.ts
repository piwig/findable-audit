import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { verdictOf } from './verdict.js';
import { renderCwvMarkdown } from './cwv.js';
import { collectRecommendations, topFixes, ACTION_KINDS, recommendationAdvice, recommendationFinding } from './recommendations.js';
import { markdownText } from './safe-text.js';
import { renderPriorityAnswersMarkdown } from './answer-evidence.js';
import { messages, FAMILY_LABELS_I18N, type Lang } from './i18n.js';
import { checkWhy, checkTitle } from './check-i18n.js';
import { localizeMessage } from './message-i18n.js';
import { renderDiffMarkdown, type ReportDiff } from './diff.js';

const ICONS: Record<CheckResult['status'], string> = {
  pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️',
};

/** Escape characters that would break a Markdown table cell. */
function cell(text: string): string {
  return markdownText(text);
}

export function renderMarkdown(report: AuditReport, now: Date = new Date(), lang: Lang = 'en', opts: { diff?: ReportDiff } = {}): string {
  const m = messages(lang);
  const familyLabels = FAMILY_LABELS_I18N[lang];
  const failCount = report.results.filter((r) => r.status === 'fail').length;
  const lines: string[] = [
    `# ${m.mdTitle} — ${cell(report.url)}`,
    '',
    `**${m.mdScore} ${report.score}/100** · **${m.gradeLabel} ${report.grade}** — ${now.toISOString().slice(0, 10)}`,
    '',
    `> ${verdictOf(report.grade, failCount, lang)}`,
    '',
  ];

  const answers = renderPriorityAnswersMarkdown(report, lang);
  if (answers) lines.push(answers, '');
  const recs = collectRecommendations(report);
  if (recs.length > 0) {
    lines.push(`## ${m.mdRecommendedFixes}`, '', m.planQualificationNote, '');
    const top = topFixes(recs);
    if (top.length > 0) {
      lines.push(`### ${m.topFixesTitle(top.length)}`, '');
      top.forEach((r, i) => lines.push(`${i + 1}. **${cell(checkTitle(r.id, lang))}** (${cell(r.id)}) — ${cell(m.actionKind[r.kind])} · ${cell(m.effortLabel[r.effort])}`));
      lines.push('');
    }
    for (const kind of ACTION_KINDS) {
      const items = recs.filter((r) => r.kind === kind);
      if (!items.length) continue;
      lines.push(`### ${m.actionKind[kind]}`, '');
      for (const r of items) {
        const where = r.offenders.length ? `${m.planWhere} ${r.offenders.map(cell).join(', ')}` : m.planLocationUnknown;
        lines.push(`- **${cell(checkTitle(r.id, lang))}** (${cell(r.id)}) — ${cell(recommendationAdvice(r, lang))}`);
        lines.push(`  ${cell(m.actionEvidence[r.evidence])} · ${cell(m.effortLabel[r.effort])}. ${cell(m.planFinding)} ${cell(recommendationFinding(r, lang))} ${where}`);
        if (r.docUrl && /^https?:\/\//i.test(r.docUrl)) lines.push(`  [${m.mdDoc}](${encodeURI(r.docUrl).replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16))})`);
      }
      lines.push('');
    }
  }

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

  // A52: same cross-link as the HTML report — no new probing, reuses scored results.
  const perfIssueCount = report.results.filter((r) => r.family === 'performance' && r.status !== 'pass' && r.status !== 'skip').length;

  for (const family of Object.keys(familyLabels) as Family[]) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    lines.push(`## ${familyLabels[family]} (${earned}/${max})`, '');
    const issueCount = results.filter((r) => r.status !== 'pass' && r.status !== 'skip').length;
    if (family === 'accessibility' && issueCount > 0 && perfIssueCount > 0) {
      lines.push(`_${m.a11yPerfLink(perfIssueCount)}_`, '');
    }
    // A54: static, informational reference (not scored) — see html.ts.
    if (family === 'ai-access') {
      lines.push(`_${m.crawlRatioNote}_`, '');
    }
    // A61: same training-bots-blocked/citation-bots-allowed note as html.ts.
    const aiCrawlersResult = results.find((r) => r.id === 'ai-crawlers-allowed');
    if (family === 'ai-access' && aiCrawlersResult?.status === 'warn'
      && aiCrawlersResult.messageTemplate?.startsWith('AI crawlers blocked:')) {
      lines.push(`_${m.trainingBotsBlockedNote}_`, '');
    }
    lines.push(m.mdCheckHeader);
    lines.push('|---|---|---|---|');
    for (const r of results) {
      const why = recs.find((action) => action.id === r.id)?.kind === 'conditional' ? undefined : checkWhy(r.id, lang);
      const text = localizeMessage(r, lang);
      const msg = why ? `${cell(text)} — _${cell(why)}_` : cell(text);
      // The human title leads, the technical id follows in code — same order as
      // the HTML report, so a reader moving between the two formats is not lost.
      // #63: a verdict resting on a bar we chose says so, next to the check.
      const ev = r.evidence === 'heuristic' ? ` _(${m.evidenceHeuristic})_` : '';
      lines.push(`| ${ICONS[r.status]} | ${cell(checkTitle(r.id, lang))} \`${cell(r.id)}\`${ev} | ${r.points}/${r.maxPoints} | ${msg} |`);
    }
    lines.push('');
  }

  if (opts.diff) {
    lines.push(renderDiffMarkdown(opts.diff, lang), '');
  }

  lines.push('---', '', `_${m.auditFrequencyNote}_`, '', `_${m.gscAiPerformanceNote}_`, '', m.mdFooter, '');
  return lines.join('\n');
}
