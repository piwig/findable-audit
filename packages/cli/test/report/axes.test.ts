import { describe, it, expect } from 'vitest';
import {
  AXIS_FAMILIES, AXIS_ORDER, TRUST_CHECK_IDS,
  axisScores, trustLens, projectScore, verdictSentence,
} from '../../src/report/axes.js';
import type { AxisScore } from '../../src/report/axes.js';
import type { FamilyScore } from '../../src/scoring.js';
import type { Recommendation } from '../../src/report/recommendations.js';
import type { CheckResult, Family } from '../../src/types.js';

/**
 * A147 — the presentation layer (3 axes, trust lens, projected score, verdict
 * sentence) was only exercised through string assertions in html/summary
 * tests. These pin the arithmetic and the rule ladder directly.
 */

const ALL_FAMILIES: Family[] = [
  'ai-access', 'technical-seo', 'llm-content', 'structured-data',
  'on-page', 'performance', 'accessibility', 'security',
];

function fs(family: Family, earned: number, max = 100, weight = 1): FamilyScore {
  return { family, score: Math.round((100 * earned) / max), weight, earned, max };
}

function rec(family: Family, impact: number): Recommendation {
  return { family, impact } as unknown as Recommendation;
}

function result(id: string, points: number, maxPoints: number, status: CheckResult['status'] = 'pass'): CheckResult {
  return { id, points, maxPoints, status } as unknown as CheckResult;
}

describe('axisScores (A147)', () => {
  it('the three axes partition the eight families exactly', () => {
    const covered = AXIS_ORDER.flatMap((k) => AXIS_FAMILIES[k]);
    expect([...covered].sort()).toEqual([...ALL_FAMILIES].sort());
    expect(new Set(covered).size).toBe(ALL_FAMILIES.length);
  });

  it('returns axes in AXIS_ORDER with the weighted, renormalized blend', () => {
    const axes = axisScores([
      fs('ai-access', 100, 100, 3),   // reachable: (3*1 + 1*0.5) / 4 = 87.5 -> 88
      fs('technical-seo', 50, 100, 1),
      fs('llm-content', 20), fs('structured-data', 40), fs('on-page', 60), // understood: 40
      fs('performance', 0), fs('accessibility', 0), fs('security', 100),  // usable: 33
    ]);
    expect(axes.map((a) => a.key)).toEqual(AXIS_ORDER);
    expect(axes[0]).toEqual({ key: 'reachable', score: 88, families: ['ai-access', 'technical-seo'] });
    expect(axes[1].score).toBe(40);
    expect(axes[2].score).toBe(33);
  });

  it('an axis whose families are all absent scores null, not 0', () => {
    const axes = axisScores([fs('security', 80)]);
    expect(axes.find((a) => a.key === 'reachable')).toEqual({ key: 'reachable', score: null, families: [] });
    expect(axes.find((a) => a.key === 'usable')).toEqual({ key: 'usable', score: 80, families: ['security'] });
  });
});

describe('trustLens (A147)', () => {
  it('is a points-weighted ratio over the trust checks that ran', () => {
    const lens = trustLens([
      result('content-author-eeat', 5, 10),
      result('sameas-verified', 10, 10),
      result('some-other-check', 0, 50),          // not a trust signal
      result('content-freshness', 0, 10, 'skip'), // skipped: absent
    ]);
    expect(lens).toEqual({ score: 75, ids: ['content-author-eeat', 'sameas-verified'] });
  });

  it('scores null when no trust check ran', () => {
    expect(trustLens([])).toEqual({ score: null, ids: [] });
    expect(trustLens([result('content-freshness', 0, 10, 'skip')])).toEqual({ score: null, ids: [] });
  });

  it('every trust check id is a plausible check id (kebab-case, non-empty)', () => {
    for (const id of TRUST_CHECK_IDS) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('projectScore (A147)', () => {
  const scores = [fs('ai-access', 50, 100, 2), fs('security', 100, 100, 1)]; // overall: (2*0.5+1*1)/3 = 67

  it('with no recommendations equals the overall score formula', () => {
    expect(projectScore(scores, [])).toBe(67);
  });

  it('adds each fix to its family, capped at the family max', () => {
    expect(projectScore(scores, [rec('ai-access', 25)])).toBe(83);          // (2*0.75+1)/3
    expect(projectScore(scores, [rec('ai-access', 500)])).toBe(100);        // capped
    expect(projectScore(scores, [rec('security', 50)])).toBe(67);           // already at max
    expect(projectScore(scores, [rec('ai-access', 10), rec('ai-access', 15)])).toBe(83); // summed per family
  });

  it('returns 0 on an empty family list', () => {
    expect(projectScore([], [rec('ai-access', 10)])).toBe(0);
  });
});

describe('verdictSentence (A147)', () => {
  const axes = (reachable: number | null, understood: number | null, usable: number | null): AxisScore[] => [
    { key: 'reachable', score: reachable, families: [] },
    { key: 'understood', score: understood, families: [] },
    { key: 'usable', score: usable, families: [] },
  ];

  it('a blocked citation-time crawler outranks everything, in both languages', () => {
    const en = verdictSentence(axes(100, 100, 100), 100, true, 'en');
    const fr = verdictSentence(axes(100, 100, 100), 100, true, 'fr');
    expect(en).toMatch(/turned away at the door/);
    expect(fr).toMatch(/refusé à la porte/);
    expect(en).not.toBe(fr);
  });

  it('nothing measured when every axis is null', () => {
    expect(verdictSentence(axes(null, null, null), 0, false, 'en')).toMatch(/Nothing measurable/);
  });

  it('excellent at 90 and above, regardless of the weakest axis', () => {
    expect(verdictSentence(axes(95, 70, 100), 90, false, 'en')).toMatch(/sampled pages.*does not guarantee/);
    expect(verdictSentence(axes(95, 70, 100), 90, false, 'fr')).toMatch(/pages échantillonnées.*ne garantit/);
    expect(verdictSentence(axes(95, 70, 100), 89, false, 'en')).not.toMatch(/does not guarantee/);
  });

  it('picks the weakest axis, weak below 60, mid otherwise', () => {
    expect(verdictSentence(axes(30, 80, 80), 70, false, 'en')).toMatch(/struggle to reach/);   // reachable weak
    expect(verdictSentence(axes(65, 80, 80), 70, false, 'en')).toMatch(/get in, but not everywhere/); // reachable mid
    expect(verdictSentence(axes(80, 30, 80), 70, false, 'en')).toMatch(/cannot cite you/);     // understood weak
    expect(verdictSentence(axes(80, 80, 59), 70, false, 'en')).toMatch(/page itself is what holds it back/); // usable weak
    expect(verdictSentence(axes(80, 80, 60), 70, false, 'fr')).toMatch(/Rien ne bloque un robot/); // usable mid, fr
  });

  it('ignores null axes when looking for the weakest', () => {
    expect(verdictSentence(axes(null, 30, 80), 70, false, 'en')).toMatch(/cannot cite you/);
  });
});
