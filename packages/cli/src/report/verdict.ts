import type { Grade } from '../scoring.js';

/** One-line human verdict from the grade and the number of failing checks. */
export function verdictOf(grade: Grade, failCount: number): string {
  const n = failCount;
  switch (grade) {
    case 'A': return n === 0 ? 'Excellent — findabilité IA au top.' : `Très bon — ${n} point(s) à polir.`;
    case 'B': return `Bonne base — ${n} priorité(s) pour viser A.`;
    case 'C': return `Correct — ${n} priorité(s) freinent la findabilité.`;
    case 'D': return `Fragile — ${n} correction(s) importantes à traiter.`;
    default:  return `Fondations à corriger : ${n} point(s) critique(s).`;
  }
}
