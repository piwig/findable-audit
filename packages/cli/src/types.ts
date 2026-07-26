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
  /**
   * The English `message` with every interpolated value replaced by `{0}`, `{1}`, … —
   * the lookup key of the localized catalogue (see report/message-i18n.ts). Present only
   * when the check built its message with the `t` tag below.
   */
  messageTemplate?: string;
  /** The values that filled `messageTemplate`, in order. */
  messageParams?: MsgParam[];
}

/**
 * A value a check can interpolate into its message. `undefined`/`null` are allowed
 * because a template literal accepts them too — widening here keeps the tag a drop-in
 * for the untagged literal rather than forcing call sites to add guards.
 */
export type MsgParam = string | number | undefined | null;

/**
 * A message that remembers how it was built.
 *
 * A check writes its message once, in English, as a template literal. Rendering that
 * literal throws away the seam between the wording and the values, which is exactly
 * what a translator needs: "3 of 12 images" is not translatable, "{0} of {1} images"
 * is. Tagging the literal keeps both — `text` stays the English string every consumer
 * already reads, and `template`/`params` let the HTML and Markdown reports rebuild the
 * same sentence in French.
 */
export interface Msg {
  text: string;
  template: string;
  params: MsgParam[];
}

/** Type guard: a message argument that carries its template, not a bare string. */
export function isMsg(value: unknown): value is Msg {
  return typeof value === 'object' && value !== null && 'template' in value && 'text' in value;
}

/**
 * Tagged template that turns a check's English message into a translatable one.
 *
 *   t`missing alt on ${n} of ${total} images`
 *     → text:     "missing alt on 3 of 12 images"
 *       template: "missing alt on {0} of {1} images"
 *       params:   [3, 12]
 *
 * The produced `text` is byte-identical to what the untagged literal produced, so
 * adding the tag never changes the CLI, JSON, SARIF or JUnit output.
 */
export function t(strings: TemplateStringsArray, ...values: MsgParam[]): Msg {
  let text = '';
  let template = '';
  strings.forEach((chunk, i) => {
    text += chunk;
    template += chunk;
    if (i < values.length) {
      text += String(values[i]);
      template += `{${i}}`;
    }
  });
  return { text, template, params: values };
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
  /**
   * Same-origin fetch under an explicit User-Agent, for cloaking / dynamic-
   * serving probes (#20 `ai-serving-parity`: does the server hand AI crawlers
   * the same document as browsers?). Optional so lightweight in-memory
   * contexts need not implement it — dependent checks MUST skip when it is
   * absent. The real Crawler implements it via the same plain/guarded (SSRF)
   * code paths as `fetch()`, but caches separately (keyed by `(userAgent,
   * url)`, never sharing or evicting the default-UA cache) and never re-pins
   * `baseUrl` to a redirect's origin. Enforces the same-origin contract:
   * an absolute cross-origin `path` returns `null` without fetching. Caches
   * only successful (2xx) responses, so a probe that hit a transient error can
   * be retried with a genuinely fresh request.
   */
  fetchWithUA?(path: string, userAgent: string): Promise<FetchedResource | null>;
  /** Sampled pages (homepage included). Attached by the runner; absent in unit tests. */
  sample?: PageSample;
  /** JSON-LD entity graph across the sampled pages. Attached by the runner; absent in unit tests. */
  entityGraph?: import('./report/entity-graph.js').EntityGraph;
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
  message: string | Msg,
  fix?: string,
): CheckResult {
  const points =
    status === 'pass' ? check.maxPoints :
    status === 'warn' ? Math.floor(check.maxPoints / 2) : 0;
  const docUrl = check.docUrl ?? FAMILY_DOC_URL[check.family];
  // A bare string is its own template: no interpolation, nothing to re-fill.
  const text = isMsg(message) ? message.text : message;
  const template = isMsg(message) ? message.template : message;
  const params = isMsg(message) ? message.params : [];
  return {
    id: check.id, family: check.family, status, points, maxPoints: check.maxPoints,
    message: text, fix, docUrl, messageTemplate: template, messageParams: params,
  };
}
