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
  /** What the verdict rests on: an external standard, or a bar we chose. See Evidence. */
  evidence: Evidence;
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
  /**
   * Fetch an OFF-ORIGIN URL — the only capability in the tool that leaves the
   * audited site. It exists for one job: verifying that a profile a site
   * *declares* in `sameAs` actually exists and points back (#65). Everything
   * about it is deliberately narrow:
   *
   * - **Opt-in.** Absent unless the caller asked for it (`--verify-profiles`),
   *   so the default audit still touches nothing but the audited origin and the
   *   README's "nothing leaves your machine" stays literally true.
   * - **Budgeted.** A whole audit may fetch at most `MAX_EXTERNAL_FETCHES`
   *   distinct external URLs, whatever a check asks for.
   * - **Guarded.** http(s) only, and when the SSRF guard is on (the web app) it
   *   applies here exactly as it does to the audited origin — a site that
   *   declares `sameAs: ["http://169.254.169.254/…"]` must not turn our server
   *   into its errand boy.
   *
   * Dependent checks MUST skip when it is absent, never assume it.
   */
  fetchExternal?(url: string): Promise<FetchedResource | null>;
  /**
   * Probe an OFF-ORIGIN `<a href>` target for liveness — the second (and last)
   * capability that leaves the audited site, and the only one a *link* can
   * trigger. It exists for `outbound-link-health` (#26/#51): a citation that
   * 404s is a dead reference, and nothing on-page reveals that.
   *
   * Same narrowness as `fetchExternal`, with the bar raised where a link
   * deserves less trust than a declaration:
   *
   * - **Opt-in.** Absent unless the caller asked for it (`--check-outbound`).
   *   `--verify-profiles` does NOT enable it and vice-versa: each option keeps
   *   its own promise about what leaves the origin.
   * - **Budgeted.** At most `MAX_OUTBOUND_PROBES` distinct URLs per audit,
   *   whatever a check asks for, with a shorter per-request timeout than the
   *   audit's own — a third-party server is not the one being audited.
   * - **Guarded, always.** Unlike every other fetch, the SSRF guard is forced on
   *   here even when `blockPrivateHosts` is off: these URLs come from the
   *   audited page's markup, not from the operator, so `http://192.168.1.1/`
   *   in someone's footer must never become a request we make on their behalf.
   *   It is the same guard (`src/ssrf.ts`), never a second validation path.
   * - **HEAD first.** A ranged GET is only the fallback for servers that refuse
   *   HEAD, so a liveness probe normally costs no body at all.
   *
   * `null` means "we could not find out" (DNS failure, timeout, blocked
   * address) and must NEVER be read as a broken link; only the returned status
   * can say that. Dependent checks MUST skip when the method is absent.
   */
  fetchOutbound?(url: string): Promise<FetchedResource | null>;
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

/**
 * What a verdict rests on — the axis that decides how much a reader should
 * trust it. Deliberately independent of severity: `security-txt` only warns but
 * is measured, `content-lead-answer` is a judgement call whatever it reports.
 *
 * - `measured`: the good state is defined by something outside this project — an
 *   RFC, a W3C/WHATWG spec, WCAG, schema.org, or a threshold Google publishes
 *   (Core Web Vitals, Lighthouse). Two people reading the same response agree on
 *   the verdict.
 * - `heuristic`: WE chose the bar — a word count, a lexicon, a ratio, a notion
 *   of "reads like a direct answer". Reasonable people can disagree, and the
 *   verified research says effectiveness varies by domain. These may warn, never
 *   fail (see CLAUDE.md § honesty guard-rails).
 *
 * Required, with no default: adding a check forces the author to make the call
 * at the moment they know the answer, and the compiler refuses to let it slide.
 */
export type Evidence = 'measured' | 'heuristic';

export interface Check {
  id: string;
  family: Family;
  evidence: Evidence;
  maxPoints: number;
  /** Optional per-check documentation link; falls back to FAMILY_DOC_URL[family] in makeResult. */
  docUrl?: string;
  run(ctx: CrawlContext): Promise<CheckResult>;
}

export function makeResult(
  check: Pick<Check, 'id' | 'family' | 'evidence' | 'maxPoints' | 'docUrl'>,
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
    id: check.id, family: check.family, evidence: check.evidence, status, points, maxPoints: check.maxPoints,
    message: text, fix, docUrl, messageTemplate: template, messageParams: params,
  };
}
