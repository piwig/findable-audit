import type { AuditReport } from '../runner.js';
import type { Family } from '../types.js';
import { messages, FAMILY_LABELS_I18N, type Lang } from './i18n.js';

/** Escape text for safe inclusion in HTML. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function hostOf(url: string): string { try { return new URL(url).hostname || url; } catch { return url; } }
function scoreClass(s: number): string { return s >= 80 ? 'good' : s >= 60 ? 'ok' : 'bad'; }

/**
 * Rendering options shared by the three compare renderers.
 * `cwvNote` (default true): compare audits are lightweight — they skip Core Web
 * Vitals — so a note says so near the family scores. Callers whose compare
 * audits DID measure CWV (CLI `--cwv`) pass `cwvNote: false` to suppress it.
 */
export interface CompareRenderOptions { cwvNote?: boolean }

interface Column { host: string; you: boolean; score: number; grade: string; fam: Map<Family, number>; }

function columns(reports: AuditReport[]): Column[] {
  return reports.map((r, i) => ({
    host: hostOf(r.url),
    you: i === 0,
    score: r.score,
    grade: r.grade,
    fam: new Map(r.familyScores.map((f) => [f.family, f.score])),
  }));
}

/** Families that appear in at least one report, in canonical order. */
function familiesOf(cols: Column[], lang: Lang): Family[] {
  const order = Object.keys(FAMILY_LABELS_I18N[lang]) as Family[];
  return order.filter((fam) => cols.some((c) => c.fam.has(fam)));
}

/** Rows where "you" (column 0) trail the best competitor, largest gap first. */
function gaps(cols: Column[], fams: Family[], labels: Record<Family, string>, m: ReturnType<typeof messages>) {
  const you = cols[0];
  const others = cols.slice(1);
  const out: Array<{ label: string; gap: number }> = [];
  const bestOf = (get: (c: Column) => number | undefined) =>
    Math.max(...others.map((c) => get(c) ?? -1));
  const overallBest = bestOf((c) => c.score);
  if (overallBest > you.score) out.push({ label: m.compareOverall, gap: overallBest - you.score });
  for (const fam of fams) {
    const yourScore = you.fam.get(fam);
    if (yourScore == null) continue;
    const best = bestOf((c) => c.fam.get(fam));
    if (best > yourScore) out.push({ label: labels[fam], gap: best - yourScore });
  }
  return out.sort((a, b) => b.gap - a.gap);
}

export function renderCompareMarkdown(reports: AuditReport[], lang: Lang = 'en', opts: CompareRenderOptions = {}): string {
  const m = messages(lang);
  const labels = FAMILY_LABELS_I18N[lang];
  const cols = columns(reports);
  const fams = familiesOf(cols, lang);
  const header = ['', ...cols.map((c) => `${c.host}${c.you ? ` (${m.compareYou})` : ''}`)];
  const lines: string[] = [`## ${m.compareTitle}`, '', `| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  // overall row
  const leaderScore = Math.max(...cols.map((c) => c.score));
  lines.push(`| **${m.compareOverall}** | ${cols.map((c) => `${c.score === leaderScore ? '**' : ''}${c.score}/100 ${c.grade}${c.score === leaderScore ? '** 🏆' : ''}`).join(' | ')} |`);
  for (const fam of fams) {
    const vals = cols.map((c) => c.fam.get(fam));
    const present = vals.filter((v): v is number => v != null);
    const best = present.length ? Math.max(...present) : -1;
    lines.push(`| ${labels[fam]} | ${vals.map((v) => (v == null ? '—' : `${v === best ? '**' : ''}${v}${v === best ? '**' : ''}`)).join(' | ')} |`);
  }
  if (opts.cwvNote !== false) lines.push('', `_${m.compareCwvNote}_`);
  lines.push('');
  const g = gaps(cols, fams, labels, m);
  lines.push(`### ${m.compareGapsTitle}`, '');
  if (g.length === 0) lines.push(m.compareNoGaps, '');
  else { for (const x of g) lines.push(`- **${x.label}** — −${x.gap} ${m.compareBehind}`); lines.push(''); }
  return lines.join('\n');
}

const COMPARE_STYLE = `
  body { font: 15px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; margin: 0; padding: 2rem; max-width: 960px; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; } h2 { font-size: 1.1rem; margin: 1.5rem 0 .5rem; }
  .meta { color: #666; font-size: .9rem; margin-bottom: 1rem; }
  .cmp-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 30rem; }
  th, td { padding: .5rem .6rem; border-bottom: 1px solid #eee; text-align: center; font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align: left; }
  thead th { border-bottom: 2px solid #ddd; font-size: .85rem; color: #444; }
  .you { color: #1a7f37; }
  td.lead { font-weight: 800; }
  td.lead::after { content: " 🏆"; }
  .s.good { color: #1a7f37; } .s.ok { color: #9a6700; } .s.bad { color: #b42318; }
  .cwv-note { color: #666; font-size: .85rem; margin: .5rem 0 0; }
  .gaps { margin: 1.25rem 0; } .gaps li { margin: .2rem 0; }
  .gap-n { font-weight: 700; color: #b42318; }
  footer { margin-top: 2rem; color: #888; font-size: .8rem; border-top: 1px solid #e5e5e5; padding-top: .75rem; }
  @media (max-width: 560px) { body { padding: 1.1rem; } }
`;

export function renderCompareHtml(reports: AuditReport[], now: Date = new Date(), lang: Lang = 'en', opts: CompareRenderOptions = {}): string {
  const m = messages(lang);
  const labels = FAMILY_LABELS_I18N[lang];
  const cols = columns(reports);
  const fams = familiesOf(cols, lang);
  const date = now.toISOString().slice(0, 10);
  const leaderScore = Math.max(...cols.map((c) => c.score));
  const headCells = cols.map((c) => `<th class="${c.you ? 'you' : ''}">${esc(c.host)}${c.you ? ` (${esc(m.compareYou)})` : ''}</th>`).join('');
  const overall = `<tr><td><b>${esc(m.compareOverall)}</b></td>${cols.map((c) =>
    `<td class="s ${scoreClass(c.score)}${c.score === leaderScore ? ' lead' : ''}">${c.score}/100 · ${esc(c.grade)}</td>`).join('')}</tr>`;
  const famRows = fams.map((fam) => {
    const vals = cols.map((c) => c.fam.get(fam));
    const present = vals.filter((v): v is number => v != null);
    const best = present.length ? Math.max(...present) : -1;
    return `<tr><td>${esc(labels[fam])}</td>${vals.map((v) =>
      v == null ? '<td>—</td>' : `<td class="s ${scoreClass(v)}${v === best ? ' lead' : ''}">${v}</td>`).join('')}</tr>`;
  }).join('');
  const g = gaps(cols, fams, labels, m);
  const gapsHtml = g.length === 0
    ? `<p>${esc(m.compareNoGaps)}</p>`
    : `<ul class="gaps">${g.map((x) => `<li>${esc(x.label)} — <span class="gap-n">−${x.gap}</span> ${esc(m.compareBehind)}</li>`).join('')}</ul>`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.compareTitle)}</title>
<style>${COMPARE_STYLE}</style>
</head>
<body>
<h1>${esc(m.compareTitle)}</h1>
<div class="meta">${cols.map((c) => esc(c.host)).join(' · ')} — ${date}</div>
<div class="cmp-wrap"><table>
<thead><tr><th></th>${headCells}</tr></thead>
<tbody>${overall}${famRows}</tbody>
</table></div>
${opts.cwvNote !== false ? `<p class="cwv-note">${esc(m.compareCwvNote)}</p>\n` : ''}<h2>${esc(m.compareGapsTitle)}</h2>
${gapsHtml}
<footer>${esc(m.footer)}</footer>
</body>
</html>
`;
}

/** Compact plain-text comparison for stdout. */
export function renderCompareTerminal(reports: AuditReport[], lang: Lang = 'en', opts: CompareRenderOptions = {}): string {
  const m = messages(lang);
  const labels = FAMILY_LABELS_I18N[lang];
  const cols = columns(reports);
  const fams = familiesOf(cols, lang);
  const w = Math.max(14, ...fams.map((f) => labels[f].length)) + 2;
  const colW = Math.max(10, ...cols.map((c) => c.host.length + (c.you ? 6 : 0))) + 3;
  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
  const lines: string[] = [m.compareTitle, ''];
  lines.push(pad('', w) + cols.map((c) => pad(`${c.host}${c.you ? ` (${m.compareYou})` : ''}`, colW)).join(''));
  const leaderScore = Math.max(...cols.map((c) => c.score));
  lines.push(pad(m.compareOverall, w) + cols.map((c) => pad(`${c.score}/100 ${c.grade}${c.score === leaderScore ? ' *' : ''}`, colW)).join(''));
  for (const fam of fams) {
    const vals = cols.map((c) => c.fam.get(fam));
    const present = vals.filter((v): v is number => v != null);
    const best = present.length ? Math.max(...present) : -1;
    lines.push(pad(labels[fam], w) + vals.map((v) => pad(v == null ? '—' : `${v}${v === best ? ' *' : ''}`, colW)).join(''));
  }
  if (opts.cwvNote !== false) lines.push('', m.compareCwvNote);
  const g = gaps(cols, fams, labels, m);
  lines.push('', m.compareGapsTitle + ':');
  if (g.length === 0) lines.push('  ' + m.compareNoGaps);
  else for (const x of g) lines.push(`  ${x.label}: -${x.gap} ${m.compareBehind}`);
  return lines.join('\n');
}
