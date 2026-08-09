// #64 — the one-screen summary, for whoever decides rather than whoever fixes.
//
// The full report answers "what is wrong, everywhere, and how do I fix each of
// it". A director, a client or a founder asks three different questions: where
// do we stand, what are the few things worth doing, and what would they cost.
// Everything here is assembled from pieces the report already computes — axes,
// verdict sentence, recommendations, effort, projected score — so the summary
// can never disagree with the report it summarises.
//
// What it deliberately does NOT contain: the per-check table, the passing
// checks, the family breakdown. A summary that grows into a second full report
// has stopped being one; the tests police that.

import type { AuditReport } from '../runner.js';
import { messages, type Lang } from './i18n.js';
import { checkTitle, checkFix } from './check-i18n.js';
import { axisScores, projectScore, trustLens, verdictSentence, AXIS_ORDER } from './axes.js';
import { collectRecommendations } from './recommendations.js';

/** How many actions a one-screen summary can carry before it stops being one. */
export const SUMMARY_ACTIONS = 3;

function hostOf(url: string): string {
  try { return new URL(url).hostname || url; } catch { return url; }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The shared decision layer: score, verdict, axes, top actions, projection. */
function summaryModel(report: AuditReport, lang: Lang) {
  const m = messages(lang);
  const axes = axisScores(report.familyScores);
  const blocked = report.results.some((r) => r.id === 'ai-crawlers-allowed' && r.status === 'fail');
  const recs = collectRecommendations(report.results);
  const top = recs.slice(0, SUMMARY_ACTIONS);
  // Project only what the listed actions would earn — promising the gain of
  // fixes the reader cannot see would be a number they can never verify.
  const projected = projectScore(report.familyScores, top);
  return {
    m, axes, top,
    // A37 — the E-E-A-T lens. Omitted (null) when none of its checks ran,
    // rather than shown as a hollow 0.
    trust: trustLens(report.results),
    verdict: verdictSentence(axes, report.score, blocked, lang),
    projected,
    host: hostOf(report.url),
  };
}

export function renderSummaryMarkdown(report: AuditReport, now: Date, lang: Lang = 'en'): string {
  const { m, axes, top, trust, verdict, projected, host } = summaryModel(report, lang);
  const lines: string[] = [];
  lines.push(`# ${m.summaryTitle} — ${host}`);
  lines.push('');
  lines.push(`**${report.score}${m.outOf100} · ${m.gradeLabel} ${report.grade}** — ${verdict}`);
  lines.push('');
  lines.push(`_${m.stats(
    report.results.filter((r) => r.status === 'pass').length,
    report.results.filter((r) => r.status === 'fail' || r.status === 'warn').length,
    report.sampledPages.length,
  )} · ${now.toISOString().slice(0, 10)}_`);
  lines.push('');

  for (const key of AXIS_ORDER) {
    const axis = axes.find((a) => a.key === key);
    if (!axis) continue;
    const value = axis.score === null ? m.axisNotApplicable : `${axis.score}/100`;
    lines.push(`- **${m.axisLabel[key]}** ${value} — ${m.axisQuestion[key]}`);
  }
  // A37 — the trust/authority (E-E-A-T) lens: same list, clearly a lens and
  // not a fourth axis. Absent entirely when none of its checks ran.
  if (trust.score !== null) {
    lines.push(`- **${m.trustLabel}** ${trust.score}/100 — ${m.trustQuestion}`);
  }
  lines.push('');

  if (top.length === 0) {
    lines.push(m.planEmpty);
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`## ${m.summaryActions}`);
  lines.push('');
  top.forEach((r, i) => {
    // checkFix, not r.fix: the raw fix a check emits is English. A French
    // summary that quoted it would leak exactly the way reports did before the
    // localisation pass.
    lines.push(`${i + 1}. **${checkTitle(r.id, lang)}** (\`${r.id}\`) — ${checkFix(r.id, lang, r.fix) ?? r.fix}`);
    lines.push(`   _+${r.impact} ${m.pts} · ${m.effortLabel[r.effort]}_`);
  });
  lines.push('');
  lines.push(`**${m.summaryProjection(report.score, projected)}**`);
  lines.push('');
  return lines.join('\n');
}

export function renderSummaryHtml(report: AuditReport, now: Date, lang: Lang = 'en'): string {
  const { m, axes, top, trust, verdict, projected, host } = summaryModel(report, lang);
  const band = report.score >= 80 ? 'good' : report.score >= 60 ? 'ok' : 'bad';

  const axisCards = AXIS_ORDER.map((key) => {
    const axis = axes.find((a) => a.key === key);
    if (!axis) return '';
    const value = axis.score === null ? escapeHtml(m.axisNotApplicable) : String(axis.score);
    return `<div class="ax"><div class="ax-n">${value}</div><div class="ax-l">${escapeHtml(m.axisLabel[key])}</div>`
      + `<div class="ax-q">${escapeHtml(m.axisQuestion[key])}</div></div>`;
  }).join('\n');

  // A37 — trust lens rendered as a distinct strip under the three axes, so it
  // reads as a lens on the whole rather than a fourth axis. Hidden when no
  // trust check ran.
  const trustStrip = trust.score === null
    ? ''
    : `<div class="lens"><div class="ax-n">${trust.score}</div><div class="ax-l">${escapeHtml(m.trustLabel)}</div>`
      + `<div class="ax-q">${escapeHtml(m.trustQuestion)}</div></div>`;

  const actions = top.length === 0
    ? `<p class="empty">${escapeHtml(m.planEmpty)}</p>`
    : `<ol class="acts">${top.map((r) => `<li><b>${escapeHtml(checkTitle(r.id, lang))}</b> — ${escapeHtml(checkFix(r.id, lang, r.fix) ?? r.fix)}`
      + `<span class="cost">+${r.impact} ${escapeHtml(m.pts)} · ${escapeHtml(m.effortLabel[r.effort])}</span></li>`).join('')}</ol>`
      + `<p class="proj">${escapeHtml(m.summaryProjection(report.score, projected))}</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(m.summaryTitle)} — ${escapeHtml(host)}</title>
<style>
  :root { color-scheme: light dark; --ink:#1a1a1a; --muted:#555; --soft:#6b7280; --bg:#fff;
    --line:#e5e5e5; --panel:#fbfbfb; --good:#1a7f37; --warn:#9a6700; --bad:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e9ecef; --muted:#b3bcc4; --soft:#9aa4ae;
    --bg:#14171a; --line:#2b3138; --panel:#1a1e22; --good:#4fbf74; --warn:#d8a640; --bad:#f3796f; } }
  * { box-sizing: border-box; }
  body { font: 16px/1.55 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); background: var(--bg); margin: 0 auto; padding: 2.5rem 2rem; max-width: 720px; }
  h1 { font-size: 1.35rem; margin: 0 0 .2rem; }
  .host { color: var(--muted); font-size: .9rem; margin: 0 0 1.5rem; }
  .score { display: flex; align-items: baseline; gap: .6rem; }
  .score b { font-size: 3rem; line-height: 1; font-weight: 800; }
  .score .good { color: var(--good); } .score .ok { color: var(--warn); } .score .bad { color: var(--bad); }
  .score span { color: var(--soft); font-size: 1rem; }
  .verdict { font-size: 1.05rem; margin: .8rem 0 1.6rem; }
  .axes { display: flex; gap: .8rem; margin: 0 0 .8rem; }
  .lens { display: flex; align-items: baseline; gap: .6rem; padding: .6rem .9rem; margin: 0 0 1.8rem;
    border: 1px dashed var(--line); border-radius: 12px; background: var(--panel); }
  .lens .ax-n { font-size: 1.1rem; font-weight: 700; }
  .ax { flex: 1; padding: .8rem .9rem; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
  .ax-n { font-size: 1.7rem; font-weight: 800; line-height: 1.1; }
  .ax-l { font-weight: 700; font-size: .92rem; }
  .ax-q { color: var(--soft); font-size: .78rem; line-height: 1.35; }
  h2 { font-size: 1rem; margin: 0 0 .6rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
  .acts { margin: 0; padding-left: 1.2rem; }
  .acts li { margin: 0 0 .8rem; }
  .cost { display: block; color: var(--soft); font-size: .82rem; margin-top: .15rem; }
  .proj { font-weight: 700; margin: 1.2rem 0 0; }
  .empty { color: var(--good); font-weight: 600; }
  footer { margin-top: 2.5rem; padding-top: .8rem; border-top: 1px solid var(--line);
    color: var(--soft); font-size: .8rem; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
<h1>${escapeHtml(m.summaryTitle)}</h1>
<p class="host">${escapeHtml(host)} · ${now.toISOString().slice(0, 10)}</p>
<div class="score"><b class="${band}">${report.score}</b><span>${escapeHtml(m.outOf100)} · ${escapeHtml(m.gradeLabel)} ${escapeHtml(report.grade)}</span></div>
<p class="verdict">${escapeHtml(verdict)}</p>
<div class="axes">${axisCards}</div>
${trustStrip}
<h2>${escapeHtml(m.summaryActions)}</h2>
${actions}
<footer>${m.footer}</footer>
</body>
</html>
`;
}
