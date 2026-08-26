#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildChecks } from './checks/index.js';
import { runAudit, sampleSite, UnreachableSiteError, type AuditProgress, type AuditReport } from './runner.js';
import { renderTerminal } from './report/terminal.js';
import { renderJson } from './report/json.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';
import { renderSarif } from './report/sarif.js';
import { renderBadge } from './report/badge.js';
import { renderJunit } from './report/junit.js';
import { renderCompareHtml, renderCompareMarkdown, renderCompareTerminal } from './report/compare.js';
import { diffReports, renderDiffTerminal, type ReportDiff } from './report/diff.js';
import { pickEntityGraphRenderer } from './report/entity-graph.js';
import { pickAnswersRenderer } from './report/answers.js';
import { emitFiles, generateLlmsTxt, generateLlmsFullTxt } from './generate/index.js';
import { renderSummaryHtml, renderSummaryMarkdown } from './report/summary.js';
import { buildIndexNowPayload, submitIndexNow } from './submit/indexnow.js';
import { parseHistory, appendHistory, type HistoryEntry } from './report/history.js';
import { FAMILY_WEIGHTS } from './scoring.js';
import type { Lang } from './report/i18n.js';

const USAGE = `Usage: findable <url> [options]
       findable generate llms-txt <url> [--out <dir>] [--lang <en|fr>] [--max-pages <n>] [--timeout <ms>] [--user-agent <ua>] [--quiet]

findable <url> [--compare <url2,url3,...>] [--baseline <file.json>] [--fail-on-regression] [--fail-on <family>=<n>] [--regression-tolerance <n>] [--json] [--report <file.md|file.html|file.json|file.sarif|file.xml|file.svg>] [--no-report] [--lang <en|fr>] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--user-agent <ua>] [--indexnow-key <key>] [--cwv] [--psi-key <key>] [--psi-strategy <mobile|desktop>] [--entity-graph <file>] [--answers <file>] [--summary <file>] [--submit] [--verify-profiles] [--check-outbound] [--emit <dir>] [--history <file.json>] [--quiet] [--no-color]

--compare audits your URL against one or more competitor URLs (comma-separated) and writes a side-by-side scorecard (overall + per-family, with the gaps where you trail).
--baseline <file.json> diffs this run against a prior findable --report *.json: overall/per-family deltas + which checks regressed or improved (shown in the terminal and the md/html reports).
--fail-on-regression exits 1 when the score drops below the baseline by more than --regression-tolerance points (default 0); requires --baseline. Ideal as a CI gate.
--fail-on <family>=<n> (repeatable) exits 1 when that family subscore is below n, without imposing a global threshold — e.g. --fail-on ai-access=80 --fail-on structured-data=70. Families: ai-access, llm-content, structured-data, technical-seo, on-page, performance, accessibility, security.
--entity-graph <file> writes the JSON-LD entity graph across the sampled pages; format by extension: .json, .dot (Graphviz), or .mmd (Mermaid).
--answers <file> writes the answer matrix: the questions this site's own declarations imply, and
  whether the crawled pages hold a passage that answers each one and stands on its own. Format by
  extension: .json, or anything else Markdown. These questions come from what the site DECLARES —
  its services, its areas, its markup — never from measured search demand, and the file says so.
--emit <dir> writes ready-to-deploy indexing files (robots.txt, llms.txt, llms-full.txt, .well-known/ai.json,
  sitemap.xml, jsonld-stubs.json, GENERATED-README.md) into <dir>. Content is generic — review before deploying,
  especially robots.txt. Works alongside --report/--no-report (independent of the md/html report files).
--summary <file> writes the one-screen version for whoever decides: score, verdict, the three axes,
  the three highest-gain actions with their cost, and what they would be worth together. Format by extension
  (.html or anything else Markdown). No check table — that is what --report is for.
--verify-profiles fetches the profiles your JSON-LD declares in sameAs and checks each one links back
  to your site — the return link is what turns a claim into a verified identity. It never hunts for a
  presence you did not declare, and a platform that refuses robots (LinkedIn, Instagram...) is reported
  as unverifiable, never held against you. At most 8 URLs, http(s) only, same SSRF guard.
--check-outbound probes the external links your pages publish and reports the dead ones (outbound-link-health),
  because a citation that 404s is a dead reference nothing on-page reveals. HEAD first (ranged GET only for
  servers that refuse it), at most 10 URLs, one per host, main content first, shorter timeout, SSRF guard
  always on. A host that times out or refuses robots is reported as unverifiable — only a 404/410 counts
  as broken, so a network hiccup never fails your audit.
--verify-profiles and --check-outbound are the ONLY options that fetch anything off your own origin, and
  neither implies the other; without them the audit touches nothing but the audited site.
--experimental-agent-standards probes the emerging agent-actionability manifests (/.well-known/agents.json,
  /agents.json, /.well-known/ucp.json) on the audited origin. Experimental: no engine or agent vendor has
  committed to these standards, so the result is informational only and NEVER counts in the score (0 points).
--history <file.json> appends this run (date + overall and per-family scores, never full results) to a
  small JSON series and reads it back: with 2+ runs the HTML report opens with sparklines — the score's
  direction over time, overall and per family. The file is safe to commit; oldest entries are dropped
  past 500. A file that is not a findable-audit history is refused, never overwritten.
--submit notifies IndexNow (Bing, Yandex, Seznam, Naver — Google does not participate) of the sampled URLs.
  Opt-in and requires --indexnow-key: nothing is sent unless /<key>.txt is verified on the audited site, which
  is what proves you own it. Only sampled same-origin URLs are submitted, and a refused submission never
  changes the exit code.

Audits a website's readiness for AI search (GEO) and technical SEO.
Samples up to --max-pages pages (default 10, homepage + sitemap/link-discovered pages; 1 = homepage only).
  Depth is an intention, not a number: 1 = fast check (homepage only) · 5-10 = template audit (the
  page shapes a site reuses) · 25-50 = site audit · 100+ = deep investigation. A bigger sample costs
  proportionally more requests to the audited site, so pick the smallest one that answers your question.
By default, two report files are written to the current directory: <host>-<date>.md and <host>-<date>.html
  (the .html is a self-contained, printable report — open it and "Print to PDF"). Use --no-report to write none.
--report <file> overrides the default and writes exactly the file(s) you name (repeatable); the format is chosen
  by extension: .html/.htm -> HTML, .json -> JSON, .sarif -> SARIF (GitHub code-scanning), .xml -> JUnit
  (GitLab CI / Jenkins), .svg -> status badge for a README, anything else -> Markdown.
--lang selects the report language (en or fr; default en): chrome, check titles, "why", fixes and the
  checks' own dynamic messages. Terminal, JSON, SARIF, JUnit and the SVG badge stay English.
--user-agent overrides the crawler User-Agent (e.g. "GPTBot/1.0") to test UA-based blocking.
--cwv opts into Core Web Vitals via one (slow, ~15-30s) PageSpeed Insights call; without it the CWV checks skip.
--psi-key <key> supplies a Google PSI/CrUX API key (recommended: the keyless endpoint is rate-limited).
--psi-strategy selects the PSI form factor (default mobile).
--quiet silences the informational notes on stderr ("auditing…", "report written to…"); the audit
  result on stdout and real errors still print. Errors keep the findable-audit: prefix, notes never had it.
--no-color strips ANSI colors from the terminal output (for pagers, logs, CI). The NO_COLOR
  environment variable (no-color.org) is honored too; --no-color simply forces it for one run.
Exit codes: 0 = score >= min-score and all gates pass, 1 = below min-score / regression / --fail-on gate, 2 = unreachable or invalid invocation, 3 = report write failed.`;

/** Default report basename written when neither --report nor --no-report is given. */
function defaultReportBase(url: string, now: Date): string {
  let host = 'report';
  try { host = new URL(url).hostname || 'report'; } catch { /* keep 'report' */ }
  const safeHost = host.replace(/[^a-z0-9.-]/gi, '-');
  return `${safeHost}-${now.toISOString().slice(0, 10)}`;
}

const parseCliArgs = () =>
  parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      'min-score': { type: 'string', default: '60' },
      timeout: { type: 'string', default: '10000' },
      'max-pages': { type: 'string', default: '10' },
      'user-agent': { type: 'string' },
      'indexnow-key': { type: 'string' },
      cwv: { type: 'boolean', default: false },
      'psi-key': { type: 'string' },
      'psi-strategy': { type: 'string', default: 'mobile' },
      lang: { type: 'string' },
      compare: { type: 'string' },
      baseline: { type: 'string' },
      'fail-on-regression': { type: 'boolean', default: false },
      'fail-on': { type: 'string', multiple: true },
      'regression-tolerance': { type: 'string', default: '0' },
      'entity-graph': { type: 'string' },
      answers: { type: 'string' },
      emit: { type: 'string' },
      submit: { type: 'boolean', default: false },
      'verify-profiles': { type: 'boolean', default: false },
      'check-outbound': { type: 'boolean', default: false },
      // A38 — opt-in probe of emerging agents.json / UCP manifests (never scored).
      'experimental-agent-standards': { type: 'boolean', default: false },
      summary: { type: 'string' },
      history: { type: 'string' },
      out: { type: 'string' },
      report: { type: 'string', short: 'r', multiple: true },
      'no-report': { type: 'boolean', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    } as const,
  });

let parsed: ReturnType<typeof parseCliArgs>;
try {
  parsed = parseCliArgs();
} catch (err) {
  // Unknown option / missing value: a clean message, not a stack trace.
  console.error(`findable-audit: ${(err as Error).message}\n\n${USAGE}`);
  process.exit(2);
}
const { values, positionals } = parsed;

// Output discipline (#A10): the audit result owns stdout; everything else is
// stderr, split into *notes* (informational, silenced by --quiet) and *errors*
// (always printed, always prefixed "findable-audit:"). --no-color strips ANSI
// from the terminal rendering; the NO_COLOR env var is already honored by
// picocolors at import time, the flag just makes it per-run and discoverable.
const note = (msg: string): void => { if (!values.quiet) console.error(msg); };
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const colorize = (s: string): string => (values['no-color'] ? stripAnsi(s) : s);

if (values.version) {
  console.log(createRequire(import.meta.url)('../package.json').version);
  process.exit(0);
}

// `findable generate llms-txt <url>` (#A22): remediation subcommand — crawl +
// sample only (no checks, no score), then write llms.txt / llms-full.txt built
// from the REAL crawled pages into --out. Detected here so the shared option
// validations (--timeout, --max-pages, --lang, --user-agent) below apply to it.
const isGenerate = positionals[0] === 'generate';
const url = isGenerate ? positionals[2] : positionals[0];
if (values.help || !url) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}
if (isGenerate && positionals[1] !== 'llms-txt') {
  console.error(`findable-audit: unknown generate target "${positionals[1] ?? ''}" (expected "llms-txt")\n\n${USAGE}`);
  process.exit(2);
}
const outDir = values.out ?? '.';
if (outDir.trim() === '') {
  console.error(`findable-audit: --out must not be empty\n\n${USAGE}`);
  process.exit(2);
}

const minScore = Number(values['min-score']);
if (values['min-score'].trim() === '' || !Number.isFinite(minScore)) {
  console.error(`findable-audit: invalid --min-score value "${values['min-score']}" (expected a number)\n\n${USAGE}`);
  process.exit(2);
}

const timeoutMs = Number(values.timeout);
if (values.timeout.trim() === '' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(`findable-audit: invalid --timeout value "${values.timeout}" (expected a positive number of milliseconds)\n\n${USAGE}`);
  process.exit(2);
}

const maxPages = Number(values['max-pages']);
if (values['max-pages'].trim() === '' || !Number.isInteger(maxPages) || maxPages < 1) {
  console.error(`findable-audit: invalid --max-pages value "${values['max-pages']}" (expected an integer >= 1)\n\n${USAGE}`);
  process.exit(2);
}

const userAgent = values['user-agent'];
if (userAgent !== undefined && userAgent.trim() === '') {
  console.error(`findable-audit: --user-agent must not be empty\n\n${USAGE}`);
  process.exit(2);
}

const psiKey = values['psi-key'];
if (psiKey !== undefined && psiKey.trim() === '') {
  console.error(`findable-audit: --psi-key must not be empty\n\n${USAGE}`);
  process.exit(2);
}

const psiStrategy = values['psi-strategy'];
if (psiStrategy !== 'mobile' && psiStrategy !== 'desktop') {
  console.error(`findable-audit: invalid --psi-strategy value "${psiStrategy}" (expected "mobile" or "desktop")\n\n${USAGE}`);
  process.exit(2);
}

const lang = (values.lang ?? 'en');
if (lang !== 'en' && lang !== 'fr') {
  console.error(`findable-audit: invalid --lang value "${lang}" (expected "en" or "fr")\n\n${USAGE}`);
  process.exit(2);
}
const langTyped: Lang = lang;

const targetUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
if (!URL.canParse(targetUrl) || !/^https?:$/.test(new URL(targetUrl).protocol)) {
  console.error(`findable-audit: invalid URL "${url}"\n\n${USAGE}`);
  process.exit(2);
}

// --baseline / --fail-on-regression / --regression-tolerance validation.
const failOnRegression = values['fail-on-regression'];
const regressionTolerance = Number(values['regression-tolerance']);
if (!Number.isInteger(regressionTolerance) || regressionTolerance < 0) {
  console.error(`findable-audit: invalid --regression-tolerance value "${values['regression-tolerance']}" (expected an integer >= 0)\n\n${USAGE}`);
  process.exit(2);
}

// --fail-on <family>=<score> validation (A89): repeatable per-family CI gates.
const failOnGates = new Map<string, number>();
for (const raw of values['fail-on'] ?? []) {
  const eq = raw.indexOf('=');
  const family = eq === -1 ? '' : raw.slice(0, eq).trim();
  const threshold = eq === -1 ? NaN : Number(raw.slice(eq + 1));
  if (!(family in FAMILY_WEIGHTS)) {
    console.error(`findable-audit: invalid --fail-on value "${raw}" (expected <family>=<score> with family one of: ${Object.keys(FAMILY_WEIGHTS).join(', ')})\n\n${USAGE}`);
    process.exit(2);
  }
  if (raw.slice(eq + 1).trim() === '' || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    console.error(`findable-audit: invalid --fail-on value "${raw}" (expected a score between 0 and 100)\n\n${USAGE}`);
    process.exit(2);
  }
  failOnGates.set(family, threshold);
}
if ((failOnRegression || values['regression-tolerance'] !== '0') && values.baseline === undefined) {
  console.error(`findable-audit: --fail-on-regression / --regression-tolerance require --baseline <file>\n\n${USAGE}`);
  process.exit(2);
}
// --answers <file>: validate the target extension up front, like --entity-graph.
const answersFile = values.answers;
if (answersFile !== undefined) {
  if (answersFile.trim() === '' || pickAnswersRenderer(answersFile) === null) {
    console.error('findable-audit: --answers file must end in .json or .md');
    process.exit(2);
  }
}

// --entity-graph <file>: validate the target extension up front.
const entityGraphFile = values['entity-graph'];
if (entityGraphFile !== undefined) {
  if (entityGraphFile.trim() === '' || pickEntityGraphRenderer(entityGraphFile) === null) {
    console.error(`findable-audit: --entity-graph file must end in .json, .dot or .mmd (got "${entityGraphFile}")\n\n${USAGE}`);
    process.exit(2);
  }
}

// --summary <file>: validated up front, written after the audit.
const summaryFile = values.summary;
if (summaryFile !== undefined && summaryFile.trim() === '') {
  console.error(`findable-audit: --summary must not be empty\n\n${USAGE}`);
  process.exit(2);
}

// --history <file.json>: read (and validate) the prior series up front, so a
// file we cannot parse aborts BEFORE the audit spends minutes crawling — and
// is never overwritten. A missing file simply starts a fresh series.
const historyFile = values.history;
let priorHistory: HistoryEntry[] = [];
if (historyFile !== undefined) {
  if (historyFile.trim() === '' || !/\.json$/i.test(historyFile)) {
    console.error(`findable-audit: --history file must end in .json (got "${historyFile}")\n\n${USAGE}`);
    process.exit(2);
  }
  let raw: string | undefined;
  try {
    raw = readFileSync(historyFile, 'utf8');
  } catch {
    raw = undefined; // no file yet: first run starts the series
  }
  if (raw !== undefined) {
    try {
      priorHistory = parseHistory(raw);
    } catch (err) {
      console.error(`findable-audit: "${historyFile}" is not a findable-audit history file (${(err as Error).message}) — refusing to overwrite it`);
      process.exit(2);
    }
  }
}

// --submit: opt-in IndexNow notification. Refused up front without a key —
// the key file hosted on the site is the ownership proof, and the audit itself
// verifies it (the `indexnow` check must pass before anything is sent).
if (values.submit && (values['indexnow-key'] === undefined || values['indexnow-key'].trim() === '')) {
  console.error(`findable-audit: --submit requires --indexnow-key <key> (the key file proves you own the site)\n\n${USAGE}`);
  process.exit(2);
}

// --emit <dir>: validate non-empty. Actual writing happens after the audit,
// once report.entityGraph is available (see includeEntityGraph below).
const emitDir = values.emit;
if (emitDir !== undefined && emitDir.trim() === '') {
  console.error(`findable-audit: --emit must not be empty\n\n${USAGE}`);
  process.exit(2);
}

let baseline: AuditReport | undefined;
if (values.baseline !== undefined) {
  let parsedBaseline: unknown;
  try {
    parsedBaseline = JSON.parse(readFileSync(values.baseline, 'utf8'));
  } catch (err) {
    console.error(`findable-audit: cannot read baseline "${values.baseline}": ${(err as Error).message}`);
    process.exit(2);
  }
  const b = parsedBaseline as Partial<AuditReport>;
  if (!b || typeof b.score !== 'number' || !Array.isArray(b.results) || !Array.isArray(b.familyScores)) {
    console.error(`findable-audit: "${values.baseline}" is not a valid audit report (expected a findable-audit --report *.json file)`);
    process.exit(2);
  }
  baseline = b as AuditReport;
}

// The HTML report draws the entity graph (#58), so it needs the graph attached
// — same rule as --entity-graph and --emit. Decided before the audit because
// the default report targets (md + html) are known up front. A JSON-only run
// (the CI shape: `--report baseline.json`) stays lean, so committed baselines
// do not silently grow; a .json written alongside a .html carries the graph.
const htmlReportWanted = values.report === undefined
  ? !values['no-report']
  : values.report.some((f) => /\.html?$/i.test(f));

if (isGenerate) {
  // No process.exit() after the crawl (undici sockets closing → libuv crash on
  // Windows, same rule as the audit path): set process.exitCode and drain.
  try {
    note(`sampling ${targetUrl} (up to ${maxPages} page${maxPages === 1 ? '' : 's'}, timeout ${timeoutMs}ms)…`);
    const sample = await sampleSite(targetUrl, { timeoutMs, maxPages, userAgent });
    // A minimal report-shaped source: the llms generators only read url,
    // sampledPages and pageMeta — score/grade/results are never consulted.
    const source: AuditReport = {
      url: sample.url, score: 0, grade: 'F', familyScores: [], results: [],
      sampledPages: sample.sampledPages, pageMeta: sample.pageMeta,
    };
    mkdirSync(outDir, { recursive: true });
    const files: ReadonlyArray<readonly [string, string]> = [
      ['llms.txt', generateLlmsTxt(source, { lang: langTyped })],
      ['llms-full.txt', generateLlmsFullTxt(source, { lang: langTyped })],
    ];
    for (const [name, body] of files) {
      const full = path.join(outDir, name);
      writeFileSync(full, body, 'utf8');
      note(`${name} written to ${full}`);
    }
    note(langTyped === 'fr'
      ? '⚠ ébauches construites depuis vos vraies pages — relire et compléter avant de déployer (résumé, contenu complet).'
      : '⚠ drafts built from your real pages — review and complete before deploying (summary, full content).');
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof UnreachableSiteError) {
      console.error(`findable-audit: ${err.message}`);
      process.exitCode = 2;
    } else {
      throw err;
    }
  }
} else {
try {
  const checks = buildChecks({
    indexnowKey: values['indexnow-key'],
    agentStandards: values['experimental-agent-standards'],
  });
  // Live progress (#A10): one rewritten stderr line — "page 3/10", then
  // "checks 87/138" — cleared before the result prints. TTY only: a CI log
  // keeps the single "auditing…" note instead of 150 rewrites, and --quiet
  // silences both. Never stdout, which belongs to the result alone.
  const onProgress = process.stderr.isTTY && !values.quiet
    ? (ev: AuditProgress): void => {
        const label = ev.phase === 'sample' ? `page ${ev.done}/${ev.total}`
          : ev.phase === 'checks' ? `checks ${ev.done}/${ev.total}`
          : ev.phase === 'cwv' ? 'core web vitals (PageSpeed)…'
          : ev.phase === 'connect' ? 'connecting…' : '';
        process.stderr.write(`\r\x1b[2K${label}`);
      }
    : undefined;
  const auditOpts = { onProgress, timeoutMs, maxPages, userAgent, cwv: values.cwv, psiKey, psiStrategy: psiStrategy as 'mobile' | 'desktop', verifyProfiles: values['verify-profiles'], checkOutbound: values['check-outbound'], includeEntityGraph: entityGraphFile !== undefined || emitDir !== undefined || htmlReportWanted, includeAnswerMatrix: answersFile !== undefined };
  note(`auditing ${targetUrl} (up to ${maxPages} page${maxPages === 1 ? '' : 's'}, timeout ${timeoutMs}ms)…`);
  const report = await runAudit(targetUrl, checks, auditOpts);
  report.toolVersion = createRequire(import.meta.url)('../package.json').version;

  // --baseline: diff the fresh report against a prior audit.json.
  const diff: ReportDiff | undefined = baseline ? diffReports(report, baseline) : undefined;

  // --compare <u1,u2,...>: audit competitor URLs too and produce a side-by-side
  // scorecard. A competitor that is invalid or unreachable is skipped (with a
  // warning) rather than aborting the whole run.
  const competitorReports: AuditReport[] = [];
  if (values.compare && values.compare.trim() !== '') {
    const urls = values.compare.split(',').map((s) => s.trim()).filter(Boolean)
      .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
    for (const cu of urls) {
      if (!URL.canParse(cu) || !/^https?:$/.test(new URL(cu).protocol)) {
        console.error(`findable-audit: skipping invalid --compare URL "${cu}"`);
        continue;
      }
      try {
        note(`auditing competitor ${cu}…`);
        competitorReports.push(await runAudit(cu, checks, auditOpts));
      } catch (err) {
        console.error(`findable-audit: skipping "${cu}" (${(err as Error).message})`);
      }
    }
  }
  const compare = competitorReports.length > 0;
  const reports = [report, ...competitorReports];

  // Compare audits reuse auditOpts: CWV is measured only when --cwv was given,
  // so the "CWV not measured" note is suppressed exactly in that case.
  const compareOpts = { cwvNote: !values.cwv };
  if (onProgress) process.stderr.write('\r\x1b[2K'); // leave no half-line under the result
  console.log(values.json ? renderJson(report) : colorize(compare ? renderCompareTerminal(reports, langTyped, compareOpts) : renderTerminal(report, langTyped)));
  if (diff && !values.json) console.log('\n' + colorize(renderDiffTerminal(diff, langTyped)));
  // Decide which report files to write:
  //   --report given  -> exactly those (format by extension); default suppressed
  //   --no-report     -> none
  //   otherwise       -> <host>-<date>[-compare].md and .html in the current directory
  const now = new Date();
  const explicit = values.report ?? [];
  let targets: string[];
  if (explicit.length > 0) {
    targets = explicit;
  } else if (values['no-report']) {
    targets = [];
  } else {
    const base = defaultReportBase(report.url, now) + (compare ? '-compare' : '');
    targets = [`${base}.md`, `${base}.html`];
  }
  let reportWriteFailed = false;
  // --history: append this run BEFORE rendering, so the sparklines in the HTML
  // written just below include today's point (the reader sees the line end at
  // the score printed above it).
  let history: HistoryEntry[] | undefined;
  if (historyFile !== undefined) {
    history = appendHistory(priorHistory, report, now);
    try {
      writeFileSync(historyFile, JSON.stringify(history, null, 2) + '\n', 'utf8');
      note(`history appended to ${historyFile} (${history.length} run${history.length === 1 ? '' : 's'})`);
    } catch (err) {
      console.error(`findable-audit: cannot write history to "${historyFile}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }
  for (const file of targets) {
    let body: string;
    if (/\.sarif$/i.test(file)) body = renderSarif(report);
    else if (/\.svg$/i.test(file)) body = renderBadge(report);
    else if (/\.json$/i.test(file)) body = renderJson(report);
    else if (/\.xml$/i.test(file)) body = renderJunit(report);
    else if (/\.html?$/i.test(file)) body = compare ? renderCompareHtml(reports, now, langTyped, compareOpts) : renderHtml(report, now, langTyped, { diff, history });
    else body = compare ? renderCompareMarkdown(reports, langTyped, compareOpts) : renderMarkdown(report, now, langTyped, { diff });
    try {
      writeFileSync(file, body, 'utf8');
      note(`report written to ${file}`);
    } catch (err) {
      // Never process.exit() here (undici sockets closing → libuv crash on
      // Windows); set the flag and let the event loop drain.
      console.error(`findable-audit: cannot write report to "${file}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }
  // Do NOT call process.exit() here: on Windows, exiting while undici (fetch)
  // keep-alive sockets are still closing crashes Node with a libuv assertion
  // ("!(handle->flags & UV_HANDLE_CLOSING)", src\win\async.c). Setting
  // process.exitCode lets the event loop drain and the process exit cleanly.
  // --emit <dir>: write the generated indexing files (robots.txt, llms.txt,
  // llms-full.txt, .well-known/ai.json, sitemap.xml, jsonld-stubs.json,
  // GENERATED-README.md). Independent of --report/--no-report: emitFiles
  // already uses writeFileSync, never process.exit.
  if (emitDir !== undefined) {
    try {
      const written = emitFiles(report, emitDir, { lang: langTyped });
      note(`generated indexing files in ${emitDir} (${written.length} files)`);
      note(langTyped === 'fr'
        ? '⚠ fichiers génériques — relire avant de déployer, surtout robots.txt'
        : '⚠ generic files — review before deploying, especially robots.txt');
    } catch (err) {
      console.error(`findable-audit: cannot write generated files to "${emitDir}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }
  // --summary <file>: the one-screen deliverable (#64). Independent of --report:
  // a reader who wants both gets both, and a client who only ever sees the
  // summary never has to open a 121-row table to learn where the site stands.
  if (summaryFile !== undefined) {
    const body = /\.html?$/i.test(summaryFile)
      ? renderSummaryHtml(report, now, langTyped)
      : renderSummaryMarkdown(report, now, langTyped);
    try {
      writeFileSync(summaryFile, body, 'utf8');
      note(`summary written to ${summaryFile}`);
    } catch (err) {
      console.error(`findable-audit: cannot write summary to "${summaryFile}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }

  // --answers <file>: write the answer matrix in the chosen format. The sample it rests
  // on travels with it, and so does the warning when the crawl stopped at its page limit —
  // a gap found on a truncated crawl is not evidence of a gap on the site.
  if (answersFile !== undefined && report.answerMatrix) {
    const renderer = pickAnswersRenderer(answersFile)!;
    const capped = report.sampledPages.length >= maxPages;
    try {
      writeFileSync(answersFile, renderer(report.answerMatrix, {
        sampledPages: report.sampledPages, capped, lang,
      }), 'utf8');
      note(`answer matrix written to ${answersFile}`);
    } catch (err) {
      console.error(`findable-audit: cannot write answer matrix to "${answersFile}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }

  // --entity-graph <file>: write the JSON-LD entity graph in the chosen format.
  if (entityGraphFile !== undefined && report.entityGraph) {
    const renderer = pickEntityGraphRenderer(entityGraphFile)!;
    try {
      writeFileSync(entityGraphFile, renderer(report.entityGraph), 'utf8');
      note(`entity graph written to ${entityGraphFile}`);
    } catch (err) {
      console.error(`findable-audit: cannot write entity graph to "${entityGraphFile}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }

  // --submit: notify IndexNow (Bing, Yandex, Seznam, Naver — not Google, which
  // does not participate). Runs last, after every file is written, and never
  // changes the exit code: a refused submission is not a failed audit.
  if (values.submit) {
    const key = values['indexnow-key']!;
    const proof = report.results.find((r) => r.id === 'indexnow');
    if (proof?.status !== 'pass') {
      console.error(`findable-audit: not submitting — the IndexNow key file is not verified on ${report.url} `
        + `(check "indexnow": ${proof?.status ?? 'absent'}). Publish /${key}.txt containing exactly the key, then retry.`);
    } else {
      const payload = buildIndexNowPayload(report, key);
      if (payload === null) {
        console.error('findable-audit: not submitting — no sampled URL to submit.');
      } else {
        note(`submitting ${payload.urlList.length} URL(s) to IndexNow (Bing, Yandex, Seznam, Naver)…`);
        const result = await submitIndexNow(payload, { timeoutMs });
        console.error(`IndexNow: ${result.message}`);
        if (result.ok) {
          note('note: Google does not participate in IndexNow — submit there via Search Console.');
        }
      }
    }
  }

  const regressed = failOnRegression && baseline !== undefined && report.score < baseline.score - regressionTolerance;
  // A89 — per-family gates: exit 1 when a gated family subscore is below its threshold.
  let gateFailed = false;
  for (const f of report.familyScores) {
    const threshold = failOnGates.get(f.family);
    if (threshold !== undefined && f.score < threshold) {
      gateFailed = true;
      console.error(`findable-audit: --fail-on gate failed — ${f.family} scored ${f.score} < ${threshold}`);
    }
  }
  process.exitCode = reportWriteFailed ? 3 : regressed || gateFailed ? 1 : report.score >= minScore ? 0 : 1;
} catch (err) {
  if (err instanceof UnreachableSiteError) {
    console.error(`findable-audit: ${err.message}`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
}
