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
  it('does not render a metric absent from the field data', () => {
    const noInp = { ...psi, field: { ...psi.field, inp: undefined } };
    expect(renderCwvHtml(noInp)).not.toContain('>INP<');
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
    expect(htmlFr).toMatch(/PASSED|À AMÉLIORER|ÉCHEC|NON CONCLUANT/);
    expect(htmlFr).toMatch(/CrUX (origine|terrain)/);
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
});
