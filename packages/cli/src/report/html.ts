import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { verdictOf } from './verdict.js';
import { renderCwvHtml } from './cwv.js';
import { collectRecommendations } from './recommendations.js';
import { messages, FAMILY_LABELS_I18N, FAMILY_SHORT_I18N, type Lang } from './i18n.js';
import { checkWhy, checkFix } from './check-i18n.js';

const STATUS_LABEL: Record<CheckResult['status'], string> = {
  pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP',
};

/**
 * findable-audit logomark: an "Aube verte" gradient tile with a white magnifier
 * (search / audit). Inline SVG so the report stays fully self-contained (no
 * external asset, no data URI). One instance per document → the gradient id is
 * safe. `aria-hidden` because the adjacent title already names the product.
 */
function logoMark(size = 24): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`
    + '<defs><linearGradient id="faGrad" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#3bbf6b"/><stop offset=".55" stop-color="#1a7f37"/><stop offset="1" stop-color="#0f766e"/>'
    + '</linearGradient></defs>'
    + '<rect x="1" y="1" width="30" height="30" rx="7" fill="url(#faGrad)"/>'
    + '<circle cx="13.5" cy="13.5" r="6.3" fill="none" stroke="#fff" stroke-width="2.5"/>'
    + '<line x1="18.3" y1="18.3" x2="24" y2="24" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
    + '</svg>';
}

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
  .report-h1 { display: flex; align-items: center; gap: .55rem; }
  .report-h1 svg { display: block; flex: 0 0 auto; }
  h2 { font-size: 1.1rem; margin: 1.75rem 0 .5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .25rem; }
  .meta { color: #666; font-size: .9rem; margin-bottom: 1rem; }
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
  .why { color: #6b7280; font-size: .82rem; line-height: 1.4; margin-top: .18rem; }
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
  .cwv { margin: 1.5rem 0; border: 1px solid #dfe7e1; background: #f6faf7; border-radius: 12px; padding: 1rem 1.15rem 1.15rem; }
  .cwv > h2 { margin-top: .1rem; border-bottom: none; }
  .cwv-info { margin-top: .25rem; }
  .cwv-intro { color: #4a5560; font-size: .85rem; margin: .5rem 0 .5rem; }
  .cwv-explain h3, .cwv-advice h3 { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7683; margin: .75rem 0 .3rem; }
  .cwv-explain ul, .cwv-advice ul { margin: .2rem 0; padding-left: 1.1rem; }
  .cwv-explain li, .cwv-advice li { font-size: .85rem; color: #3a424c; margin: .18rem 0; }
  .cwv-advice { border-top: 1px solid #e6ede8; margin-top: .6rem; }
  .cwv-allgood { color: #1a7f37; font-size: .85rem; font-weight: 600; margin: .6rem 0 0; }
  .cwv-kpi-wrap { overflow-x: auto; margin: .5rem 0 .25rem; }
  .cwv-kpi { width: 100%; border-collapse: collapse; font-size: .82rem; min-width: 22rem; }
  .cwv-kpi th { text-align: left; font-weight: 700; color: #6b7683; font-size: .72rem; text-transform: uppercase; letter-spacing: .03em; border-bottom: 1px solid #dfe7e1; padding: .3rem .5rem; white-space: nowrap; }
  .cwv-kpi td { padding: .35rem .5rem; border-bottom: 1px solid #eef2ef; color: #3a424c; white-space: nowrap; }
  .cwv-kpi-val { font-weight: 700; font-variant-numeric: tabular-nums; }
  .cwv-kpi-rating.good { color: #1a7f37; font-weight: 700; } .cwv-kpi-rating.ok { color: #9a6700; font-weight: 700; } .cwv-kpi-rating.bad { color: #b42318; font-weight: 700; }
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
  .ap-effort { font-size: .72rem; font-weight: 700; border-radius: 20px; padding: .1rem .45rem; white-space: nowrap; flex: 0 0 auto; }
  .ap-effort.eff-quick { color: #1a7f37; background: #e7f4ec; }
  .ap-effort.eff-moderate { color: #9a6700; background: #fbf1dd; }
  .ap-effort.eff-involved { color: #555; background: #eef0f2; }
  .ap-more-note { color: #888; font-size: .82rem; margin: .5rem 0 0; }
  details.fam { margin: 0; }
  .fam-sum { cursor: pointer; font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 .4rem;
    padding: .3rem 0 .35rem; border-bottom: 1px solid #e5e5e5; list-style: none;
    display: flex; align-items: center; gap: .5rem; }
  .fam-sum::-webkit-details-marker { display: none; }
  .fam-sum::before { content: "\\25B8"; color: #999; font-size: .8em; flex: 0 0 auto; transition: transform .15s; }
  details[open] > .fam-sum::before { transform: rotate(90deg); }
  .fam-sum:hover { color: #1a7f37; }
  .fam-sum h2 { margin: 0; padding: 0; border: 0; font: inherit; flex: 1; min-width: 0;
    display: flex; align-items: center; gap: .5rem; }
  .fam-sum .pts { font-weight: 400; }
  .fam-dot { width: 9px; height: 9px; border-radius: 50%; margin-left: auto; flex: 0 0 auto; }
  .fam-dot.good { background: #1a7f37; } .fam-dot.ok { background: #9a6700; } .fam-dot.bad { background: #b42318; }
  details.fam > table { margin-top: .25rem; }
  @media (max-width: 640px) {
    /* overflow-wrap inherits: breaks long space-less tokens (URLs in .meta, verdict,
       action-plan fixes) that would otherwise force horizontal scroll on phones. */
    body { padding: 1.1rem; overflow-wrap: anywhere; }
    h1 { font-size: 1.3rem; }
    h2 { font-size: 1.05rem; }
    .fam-sum { font-size: 1.05rem; }
    .hero { flex-direction: column; align-items: flex-start; gap: .6rem; }
    .hero-score { font-size: 1.7rem; }
    .subscore-table td { padding: .3rem .25rem; }
    .fam-label { width: auto; }
    .fam-weight { width: 3rem; }
    td { padding: .4rem .3rem; overflow-wrap: anywhere; }
    td.pts { width: auto; }
    code { overflow-wrap: anywhere; }
    .cwv-grid { gap: .7rem; justify-content: center; }
    .ap-item { flex-wrap: wrap; }
    .ap-fix { flex-basis: 100%; }
  }
  @media print {
    body { padding: 0; max-width: none; }
    h2, tr, .subscore-table tr { break-inside: avoid; }
    .fam-sum { break-after: avoid; }
    /* Reveal collapsed families so a direct print of the web result page is
       complete (the downloaded export is already open). */
    details.fam > table { display: table !important; content-visibility: visible !important; }
    .bar-fill, .grade, .fam-score, .hero-score, .cwv-ring, .fam-dot { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function renderHtml(
  report: AuditReport,
  now: Date = new Date(),
  lang: Lang = 'en',
  { collapsed = false }: { collapsed?: boolean } = {},
): string {
  const m = messages(lang);
  const familyLabels = FAMILY_LABELS_I18N[lang];
  const familyShort = FAMILY_SHORT_I18N[lang];
  const date = now.toISOString().slice(0, 10);
  const families = Object.keys(familyLabels) as Family[];
  const sections: string[] = [];

  for (const family of families) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    const rows = results.map((r) => {
      const why = checkWhy(r.id, lang);
      const whyHtml = why ? `<div class="why">${escapeHtml(why)}</div>` : '';
      const fixText = checkFix(r.id, lang, r.fix);
      const link = r.docUrl && r.status !== 'pass' && r.status !== 'skip'
        ? ` <a class="fix-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">${m.learnMore}</a>` : '';
      const fix = fixText && r.status !== 'pass' && r.status !== 'skip'
        ? `<div class="fix">${escapeHtml(fixText)}${link}</div>` : '';
      return `<tr class="row">
        <td class="st ${r.status}">${STATUS_LABEL[r.status]}</td>
        <td><code>${escapeHtml(r.id)}</code><div class="msg">${escapeHtml(r.message)}</div>${whyHtml}${fix}</td>
        <td class="pts">${r.points}/${r.maxPoints}</td>
      </tr>`;
    }).join('\n');
    // Collapsible per-family section: a native <details>/<summary> (no JS, so
    // CSP-safe). The dot on the summary flags the family's worst status so a
    // reader can scan without expanding. Web reports pass collapsed:true;
    // downloaded/exported reports stay open (printable).
    const worst = results.some((r) => r.status === 'fail') ? 'bad'
      : results.some((r) => r.status === 'warn') ? 'ok' : 'good';
    // A heading lives INSIDE the <summary> so screen-reader heading navigation
    // still reaches every family; the dot carries a text alternative (role=img
    // + aria-label) so its meaning isn't colour-only.
    const statusLabel = escapeHtml(m.famStatus[worst]);
    sections.push(`<details class="fam"${collapsed ? '' : ' open'}>
      <summary class="fam-sum"><h2>${escapeHtml(familyLabels[family])} <span class="pts">(${earned}/${max})</span><span class="fam-dot ${worst}" role="img" aria-label="${statusLabel}" title="${statusLabel}"></span></h2></summary>
      <table>${rows}</table>
    </details>`);
  }

  const pages = report.sampledPages.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ');

  const subscoreRows = report.familyScores.map((fs) => {
    const cls = scoreClass(fs.score);
    const label = escapeHtml(familyLabels[fs.family]);
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
<h2>${m.categorySubscores}</h2>
<table class="subscore-table">${subscoreRows}</table>
</section>`
    : '';

  const passed = report.results.filter((r) => r.status === 'pass').length;
  const failCount = report.results.filter((r) => r.status === 'fail').length;
  const toFix = report.results.filter((r) => r.status === 'fail' || r.status === 'warn').length;

  const cwvSection = report.psi
    ? renderCwvHtml(report.psi, lang)
    : `<p class="cwv-note">${m.cwvNotMeasured}</p>`;

  const recs = collectRecommendations(report.results);
  const CAP = 12;
  const shown = recs.slice(0, CAP);
  const renderApGroup = (title: string, items: typeof shown): string => {
    if (items.length === 0) return '';
    const rows = items.map((r) => {
      const more = r.docUrl
        ? ` <a class="ap-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">${m.learnMore}</a>` : '';
      return `<div class="ap-item">
        <span class="ap-sev ${r.status}"></span>
        <span class="chip">${escapeHtml(familyShort[r.family])}</span>
        <span class="ap-fix">${escapeHtml(checkFix(r.id, lang, r.fix) ?? r.fix)}${more}</span>
        <span class="ap-effort eff-${r.effort}">${m.effortLabel[r.effort]}</span>
        <span class="ap-imp">+${r.impact} ${m.pts}</span>
      </div>`;
    }).join('\n');
    return `<div class="ap-group"><h3>${title}</h3>${rows}</div>`;
  };
  const actionPlan = recs.length > 0
    ? `<section class="action-plan">
<h2>${m.actionPlan}</h2>
${renderApGroup(m.fixFirst, shown.filter((r) => r.status === 'fail'))}
${renderApGroup(m.improve, shown.filter((r) => r.status === 'warn'))}
${recs.length > CAP ? `<p class="ap-more-note">${m.moreRecs(recs.length - CAP)}</p>` : ''}
</section>`
    : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${m.reportTitle} — ${escapeHtml(report.url)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1 class="report-h1">${logoMark(26)}<span>${m.reportTitle}</span></h1>
<div class="meta">${escapeHtml(report.url)} · ${date}</div>
<header class="hero">
  <div class="hero-score ${scoreClass(report.score)}">${report.score}<span>${m.outOf100}</span></div>
  <div class="hero-meta">
    <span class="grade ${gradeClass(report.grade)}">${m.gradeLabel} ${escapeHtml(report.grade)}</span>
    <div class="verdict">${escapeHtml(verdictOf(report.grade, failCount, lang))}</div>
  </div>
</header>
<p class="stats">${m.stats(passed, toFix, report.sampledPages.length)}</p>
<p class="pages">${m.pagesAudited} ${pages}</p>
${subscoreSection}
${cwvSection}
${actionPlan}
${sections.join('\n')}
<footer>${m.footer}</footer>
</body>
</html>
`;
}
