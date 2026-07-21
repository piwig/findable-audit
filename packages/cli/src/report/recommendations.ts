import type { CheckResult, Family } from '../types.js';
import { FAMILY_WEIGHTS } from '../scoring.js';

export interface Recommendation {
  id: string;
  family: Family;
  status: 'fail' | 'warn';
  fix: string;
  docUrl?: string;
  /** Recoverable points on this check (maxPoints - points). */
  impact: number;
  /** impact weighted by the family's score weight — the cross-family priority key. */
  weighted: number;
}

/** fail/warn checks that carry a fix, sorted fails-first then by weighted impact desc. */
export function collectRecommendations(results: CheckResult[]): Recommendation[] {
  return results
    .filter((r): r is CheckResult & { fix: string } =>
      !!r.fix && (r.status === 'fail' || r.status === 'warn'))
    .map((r) => {
      const impact = r.maxPoints - r.points;
      return {
        id: r.id,
        family: r.family,
        status: r.status as 'fail' | 'warn',
        fix: r.fix,
        docUrl: r.docUrl,
        impact,
        weighted: impact * FAMILY_WEIGHTS[r.family],
      };
    })
    .sort((a, b) => (a.status === b.status ? b.weighted - a.weighted : a.status === 'fail' ? -1 : 1));
}
