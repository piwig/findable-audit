import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePsi } from '../../src/perf/psi.js';
import { bucketOf, renderCwvHtml, renderCwvMarkdown } from '../../src/report/cwv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'psi-sample.json'), 'utf8'));
const psi = parsePsi(sample, 'mobile'); // lcp1800 inp150 cls0.05 ttfb400 all FAST, lab perf0.98

describe('bucketOf (lower is better)', () => {
  it('classifies against good/poor thresholds inclusively', () => {
    expect(bucketOf(2500, { good: 2500, poor: 4000 })).toBe('good');
    expect(bucketOf(3000, { good: 2500, poor: 4000 })).toBe('ni');
    expect(bucketOf(4001, { good: 2500, poor: 4000 })).toBe('poor');
  });
});

describe('renderCwvHtml', () => {
  const html = renderCwvHtml(psi);
  it('renders one gauge per present field metric', () => {
    for (const name of ['LCP', 'INP', 'CLS', 'TTFB']) expect(html).toContain(name);
  });
  it('colors gauges via conic-gradient and keeps values readable', () => {
    expect(html).toContain('conic-gradient');
    expect(html).toContain('1.8 s'); // LCP 1800ms
    expect(html).toContain('150 ms'); // INP
    expect(html).toContain('0.05'); // CLS
  });
  it('shows the compact Lighthouse lab line', () => {
    expect(html).toContain('98'); // perfScore 0.98 -> 98/100
  });
  it('does not render a gauge for a metric absent from the field data', () => {
    const noInp = { ...psi, field: { ...psi.field, inp: undefined } };
    const out = renderCwvHtml(noInp);
    expect(out).not.toContain('<div class="cwv-name">INP</div>'); // no fabricated INP gauge
    expect(out).toContain('<div class="cwv-name">LCP</div>');     // a measured metric keeps its gauge
    // (the educational explainer glossary still lists INP by design — not a measurement)
  });

  it('derives the assessment from present metrics when overallCategory is absent (correct threshold per metric)', () => {
    const psiNoOverall = {
      strategy: 'mobile' as const,
      field: { ttfb: { p75: 2000, category: '' }, overallCategory: 'NONE', origin: false },
      lab: {},
    };
    // TTFB 2000ms > poor(1800) -> FAILED ; and no crash from a missing LCP/INP/CLS
    expect(renderCwvHtml(psiNoOverall)).toContain('FAILED');
  });

  it('defaults to English (assessment + CrUX source)', () => {
    expect(html).toMatch(/PASSED|NEEDS WORK|FAILED|INCONCLUSIVE/);
    expect(html).toMatch(/CrUX (origin\b|field)/);
  });
  it('renders French labels when asked', () => {
    const htmlFr = renderCwvHtml(psi, 'fr');
    expect(htmlFr).toMatch(/RÉUSSI|À AMÉLIORER|ÉCHEC|NON CONCLUANT/); // success badge is localized too
    expect(htmlFr).not.toContain('PASSED');                          // no leftover English state
    expect(htmlFr).toMatch(/CrUX (origine|terrain)/);
  });
  it('emits neither advice nor an all-good note when no field metric was measured (lab-only PSI)', () => {
    const labOnly = { ...psi, field: { origin: false } };
    const out = renderCwvHtml(labOnly);
    expect(out).not.toContain('cwv-allgood');   // an all-good note would contradict…
    expect(out).toMatch(/INCONCLUSIVE/);        // …the inconclusive assessment badge
    expect(out).not.toContain('How to improve');
    const md = renderCwvMarkdown(labOnly);
    expect(md).not.toMatch(/good.*range|nice work/i);
    expect(md).not.toContain('How to improve');
  });
  it('includes an explainer (what each metric means) + intro, and an all-good note when everything passes', () => {
    expect(html).toContain('What these metrics mean');
    expect(html).toMatch(/Core Web Vitals are Google/); // intro
    expect(html).toContain('Largest Contentful Paint');
    expect(html).toMatch(/good.*range|nice work/i);     // cwvAllGood (sample is all-FAST)
    expect(html).not.toContain('How to improve');       // no advice list when all good
  });
  it('shows targeted advice ONLY for metrics that are not good', () => {
    const slowLcp = { ...psi, field: { ...psi.field, lcp: { ...psi.field.lcp, p75: 5000 } } };
    const out = renderCwvHtml(slowLcp);
    expect(out).toContain('How to improve');
    expect(out).toMatch(/<b>LCP<\/b>/);   // advice item keyed by the metric code
    expect(out).toMatch(/hero image/i);
    expect(out).not.toContain('good range'); // the all-good note is gone
  });
  it('localizes the explainer + advice in French', () => {
    const slowLcp = { ...psi, field: { ...psi.field, lcp: { ...psi.field.lcp, p75: 5000 } } };
    const fr = renderCwvHtml(slowLcp, 'fr');
    expect(fr).toContain('Ce que mesurent ces indicateurs');
    expect(fr).toContain('Comment améliorer');
    expect(fr).toMatch(/image principale/i);
  });
  it('renders a KPI table with each measured metric beside its good/poor thresholds', () => {
    expect(html).toContain('class="cwv-kpi"');
    expect(html).toContain('&le; 2.5 s');  // LCP "good" threshold (2500 ms)
    expect(html).toContain('&gt; 4.0 s');  // LCP "poor" threshold (4000 ms)
    expect(html).toMatch(/<th>Metric<\/th>/); // English headers by default
  });
  it('localizes the KPI table headers in French', () => {
    const fr = renderCwvHtml(psi, 'fr');
    expect(fr).toMatch(/<th>Métrique<\/th>/);
    expect(fr).toMatch(/<th>Évaluation<\/th>/);
  });
});

describe('renderCwvMarkdown', () => {
  it('renders a table with a status per present metric', () => {
    const md = renderCwvMarkdown(psi);
    expect(md).toContain('## Core Web Vitals');
    expect(md).toMatch(/\| LCP \| 1\.8 s \|/);
  });

  it('defaults to English status + header', () => {
    const md = renderCwvMarkdown(psi);
    expect(md).toContain('| Metric | p75 | Status | Source |');
    expect(md).toMatch(/✅ Good|⚠️ Needs improvement|❌ Poor/);
  });
  it('renders French status + header when asked', () => {
    const md = renderCwvMarkdown(psi, 'fr');
    expect(md).toContain('| Métrique | p75 | Statut | Source |');
    expect(md).toMatch(/✅ Bon|⚠️ À améliorer|❌ Mauvais/);
  });
  it('appends the intro, explainer and (result-based) advice, mutually exclusive', () => {
    const md = renderCwvMarkdown(psi);
    expect(md).toMatch(/Core Web Vitals are Google/);   // intro
    expect(md).toContain('What these metrics mean');     // explainer
    expect(md).toMatch(/good.*range|nice work/i);        // all-good note (sample all FAST)
    expect(md).not.toContain('How to improve');          // all-good ⇒ no advice list
    const slow = { ...psi, field: { ...psi.field, cls: { ...psi.field.cls, p75: 0.4 } } };
    const md2 = renderCwvMarkdown(slow);
    expect(md2).toContain('How to improve');
    expect(md2).toMatch(/\*\*CLS\*\*/);
    expect(md2).not.toMatch(/good.*range|nice work/i);   // advice present ⇒ no all-good note
    // French markdown localizes intro + explainer title + advice title
    const frMd = renderCwvMarkdown(slow, 'fr');
    expect(frMd).toMatch(/Core Web Vitals sont les signaux/); // fr intro
    expect(frMd).toContain('Ce que mesurent ces indicateurs');
    expect(frMd).toContain('Comment améliorer');
  });
});
