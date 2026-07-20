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
}

export interface CrawlContext {
  baseUrl: URL;
  fetch(path: string): Promise<FetchedResource | null>;
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
