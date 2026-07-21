import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { FAMILY_LABELS, FAMILY_SHORT } from './terminal.js';
import { verdictOf } from './verdict.js';
import { renderCwvHtml } from './cwv.js';
import { collectRecommendations } from './recommendations.js';

const STATUS_LABEL: Record<CheckResult['status'], string> = {
  pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP',
};

/** Escape text for safe inclusion in HTML (the report contains site-derived strings). */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreClass(score: number): string {
  return score >= 80 ? 'good' : score >= 60 ? 'ok' : 'bad';
}

/** Colour band for a letter grade: A/B green, C amber, D/F red — mirrors scoreClass. */
function gradeClass(grade: string): string {
  return grade === 'A' || grade === 'B' ? 'good' : grade === 'C' ? 'ok' : 'bad';
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fff; margin: 0; padding: 2rem; max-width: 860px; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 1.75rem 0 .5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .25rem; }
  .meta { color: #666; font-size: .9rem; margin-bottom: 1rem; }
  .badges { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; margin: 0 0 .25rem; }
  .score { display: inline-block; font-weight: 700; font-size: 1.1rem; padding: .35rem .8rem;
    border-radius: 6px; color: #fff; }
  .score.good { background: #1a7f37; } .score.ok { background: #9a6700; } .score.bad { background: #b42318; }
  .grade { display: inline-block; font-weight: 700; font-size: 1.4rem; line-height: 1; padding: .3rem .9rem;
    border-radius: 6px; color: #fff; }
  .grade.good { background: #1a7f37; } .grade.ok { background: #9a6700; } .grade.bad { background: #b42318; }
  .pages { color: #444; font-size: .85rem; margin: .5rem 0 0; }
  .hero { display: flex; align-items: center; gap: 1rem; margin: 1rem 0 .75rem;
    padding: 1rem; border: 1px solid #ececec; border-radius: 12px; background: #fbfbfb; }
  .hero-score { font-weight: 800; font-size: 2rem; line-height: 1; color: #fff;
    border-radius: 12px; padding: .6rem .8rem; min-width: 3.4rem; text-align: center; }
  .hero-score span { display: block; font-size: .7rem; font-weight: 600; opacity: .85; }
  .hero-score.good { background: #1a7f37; } .hero-score.ok { background: #9a6700; } .hero-score.bad { background: #b42318; }
  .hero-meta .verdict { color: #555; font-size: .95rem; margin-top: .3rem; }
  .stats { color: #666; font-size: .85rem; margin: 0 0 .25rem; }
  table { width: 100%; border-collapse: collapse; margin: .25rem 0; }
  td { padding: .4rem .5rem; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  td.st { white-space: nowrap; font-weight: 700; font-size: .8rem; width: 3.5rem; }
  td.pts { white-space: nowrap; text-align: right; color: #555; width: 3.5rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
  .st.pass { color: #1a7f37; } .st.warn { color: #9a6700; } .st.fail { color: #b42318; } .st.skip { color: #999; }
  .fix { color: #555; font-size: .85rem; margin-top: .15rem; }
  .fix-more { color: #1a7f37; font-size: .8rem; white-space: nowrap; }
  .msg { color: #333; font-size: .9rem; margin-top: .1rem; }
  .row { break-inside: avoid; }
  .subscores { margin: 1.25rem 0; }
  .subscore-table td { border-bottom: none; padding: .3rem .5rem; vertical-align: middle; }
  .fam-label { font-size: .9rem; width: 34%; }
  .fam-score { font-weight: 700; font-size: .9rem; text-align: right; width: 3rem; white-space: nowrap; }
  .fam-score.good { color: #1a7f37; } .fam-score.ok { color: #9a6700; } .fam-score.bad { color: #b42318; }
  .fam-weight { color: #888; font-size: .8rem; text-align: right; width: 3.5rem; white-space: nowrap; }
  .fam-bar { width: 40%; }
  .bar { background: #eee; border-radius: 4px; height: .55rem; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-fill.good { background: #1a7f37; } .bar-fill.ok { background: #9a6700; } .bar-fill.bad { background: #b42318; }
  footer { margin-top: 2rem; color: #888; font-size: .8rem; border-top: 1px solid #e5e5e5; padding-top: .75rem; }
  .cwv { margin: 1.25rem 0; }
  .cwv-assess-line { margin: .25rem 0 .5rem; }
  .cwv-assess { display: inline-block; font-weight: 700; font-size: .78rem; padding: .15rem .55rem; border-radius: 6px; color: #fff; }
  .cwv-assess.good { background: #1a7f37; } .cwv-assess.ok { background: #9a6700; } .cwv-assess.bad { background: #b42318; }
  .cwv-src { color: #888; font-size: .8rem; }
  .cwv-grid { display: flex; gap: 1.1rem; flex-wrap: wrap; margin: .5rem 0; }
  .cwv-gauge { text-align: center; }
  .cwv-ring { width: 76px; height: 76px; border-radius: 50%; margin: 0 auto .3rem; display: flex; align-items: center; justify-content: center; }
  .cwv-inner { width: 58px; height: 58px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
  .cwv-val { font-weight: 700; font-size: .9rem; }
  .cwv-name { font-size: .78rem; font-weight: 700; }
  .cwv-bucket { font-size: .72rem; }
  .cwv-bucket.good { color: #1a7f37; } .cwv-bucket.ok { color: #9a6700; } .cwv-bucket.bad { color: #b42318; }
  .cwv-lab { color: #666; font-size: .8rem; margin-top: .35rem; }
  .cwv-tag { font-size: .65rem; color: #77c; background: #eef0fb; padding: .05rem .35rem; border-radius: 4px; }
  .cwv-note { color: #888; font-size: .85rem; margin: 1rem 0; }
  .action-plan { margin: 1.25rem 0; }
  .ap-group h3 { font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; color: #888; margin: .9rem 0 .3rem; }
  .ap-item { display: flex; align-items: baseline; gap: .5rem; padding: .4rem 0; border-top: 1px solid #f2f2f2; }
  .ap-sev { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; position: relative; top: .35rem; }
  .ap-sev.fail { background: #b42318; } .ap-sev.warn { background: #9a6700; }
  .chip { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .02em;
    color: #555; background: #f0f0f0; padding: .1rem .45rem; border-radius: 20px; flex: 0 0 auto; }
  .ap-fix { flex: 1; font-size: .9rem; color: #333; }
  .ap-more { color: #1a7f37; font-size: .82rem; white-space: nowrap; }
  .ap-imp { font-size: .78rem; font-weight: 700; color: #1a7f37; background: #e7f4ec;
    padding: .1rem .45rem; border-radius: 20px; white-space: nowrap; flex: 0 0 auto; }
  .ap-more-note { color: #888; font-size: .82rem; margin: .5rem 0 0; }
  @media print {
    body { padding: 0; max-width: none; }
    h2, tr, .subscore-table tr { break-inside: avoid; }
    .bar-fill, .score, .grade, .fam-score, .hero-score, .cwv-ring { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function renderHtml(report: AuditReport, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const families = Object.keys(FAMILY_LABELS) as Family[];
  const sections: string[] = [];

  for (const family of families) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    const rows = results.map((r) => {
      const link = r.docUrl && r.status !== 'pass' && r.status !== 'skip'
        ? ` <a class="fix-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">En savoir plus →</a>` : '';
      const fix = r.fix && r.status !== 'pass' && r.status !== 'skip'
        ? `<div class="fix">${escapeHtml(r.fix)}${link}</div>` : '';
      return `<tr class="row">
        <td class="st ${r.status}">${STATUS_LABEL[r.status]}</td>
        <td><code>${escapeHtml(r.id)}</code><div class="msg">${escapeHtml(r.message)}</div>${fix}</td>
        <td class="pts">${r.points}/${r.maxPoints}</td>
      </tr>`;
    }).join('\n');
    sections.push(`<h2>${escapeHtml(FAMILY_LABELS[family])} <span class="pts">(${earned}/${max})</span></h2>
      <table>${rows}</table>`);
  }

  const pages = report.sampledPages.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ');

  const subscoreRows = report.familyScores.map((fs) => {
    const cls = scoreClass(fs.score);
    const label = escapeHtml(FAMILY_LABELS[fs.family]);
    const weightPct = Math.round(fs.weight * 100);
    return `<tr>
        <td class="fam-label">${label}</td>
        <td class="fam-score ${cls}">${fs.score}</td>
        <td class="fam-weight">${weightPct}%</td>
        <td class="fam-bar"><div class="bar"><div class="bar-fill ${cls}" style="width:${fs.score}%"></div></div></td>
      </tr>`;
  }).join('\n');

  const subscoreSection = report.familyScores.length > 0
    ? `<section class="subscores">
<h2>Category subscores</h2>
<table class="subscore-table">${subscoreRows}</table>
</section>`
    : '';

  const passed = report.results.filter((r) => r.status === 'pass').length;
  const failCount = report.results.filter((r) => r.status === 'fail').length;
  const toFix = report.results.filter((r) => r.status === 'fail' || r.status === 'warn').length;

  const cwvSection = report.psi
    ? renderCwvHtml(report.psi)
    : `<p class="cwv-note">Core Web Vitals non mesurés — lancez avec <code>--cwv --psi-key &lt;clé&gt;</code>.</p>`;

  const recs = collectRecommendations(report.results);
  const CAP = 12;
  const shown = recs.slice(0, CAP);
  const renderApGroup = (title: string, items: typeof shown): string => {
    if (items.length === 0) return '';
    const rows = items.map((r) => {
      const more = r.docUrl
        ? ` <a class="ap-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">En savoir plus →</a>` : '';
      return `<div class="ap-item">
        <span class="ap-sev ${r.status}"></span>
        <span class="chip">${escapeHtml(FAMILY_SHORT[r.family])}</span>
        <span class="ap-fix">${escapeHtml(r.fix)}${more}</span>
        <span class="ap-imp">+${r.impact} pts</span>
      </div>`;
    }).join('\n');
    return `<div class="ap-group"><h3>${title}</h3>${rows}</div>`;
  };
  const actionPlan = recs.length > 0
    ? `<section class="action-plan">
<h2>Plan d'action</h2>
${renderApGroup('🔴 À corriger en priorité', shown.filter((r) => r.status === 'fail'))}
${renderApGroup('🟠 À améliorer', shown.filter((r) => r.status === 'warn'))}
${recs.length > CAP ? `<p class="ap-more-note">+${recs.length - CAP} autre(s) — voir le détail par famille ci-dessous.</p>` : ''}
</section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>findable-audit report — ${escapeHtml(report.url)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>findable-audit report</h1>
<div class="meta">${escapeHtml(report.url)} · ${date}</div>
<header class="hero">
  <div class="hero-score ${scoreClass(report.score)}">${report.score}<span>/100</span></div>
  <div class="hero-meta">
    <span class="grade ${gradeClass(report.grade)}">Grade ${escapeHtml(report.grade)}</span>
    <div class="verdict">${escapeHtml(verdictOf(report.grade, failCount))}</div>
  </div>
</header>
<p class="stats">${passed} réussis · ${toFix} à corriger · ${report.sampledPages.length} pages</p>
<p class="pages">Pages audited: ${pages}</p>
${subscoreSection}
${cwvSection}
${actionPlan}
${sections.join('\n')}
<footer>Generated by findable-audit · https://github.com/piwig/findable-audit</footer>
</body>
</html>
`;
}
