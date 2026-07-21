import type { PsiResult } from '../perf/psi.js';
import { CWV_THRESHOLDS } from '../perf/psi.js';
import { messages, type Lang } from './i18n.js';

export type Bucket = 'good' | 'ni' | 'poor';

/** Lower-is-better bucketing against good/poor thresholds (inclusive). */
export function bucketOf(value: number, t: { good: number; poor: number }): Bucket {
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'ni';
  return 'poor';
}

const CLS = { good: '#1a7f37', ni: '#9a6700', poor: '#b42318' } as const;
const CSSCLASS: Record<Bucket, string> = { good: 'good', ni: 'ok', poor: 'bad' };

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

type AssessKey = 'passed' | 'average' | 'slow' | 'inconclusive';

function assessment(psi: PsiResult): { cls: string; key: AssessKey } {
  const oc = psi.field.overallCategory;
  if (oc === 'FAST') return { cls: 'good', key: 'passed' };
  if (oc === 'AVERAGE') return { cls: 'ok', key: 'average' };
  if (oc === 'SLOW') return { cls: 'bad', key: 'slow' };
  // fallback: worst present bucket — keep each metric bound to its own threshold
  const buckets = METRICS
    .filter((m) => psi.field[m.key])
    .map((m) => bucketOf(psi.field[m.key]!.p75, m.t));
  if (buckets.includes('poor')) return { cls: 'bad', key: 'slow' };
  if (buckets.includes('ni')) return { cls: 'ok', key: 'average' };
  if (buckets.length) return { cls: 'good', key: 'passed' };
  return { cls: 'ok', key: 'inconclusive' };
}

export function renderCwvHtml(psi: PsiResult, lang: Lang = 'en'): string {
  const t = messages(lang);
  const a = assessment(psi);
  const src = psi.field.origin ? t.cwvSrcOrigin : t.cwvSrcField;
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
      <div class="cwv-bucket ${CSSCLASS[b]}">${t.cwvBucket[b]}</div>
    </div>`;
  }).join('');

  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `<div class="cwv-lab">${t.cwvLabPrefix} ${Math.round(lab.perfScore * 100)}/100${
        lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${
        lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''} <span class="cwv-tag">${t.cwvLabTag}</span></div>`
    : '';

  return `<section class="cwv">
<h2>${t.cwvTitle}</h2>
<p class="cwv-assess-line"><span class="cwv-assess ${a.cls}">${t.cwvAssess[a.key]}</span> <span class="cwv-src">${src} · ${psi.strategy}</span></p>
<div class="cwv-grid">${gauges}</div>
${labLine}
</section>`;
}

export function renderCwvMarkdown(psi: PsiResult, lang: Lang = 'en'): string {
  const t = messages(lang);
  const rows = METRICS.map((m) => {
    const fm = psi.field[m.key];
    if (!fm) return '';
    const b = bucketOf(fm.p75, m.t);
    return `| ${m.name} | ${m.fmt(fm.p75)} | ${t.cwvMdStatus[b]} | ${psi.field.origin ? t.cwvMdSrcOrigin : t.cwvMdSrcField} |`;
  }).filter(Boolean).join('\n');
  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `\n_${t.cwvLabMdPrefix} ${Math.round(lab.perfScore * 100)}/100${lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''}_\n`
    : '';
  return `## ${t.cwvTitle}\n\n${t.cwvMdHeader}\n|---|---|---|---|\n${rows}\n${labLine}`;
}
