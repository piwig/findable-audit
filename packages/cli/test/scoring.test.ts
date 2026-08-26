import { describe, it, expect } from 'vitest';
import { FAMILY_WEIGHTS, gradeOf, computeScore } from '../src/scoring.js';
import type { CheckResult, CheckStatus, Family } from '../src/types.js';

/**
 * A88(b) — direct unit tests for the sold score: weight invariant, grade
 * boundaries, skip handling and renormalization. Until now the scoring maths
 * only had indirect coverage through end-to-end runs.
 */

function res(family: Family, status: CheckStatus, points: number, maxPoints: number): CheckResult {
  return {
    id: `${family}-${status}-${points}-${maxPoints}`,
    family,
    evidence: 'internal-bar',
    status,
    points,
    maxPoints,
    message: 'test',
  } as CheckResult;
}

describe('FAMILY_WEIGHTS (A88b)', () => {
  it('weights sum to exactly 1.00', () => {
    const sum = Object.values(FAMILY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
  });

  it('every weight is strictly positive', () => {
    for (const w of Object.values(FAMILY_WEIGHTS)) expect(w).toBeGreaterThan(0);
  });
});

describe('gradeOf (A88b)', () => {
  it('maps boundary scores to documented grades (A>=90, B>=80, C>=70, D>=60, F<60)', () => {
    expect(gradeOf(100)).toBe('A');
    expect(gradeOf(90)).toBe('A');
    expect(gradeOf(89)).toBe('B');
    expect(gradeOf(80)).toBe('B');
    expect(gradeOf(79)).toBe('C');
    expect(gradeOf(70)).toBe('C');
    expect(gradeOf(69)).toBe('D');
    expect(gradeOf(60)).toBe('D');
    expect(gradeOf(59)).toBe('F');
    expect(gradeOf(0)).toBe('F');
  });
});

describe('computeScore (A88b)', () => {
  it('returns 100 / grade A when every non-skip check earns full points', () => {
    const results = (Object.keys(FAMILY_WEIGHTS) as Family[]).map((f) => res(f, 'pass', 5, 5));
    const s = computeScore(results);
    expect(s.score).toBe(100);
    expect(s.grade).toBe('A');
    expect(s.familyScores).toHaveLength(Object.keys(FAMILY_WEIGHTS).length);
  });

  it('returns 0 and no family scores when there are no results', () => {
    const s = computeScore([]);
    expect(s.score).toBe(0);
    expect(s.grade).toBe('F');
    expect(s.familyScores).toEqual([]);
  });

  it('ignores skip results entirely (points and maxPoints)', () => {
    const withSkip = computeScore([
      res('ai-access', 'pass', 5, 5),
      res('ai-access', 'skip', 0, 5),
    ]);
    const withoutSkip = computeScore([res('ai-access', 'pass', 5, 5)]);
    expect(withSkip).toEqual(withoutSkip);
    expect(withSkip.score).toBe(100);
  });

  it('excludes a family whose checks are all skip, and renormalizes weights', () => {
    const s = computeScore([
      res('ai-access', 'pass', 5, 5),
      res('security', 'skip', 0, 5),
    ]);
    expect(s.familyScores.map((f) => f.family)).toEqual(['ai-access']);
    // Renormalization: the only included family fully passes -> 100, not 16.
    expect(s.score).toBe(100);
  });

  it('weights family subscores by FAMILY_WEIGHTS', () => {
    // ai-access (0.16) at 0%, llm-content (0.18) at 100% -> 100*0.18/0.34 = 52.94 -> 53
    const s = computeScore([
      res('ai-access', 'fail', 0, 5),
      res('llm-content', 'pass', 5, 5),
    ]);
    expect(s.score).toBe(53);
    expect(s.grade).toBe('F');
  });

  it('keeps familyScores in canonical FAMILY_WEIGHTS order regardless of input order', () => {
    const s = computeScore([
      res('security', 'pass', 1, 2),
      res('ai-access', 'pass', 1, 2),
    ]);
    expect(s.familyScores.map((f) => f.family)).toEqual(['ai-access', 'security']);
    expect(s.familyScores[0]).toMatchObject({ score: 50, weight: FAMILY_WEIGHTS['ai-access'], earned: 1, max: 2 });
  });
});
