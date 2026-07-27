import { Crawler } from './crawler.js';
import { samplePages } from './sampler.js';
import type { Check, CheckResult, Family } from './types.js';
import { makeResult } from './types.js';
import { pathOf } from './checks/aggregate.js';
import { computeScore, type Grade, type FamilyScore } from './scoring.js';
import { fetchPsi, type PsiResult } from './perf/psi.js';
import { buildEntityGraph, type EntityGraph } from './report/entity-graph.js';
import { mapProbes } from './checks/concurrency.js';

/**
 * How many checks may be in flight at once. Higher than the request gate on
 * purpose: a check spends nearly all its time waiting on the gate, so this only
 * decides how many are queued behind it, never how hard the audited site is hit.
 */
const CHECK_CONCURRENCY = 12;

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
  /** JSON-LD entity graph across sampled pages. Included only when opts.includeEntityGraph is set. */
  entityGraph?: EntityGraph;
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
  /** Verify declared sameAs profiles by fetching them off-origin (#65). Opt-in: see CrawlContext.fetchExternal. */
  verifyProfiles?: boolean;
  /** Probe outbound `<a href>` targets for liveness (#26/#51). Opt-in: see CrawlContext.fetchOutbound. */
  checkOutbound?: boolean;
  /** Include the built entity graph in the returned AuditReport (for --entity-graph export). */
  includeEntityGraph?: boolean;
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
    // #65: off-origin verification is wired up only when asked for, so the
    // default audit still touches nothing but the audited origin.
    verifyProfiles: opts.verifyProfiles,
    // #26/#51: outbound link probing is its own opt-in, never implied by the above.
    checkOutbound: opts.checkOutbound,
    signal: opts.signal,
  });

  emit({ phase: 'connect', done: 0, total: 1 });
  const home = await crawler.fetch('/');
  if (home === null) throw new UnreachableSiteError(`Cannot reach ${url}`);
  emit({ phase: 'connect', done: 1, total: 1 });

  // Core Web Vitals: at most ONE PageSpeed Insights call per run, started HERE —
  // as soon as the site is known reachable — and awaited further down, just
  // before the checks that read it.
  //
  // It used to run after sampling, so its latency added to the crawl's. PSI is
  // an independent call to Google about a URL we already know; overlapping it
  // with our own crawl turns `crawl + psi` into `max(crawl, psi)`. Measured on a
  // real production site: 57s of crawl followed by a PSI call that hit its own
  // 45s ceiling made a 103s audit, past the web app's 90s cap — the site could
  // never be audited from the browser. Nothing else changes: the promise is
  // created eagerly, and a rejection is impossible because fetchPsi resolves to
  // null on any failure.
  const psiPromise = opts.cwv
    ? (emit({ phase: 'cwv', done: 0, total: 1 }), fetchPsi(crawler.baseUrl.toString(), {
      key: opts.psiKey,
      strategy: opts.psiStrategy ?? 'mobile',
      signal: opts.signal,
    }))
    : null;

  crawler.sample = await samplePages(crawler, opts.maxPages ?? 10);
  emit({ phase: 'sample', done: crawler.sample.pages.length, total: opts.maxPages ?? 10 });

  // Build the JSON-LD entity graph once, from the sampled HTML the crawler
  // already fetched (never executes JS). Checks read it from ctx.entityGraph.
  crawler.entityGraph = buildEntityGraph(crawler.sample.pages.map((p) => {
    let path = '/';
    try { path = new URL(p.finalUrl).pathname; } catch { /* keep '/' */ }
    return { path, html: p.body };
  }));

  // Await the call started before sampling. The 8 CWV/lab checks read the
  // result from ctx.psi, so it has to be settled before they run — but by now
  // it has been in flight for the whole crawl.
  if (psiPromise !== null) {
    crawler.psi = await psiPromise;
    emit({ phase: 'cwv', done: 1, total: 1 });
  }
  // Checks run a few at a time instead of one after another. They are pure
  // consumers of the crawler — each fetches what it needs and returns a verdict
  // — so nothing about the verdicts depends on the order they run in, and
  // mapProbes returns results in the ORIGINAL order regardless of who finishes
  // first. What changes is wall-clock: the audit stops being the sum of every
  // check's network wait.
  //
  // The audited site is protected by the crawler, not by this number: every
  // request goes through a single global gate (MAX_INFLIGHT_REQUESTS), and
  // concurrent callers asking for the same URL share one in-flight request
  // rather than issuing duplicates. Raising CHECK_CONCURRENCY therefore
  // overlaps more *waiting*, never more load.
  let done = 0;
  const results = await mapProbes(checks, async (check) => {
    let res: CheckResult;
    try {
      res = await check.run(crawler);
    } catch (err) {
      // A crashing check must not affect the score: mark it skipped.
      res = makeResult(check, 'skip', `check crashed: ${(err as Error).message}`);
    }
    done++;
    emit({ phase: 'checks', done, total: checks.length, checkId: check.id, family: res.family });
    return res;
  }, CHECK_CONCURRENCY);
  const { score, grade, familyScores } = computeScore(results);
  emit({ phase: 'score', done: 1, total: 1 });
  const sampledPages = crawler.sample.pages.map(pathOf);
  return {
    url: crawler.baseUrl.toString(), score, grade, familyScores, sampledPages, results,
    psi: crawler.psi, generatedAt: new Date().toISOString(),
    ...(opts.includeEntityGraph ? { entityGraph: crawler.entityGraph } : {}),
  };
}
