export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type Family = 'ai-access' | 'llm-content' | 'structured-data' | 'seo-fundamentals';

export interface CheckResult {
  id: string;
  family: Family;
  status: CheckStatus;
  points: number;
  maxPoints: number;
  message: string;
  fix?: string;
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

export interface CrawlContext {
  baseUrl: URL;
  fetch(path: string): Promise<FetchedResource | null>;
  /** Sampled pages (homepage included). Attached by the runner; absent in unit tests. */
  sample?: PageSample;
}

export interface Check {
  id: string;
  family: Family;
  maxPoints: number;
  run(ctx: CrawlContext): Promise<CheckResult>;
}

export function makeResult(
  check: Pick<Check, 'id' | 'family' | 'maxPoints'>,
  status: CheckStatus,
  message: string,
  fix?: string,
): CheckResult {
  const points =
    status === 'pass' ? check.maxPoints :
    status === 'warn' ? Math.floor(check.maxPoints / 2) : 0;
  return { id: check.id, family: check.family, status, points, maxPoints: check.maxPoints, message, fix };
}
