import { Crawler } from './crawler.js';
import { samplePages } from './sampler.js';
import type { Check, CheckResult } from './types.js';
import { makeResult } from './types.js';
import { pathOf } from './checks/aggregate.js';
import { computeScore, type Grade, type FamilyScore } from './scoring.js';

export class UnreachableSiteError extends Error {}

export interface AuditReport {
  url: string;
  /** Weighted overall score, 0-100. */
  score: number;
  /** Letter grade derived from `score`. */
  grade: Grade;
  /** Per-family subscores (only families with >=1 non-skip check), canonical order. */
  familyScores: FamilyScore[];
  /** Pathnames of the sampled pages (homepage first). */
  sampledPages: string[];
  results: CheckResult[];
}

export interface AuditOptions {
  timeoutMs?: number;
  /** Max pages sampled (homepage included). 1 = homepage only. Default 10. */
  maxPages?: number;
  /** Override the crawler User-Agent (e.g. "GPTBot/1.0" to test UA-based blocking). */
  userAgent?: string;
  /**
   * Enable the crawler's fetch-layer SSRF guard: refuse to connect to internal/
   * reserved addresses on any hop (initial URL, sitemap, sampled pages, hreflang
   * alternates), re-validate redirects, and pin to the validated IP. The public
   * web app sets this; the CLI leaves it off so it can audit loopback fixtures.
   */
  blockPrivateHosts?: boolean;
  /** Abort in-flight fetches (e.g. when the caller's hard timeout fires). */
  signal?: AbortSignal;
}

export async function runAudit(url: string, checks: Check[], opts: AuditOptions = {}): Promise<AuditReport> {
  const crawler = new Crawler(url, opts.timeoutMs, opts.userAgent, {
    blockPrivateHosts: opts.blockPrivateHosts,
    signal: opts.signal,
  });
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
  const { score, grade, familyScores } = computeScore(results);
  const sampledPages = crawler.sample.pages.map(pathOf);
  return { url: crawler.baseUrl.toString(), score, grade, familyScores, sampledPages, results };
}
