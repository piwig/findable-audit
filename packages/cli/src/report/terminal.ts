import pc from 'picocolors';
import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { FAMILY_LABELS_I18N, FAMILY_SHORT_I18N, messages, type Lang } from './i18n.js';
import { collectRecommendations, topFixes } from './recommendations.js';
import { axisScores, verdictSentence } from './axes.js';

/** Terminal output stays English: labels & short chips derive from the EN catalog. */
export const FAMILY_LABELS: Record<Family, string> = FAMILY_LABELS_I18N.en;
export const FAMILY_SHORT: Record<Family, string> = FAMILY_SHORT_I18N.en;

const ICONS: Record<CheckResult['status'], string> = {
  pass: pc.green('OK '), warn: pc.yellow('!! '), fail: pc.red('XX '), skip: pc.dim('-- '),
};

/** Chrome strings that exist only in the terminal renderer (not in ReportMessages). */
const TERMINAL_CHROME: Record<Lang, { forUrl: string; fix: string; weight: string }> = {
  en: { forUrl: 'for', fix: 'fix', weight: 'weight' },
  fr: { forUrl: 'pour', fix: 'correctif', weight: 'poids' },
};

// Backlog A87: the terminal output follows --lang like every other renderer,
// so `--lang fr --baseline` no longer mixes an English verdict with a French diff.
export function renderTerminal(report: AuditReport, lang: Lang = 'en'): string {
  const m = messages(lang);
  const chrome = TERMINAL_CHROME[lang];
  const labels = FAMILY_LABELS_I18N[lang];
  const lines: string[] = [pc.bold(`${m.reportTitle} ${chrome.forUrl} ${report.url}`), ''];
  // Backlog A32: executive summary first — the same verdict sentence the HTML
  // report opens with, plus the pass/to-fix counts, so a reader who stops at
  // the first screen still leaves with the decision, not just a score.
  const blocked = report.results.some((r) => r.id === 'ai-crawlers-allowed' && r.status === 'fail');
  const verdict = verdictSentence(axisScores(report.familyScores), report.score, blocked, lang);
  lines.push(verdict);
  lines.push(pc.dim(m.stats(
    report.results.filter((r) => r.status === 'pass').length,
    report.results.filter((r) => r.status === 'fail' || r.status === 'warn').length,
    report.sampledPages.length,
  )));
  lines.push('');
  // Backlog A3: best payoff first — recoverable points ÷ estimated effort —
  // so the reader knows where to start before scrolling the flat list.
  const top = topFixes(collectRecommendations(report.results));
  if (top.length > 0) {
    lines.push(pc.bold(m.topFixesTitle(top.length)));
    top.forEach((r, i) => {
      lines.push(`  ${i + 1}. ${r.id.padEnd(22)} +${r.impact} pts  ${pc.dim(`[${r.effort}]`)}  ${r.fix}`);
    });
    lines.push('');
  }
  for (const family of Object.keys(labels) as Family[]) {
    const results = report.results.filter((x) => x.family === family);
    if (results.length === 0) continue; // families with no checks yet (e.g. performance)
    lines.push(pc.bold(labels[family]));
    for (const r of results) {
      lines.push(`  ${ICONS[r.status]}${r.id.padEnd(22)} ${r.points}/${r.maxPoints}  ${r.message}`);
      if (r.fix && r.status !== 'pass' && r.status !== 'skip') lines.push(pc.dim(`      ${chrome.fix}: ${r.fix}`));
    }
    lines.push('');
  }
  const color = report.score >= 80 ? pc.green : report.score >= 60 ? pc.yellow : pc.red;
  lines.push(pc.bold(`${m.mdScore} ${color(`${report.score}/100`)}  ${color(`${m.gradeLabel}: ${report.grade}`)}`));
  for (const fs of report.familyScores) {
    lines.push(pc.dim(`  ${labels[fs.family].padEnd(30)} ${fs.score}/100  (${chrome.weight} ${Math.round(fs.weight * 100)}%, ${fs.earned}/${fs.max} pts)`));
  }
  return lines.join('\n');
}
