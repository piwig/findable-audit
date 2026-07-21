// Core Web Vitals via the Google PageSpeed Insights (PSI) v5 API.
//
// A single PSI call yields both CrUX *field* data (real-user p75 metrics) and
// Lighthouse *lab* data. The result is parsed into a compact `PsiResult` that
// the eight `performance`-family CWV/lab checks read from `ctx.psi`. The parser
// (`parsePsi`) is separated from the network call (`fetchPsi`) so it can be
// unit-tested against a captured fixture without ever hitting the real API.
//
// Zero new dependencies: native `fetch` only.

/** Field (CrUX) metric: the 75th-percentile value plus its CrUX bucket. */
export interface FieldMetric {
  /** p75 value. ms for LCP/INP/TTFB; a unitless CLS score (already ÷100 from the raw API integer). */
  p75: number;
  /** CrUX distribution bucket: 'FAST' | 'AVERAGE' | 'SLOW' (or '' when absent). */
  category: string;
}

/** CrUX field data (real-user), url-level when available else origin-level. */
export interface PsiField {
  lcp?: FieldMetric;
  cls?: FieldMetric;
  inp?: FieldMetric;
  ttfb?: FieldMetric;
  /** loadingExperience.overall_category ('FAST'|'AVERAGE'|'SLOW'|'NONE'|undefined). */
  overallCategory?: string;
  /** true when the field metrics came from originLoadingExperience (origin fallback). */
  origin: boolean;
}

/** Lighthouse lab data (synthetic). All numeric values are milliseconds unless noted. */
export interface PsiLab {
  /** categories.performance.score, 0..1. */
  perfScore?: number;
  lcp?: number;
  fcp?: number;
  /** total-blocking-time. */
  tbt?: number;
  /** server-response-time (a lab TTFB proxy). */
  serverResponseTime?: number;
  speedIndex?: number;
}

export interface PsiResult {
  strategy: 'mobile' | 'desktop';
  field: PsiField;
  lab: PsiLab;
}

/**
 * Authoritative Core Web Vitals thresholds (spec §5). Lower is better for every
 * metric except `lighthouse` (a 0..1 score, higher is better). `tbt` uses a
 * strict `<good` boundary for "pass"; the others treat `good`/`poor` inclusively.
 */
export const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 }, // ms
  cls: { good: 0.1, poor: 0.25 }, // unitless
  inp: { good: 200, poor: 500 }, // ms
  ttfb: { good: 800, poor: 1800 }, // ms
  lighthouse: { good: 0.9, poor: 0.5 }, // score 0..1, higher better
  tbt: { good: 200, poor: 600 }, // ms, strict-less "good"
  fcp: { good: 1800, poor: 3000 }, // ms
  labLcp: { good: 2500, poor: 4000 }, // ms
} as const;

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/* eslint-disable @typescript-eslint/no-explicit-any */

function num(x: any): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/** Map one CrUX metric object → FieldMetric (scaling the raw percentile). */
function fieldMetric(m: any, scale = 1): FieldMetric | undefined {
  const p = num(m?.percentile);
  if (p === undefined) return undefined;
  return { p75: p * scale, category: typeof m?.category === 'string' ? m.category : '' };
}

function hasMetrics(exp: any): boolean {
  return !!exp && !!exp.metrics && Object.keys(exp.metrics).length > 0;
}

/**
 * Parse a PSI v5 JSON response into a `PsiResult`. Best-effort and total: any
 * missing branch simply leaves the corresponding field/lab value `undefined`
 * (so the dependent check `skip`s), and it never throws on a malformed shape.
 *
 * Field metrics: prefer the url-level `loadingExperience`; fall back to
 * `originLoadingExperience` (flagged via `field.origin`). CLS is delivered by
 * the API as an integer ×100 (e.g. 5 → 0.05) and is normalised here.
 */
export function parsePsi(json: any, strategy: 'mobile' | 'desktop'): PsiResult {
  const le = json?.loadingExperience;
  const ole = json?.originLoadingExperience;
  let src: any;
  let origin = false;
  if (hasMetrics(le)) {
    src = le;
  } else if (hasMetrics(ole)) {
    src = ole;
    origin = true;
  }

  const field: PsiField = { origin };
  if (src) {
    const m = src.metrics ?? {};
    field.lcp = fieldMetric(m.LARGEST_CONTENTFUL_PAINT_MS);
    field.cls = fieldMetric(m.CUMULATIVE_LAYOUT_SHIFT_SCORE, 0.01);
    field.inp = fieldMetric(m.INTERACTION_TO_NEXT_PAINT);
    field.ttfb = fieldMetric(m.EXPERIMENTAL_TIME_TO_FIRST_BYTE);
  }
  // overall_category can be present even when url-level metrics are not; take it
  // from whichever experience object supplied the metrics, else the url-level one.
  const overallSrc = src ?? le ?? ole;
  const overall = overallSrc?.overall_category;
  if (typeof overall === 'string') field.overallCategory = overall;

  const lh = json?.lighthouseResult;
  const audits = lh?.audits ?? {};
  const lab: PsiLab = {
    perfScore: num(lh?.categories?.performance?.score),
    lcp: num(audits['largest-contentful-paint']?.numericValue),
    fcp: num(audits['first-contentful-paint']?.numericValue),
    tbt: num(audits['total-blocking-time']?.numericValue),
    serverResponseTime: num(audits['server-response-time']?.numericValue),
    speedIndex: num(audits['speed-index']?.numericValue),
  };

  return { strategy, field, lab };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export interface FetchPsiOptions {
  /** Google PSI/CrUX API key. Strongly recommended: the keyless endpoint is 429-rate-limited. */
  key?: string;
  strategy?: 'mobile' | 'desktop';
  /** Abort signal (honours the audit run's timeout / caller abort). */
  signal?: AbortSignal;
}

/**
 * Make the ONE PageSpeed Insights call for the run and parse it. Returns `null`
 * on any transport error or non-200 response (e.g. a keyless 429), which the
 * checks treat as "no PSI data" and `skip`. Never throws.
 */
export async function fetchPsi(url: string, opts: FetchPsiOptions = {}): Promise<PsiResult | null> {
  const strategy = opts.strategy ?? 'mobile';
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (opts.key) params.set('key', opts.key);
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: opts.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return parsePsi(json, strategy);
  } catch {
    return null;
  }
}
