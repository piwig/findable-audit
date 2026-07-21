import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePsi, fetchPsi, CWV_THRESHOLDS } from '../../src/perf/psi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  readFileSync(path.join(here, '..', 'fixtures', 'psi-sample.json'), 'utf8'),
);

// NOTE: no test in this file hits the real PageSpeed Insights API. The parser is
// exercised against a captured fixture; fetchPsi is exercised with globalThis.fetch
// stubbed, then restored.

describe('parsePsi (captured PSI v5 fixture, no network)', () => {
  it('maps url-level CrUX field metrics, normalising CLS ÷100', () => {
    const r = parsePsi(sample, 'mobile');
    expect(r.strategy).toBe('mobile');
    expect(r.field.origin).toBe(false); // url-level metrics present -> not the origin fallback
    expect(r.field.lcp).toEqual({ p75: 1800, category: 'FAST' });
    expect(r.field.cls).toEqual({ p75: 0.05, category: 'FAST' }); // raw 5 -> 0.05
    expect(r.field.inp).toEqual({ p75: 150, category: 'FAST' });
    expect(r.field.ttfb).toEqual({ p75: 400, category: 'FAST' });
    expect(r.field.overallCategory).toBe('FAST');
  });

  it('maps Lighthouse lab metrics', () => {
    const r = parsePsi(sample, 'desktop');
    expect(r.strategy).toBe('desktop');
    expect(r.lab.perfScore).toBe(0.98);
    expect(r.lab.lcp).toBeCloseTo(1900.42, 2);
    expect(r.lab.fcp).toBeCloseTo(1200.5, 2);
    expect(r.lab.tbt).toBe(80);
    expect(r.lab.serverResponseTime).toBe(300);
    expect(r.lab.speedIndex).toBe(2000);
  });

  it('falls back to originLoadingExperience when the url has no field metrics', () => {
    const json = {
      loadingExperience: { overall_category: 'NONE' }, // no metrics
      originLoadingExperience: {
        metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3200, category: 'AVERAGE' } },
        overall_category: 'AVERAGE',
      },
      lighthouseResult: { categories: { performance: { score: 0.7 } }, audits: {} },
    };
    const r = parsePsi(json, 'mobile');
    expect(r.field.origin).toBe(true);
    expect(r.field.lcp).toEqual({ p75: 3200, category: 'AVERAGE' });
    expect(r.field.overallCategory).toBe('AVERAGE');
    expect(r.lab.perfScore).toBe(0.7);
  });

  it('leaves field metrics undefined when there is no CrUX data (lab still parsed)', () => {
    const json = {
      loadingExperience: { overall_category: 'NONE' },
      lighthouseResult: {
        categories: { performance: { score: 0.42 } },
        audits: { 'first-contentful-paint': { numericValue: 3500 } },
      },
    };
    const r = parsePsi(json, 'mobile');
    expect(r.field.lcp).toBeUndefined();
    expect(r.field.cls).toBeUndefined();
    expect(r.field.inp).toBeUndefined();
    expect(r.field.ttfb).toBeUndefined();
    expect(r.field.overallCategory).toBe('NONE');
    expect(r.lab.perfScore).toBe(0.42);
    expect(r.lab.fcp).toBe(3500);
    expect(r.lab.lcp).toBeUndefined();
  });

  it('never throws on a malformed/empty response', () => {
    expect(() => parsePsi({}, 'mobile')).not.toThrow();
    const r = parsePsi({}, 'mobile');
    expect(r.field.origin).toBe(false);
    expect(r.field.overallCategory).toBeUndefined();
    expect(r.lab.perfScore).toBeUndefined();
  });

  it('exposes the authoritative threshold table', () => {
    expect(CWV_THRESHOLDS.lcp).toEqual({ good: 2500, poor: 4000 });
    expect(CWV_THRESHOLDS.cls).toEqual({ good: 0.1, poor: 0.25 });
    expect(CWV_THRESHOLDS.inp).toEqual({ good: 200, poor: 500 });
    expect(CWV_THRESHOLDS.ttfb).toEqual({ good: 800, poor: 1800 });
    expect(CWV_THRESHOLDS.lighthouse).toEqual({ good: 0.9, poor: 0.5 });
    expect(CWV_THRESHOLDS.tbt).toEqual({ good: 200, poor: 600 });
  });
});

describe('fetchPsi (globalThis.fetch stubbed, never the real API)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('builds the v5 runPagespeed URL with url/strategy/category/key and parses a 200', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: string | URL) => {
      calledUrl = String(input);
      return { ok: true, status: 200, json: async () => sample } as Response;
    }) as typeof fetch;

    const r = await fetchPsi('https://example.com/', { key: 'SECRET', strategy: 'desktop' });
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('desktop');
    expect(r!.lab.perfScore).toBe(0.98);

    const u = new URL(calledUrl);
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    expect(u.searchParams.get('url')).toBe('https://example.com/');
    expect(u.searchParams.get('strategy')).toBe('desktop');
    expect(u.searchParams.get('category')).toBe('performance');
    expect(u.searchParams.get('key')).toBe('SECRET');
  });

  it('omits the key param when none is provided and defaults strategy to mobile', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: string | URL) => {
      calledUrl = String(input);
      return { ok: true, status: 200, json: async () => sample } as Response;
    }) as typeof fetch;

    const r = await fetchPsi('https://example.com/');
    expect(r!.strategy).toBe('mobile');
    const u = new URL(calledUrl);
    expect(u.searchParams.get('strategy')).toBe('mobile');
    expect(u.searchParams.has('key')).toBe(false);
  });

  it('returns null on a non-200 response (e.g. keyless 429 rate-limit)', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) } as Response)) as typeof fetch;
    expect(await fetchPsi('https://example.com/')).toBeNull();
  });

  it('returns null on a transport error', async () => {
    globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    expect(await fetchPsi('https://example.com/')).toBeNull();
  });
});
