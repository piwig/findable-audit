import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { gradeOf } from '../scoring.js';
import { renderCwvHtml } from './cwv.js';
import { collectRecommendations, topFixes, type Recommendation } from './recommendations.js';
import { messages, FAMILY_LABELS_I18N, FAMILY_SHORT_I18N, type Lang } from './i18n.js';
import { checkWhy, checkFix, checkTitle } from './check-i18n.js';
import { localizeMessage } from './message-i18n.js';
import { checkSnippet } from './snippets.js';
import { renderDiffHtmlSection, type ReportDiff } from './diff.js';
import { renderScoreGauge, renderPriorityBars, renderEntityGraphSvg } from './charts.js';
import { AXIS_ORDER, axisScores, projectScore, verdictSentence } from './axes.js';
import type { Effort } from './effort.js';
import { renderSparklineSvg, type HistoryEntry } from './history.js';

const STATUS_LABEL: Record<CheckResult['status'], string> = {
  pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP',
};

/** Effort lanes, easiest first — a reader arbitrates on effort, not on family. */
const LANES: Effort[] = ['quick', 'moderate', 'involved'];

/** Items shown per lane before the tail folds. Nothing is dropped — see planRest. */
const LANE_VISIBLE = 6;

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

/*
 * Styling notes for the three-layer redesign
 * -----------------------------------------
 * - Every colour goes through a custom property so the dark theme is one
 *   @media block, not a second stylesheet. The inline SVG charts read the same
 *   properties (see charts.ts), so a chart never fights its background.
 * - The grade colour no longer tints the page: the verdict card is neutral and
 *   colour is spent only where it MEANS a status. A grade C report used to be
 *   amber from top to bottom, which made severity unreadable.
 * - Dark-theme status colours are lifted in luminosity to keep 4.5:1 on #14171a;
 *   the light values are unchanged.
 * - No JavaScript anywhere: every disclosure is a native <details>, so the
 *   report stays servable under the landing's `script-src 'none'` CSP.
 */
const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #fff; --ink: #1a1a1a; --muted: #555; --faint: #888; --soft: #6b7280;
    --line: #e5e5e5; --panel: #fbfbfb; --panel-line: #ececec; --track: #eee;
    --chip-bg: #f0f0f0; --code-bg: #f5f5f5;
    --good: #1a7f37; --warn: #9a6700; --bad: #b42318;
    --good-bg: #e7f4ec; --warn-bg: #fbf1dd; --bad-bg: #fdecea; --neutral-bg: #eef0f2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14171a; --ink: #e9ecef; --muted: #b3bcc4; --faint: #8d97a0; --soft: #9aa4ae;
      --line: #2b3138; --panel: #1a1e22; --panel-line: #2b3138; --track: #2b3138;
      --chip-bg: #242a30; --code-bg: #1f2429;
      --good: #4fbf74; --warn: #d8a640; --bad: #f3796f;
      --good-bg: #16301f; --warn-bg: #33280f; --bad-bg: #38191a; --neutral-bg: #242a30;
    }
  }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); background: var(--bg); margin: 0 auto; padding: 2rem; max-width: 880px; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  .report-h1 { display: flex; align-items: center; gap: .55rem; }
  .report-h1 svg { display: block; flex: 0 0 auto; }
  h2 { font-size: 1.1rem; margin: 1.75rem 0 .5rem; border-bottom: 1px solid var(--line); padding-bottom: .25rem; }
  .meta { color: var(--muted); font-size: .9rem; margin-bottom: 1rem; }
  a { color: var(--good); }

  /* --- sticky table of contents (R4): four anchors + the grade in recall --- */
  .tocbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center;
    gap: .1rem; flex-wrap: wrap; margin: 0 -2rem 1.25rem; padding: .5rem 2rem;
    background: var(--bg); border-bottom: 1px solid var(--line); }
  .tocbar a { color: var(--muted); text-decoration: none; font-size: .85rem;
    font-weight: 600; padding: .3rem .6rem; border-radius: 6px; }
  .tocbar a:hover, .tocbar a:focus-visible { color: var(--ink); background: var(--chip-bg); }
  .tocbar .toc-grade { margin-left: auto; font-weight: 800; font-size: .8rem;
    padding: .2rem .6rem; border-radius: 20px; color: #fff; }
  .tocbar .toc-grade.good { background: var(--good); } .tocbar .toc-grade.ok { background: var(--warn); }
  .tocbar .toc-grade.bad { background: var(--bad); }

  /* --- layer 1: the verdict --- */
  .grade { display: inline-block; font-weight: 700; font-size: 1.1rem; line-height: 1;
    padding: .3rem .8rem; border-radius: 6px; color: #fff; }
  .grade.good { background: var(--good); } .grade.ok { background: var(--warn); } .grade.bad { background: var(--bad); }
  .hero { display: flex; align-items: center; gap: 1.5rem; margin: .5rem 0 0;
    padding: 1.25rem; border: 1px solid var(--panel-line); border-radius: 14px; background: var(--panel); }
  .hero .viz-gauge { flex: 0 0 auto; display: block; }
  .hero-meta { flex: 1; min-width: 0; }
  .hero-meta .verdict { color: var(--ink); font-size: 1rem; line-height: 1.45; margin-top: .5rem; }
  .stats { color: var(--muted); font-size: .85rem; margin: .6rem 0 0; }
  .pages { color: var(--muted); font-size: .85rem; margin: .2rem 0 0; }
  .axes { display: flex; gap: .75rem; margin: .75rem 0 0; }
  .axis { flex: 1; min-width: 0; padding: .7rem .85rem; border: 1px solid var(--panel-line);
    border-radius: 12px; background: var(--panel); }
  .axis-score { font-weight: 800; font-size: 1.55rem; line-height: 1.1; }
  .axis-score.good { color: var(--good); } .axis-score.ok { color: var(--warn); } .axis-score.bad { color: var(--bad); }
  .axis-name { font-weight: 700; font-size: .9rem; margin-top: .1rem; }
  .axis-q { color: var(--soft); font-size: .78rem; line-height: 1.35; margin-top: .15rem; }

  /* --- layer 2: the plan --- */
  .action-plan { margin: 1.5rem 0; }
  .top-fixes { border: 1px solid var(--line); border-radius: 12px; background: var(--panel);
    padding: .7rem .9rem; margin: .9rem 0 0; }
  .top-fixes h3 { font-size: .95rem; margin: 0 0 .35rem; }
  .top-fixes ol { margin: 0; padding-left: 1.2rem; }
  .top-fixes li { font-size: .92rem; padding: .2rem 0; }
  .top-fixes .ap-sev { display: inline-block; margin-right: .35rem; top: 0; }
  .lane { margin: 1.1rem 0 0; }
  .lane-head { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap;
    border-bottom: 1px solid var(--line); padding-bottom: .3rem; }
  .lane-head h3 { font-size: .95rem; margin: 0; }
  .lane-hint { color: var(--faint); font-size: .78rem; }
  .lane-proj { margin-left: auto; font-size: .8rem; font-weight: 700; color: var(--good);
    background: var(--good-bg); padding: .15rem .55rem; border-radius: 20px; white-space: nowrap; }
  .lane-proj.flat { color: var(--muted); background: var(--neutral-bg); font-weight: 600; }
  .ap-item { padding: .55rem 0; border-top: 1px solid var(--line); }
  .ap-item:first-of-type { border-top: none; }
  .ap-line { display: flex; align-items: baseline; gap: .5rem; }
  .ap-sev { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; position: relative; top: .35rem; }
  .ap-sev.fail { background: var(--bad); } .ap-sev.warn { background: var(--warn); }
  .chip { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .02em;
    color: var(--muted); background: var(--chip-bg); padding: .1rem .45rem; border-radius: 20px; flex: 0 0 auto; }
  .ap-fix { flex: 1; font-size: .92rem; color: var(--ink); }
  .ap-more { color: var(--good); font-size: .82rem; white-space: nowrap; }
  .ap-imp { font-size: .78rem; font-weight: 700; color: var(--good); background: var(--good-bg);
    padding: .1rem .45rem; border-radius: 20px; white-space: nowrap; flex: 0 0 auto; }
  .ap-where { color: var(--muted); font-size: .82rem; margin: .25rem 0 0 1rem; }
  .ap-where code { background: var(--code-bg); padding: .05rem .3rem; border-radius: 4px; }
  .ap-how { margin: .3rem 0 0 1rem; }
  .ap-how > summary { cursor: pointer; color: var(--muted); font-size: .82rem; width: fit-content; }
  .ap-how > summary:hover { color: var(--good); }
  .ap-how .why { margin-top: .3rem; }
  .ap-rest > summary { cursor: pointer; color: var(--good); font-size: .85rem;
    padding: .5rem 0 0; width: fit-content; }
  pre.snippet { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
    padding: .6rem .75rem; overflow-x: auto; font-size: .8rem; line-height: 1.45; margin: .4rem 0 0; }
  .plan-empty { color: var(--good); font-weight: 600; }

  /* --- layer 3: the detail --- */
  table { width: 100%; border-collapse: collapse; margin: .25rem 0; }
  td { padding: .45rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  td.st { white-space: nowrap; font-weight: 700; font-size: .72rem; width: 3.4rem;
    letter-spacing: .03em; }
  td.pts { white-space: nowrap; text-align: right; color: var(--muted); width: 3.5rem;
    font-variant-numeric: tabular-nums; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
  .st.pass { color: var(--good); } .st.warn { color: var(--warn); } .st.fail { color: var(--bad); } .st.skip { color: var(--faint); }
  .row-head { display: flex; align-items: baseline; gap: .5rem; }
  .ck-title { font-weight: 700; font-size: .95rem; flex: 1; min-width: 0; }
  .ck-id { color: var(--faint); font-size: .72rem; background: var(--chip-bg);
    padding: .05rem .35rem; border-radius: 4px; flex: 0 0 auto; }
  .fix { color: var(--muted); font-size: .85rem; margin-top: .2rem; }
  .fix-more { color: var(--good); font-size: .8rem; white-space: nowrap; }
  .msg { color: var(--ink); font-size: .88rem; margin-top: .18rem; }
  .why { color: var(--soft); font-size: .82rem; line-height: 1.4; margin-top: .18rem; }
  .row { break-inside: avoid; }
  details.pass-list { margin: .3rem 0 .5rem; }
  details.pass-list > summary { cursor: pointer; color: var(--good); font-size: .85rem; width: fit-content; }
  .fam-none { color: var(--good); font-size: .88rem; margin: .35rem 0 .5rem; }
  .subscores { margin: .75rem 0 0; }
  .subscore-table td { border-bottom: none; padding: .3rem .5rem; vertical-align: middle; }
  .fam-label { font-size: .9rem; width: 34%; }
  .fam-score { font-weight: 700; font-size: .9rem; text-align: right; width: 3rem; white-space: nowrap; }
  .fam-score.good { color: var(--good); } .fam-score.ok { color: var(--warn); } .fam-score.bad { color: var(--bad); }
  .fam-weight { color: var(--faint); font-size: .8rem; text-align: right; width: 3.5rem; white-space: nowrap; }
  .fam-bar { width: 40%; }
  .bar { background: var(--track); border-radius: 4px; height: .55rem; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-fill.good { background: var(--good); } .bar-fill.ok { background: var(--warn); } .bar-fill.bad { background: var(--bad); }
  details.breakdown { margin: .5rem 0 1rem; }
  details.breakdown > summary { cursor: pointer; color: var(--muted); font-size: .9rem;
    font-weight: 600; width: fit-content; }
  details.breakdown > summary:hover { color: var(--good); }
  .viz-bars { margin-top: .5rem; }
  .viz-bars h3 { margin: 0 0 .3rem; font-size: .85rem; color: var(--muted); }
  .viz-bars svg { width: 100%; height: auto; display: block; }
  .trends { margin: 1rem 0; }
  .trends h2 { font-size: 1rem; margin: 0 0 .5rem; }
  .trend-row { display: flex; align-items: center; gap: .6rem; padding: .15rem 0; }
  .trend-label { min-width: 9rem; font-size: .85rem; color: var(--muted); }
  .trend-now { font-variant-numeric: tabular-nums; font-weight: 600; font-size: .85rem; }
  .trend-row .spark { color: var(--good); flex: none; }
  .trend-caption { margin: .3rem 0 0; font-size: .8rem; color: var(--faint); }
  footer { margin-top: 2rem; color: var(--faint); font-size: .8rem; border-top: 1px solid var(--line); padding-top: .75rem; }

  /* --- JSON-LD entity graph (#58): drawn from data every audit already builds --- */
  /* #63: a verdict that rests on a bar WE chose says so, in place. */
  .ev-legend { color: var(--muted); font-size: .82rem; margin: .35rem 0 1rem; }
  .ck-ev { display: inline-block; margin-left: .45rem; padding: .05rem .38rem; border-radius: 999px;
    font-size: .68rem; letter-spacing: .02em; text-transform: uppercase; font-weight: 600;
    color: var(--soft); border: 1px solid var(--panel-line); background: var(--panel); vertical-align: middle; }
  .eg { margin: 1.25rem 0 1.75rem; border: 1px solid var(--panel-line); background: var(--panel); border-radius: 12px; padding: .9rem 1.15rem 1.1rem; }
  .eg > h3 { margin: .1rem 0 .35rem; font-size: 1rem; }
  .eg-caption { color: var(--muted); font-size: .85rem; margin: 0 0 .6rem; }
  .eg-scroll { overflow-x: auto; }
  .eg-svg { display: block; max-width: 100%; height: auto; }
  .eg-note { color: var(--muted); font-size: .85rem; margin: .4rem 0 0; }
  .eg-legend { display: flex; flex-wrap: wrap; gap: .9rem; margin: .55rem 0 0; font-size: .8rem; color: var(--muted); }
  .eg-legend .eg-key { display: inline-block; width: 14px; height: 9px; border: 1px dashed #b42318; border-radius: 2px; margin-right: .3rem; vertical-align: middle; }

  /* --- Core Web Vitals panel (unchanged structure, themed tokens) --- */
  .cwv { margin: 1.5rem 0; border: 1px solid var(--panel-line); background: var(--panel); border-radius: 12px; padding: 1rem 1.15rem 1.15rem; }
  .cwv > h2 { margin-top: .1rem; border-bottom: none; }
  .cwv-info { margin-top: .25rem; }
  .cwv-intro { color: var(--muted); font-size: .85rem; margin: .5rem 0 .5rem; }
  .cwv-explain h3, .cwv-advice h3 { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--soft); margin: .75rem 0 .3rem; }
  .cwv-explain ul, .cwv-advice ul { margin: .2rem 0; padding-left: 1.1rem; }
  .cwv-explain li, .cwv-advice li { font-size: .85rem; color: var(--muted); margin: .18rem 0; }
  .cwv-advice { border-top: 1px solid var(--line); margin-top: .6rem; }
  .cwv-allgood { color: var(--good); font-size: .85rem; font-weight: 600; margin: .6rem 0 0; }
  .cwv-kpi-wrap { overflow-x: auto; margin: .5rem 0 .25rem; }
  .cwv-kpi { width: 100%; border-collapse: collapse; font-size: .82rem; min-width: 22rem; }
  .cwv-kpi th { text-align: left; font-weight: 700; color: var(--soft); font-size: .72rem; text-transform: uppercase; letter-spacing: .03em; border-bottom: 1px solid var(--line); padding: .3rem .5rem; white-space: nowrap; }
  .cwv-kpi td { padding: .35rem .5rem; border-bottom: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .cwv-kpi-val { font-weight: 700; font-variant-numeric: tabular-nums; }
  .cwv-kpi-rating.good { color: var(--good); font-weight: 700; } .cwv-kpi-rating.ok { color: var(--warn); font-weight: 700; } .cwv-kpi-rating.bad { color: var(--bad); font-weight: 700; }
  .cwv-assess-line { margin: .25rem 0 .5rem; }
  .cwv-assess { display: inline-block; font-weight: 700; font-size: .78rem; padding: .15rem .55rem; border-radius: 6px; color: #fff; }
  .cwv-assess.good { background: var(--good); } .cwv-assess.ok { background: var(--warn); } .cwv-assess.bad { background: var(--bad); }
  .cwv-src { color: var(--faint); font-size: .8rem; }
  .cwv-grid { display: flex; gap: 1.1rem; flex-wrap: wrap; margin: .5rem 0; }
  .cwv-gauge { text-align: center; }
  .cwv-ring { width: 76px; height: 76px; border-radius: 50%; margin: 0 auto .3rem; display: flex; align-items: center; justify-content: center; }
  .cwv-inner { width: 58px; height: 58px; border-radius: 50%; background: var(--bg); display: flex; align-items: center; justify-content: center; }
  .cwv-val { font-weight: 700; font-size: .9rem; }
  .cwv-name { font-size: .78rem; font-weight: 700; }
  .cwv-bucket { font-size: .72rem; }
  .cwv-bucket.good { color: var(--good); } .cwv-bucket.ok { color: var(--warn); } .cwv-bucket.bad { color: var(--bad); }
  .cwv-lab { color: var(--muted); font-size: .8rem; margin-top: .35rem; }
  .cwv-tag { font-size: .65rem; color: var(--soft); background: var(--chip-bg); padding: .05rem .35rem; border-radius: 4px; }
  .cwv-note { color: var(--faint); font-size: .85rem; margin: 1rem 0; }

  details.fam { margin: 0; }
  .fam-sum { cursor: pointer; font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 .4rem;
    padding: .3rem 0 .35rem; border-bottom: 1px solid var(--line); list-style: none;
    display: flex; align-items: center; gap: .5rem; }
  .fam-sum::-webkit-details-marker { display: none; }
  .fam-sum::before { content: "\\25B8"; color: var(--faint); font-size: .8em; flex: 0 0 auto; transition: transform .15s; }
  details[open] > .fam-sum::before { transform: rotate(90deg); }
  .fam-sum:hover { color: var(--good); }
  .fam-sum h2 { margin: 0; padding: 0; border: 0; font: inherit; flex: 1; min-width: 0;
    display: flex; align-items: center; gap: .5rem; }
  .fam-sum .pts { font-weight: 400; }
  .fam-dot { width: 9px; height: 9px; border-radius: 50%; margin-left: auto; flex: 0 0 auto; }
  .fam-dot.good { background: var(--good); } .fam-dot.ok { background: var(--warn); } .fam-dot.bad { background: var(--bad); }
  details.fam > table { margin-top: .25rem; }

  @media (max-width: 640px) {
    /* overflow-wrap inherits: breaks long space-less tokens (URLs in .meta, verdict,
       action-plan fixes) that would otherwise force horizontal scroll on phones. */
    body { padding: 1.1rem; overflow-wrap: anywhere; }
    h1 { font-size: 1.3rem; }
    h2 { font-size: 1.05rem; }
    .tocbar { margin: 0 -1.1rem 1rem; padding: .45rem 1.1rem; }
    .tocbar a { padding: .3rem .4rem; font-size: .8rem; }
    .fam-sum { font-size: 1rem; }
    .hero { flex-direction: column; align-items: flex-start; gap: .8rem; }
    .axes { flex-direction: column; }
    .subscore-table td { padding: .3rem .25rem; }
    .fam-label { width: auto; }
    .fam-weight { width: 3rem; }
    td { padding: .4rem .3rem; overflow-wrap: anywhere; }
    td.pts { width: auto; }
    code { overflow-wrap: anywhere; }
    .cwv-grid { gap: .7rem; justify-content: center; }
    .ap-line { flex-wrap: wrap; }
    .ap-fix { flex-basis: 100%; }
  }
  @media print {
    /* Layers 1 and 2 are the printable synthesis: force a page break after the
       plan so the summary stands on its own sheet. */
    body { padding: 0; max-width: none; }
    .tocbar { display: none; }
    .action-plan { break-after: page; }
    h2, tr, .subscore-table tr { break-inside: avoid; }
    .fam-sum { break-after: avoid; }
    /* Reveal every collapsed disclosure so a direct print of the web result page
       is complete (the downloaded export is already open). */
    details.fam > table, details.pass-list > table { display: table !important; content-visibility: visible !important; }
    details.breakdown > *, details.pass-list > *, .ap-how > *, .ap-rest > * { display: revert !important; }
    .bar-fill, .grade, .fam-score, .axis-score, .cwv-ring, .fam-dot, .toc-grade { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function renderHtml(
  report: AuditReport,
  now: Date = new Date(),
  lang: Lang = 'en',
  { collapsed = false, diff, history }: { collapsed?: boolean; diff?: ReportDiff; history?: HistoryEntry[] } = {},
): string {
  const m = messages(lang);
  const familyLabels = FAMILY_LABELS_I18N[lang];
  const familyShort = FAMILY_SHORT_I18N[lang];
  const date = now.toISOString().slice(0, 10);
  const families = Object.keys(familyLabels) as Family[];

  // ---------------------------------------------------------------- layer 3
  // One row per check. The human title leads; the technical id is demoted to a
  // small tag. Passing checks fold away — a report shows what is wrong first.
  const renderRow = (r: CheckResult): string => {
    const why = checkWhy(r.id, lang);
    const whyHtml = why ? `<div class="why">${escapeHtml(why)}</div>` : '';
    const fixText = checkFix(r.id, lang, r.fix);
    const link = r.docUrl && r.status !== 'pass' && r.status !== 'skip'
      ? ` <a class="fix-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">${m.learnMore}</a>` : '';
    const fix = fixText && r.status !== 'pass' && r.status !== 'skip'
      ? `<div class="fix">${escapeHtml(fixText)}${link}</div>` : '';
    return `<tr class="row">
        <td class="st ${r.status}">${STATUS_LABEL[r.status]}</td>
        <td>
          <div class="row-head"><span class="ck-title">${escapeHtml(checkTitle(r.id, lang))}</span><code class="ck-id">${escapeHtml(r.id)}</code>${r.evidence === 'heuristic' ? `<span class="ck-ev" title="${escapeHtml(m.evidenceTip)}">${escapeHtml(m.evidenceHeuristic)}</span>` : ''}</div>
          <div class="msg">${escapeHtml(localizeMessage(r, lang))}</div>${whyHtml}${fix}
        </td>
        <td class="pts">${r.points}/${r.maxPoints}</td>
      </tr>`;
  };

  const sections: string[] = [];
  for (const family of families) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    // Issues (fail/warn/skip) stay visible; passes go behind a disclosure.
    const issues = results.filter((r) => r.status !== 'pass');
    const passes = results.filter((r) => r.status === 'pass');
    const issuesTable = issues.length > 0
      ? `<table>${issues.map(renderRow).join('\n')}</table>`
      : `<p class="fam-none">${m.noIssues}</p>`;
    const passTable = passes.length > 0
      ? `<details class="pass-list"><summary>${escapeHtml(m.showPassed(passes.length))}</summary>
      <table>${passes.map(renderRow).join('\n')}</table></details>`
      : '';
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
      ${issuesTable}
      ${passTable}
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

  // The eight families keep their table and their chart — they simply stop
  // being the FIRST thing read (R2/R3: one score visual up top, one vocabulary).
  const breakdown = report.familyScores.length > 0
    ? `<details class="breakdown">
<summary>${escapeHtml(m.familyBreakdown)}</summary>
<section class="subscores">
<h2>${m.categorySubscores}</h2>
<table class="subscore-table">${subscoreRows}</table>
</section>
<div class="viz-bars">
<h3>${escapeHtml(m.vizTitle)}</h3>
${renderPriorityBars(report.familyScores, lang)}
</div>
</details>`
    : '';

  // --history: sparklines only make sense with >= 2 points; a first run keeps
  // the report identical to one produced without --history at all.
  const series = (history ?? []).filter((e) => e.url === report.url);
  const trendsSection = series.length >= 2
    ? `<section class="trends">
<h2>${escapeHtml(m.trendsTitle)}</h2>
<div class="trend-row"><span class="trend-label">${escapeHtml(m.trendsOverall)}</span>${renderSparklineSvg(series.map((e) => e.score))}<span class="trend-now">${series[series.length - 1].score}</span></div>
${families.map((f) => {
      const vals = series.map((e) => e.families[f]).filter((v): v is number => typeof v === 'number');
      if (vals.length < 2) return '';
      return `<div class="trend-row"><span class="trend-label">${escapeHtml(familyShort[f])}</span>${renderSparklineSvg(vals)}<span class="trend-now">${vals[vals.length - 1]}</span></div>`;
    }).join('\n')}
<p class="trend-caption">${escapeHtml(m.trendsRuns(series.length))}</p>
</section>`
    : '';

  const passed = report.results.filter((r) => r.status === 'pass').length;
  const toFix = report.results.filter((r) => r.status === 'fail' || r.status === 'warn').length;

  const cwvSection = report.psi
    ? renderCwvHtml(report.psi, lang)
    : `<p class="cwv-note">${m.cwvNotMeasured}</p>`;

  // Entity graph (#58): the runner builds it on every audit for the
  // entity-graph-connectivity check; drawing it costs nothing extra and is the
  // one view that shows *why* a disconnected @graph reads as unrelated facts.
  // `stats` is read defensively: a report can also reach this renderer from
  // outside the runner (an older audit.json, a user-supplied file), and a
  // missing summary must drop the two notes, never throw mid-render.
  const graph = report.entityGraph;
  const graphDrawing = graph && graph.nodes.length > 0 ? renderEntityGraphSvg(graph, lang) : '';
  const entityGraphSection = graph && graphDrawing
    ? `<div class="eg">
<h3>${escapeHtml(m.egTitle)}</h3>
<p class="eg-caption">${escapeHtml(m.egCaption)}</p>
<div class="eg-scroll">${graphDrawing}</div>
${(graph.stats?.components ?? 1) > 1 ? `<p class="eg-note">${escapeHtml(m.egIslands(graph.stats.components))}</p>` : ''}
${(graph.stats?.danglingRefs ?? 0) > 0 ? `<p class="eg-legend"><span><span class="eg-key"></span>${escapeHtml(m.egBroken)}</span></p>` : ''}
</div>`
    : '';

  // ---------------------------------------------------------------- layer 1
  const axes = axisScores(report.familyScores);
  // "Blocked at the door" outranks every other finding: a disallowed
  // citation-time fetcher makes the rest of the report academic.
  const blocked = report.results.some((r) => r.id === 'ai-crawlers-allowed' && r.status === 'fail');
  const verdict = verdictSentence(axes, report.score, blocked, lang);
  const axisTiles = axes.map((a) => {
    const value = a.score === null
      ? `<div class="axis-score">${escapeHtml(m.axisNotApplicable)}</div>`
      : `<div class="axis-score ${scoreClass(a.score)}">${a.score}</div>`;
    return `<div class="axis">${value}
      <div class="axis-name">${escapeHtml(m.axisLabel[a.key])}</div>
      <div class="axis-q">${escapeHtml(m.axisQuestion[a.key])}</div>
    </div>`;
  }).join('\n');

  // ---------------------------------------------------------------- layer 2
  const recs = collectRecommendations(report.results);
  const renderApItem = (r: Recommendation): string => {
    const more = r.docUrl
      ? ` <a class="ap-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">${m.learnMore}</a>` : '';
    // R9: the plan says WHERE. The check already names its offending paths in
    // its message; they are surfaced here instead of staying buried in layer 3.
    const where = r.offenders.length > 0
      ? `<div class="ap-where">${escapeHtml(m.planWhere)} ${r.offenders.map((p) => `<code>${escapeHtml(p)}</code>`).join(' ')}</div>`
      : '';
    const why = checkWhy(r.id, lang);
    const snippet = checkSnippet(r.id);
    const howBody = [
      why ? `<div class="why">${escapeHtml(why)}</div>` : '',
      snippet ? `<pre class="snippet"><code>${escapeHtml(snippet)}</code></pre>` : '',
    ].filter(Boolean).join('\n');
    const how = howBody
      ? `<details class="ap-how"><summary>${escapeHtml(m.planHow)}</summary>${howBody}</details>`
      : '';
    return `<div class="ap-item">
      <div class="ap-line">
        <span class="ap-sev ${r.status}"></span>
        <span class="chip">${escapeHtml(familyShort[r.family])}</span>
        <span class="ap-fix"><strong>${escapeHtml(checkTitle(r.id, lang))}</strong> — ${escapeHtml(checkFix(r.id, lang, r.fix) ?? r.fix)}${more}</span>
        <span class="ap-imp">+${r.impact} ${m.pts}</span>
      </div>
      ${where}
      ${how}
    </div>`;
  };

  const renderLane = (effort: Effort): string => {
    const items = recs.filter((r) => r.effort === effort);
    if (items.length === 0) return '';
    // The projection is the real recomputed score, not an approximation: same
    // weighted-renormalized formula as computeScore, with this lane's points
    // credited to their families.
    let projection = '';
    if (report.familyScores.length > 0) {
      const to = projectScore(report.familyScores, items);
      projection = to > report.score
        ? `<span class="lane-proj">${escapeHtml(m.laneProjection(items.length, report.score, to, gradeOf(to)))}</span>`
        : `<span class="lane-proj flat">${escapeHtml(m.laneFlat(items.length, report.score))}</span>`;
    }
    const head = `<div class="lane-head"><h3>${escapeHtml(m.laneTitle[effort])}</h3>`
      + `<span class="lane-hint">${escapeHtml(m.laneHint[effort])}</span>${projection}</div>`;
    const shown = items.slice(0, LANE_VISIBLE).map(renderApItem).join('\n');
    // No silent cap (R9): the tail is folded, never dropped, and the summary
    // states how many are in it.
    const rest = items.length > LANE_VISIBLE
      ? `<details class="ap-rest"><summary>${escapeHtml(m.planRest(items.length - LANE_VISIBLE))}</summary>
      ${items.slice(LANE_VISIBLE).map(renderApItem).join('\n')}</details>`
      : '';
    return `<div class="lane">${head}${shown}${rest}</div>`;
  };

  // Backlog A3: the three best-payoff fixes (weighted points ÷ effort) open
  // the plan, so the reader knows where to start before arbitrating lanes.
  const top = topFixes(recs);
  const topStrip = top.length === 0 ? '' : `<div class="top-fixes">
<h3>${escapeHtml(m.topFixesTitle(top.length))}</h3>
<ol>
${top.map((r) => `<li><span class="ap-sev ${r.status}"></span><strong>${escapeHtml(checkTitle(r.id, lang))}</strong> — ${escapeHtml(checkFix(r.id, lang, r.fix) ?? r.fix)} <span class="ap-imp">+${r.impact} ${m.pts}</span> <span class="chip">${escapeHtml(m.laneTitle[r.effort])}</span></li>`).join('\n')}
</ol>
</div>`;

  const actionPlan = `<section class="action-plan" id="plan">
<h2>${m.actionPlan}</h2>
${recs.length === 0 ? `<p class="plan-empty">${escapeHtml(m.planEmpty)}</p>` : `${topStrip}\n${LANES.map(renderLane).join('\n')}`}
</section>`;

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
<nav class="tocbar" aria-label="${escapeHtml(m.reportTitle)}">
  <a href="#verdict">${escapeHtml(m.nav.verdict)}</a>
  <a href="#plan">${escapeHtml(m.nav.plan)}</a>
  <a href="#cwv">${escapeHtml(m.nav.cwv)}</a>
  <a href="#detail">${escapeHtml(m.nav.detail)}</a>
  <span class="toc-grade ${gradeClass(report.grade)}">${m.gradeLabel} ${escapeHtml(report.grade)}</span>
</nav>
<section id="verdict">
<header class="hero">
  ${renderScoreGauge(report.score, report.grade, lang)}
  <div class="hero-meta">
    <span class="grade ${gradeClass(report.grade)}">${m.gradeLabel} ${escapeHtml(report.grade)}</span>
    <div class="verdict">${escapeHtml(verdict)}</div>
    <p class="stats">${m.stats(passed, toFix, report.sampledPages.length)}</p>
    <p class="pages">${m.pagesAudited} ${pages}</p>
  </div>
</header>
<div class="axes">${axisTiles}</div>
</section>
${actionPlan}
<div id="cwv">${cwvSection}</div>
${diff ? renderDiffHtmlSection(diff, lang) : ''}
${trendsSection}
<section id="detail">
<h2>${escapeHtml(m.detailTitle)}</h2>
${report.results.some((r) => r.evidence === 'heuristic')
    ? `<p class="ev-legend"><span class="ck-ev">${escapeHtml(m.evidenceHeuristic)}</span> ${escapeHtml(m.evidenceTip)}</p>`
    : ''}
${entityGraphSection}
${breakdown}
${sections.join('\n')}
</section>
<footer>${m.footer}</footer>
</body>
</html>
`;
}
