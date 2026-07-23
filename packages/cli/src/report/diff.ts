// Diff a fresh AuditReport against a baseline (a prior audit.json). Powers the
// CLI's --baseline output and the "vs baseline" section in md/html reports, plus
// the --fail-on-regression CI gate.
//
// Self-contained: it carries its own tiny EN/FR label dictionary so it does not
// depend on the per-check catalogue. Tolerant of old baselines (missing
// generatedAt, missing families, checks present on only one side).

import type { AuditReport } from '../runner.js';
import type { CheckResult, CheckStatus, Family } from '../types.js';
import type { Lang } from './i18n.js';

export interface CheckTransition {
  id: string;
  family: Family;
  from: CheckStatus | 'absent';
  to: CheckStatus | 'absent';
  message: string;
}

export interface FamilyDelta {
  family: Family;
  baseline: number | null;
  current: number | null;
  delta: number | null;
}

export interface ReportDiff {
  baselineScore: number;
  currentScore: number;
  scoreDelta: number;
  familyDeltas: FamilyDelta[];
  regressions: CheckTransition[];
  improvements: CheckTransition[];
  added: string[];
  removed: string[];
  baselineGeneratedAt?: string;
}

// A skipped check contributes no score and is treated as absent for diffing.
const SEVERITY: Record<CheckStatus, number> = { pass: 0, warn: 1, fail: 2, skip: -1 };

function effectiveStatus(r: CheckResult | undefined): CheckStatus | 'absent' {
  if (!r || r.status === 'skip') return 'absent';
  return r.status;
}

export function diffReports(current: AuditReport, baseline: AuditReport): ReportDiff {
  const curById = new Map(current.results.map((r) => [r.id, r]));
  const baseById = new Map(baseline.results.map((r) => [r.id, r]));
  const allIds = new Set([...curById.keys(), ...baseById.keys()]);

  const regressions: CheckTransition[] = [];
  const improvements: CheckTransition[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const id of allIds) {
    const cur = curById.get(id);
    const base = baseById.get(id);
    const from = effectiveStatus(base);
    const to = effectiveStatus(cur);

    // Presence (skip counts as absent).
    if (from === 'absent' && to !== 'absent') { added.push(id); }
    if (to === 'absent' && from !== 'absent') { removed.push(id); }
    if (from === 'absent' || to === 'absent') continue; // no severity transition to grade

    const sevFrom = SEVERITY[from as CheckStatus];
    const sevTo = SEVERITY[to as CheckStatus];
    if (sevTo > sevFrom) {
      regressions.push({ id, family: (cur ?? base)!.family, from, to, message: (cur ?? base)!.message });
    } else if (sevTo < sevFrom) {
      improvements.push({ id, family: (cur ?? base)!.family, from, to, message: (cur ?? base)!.message });
    }
  }

  // Family deltas: outer-join by family name.
  const curFam = new Map(current.familyScores.map((f) => [f.family, f.score]));
  const baseFam = new Map(baseline.familyScores.map((f) => [f.family, f.score]));
  const fams = new Set<Family>([...curFam.keys(), ...baseFam.keys()]);
  const familyDeltas: FamilyDelta[] = [...fams].map((family) => {
    const c = curFam.has(family) ? curFam.get(family)! : null;
    const b = baseFam.has(family) ? baseFam.get(family)! : null;
    return { family, baseline: b, current: c, delta: c !== null && b !== null ? c - b : null };
  });

  return {
    baselineScore: baseline.score,
    currentScore: current.score,
    scoreDelta: current.score - baseline.score,
    familyDeltas,
    regressions: regressions.sort((a, b) => a.id.localeCompare(b.id)),
    improvements: improvements.sort((a, b) => a.id.localeCompare(b.id)),
    added: added.sort(),
    removed: removed.sort(),
    baselineGeneratedAt: baseline.generatedAt,
  };
}

// --- Localized labels (self-contained; not the per-check catalogue) ---
interface DiffLabels {
  title: string; baseline: string; overall: string; family: string;
  regressions: string; improvements: string; added: string; removed: string;
  none: string; was: string;
}
const LABELS: Record<Lang, DiffLabels> = {
  en: {
    title: 'Change vs baseline', baseline: 'baseline', overall: 'Overall score', family: 'Family',
    regressions: 'Regressions', improvements: 'Improvements', added: 'New checks', removed: 'Dropped checks',
    none: 'none', was: 'was',
  },
  fr: {
    title: 'Évolution vs référence', baseline: 'référence', overall: 'Score global', family: 'Famille',
    regressions: 'Régressions', improvements: 'Améliorations', added: 'Nouveaux tests', removed: 'Tests disparus',
    none: 'aucun', was: 'était',
  },
};

function sign(n: number): string { return n > 0 ? `+${n}` : `${n}`; }

export function renderDiffTerminal(d: ReportDiff, lang: Lang = 'en'): string {
  const L = LABELS[lang];
  const lines: string[] = [];
  lines.push(`${L.title}: ${d.currentScore}/100 (${L.baseline} ${d.baselineScore}, ${sign(d.scoreDelta)})`);
  for (const f of d.familyDeltas) {
    if (f.delta === null) continue;
    if (f.delta !== 0) lines.push(`  ${f.family}: ${f.current} (${sign(f.delta)})`);
  }
  const list = (label: string, items: CheckTransition[]) => {
    if (items.length === 0) return;
    lines.push(`${label}: ${items.map((t) => t.id).join(', ')}`);
  };
  list(L.regressions, d.regressions);
  list(L.improvements, d.improvements);
  if (d.added.length) lines.push(`${L.added}: ${d.added.join(', ')}`);
  if (d.removed.length) lines.push(`${L.removed}: ${d.removed.join(', ')}`);
  return lines.join('\n');
}

export function renderDiffMarkdown(d: ReportDiff, lang: Lang = 'en'): string {
  const L = LABELS[lang];
  const lines: string[] = [];
  lines.push(`## ${L.title}`, '');
  lines.push(`**${L.overall}:** ${d.currentScore}/100 — ${L.baseline} ${d.baselineScore} (${sign(d.scoreDelta)})`, '');
  lines.push(`| ${L.family} | ${L.baseline} | ${lang === 'fr' ? 'actuel' : 'current'} | Δ |`, '|---|---|---|---|');
  for (const f of d.familyDeltas) {
    lines.push(`| ${f.family} | ${f.baseline ?? '—'} | ${f.current ?? '—'} | ${f.delta === null ? '—' : sign(f.delta)} |`);
  }
  lines.push('');
  const block = (label: string, items: CheckTransition[]) => {
    lines.push(`**${label}:** ${items.length ? items.map((t) => `\`${t.id}\``).join(', ') : L.none}`);
  };
  block(L.regressions, d.regressions);
  block(L.improvements, d.improvements);
  lines.push(`**${L.added}:** ${d.added.length ? d.added.map((i) => `\`${i}\``).join(', ') : L.none}`);
  lines.push(`**${L.removed}:** ${d.removed.length ? d.removed.map((i) => `\`${i}\``).join(', ') : L.none}`);
  return lines.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDiffHtmlSection(d: ReportDiff, lang: Lang = 'en'): string {
  const L = LABELS[lang];
  const cls = d.scoreDelta > 0 ? 'up' : d.scoreDelta < 0 ? 'down' : 'flat';
  const famRows = d.familyDeltas.map((f) =>
    `<tr><td>${esc(f.family)}</td><td>${f.baseline ?? '—'}</td><td>${f.current ?? '—'}</td>`
    + `<td>${f.delta === null ? '—' : sign(f.delta)}</td></tr>`).join('');
  const idList = (items: string[]) => items.length ? items.map((i) => `<code>${esc(i)}</code>`).join(', ') : L.none;
  return `<section class="diff" style="max-width:960px;margin:1.5rem auto;padding:1rem;border:1px solid #e2e8e2;border-radius:10px">`
    + `<h2 style="margin:0 0 .5rem">${esc(L.title)}</h2>`
    + `<p><strong>${esc(L.overall)}:</strong> ${d.currentScore}/100 — ${esc(L.baseline)} ${d.baselineScore} `
    + `<span class="${cls}" style="font-weight:700;color:${d.scoreDelta >= 0 ? '#0f766e' : '#b91c1c'}">(${sign(d.scoreDelta)})</span></p>`
    + `<table style="width:100%;border-collapse:collapse"><thead><tr>`
    + `<th style="text-align:left">${esc(L.family)}</th><th>${esc(L.baseline)}</th><th>${lang === 'fr' ? 'actuel' : 'current'}</th><th>Δ</th>`
    + `</tr></thead><tbody>${famRows}</tbody></table>`
    + `<p><strong>${esc(L.regressions)}:</strong> ${idList(d.regressions.map((t) => t.id))}</p>`
    + `<p><strong>${esc(L.improvements)}:</strong> ${idList(d.improvements.map((t) => t.id))}</p>`
    + `<p><strong>${esc(L.added)}:</strong> ${idList(d.added)}</p>`
    + `<p><strong>${esc(L.removed)}:</strong> ${idList(d.removed)}</p>`
    + `</section>`;
}
