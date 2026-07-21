// Core Web Vitals checks (performance family), driven by the single PSI call the
// runner makes when `--cwv` is set. Each check reads `ctx.psi`:
//   • undefined  → `--cwv` was not passed             → skip (tell the user how to opt in)
//   • null       → the PSI call was attempted & failed → skip (likely keyless rate-limit)
//   • PsiResult  → grade against the §5 thresholds; a metric absent from the
//                  response → that check `skip`s (never fails).
// Field (CrUX) data is preferred; lab is the fallback only where the spec says.
// NOTHING here touches the network — the network happens once, in the runner.

import type { Check, CheckStatus, CrawlContext } from '../types.js';
import { makeResult } from '../types.js';
import { CWV_THRESHOLDS, type PsiResult } from '../perf/psi.js';

const OPT_IN = 'Run with `--cwv --psi-key <key>` to measure Core Web Vitals (PageSpeed Insights).';
const NO_DATA =
  'PageSpeed Insights returned no data (rate-limited without a key?); pass `--psi-key <key>` for reliable results.';

/**
 * Resolve `ctx.psi` to either the parsed result or a ready-made skip reason.
 * Distinguishes "no --cwv" (undefined) from "call failed" (null) by message.
 */
function psiOrSkip(ctx: CrawlContext): { psi: PsiResult } | { skip: string } {
  if (ctx.psi === undefined) return { skip: OPT_IN };
  if (ctx.psi === null) return { skip: NO_DATA };
  return { psi: ctx.psi };
}

/** Grade a lower-is-better metric against inclusive good/poor bounds. */
function gradeLower(value: number, good: number, poor: number): CheckStatus {
  if (value <= good) return 'pass';
  if (value <= poor) return 'warn';
  return 'fail';
}

// ---------------------------------------------------------------------------
// lighthouse-perf (PSI lab) — categories.performance.score
// ---------------------------------------------------------------------------

export const lighthousePerf: Check = {
  id: 'lighthouse-perf', family: 'performance', maxPoints: 5,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const score = r.psi.lab.perfScore;
    if (score === undefined) return makeResult(this, 'skip', 'no Lighthouse performance score in PSI response');
    const { good, poor } = CWV_THRESHOLDS.lighthouse;
    const status: CheckStatus = score >= good ? 'pass' : score >= poor ? 'warn' : 'fail';
    const msg = `Lighthouse performance ${score.toFixed(2)} (${Math.round(score * 100)}/100, ${r.psi.strategy})`;
    if (status === 'pass') return makeResult(this, status, msg);
    return makeResult(this, status, msg,
      'Act on the top PSI opportunities: eliminate render-blocking resources, cut unused JS, optimise images.');
  },
};

// ---------------------------------------------------------------------------
// cwv-lcp (CRUX field p75, lab LCP fallback)
// ---------------------------------------------------------------------------

export const cwvLcp: Check = {
  id: 'cwv-lcp', family: 'performance', maxPoints: 6,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const { field, lab } = r.psi;
    const { good, poor } = CWV_THRESHOLDS.lcp;
    const fix = 'Preload the LCP image/font; remove render-blocking CSS/JS ahead of it; speed up the server.';
    if (field.lcp) {
      const status = gradeLower(field.lcp.p75, good, poor);
      const msg = `LCP p75 ${Math.round(field.lcp.p75)}ms (CrUX ${field.origin ? 'origin' : 'url'} field)`;
      return status === 'pass' ? makeResult(this, status, msg) : makeResult(this, status, msg, fix);
    }
    if (lab.lcp !== undefined) {
      const status = gradeLower(lab.lcp, good, poor);
      const msg = `lab LCP ${Math.round(lab.lcp)}ms (no CrUX field data)`;
      return status === 'pass' ? makeResult(this, status, msg) : makeResult(this, status, msg, fix);
    }
    return makeResult(this, 'skip', 'no LCP data (field or lab) in PSI response');
  },
};

// ---------------------------------------------------------------------------
// cwv-cls (CRUX field p75) — field-only (no lab CLS parsed)
// ---------------------------------------------------------------------------

export const cwvCls: Check = {
  id: 'cwv-cls', family: 'performance', maxPoints: 4,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const { field } = r.psi;
    if (!field.cls) return makeResult(this, 'skip', 'no CLS field data in PSI response');
    const { good, poor } = CWV_THRESHOLDS.cls;
    const status = gradeLower(field.cls.p75, good, poor);
    const msg = `CLS p75 ${field.cls.p75.toFixed(2)} (CrUX ${field.origin ? 'origin' : 'url'} field)`;
    if (status === 'pass') return makeResult(this, status, msg);
    return makeResult(this, status, msg,
      'Set width/height on media and ads; reserve space for injected banners/embeds.');
  },
};

// ---------------------------------------------------------------------------
// cwv-inp (CRUX field p75) — absent → skip (low traffic ≠ fail)
// ---------------------------------------------------------------------------

export const cwvInp: Check = {
  id: 'cwv-inp', family: 'performance', maxPoints: 4,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const { field } = r.psi;
    if (!field.inp) return makeResult(this, 'skip', 'no INP field data in PSI response (low-traffic URL)');
    const { good, poor } = CWV_THRESHOLDS.inp;
    const status = gradeLower(field.inp.p75, good, poor);
    const msg = `INP p75 ${Math.round(field.inp.p75)}ms (CrUX ${field.origin ? 'origin' : 'url'} field)`;
    if (status === 'pass') return makeResult(this, status, msg);
    return makeResult(this, status, msg, 'Break up long JS tasks; defer third-party scripts; minimise main-thread work.');
  },
};

// ---------------------------------------------------------------------------
// cwv-assessment (CRUX overall_category)
// ---------------------------------------------------------------------------

export const cwvAssessment: Check = {
  id: 'cwv-assessment', family: 'performance', maxPoints: 4,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const cat = r.psi.field.overallCategory;
    if (cat !== 'FAST' && cat !== 'AVERAGE' && cat !== 'SLOW') {
      return makeResult(this, 'skip', 'no CrUX overall assessment (no field data)');
    }
    const scope = r.psi.field.origin ? 'origin' : 'url';
    const msg = `CrUX assessment ${cat} (${scope} field)`;
    if (cat === 'FAST') return makeResult(this, 'pass', msg);
    return makeResult(this, cat === 'AVERAGE' ? 'warn' : 'fail', msg,
      'Fix whichever of LCP / CLS / INP is worst first; re-measure once field data updates.');
  },
};

// ---------------------------------------------------------------------------
// cwv-ttfb (CRUX field p75, lab server-response-time fallback)
// ---------------------------------------------------------------------------

export const cwvTtfb: Check = {
  id: 'cwv-ttfb', family: 'performance', maxPoints: 3,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const { field, lab } = r.psi;
    const { good, poor } = CWV_THRESHOLDS.ttfb;
    const fix = 'Add edge caching / a CDN; enable keep-alive and HTTP/2; speed up server response.';
    if (field.ttfb) {
      const status = gradeLower(field.ttfb.p75, good, poor);
      const msg = `TTFB p75 ${Math.round(field.ttfb.p75)}ms (CrUX ${field.origin ? 'origin' : 'url'} field)`;
      return status === 'pass' ? makeResult(this, status, msg) : makeResult(this, status, msg, fix);
    }
    if (lab.serverResponseTime !== undefined) {
      const status = gradeLower(lab.serverResponseTime, good, poor);
      const msg = `lab TTFB ${Math.round(lab.serverResponseTime)}ms (server-response-time, no field data)`;
      return status === 'pass' ? makeResult(this, status, msg) : makeResult(this, status, msg, fix);
    }
    return makeResult(this, 'skip', 'no TTFB data (field or lab) in PSI response');
  },
};

// ---------------------------------------------------------------------------
// lab-tbt (PSI lab total-blocking-time) — INP proxy; "good" is strict-less
// ---------------------------------------------------------------------------

export const labTbt: Check = {
  id: 'lab-tbt', family: 'performance', maxPoints: 3,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const tbt = r.psi.lab.tbt;
    if (tbt === undefined) return makeResult(this, 'skip', 'no Total Blocking Time in PSI response');
    const { good, poor } = CWV_THRESHOLDS.tbt;
    const status: CheckStatus = tbt < good ? 'pass' : tbt <= poor ? 'warn' : 'fail';
    const msg = `Total Blocking Time ${Math.round(tbt)}ms (lab, ${r.psi.strategy})`;
    if (status === 'pass') return makeResult(this, status, msg);
    return makeResult(this, status, msg, 'Reduce/defer JS; code-split; cut third-party tags to shorten long tasks.');
  },
};

// ---------------------------------------------------------------------------
// lab-fcp (PSI lab FCP, cross-checked with lab LCP) — the no-field-data proxy
// ---------------------------------------------------------------------------

export const labFcp: Check = {
  id: 'lab-fcp', family: 'performance', maxPoints: 3,
  async run(ctx) {
    const r = psiOrSkip(ctx);
    if ('skip' in r) return makeResult(this, 'skip', r.skip);
    const { fcp, lcp } = r.psi.lab;
    if (fcp === undefined) return makeResult(this, 'skip', 'no lab First Contentful Paint in PSI response');
    const F = CWV_THRESHOLDS.fcp;
    const L = CWV_THRESHOLDS.labLcp;
    const labLcpKnown = lcp !== undefined;
    let status: CheckStatus;
    if (fcp > F.poor || (labLcpKnown && lcp! > L.poor)) status = 'fail';
    else if (fcp <= F.good && (!labLcpKnown || lcp! <= L.good)) status = 'pass';
    else status = 'warn';
    const msg = `lab FCP ${Math.round(fcp)}ms${labLcpKnown ? `, lab LCP ${Math.round(lcp!)}ms` : ''} (${r.psi.strategy})`;
    if (status === 'pass') return makeResult(this, status, msg);
    return makeResult(this, status, msg,
      'Shorten the critical request chain; eliminate render-blocking CSS/JS; preload the hero resource.');
  },
};
