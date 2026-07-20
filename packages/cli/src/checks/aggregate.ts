import type { CrawlContext, FetchedResource } from '../types.js';

/** Pages to audit: the runner-attached sample when present, else the homepage alone. */
export async function pagesOf(ctx: CrawlContext): Promise<FetchedResource[]> {
  if (ctx.sample && ctx.sample.pages.length > 0) return ctx.sample.pages;
  const home = await ctx.fetch('/');
  return home?.status === 200 ? [home] : [];
}

/** Pathname of a fetched page, for compact offender lists. */
export function pathOf(res: FetchedResource): string {
  try { return new URL(res.finalUrl).pathname; } catch { return '/'; }
}

export interface Aggregate {
  status: 'pass' | 'warn' | 'fail';
  /** Up to 3 offenders, then "(+N more)". Empty string on pass. */
  detail: string;
}

/**
 * Spec §2.3: pass = 100% conform, warn = conform ratio >= warnRatio (default 0.8), fail below.
 */
export function aggregate(total: number, offenders: string[], warnRatio = 0.8): Aggregate {
  if (offenders.length === 0) return { status: 'pass', detail: '' };
  const conform = (total - offenders.length) / total;
  const shown = offenders.slice(0, 3).join(', ');
  const more = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
  return { status: conform >= warnRatio ? 'warn' : 'fail', detail: `${shown}${more}` };
}
