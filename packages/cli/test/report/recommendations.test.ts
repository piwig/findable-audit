import { describe, it, expect } from 'vitest';
import { collectRecommendations, topFixes } from '../../src/report/recommendations.js';
import type { CheckResult } from '../../src/types.js';

const results: CheckResult[] = [
  { id: 'pass-no-fix', family: 'on-page', status: 'pass', points: 5, maxPoints: 5, message: 'ok' },
  { id: 'warn-sec', family: 'security', status: 'warn', points: 2, maxPoints: 4, message: 'm', fix: 'do x', docUrl: 'https://d/sec' },
  { id: 'fail-perf', family: 'performance', status: 'fail', points: 0, maxPoints: 6, message: 'm', fix: 'do y', docUrl: 'https://d/perf' },
  { id: 'fail-onpage', family: 'on-page', status: 'fail', points: 0, maxPoints: 3, message: 'm', fix: 'do z' },
  { id: 'skip-x', family: 'performance', status: 'skip', points: 0, maxPoints: 4, message: 'm', fix: 'ignored' },
];

describe('collectRecommendations', () => {
  const recs = collectRecommendations(results);
  it('keeps only fail/warn checks that have a fix', () => {
    expect(recs.map((r) => r.id)).toEqual(['fail-perf', 'fail-onpage', 'warn-sec']);
  });
  it('orders fails before warns, then by weighted impact desc', () => {
    // fail-perf: impact 6 * weight(performance .10)=0.6 ; fail-onpage: 3 * (.12)=0.36 -> perf first
    expect(recs[0].id).toBe('fail-perf');
    expect(recs[1].id).toBe('fail-onpage');
    expect(recs[2].status).toBe('warn');
  });
  it('computes recoverable points as impact', () => {
    expect(recs[0].impact).toBe(6);
    expect(recs.find((r) => r.id === 'warn-sec')!.impact).toBe(2);
  });
  it('assigns an effort estimate to each recommendation (family default here)', () => {
    expect(recs.find((r) => r.id === 'fail-perf')!.effort).toBe('involved'); // performance
    expect(recs.find((r) => r.id === 'fail-onpage')!.effort).toBe('quick');  // on-page
    expect(recs.find((r) => r.id === 'warn-sec')!.effort).toBe('quick');     // security
  });
});

describe('topFixes', () => {
  const recs = collectRecommendations(results);
  it('ranks by weighted payoff ÷ effort cost, not by raw impact', () => {
    // fail-perf: 0.6/4 (involved) = 0.15 ; fail-onpage: 0.36/1 = 0.36 ;
    // warn-sec: 2*.06=0.12/1 = 0.12 -> the cheap on-page fix outranks the big perf project.
    expect(topFixes(recs).map((r) => r.id)).toEqual(['fail-onpage', 'fail-perf', 'warn-sec']);
  });
  it('caps at n and never mutates its input', () => {
    const before = recs.map((r) => r.id);
    expect(topFixes(recs, 2)).toHaveLength(2);
    expect(recs.map((r) => r.id)).toEqual(before);
  });
  it('is empty when there is nothing to fix', () => {
    expect(topFixes([])).toEqual([]);
  });
});
