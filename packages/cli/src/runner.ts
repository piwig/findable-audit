import { Crawler } from './crawler.js';
import type { Check, CheckResult } from './types.js';
import { makeResult } from './types.js';

export class UnreachableSiteError extends Error {}

export interface AuditReport {
  url: string;
  score: number;
  results: CheckResult[];
}

export async function runAudit(url: string, checks: Check[]): Promise<AuditReport> {
  const crawler = new Crawler(url);
  const home = await crawler.fetch('/');
  if (home === null) throw new UnreachableSiteError(`Cannot reach ${url}`);
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      results.push(await check.run(crawler));
    } catch (err) {
      results.push(makeResult(check, 'fail', `check crashed: ${(err as Error).message}`));
    }
  }
  const scored = results.filter((r) => r.status !== 'skip');
  const max = scored.reduce((s, r) => s + r.maxPoints, 0);
  const earned = scored.reduce((s, r) => s + r.points, 0);
  return { url: crawler.baseUrl.toString(), score: max === 0 ? 0 : Math.round((earned / max) * 100), results };
}
