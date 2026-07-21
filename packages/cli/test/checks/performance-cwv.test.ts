import { describe, it, expect } from 'vitest';
import type { CrawlContext } from '../../src/types.js';
import type { PsiResult, PsiField, PsiLab } from '../../src/perf/psi.js';
import {
  lighthousePerf, cwvLcp, cwvCls, cwvInp, cwvAssessment, cwvTtfb, labTbt, labFcp,
} from '../../src/checks/performance-cwv.js';

// Every test here injects a fake `ctx.psi` — NO check reaches the network (the
// single PSI call happens in the runner, not in a check).

function mkPsi(field: Partial<PsiField> = {}, lab: PsiLab = {}, strategy: 'mobile' | 'desktop' = 'mobile'): PsiResult {
  return { strategy, field: { origin: false, ...field }, lab };
}
function ctxWith(psi: PsiResult | null | undefined): CrawlContext {
  return { baseUrl: new URL('http://x/'), async fetch() { return null; }, psi };
}

const ALL = [lighthousePerf, cwvLcp, cwvCls, cwvInp, cwvAssessment, cwvTtfb, labTbt, labFcp];

describe('CWV checks — opt-in / no-data gating', () => {
  it('every CWV check skips (never fails) when --cwv was not passed (ctx.psi undefined)', async () => {
    for (const check of ALL) {
      const r = await check.run(ctxWith(undefined));
      expect(r.status).toBe('skip');
      expect(r.message).toMatch(/--cwv/);
    }
  });
  it('every CWV check skips when the PSI call failed (ctx.psi null)', async () => {
    for (const check of ALL) {
      const r = await check.run(ctxWith(null));
      expect(r.status).toBe('skip');
      expect(r.message).toMatch(/psi-key/i);
    }
  });
});

describe('lighthouse-perf (lab score)', () => {
  const run = (perfScore?: number) => lighthousePerf.run(ctxWith(mkPsi({}, { perfScore })));
  it('passes at >=0.90', async () => expect((await run(0.95)).status).toBe('pass'));
  it('warns 0.50–0.89', async () => expect((await run(0.7)).status).toBe('warn'));
  it('fails below 0.50', async () => expect((await run(0.3)).status).toBe('fail'));
  it('skips when there is no lab score', async () => expect((await run(undefined)).status).toBe('skip'));
});

describe('cwv-lcp (field p75, lab fallback)', () => {
  const field = (p75: number) => cwvLcp.run(ctxWith(mkPsi({ lcp: { p75, category: '' } })));
  it('passes at <=2500ms (field)', async () => expect((await field(2000)).status).toBe('pass'));
  it('warns 2500–4000ms (field)', async () => expect((await field(3000)).status).toBe('warn'));
  it('fails above 4000ms (field)', async () => expect((await field(5000)).status).toBe('fail'));
  it('falls back to lab LCP when there is no field data', async () => {
    expect((await cwvLcp.run(ctxWith(mkPsi({}, { lcp: 2000 })))).status).toBe('pass');
    expect((await cwvLcp.run(ctxWith(mkPsi({}, { lcp: 5000 })))).status).toBe('fail');
  });
  it('skips when neither field nor lab LCP is present', async () => {
    expect((await cwvLcp.run(ctxWith(mkPsi({}, {})))).status).toBe('skip');
  });
});

describe('cwv-cls (field p75)', () => {
  const field = (p75: number) => cwvCls.run(ctxWith(mkPsi({ cls: { p75, category: '' } })));
  it('passes at <=0.10', async () => expect((await field(0.05)).status).toBe('pass'));
  it('warns 0.10–0.25', async () => expect((await field(0.2)).status).toBe('warn'));
  it('fails above 0.25', async () => expect((await field(0.3)).status).toBe('fail'));
  it('skips with no field CLS', async () => expect((await cwvCls.run(ctxWith(mkPsi({}, {})))).status).toBe('skip'));
});

describe('cwv-inp (field p75, absent -> skip)', () => {
  const field = (p75: number) => cwvInp.run(ctxWith(mkPsi({ inp: { p75, category: '' } })));
  it('passes at <=200ms', async () => expect((await field(150)).status).toBe('pass'));
  it('warns 200–500ms', async () => expect((await field(300)).status).toBe('warn'));
  it('fails above 500ms', async () => expect((await field(600)).status).toBe('fail'));
  it('skips (not fails) when absent — low traffic', async () => {
    const r = await cwvInp.run(ctxWith(mkPsi({}, {})));
    expect(r.status).toBe('skip');
  });
});

describe('cwv-assessment (overall_category)', () => {
  const overall = (overallCategory: string) => cwvAssessment.run(ctxWith(mkPsi({ overallCategory })));
  it('passes on FAST', async () => expect((await overall('FAST')).status).toBe('pass'));
  it('warns on AVERAGE', async () => expect((await overall('AVERAGE')).status).toBe('warn'));
  it('fails on SLOW', async () => expect((await overall('SLOW')).status).toBe('fail'));
  it('skips on NONE / missing', async () => {
    expect((await overall('NONE')).status).toBe('skip');
    expect((await cwvAssessment.run(ctxWith(mkPsi({})))).status).toBe('skip');
  });
});

describe('cwv-ttfb (field p75, lab server-response-time fallback)', () => {
  const field = (p75: number) => cwvTtfb.run(ctxWith(mkPsi({ ttfb: { p75, category: '' } })));
  it('passes at <=800ms (field)', async () => expect((await field(400)).status).toBe('pass'));
  it('warns 800–1800ms (field)', async () => expect((await field(1000)).status).toBe('warn'));
  it('fails above 1800ms (field)', async () => expect((await field(2000)).status).toBe('fail'));
  it('falls back to lab server-response-time', async () => {
    expect((await cwvTtfb.run(ctxWith(mkPsi({}, { serverResponseTime: 300 })))).status).toBe('pass');
    expect((await cwvTtfb.run(ctxWith(mkPsi({}, { serverResponseTime: 2000 })))).status).toBe('fail');
  });
  it('skips when neither field nor lab TTFB is present', async () => {
    expect((await cwvTtfb.run(ctxWith(mkPsi({}, {})))).status).toBe('skip');
  });
});

describe('lab-tbt (lab total-blocking-time, strict-less good)', () => {
  const tbt = (v: number) => labTbt.run(ctxWith(mkPsi({}, { tbt: v })));
  it('passes below 200ms', async () => expect((await tbt(100)).status).toBe('pass'));
  it('warns at exactly 200ms (strict-less boundary)', async () => expect((await tbt(200)).status).toBe('warn'));
  it('warns 200–600ms', async () => expect((await tbt(400)).status).toBe('warn'));
  it('fails above 600ms', async () => expect((await tbt(700)).status).toBe('fail'));
  it('skips with no lab TBT', async () => expect((await labTbt.run(ctxWith(mkPsi({}, {})))).status).toBe('skip'));
});

describe('lab-fcp (lab FCP cross-checked with lab LCP)', () => {
  const fcpLcp = (fcp: number, lcp?: number) => labFcp.run(ctxWith(mkPsi({}, { fcp, lcp })));
  it('passes when FCP<=1800 and lab LCP<=2500', async () => expect((await fcpLcp(1200, 2000)).status).toBe('pass'));
  it('passes on FCP alone when lab LCP is absent', async () => expect((await fcpLcp(1500)).status).toBe('pass'));
  it('warns in the middle band (FCP)', async () => expect((await fcpLcp(2500, 2000)).status).toBe('warn'));
  it('warns when lab LCP is in the middle band', async () => expect((await fcpLcp(1200, 3000)).status).toBe('warn'));
  it('fails when FCP>3000', async () => expect((await fcpLcp(3500, 2000)).status).toBe('fail'));
  it('fails when lab LCP>4000', async () => expect((await fcpLcp(1200, 4500)).status).toBe('fail'));
  it('skips with no lab FCP', async () => expect((await labFcp.run(ctxWith(mkPsi({}, {})))).status).toBe('skip'));
});
