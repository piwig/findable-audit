import type { CheckResult, Family } from './types.js';

/**
 * Family weights (sum = 1.00). These govern the weighted overall score; the raw
 * point values inside a family only matter relative to each other.
 * Order is canonical: renderers and `familyScores` iterate in this order.
 */
export const FAMILY_WEIGHTS: Record<Family, number> = {
  'ai-access': 0.16,
  'llm-content': 0.18,
  'structured-data': 0.15,
  'technical-seo': 0.15,
  'on-page': 0.12,
  performance: 0.1,
  accessibility: 0.07,
  security: 0.07,
};

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Letter grade for a 0-100 score: A>=90, B>=80, C>=70, D>=60, F<60. */
export function gradeOf(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Per-family subscore over that family's non-skip checks (only included families). */
export interface FamilyScore {
  family: Family;
  /** Subscore 0-100 (round of earned/max). */
  score: number;
  /** The family's base weight (before renormalization). */
  weight: number;
  earned: number;
  max: number;
}

export interface ScoreResult {
  /** Weighted overall score, 0-100. */
  score: number;
  grade: Grade;
  /** Only families with at least one non-skip check (max > 0), in canonical order. */
  familyScores: FamilyScore[];
}

/**
 * Weighted, renormalized scoring (spec v0.2 §2):
 *   sub_i  = earned_i / max_i     over non-skip checks in family i
 *   included = families with max_i > 0 (a family with only skips is excluded)
 *   W      = Σ weight_i           (i ∈ included)
 *   score  = round( 100 * Σ (weight_i * sub_i) / W )
 * Invariant: when every non-skip check passes, every sub_i = 1, so score = 100.
 */
export function computeScore(results: CheckResult[]): ScoreResult {
  const acc = new Map<Family, { earned: number; max: number }>();
  for (const r of results) {
    if (r.status === 'skip') continue;
    const cur = acc.get(r.family) ?? { earned: 0, max: 0 };
    cur.earned += r.points;
    cur.max += r.maxPoints;
    acc.set(r.family, cur);
  }

  const familyScores: FamilyScore[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  for (const family of Object.keys(FAMILY_WEIGHTS) as Family[]) {
    const a = acc.get(family);
    if (!a || a.max === 0) continue; // excluded: no non-skip checks in this family
    const sub = a.earned / a.max;
    const weight = FAMILY_WEIGHTS[family];
    familyScores.push({ family, score: Math.round(sub * 100), weight, earned: a.earned, max: a.max });
    weightedSum += weight * sub;
    totalWeight += weight;
  }

  const score = totalWeight === 0 ? 0 : Math.round((100 * weightedSum) / totalWeight);
  return { score, grade: gradeOf(score), familyScores };
}
