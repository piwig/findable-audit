import type { PsiResult } from './perf/psi.js';
import { FAMILY_DOC_URL } from './doc-urls.js';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type Family =
  | 'ai-access'
  | 'llm-content'
  | 'structured-data'
  | 'technical-seo'
  | 'on-page'
  | 'performance'
  | 'accessibility'
  | 'security';

export interface CheckResult {
  id: string;
  family: Family;
  status: CheckStatus;
  points: number;
  maxPoints: number;
  message: string;
  fix?: string;
  /** Resolved documentation link (check override or family fallback). Present on every result. */
  docUrl?: string;
}

export interface FetchedResource {
  status: number;
  ok: boolean;
  body: string;
  contentType: string;
  finalUrl: string;
  /** Response headers, lower-cased keys. */
  headers: Record<string, string>;
}

/** Media type of the response, without parameters, lower-cased ('' when absent). */
export function mediaType(res: FetchedResource): string {
  return res.contentType.split(';')[0].trim().toLowerCase();
}

/** true when the resource is text/plain (or no content-type header at all). */
export function isPlainText(res: FetchedResource): boolean {
  const ct = mediaType(res);
  return ct === '' || ct === 'text/plain';
}

/** true when the resource is an XML media type (or no content-type header at all). */
export function isXml(res: FetchedResource): boolean {
  const ct = mediaType(res);
  return ct === '' || ct === 'application/xml' || ct === 'text/xml' || ct.endsWith('+xml');
}

/** A deterministic sample of same-origin HTML pages, homepage included. */
export interface PageSample {
  pages: FetchedResource[];
  source: 'sitemap' | 'links' | 'homepage-only';
}

/** One hop of a manual (no-follow) fetch chain. */
export interface FetchHop {
  /** The absolute URL fetched on this hop. */
  url: string;
  /** HTTP status returned by this hop (0 on transport-less loop sentinel). */
  status: number;
  /** The `Location` header when this hop is a redirect (absent on the terminal hop). */
  location?: string;
}

/** Result of a manual, no-follow fetch: the whole hop list plus the terminal status/URL. */
export interface FetchChainResult {
  hops: FetchHop[];
  finalStatus: number;
  finalUrl: string;
}

export interface CrawlContext {
  baseUrl: URL;
  fetch(path: string): Promise<FetchedResource | null>;
  /**
   * Manual, NO-FOLLOW fetch returning every redirect hop (used by
   * www-consolidation, trailing-slash, redirect-chains, soft-404). Optional so
   * lightweight in-memory contexts need not implement it; the real Crawler
   * always does. When the SSRF guard is on it re-validates EVERY hop.
   */
  fetchChain?(path: string, opts?: { maxHops?: number }): Promise<FetchChainResult | null>;
  /** Sampled pages (homepage included). Attached by the runner; absent in unit tests. */
  sample?: PageSample;
  /**
   * Core Web Vitals data from the single PageSpeed Insights call. Set by the
   * runner only when `--cwv` is given:
   *   undefined → not requested (all CWV/lab checks skip with an opt-in hint)
   *   null      → PSI call attempted but failed (e.g. keyless rate-limit → skip)
   *   PsiResult → grade against the thresholds.
   */
  psi?: PsiResult | null;
}

export interface Check {
  id: string;
  family: Family;
  maxPoints: number;
  /** Optional per-check documentation link; falls back to FAMILY_DOC_URL[family] in makeResult. */
  docUrl?: string;
  run(ctx: CrawlContext): Promise<CheckResult>;
}

export function makeResult(
  check: Pick<Check, 'id' | 'family' | 'maxPoints' | 'docUrl'>,
  status: CheckStatus,
  message: string,
  fix?: string,
): CheckResult {
  const points =
    status === 'pass' ? check.maxPoints :
    status === 'warn' ? Math.floor(check.maxPoints / 2) : 0;
  const docUrl = check.docUrl ?? FAMILY_DOC_URL[check.family];
  return { id: check.id, family: check.family, status, points, maxPoints: check.maxPoints, message, fix, docUrl };
}
