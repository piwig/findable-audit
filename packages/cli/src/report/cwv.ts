import type { PsiResult } from '../perf/psi.js';
import { CWV_THRESHOLDS } from '../perf/psi.js';

export type Bucket = 'good' | 'ni' | 'poor';

/** Lower-is-better bucketing against good/poor thresholds (inclusive). */
export function bucketOf(value: number, t: { good: number; poor: number }): Bucket {
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'ni';
  return 'poor';
}

const CLS = { good: '#1a7f37', ni: '#9a6700', poor: '#b42318' } as const;
const CSSCLASS: Record<Bucket, string> = { good: 'good', ni: 'ok', poor: 'bad' };
const LABEL: Record<Bucket, string> = { good: 'bon', ni: 'à améliorer', poor: 'mauvais' };
const MD_STATUS: Record<Bucket, string> = { good: '✅ Bon', ni: '⚠️ À améliorer', poor: '❌ Mauvais' };

type FieldKey = 'lcp' | 'inp' | 'cls' | 'ttfb';
interface Metric { key: FieldKey; name: string; t: { good: number; poor: number }; fmt: (v: number) => string; }

const METRICS: Metric[] = [
  { key: 'lcp', name: 'LCP', t: CWV_THRESHOLDS.lcp, fmt: (v) => `${(v / 1000).toFixed(1)} s` },
  { key: 'inp', name: 'INP', t: CWV_THRESHOLDS.inp, fmt: (v) => `${Math.round(v)} ms` },
  { key: 'cls', name: 'CLS', t: CWV_THRESHOLDS.cls, fmt: (v) => v.toFixed(2) },
  { key: 'ttfb', name: 'TTFB', t: CWV_THRESHOLDS.ttfb, fmt: (v) => `${(v / 1000).toFixed(1)} s` },
];

/** Fuller arc = better (indicative); the bucket colour + label carry the authoritative signal. */
function arcPct(value: number, t: { good: number; poor: number }): number {
  const frac = Math.max(0.05, Math.min(1, 1 - value / t.poor));
  return Math.round(frac * 100);
}

function assessment(psi: PsiResult): { cls: string; label: string } {
  const oc = psi.field.overallCategory;
  if (oc === 'FAST') return { cls: 'good', label: 'PASSED' };
  if (oc === 'AVERAGE') return { cls: 'ok', label: 'À AMÉLIORER' };
  if (oc === 'SLOW') return { cls: 'bad', label: 'ÉCHEC' };
  // fallback: worst present bucket
  const buckets = METRICS.map((m) => psi.field[m.key]).filter(Boolean)
    .map((fm, i) => bucketOf((fm as { p75: number }).p75, METRICS[i].t));
  if (buckets.includes('poor')) return { cls: 'bad', label: 'ÉCHEC' };
  if (buckets.includes('ni')) return { cls: 'ok', label: 'À AMÉLIORER' };
  if (buckets.length) return { cls: 'good', label: 'PASSED' };
  return { cls: 'ok', label: 'NON CONCLUANT' };
}

export function renderCwvHtml(psi: PsiResult): string {
  const a = assessment(psi);
  const src = psi.field.origin ? 'CrUX origine' : 'CrUX terrain';
  const gauges = METRICS.map((m) => {
    const fm = psi.field[m.key];
    if (!fm) return '';
    const b = bucketOf(fm.p75, m.t);
    const pct = arcPct(fm.p75, m.t);
    return `<div class="cwv-gauge">
      <div class="cwv-ring" style="background:conic-gradient(${CLS[b]} 0 ${pct}%, #eee ${pct}% 100%)">
        <div class="cwv-inner"><span class="cwv-val">${m.fmt(fm.p75)}</span></div>
      </div>
      <div class="cwv-name">${m.name}</div>
      <div class="cwv-bucket ${CSSCLASS[b]}">${LABEL[b]}</div>
    </div>`;
  }).join('');

  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `<div class="cwv-lab">Labo Lighthouse : Perf ${Math.round(lab.perfScore * 100)}/100${
        lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${
        lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''} <span class="cwv-tag">labo</span></div>`
    : '';

  return `<section class="cwv">
<h2>Core Web Vitals</h2>
<p class="cwv-assess-line"><span class="cwv-assess ${a.cls}">${a.label}</span> <span class="cwv-src">${src} · ${psi.strategy}</span></p>
<div class="cwv-grid">${gauges}</div>
${labLine}
</section>`;
}

export function renderCwvMarkdown(psi: PsiResult): string {
  const rows = METRICS.map((m) => {
    const fm = psi.field[m.key];
    if (!fm) return '';
    const b = bucketOf(fm.p75, m.t);
    return `| ${m.name} | ${m.fmt(fm.p75)} | ${MD_STATUS[b]} | ${psi.field.origin ? 'origin' : 'field'} |`;
  }).filter(Boolean).join('\n');
  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `\n_Lab (Lighthouse): Perf ${Math.round(lab.perfScore * 100)}/100${lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''}_\n`
    : '';
  return `## Core Web Vitals\n\n| Metric | p75 | Status | Source |\n|---|---|---|---|\n${rows}\n${labLine}`;
}
