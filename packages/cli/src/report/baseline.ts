import type { AuditReport } from '../runner.js';
import { FAMILY_WEIGHTS } from '../scoring.js';

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const number = (v: unknown, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const family = (v: unknown) => typeof v === 'string' && Object.hasOwn(FAMILY_WEIGHTS, v);
const url = (v: unknown): v is string => {
  if (!text(v)) return false;
  try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; }
};

/** Validate fields consumed by baseline comparisons; older reports may omit metadata. */
export function isAuditReport(value: unknown): value is AuditReport {
  if (!object(value) || !url(value.url) || !number(value.score, 100)
    || typeof value.grade !== 'string' || !['A', 'B', 'C', 'D', 'F'].includes(value.grade)
    || !Array.isArray(value.sampledPages) || !value.sampledPages.every(text)
    || !Array.isArray(value.results) || !Array.isArray(value.familyScores)) return false;
  if (value.toolVersion !== undefined && !text(value.toolVersion)) return false;
  if (value.generatedAt !== undefined && !text(value.generatedAt)) return false;
  if (!value.results.every((r) => object(r) && text(r.id) && family(r.family)
    && typeof r.status === 'string' && ['pass', 'warn', 'fail', 'skip'].includes(r.status)
    && number(r.points) && number(r.maxPoints) && r.points <= r.maxPoints
    && typeof r.message === 'string')) return false;
  if (!value.familyScores.every((f) => object(f) && family(f.family) && number(f.score, 100)
    && number(f.weight, 1) && number(f.earned) && number(f.max) && f.earned <= f.max)) return false;
  return new Set(value.results.map((r) => r.id)).size === value.results.length
    && new Set(value.familyScores.map((f) => f.family)).size === value.familyScores.length;
}

/** Paths and HTTP→HTTPS changes are allowed; another hostname is another site. */
export function sameBaselineSite(baselineUrl: string, currentUrl: string): boolean {
  try { return new URL(baselineUrl).hostname === new URL(currentUrl).hostname; } catch { return false; }
}

export type BaselineValidation = { ok: true; report: AuditReport }
  | { ok: false; reason: 'invalid-report' | 'different-site' };

export function validateBaseline(value: unknown, currentUrl?: string): BaselineValidation {
  if (!isAuditReport(value)) return { ok: false, reason: 'invalid-report' };
  if (currentUrl !== undefined && !sameBaselineSite(value.url, currentUrl)) return { ok: false, reason: 'different-site' };
  return { ok: true, report: value };
}
