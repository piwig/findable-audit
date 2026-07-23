import { Crawler } from './crawler.js';
import { samplePages } from './sampler.js';
import type { Check, CheckResult, Family } from './types.js';
import { makeResult } from './types.js';
import { pathOf } from './checks/aggregate.js';
import { computeScore, type Grade, type FamilyScore } from './scoring.js';
import { fetchPsi, type PsiResult } from './perf/psi.js';

export class UnreachableSiteError extends Error {}

export type AuditPhase = 'connect' | 'sample' | 'checks' | 'cwv' | 'score';

export interface AuditProgress {
  phase: AuditPhase;
  done: number;
  total: number;
  checkId?: string;
  family?: Family;
}

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
  /** Raw PageSpeed data: PsiResult when --cwv succeeded, null when it failed, undefined when not requested. */
  psi?: PsiResult | null;
  /** ISO timestamp of when this audit ran (set by the runner). Optional so old audit.json still parses. */
  generatedAt?: string;
  /** CLI version that produced this report (set by index.ts). Optional for backward-compat. */
  toolVersion?: string;
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
  /**
   * Opt into the single (slow) PageSpeed Insights call that powers the Core Web
   * Vitals checks. Without it, `ctx.psi` stays undefined and every CWV/lab check
   * skips. Static performance heuristics always run regardless.
   */
  cwv?: boolean;
  /** Google PSI/CrUX API key. Recommended: the keyless endpoint is 429-rate-limited. */
  psiKey?: string;
  /** PSI strategy (default 'mobile'). */
  psiStrategy?: 'mobile' | 'desktop';
  /**
   * Best-effort progress callback for a live UI (e.g. the web app's SSE stream).
   * Wrapped in try/catch by the runner: it never throws into the audit and never
   * alters results. Fired for phases connect → sample → (cwv) → checks → score.
   */
  onProgress?: (ev: AuditProgress) => void;
}

export async function runAudit(url: string, checks: Check[], opts: AuditOptions = {}): Promise<AuditReport> {
  const emit = (ev: AuditProgress): void => { try { opts.onProgress?.(ev); } catch { /* best-effort: never break the audit */ } };

  const crawler = new Crawler(url, opts.timeoutMs, opts.userAgent, {
    blockPrivateHosts: opts.blockPrivateHosts,
    signal: opts.signal,
  });

  emit({ phase: 'connect', done: 0, total: 1 });
  const home = await crawler.fetch('/');
  if (home === null) throw new UnreachableSiteError(`Cannot reach ${url}`);
  emit({ phase: 'connect', done: 1, total: 1 });

  crawler.sample = await samplePages(crawler, opts.maxPages ?? 10);
  emit({ phase: 'sample', done: crawler.sample.pages.length, total: opts.maxPages ?? 10 });

  // Core Web Vitals: at most ONE PageSpeed Insights call for the whole run, made
  // only on opt-in. The 8 CWV/lab checks read the cached result from ctx.psi.
  if (opts.cwv) {
    emit({ phase: 'cwv', done: 0, total: 1 });
    crawler.psi = await fetchPsi(crawler.baseUrl.toString(), {
      key: opts.psiKey,
      strategy: opts.psiStrategy ?? 'mobile',
      signal: opts.signal,
    });
    emit({ phase: 'cwv', done: 1, total: 1 });
  }
  const results: CheckResult[] = [];
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    let res: CheckResult;
    try {
      res = await check.run(crawler);
    } catch (err) {
      // A crashing check must not affect the score: mark it skipped.
      res = makeResult(check, 'skip', `check crashed: ${(err as Error).message}`);
    }
    results.push(res);
    emit({ phase: 'checks', done: i + 1, total: checks.length, checkId: check.id, family: res.family });
  }
  const { score, grade, familyScores } = computeScore(results);
  emit({ phase: 'score', done: 1, total: 1 });
  const sampledPages = crawler.sample.pages.map(pathOf);
  return { url: crawler.baseUrl.toString(), score, grade, familyScores, sampledPages, results, psi: crawler.psi };
}
