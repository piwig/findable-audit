import type { Grade } from '../scoring.js';
import { messages, type Lang } from './i18n.js';

/** One-line human verdict from the grade and the number of failing checks. */
export function verdictOf(grade: Grade, failCount: number, lang: Lang = 'en'): string {
  return messages(lang).verdict(grade, failCount);
}
