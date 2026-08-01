import type { CheckResult, Family } from '../types.js';
import { FAMILY_WEIGHTS } from '../scoring.js';
import { effortOf, type Effort } from './effort.js';

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
  /** Coarse estimate of how much work the fix takes. */
  effort: Effort;
  /** Paths named in the check's message — the "where" the plan used to omit. */
  offenders: string[];
}

/**
 * Paths a check named in its message. Checks list their offending pages inline
 * ("no <h1> on /a, /b/c"), so the plan can say WHERE without a new data channel.
 *
 * Deliberately conservative: only same-site paths and absolute URLs, never bare
 * words, and capped — an item that names forty pages is a template problem, and
 * the first few make that point just as well.
 */
const OFFENDER_CAP = 6;

export function offendersOf(message: string): string[] {
  const found = message.match(/https?:\/\/[^\s,;)"'<]+|(?<![\w/.-])\/[\w./-]*/g) ?? [];
  const seen: string[] = [];
  for (const raw of found) {
    // Trim trailing punctuation a sentence leaves glued to a path.
    const path = raw.replace(/[.,;:)]+$/, '');
    // A lone "/" is the homepage and is worth showing; anything shorter is noise.
    if (path.length === 0 || seen.includes(path)) continue;
    seen.push(path);
    if (seen.length >= OFFENDER_CAP) break;
  }
  return seen;
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
        effort: effortOf(r.id, r.family),
        offenders: offendersOf(r.message),
      };
    })
    .sort((a, b) => (a.status === b.status ? b.weighted - a.weighted : a.status === 'fail' ? -1 : 1));
}

/** Relative cost of each effort tier, the denominator of the payoff ratio. */
const EFFORT_COST: Record<Effort, number> = { quick: 1, moderate: 2, involved: 4 };

/**
 * The N best-payoff fixes: recoverable weighted points ÷ estimated effort,
 * descending. Ties break on weighted impact, then fails before warns, so a
 * big quick win always outranks a small one and effort never hides a fail
 * behind an equal-ratio warn. This is the "top 3 corrections" strip shown
 * before anything else in the terminal and HTML reports (backlog A3).
 */
export function topFixes(recs: Recommendation[], n = 3): Recommendation[] {
  const ratio = (r: Recommendation): number => r.weighted / EFFORT_COST[r.effort];
  return [...recs]
    .sort((a, b) =>
      ratio(b) - ratio(a)
      || b.weighted - a.weighted
      || (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1))
    .slice(0, n);
}
