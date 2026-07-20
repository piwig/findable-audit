import { Crawler } from './crawler.js';
import { samplePages } from './sampler.js';
import type { Check, CheckResult } from './types.js';
import { makeResult } from './types.js';
import { pathOf } from './checks/aggregate.js';

export class UnreachableSiteError extends Error {}

export interface AuditReport {
  url: string;
  score: number;
  /** Pathnames of the sampled pages (homepage first). */
  sampledPages: string[];
  results: CheckResult[];
}

export interface AuditOptions {
  timeoutMs?: number;
  /** Max pages sampled (homepage included). 1 = homepage only. Default 10. */
  maxPages?: number;
}

export async function runAudit(url: string, checks: Check[], opts: AuditOptions = {}): Promise<AuditReport> {
  const crawler = new Crawler(url, opts.timeoutMs);
  const home = await crawler.fetch('/');
  if (home === null) throw new UnreachableSiteError(`Cannot reach ${url}`);
  crawler.sample = await samplePages(crawler, opts.maxPages ?? 10);
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      results.push(await check.run(crawler));
    } catch (err) {
      // A crashing check must not affect the score: mark it skipped.
      results.push(makeResult(check, 'skip', `check crashed: ${(err as Error).message}`));
    }
  }
  const scored = results.filter((r) => r.status !== 'skip');
  const max = scored.reduce((s, r) => s + r.maxPoints, 0);
  const earned = scored.reduce((s, r) => s + r.points, 0);
  const sampledPages = crawler.sample.pages.map(pathOf);
  return { url: crawler.baseUrl.toString(), score: max === 0 ? 0 : Math.round((earned / max) * 100), sampledPages, results };
}
