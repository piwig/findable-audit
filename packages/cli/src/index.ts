#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { buildChecks } from './checks/index.js';
import { runAudit, UnreachableSiteError, type AuditReport } from './runner.js';
import { renderTerminal } from './report/terminal.js';
import { renderJson } from './report/json.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';
import { renderSarif } from './report/sarif.js';
import { renderCompareHtml, renderCompareMarkdown, renderCompareTerminal } from './report/compare.js';
import { diffReports, renderDiffTerminal, type ReportDiff } from './report/diff.js';
import { pickEntityGraphRenderer } from './report/entity-graph.js';
import { emitFiles } from './generate/index.js';
import type { Lang } from './report/i18n.js';

const USAGE = `Usage: findable <url> [--compare <url2,url3,...>] [--baseline <file.json>] [--fail-on-regression] [--regression-tolerance <n>] [--json] [--report <file.md|file.html|file.json|file.sarif>] [--no-report] [--lang <en|fr>] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--user-agent <ua>] [--indexnow-key <key>] [--cwv] [--psi-key <key>] [--psi-strategy <mobile|desktop>] [--emit <dir>]

--compare audits your URL against one or more competitor URLs (comma-separated) and writes a side-by-side scorecard (overall + per-family, with the gaps where you trail).
--baseline <file.json> diffs this run against a prior findable --report *.json: overall/per-family deltas + which checks regressed or improved (shown in the terminal and the md/html reports).
--fail-on-regression exits 1 when the score drops below the baseline by more than --regression-tolerance points (default 0); requires --baseline. Ideal as a CI gate.
--entity-graph <file> writes the JSON-LD entity graph across the sampled pages; format by extension: .json, .dot (Graphviz), or .mmd (Mermaid).
--emit <dir> writes ready-to-deploy indexing files (robots.txt, llms.txt, llms-full.txt, .well-known/ai.json,
  sitemap.xml, jsonld-stubs.json, GENERATED-README.md) into <dir>. Content is generic — review before deploying,
  especially robots.txt. Works alongside --report/--no-report (independent of the md/html report files).

Audits a website's readiness for AI search (GEO) and technical SEO.
Samples up to --max-pages pages (default 10, homepage + sitemap/link-discovered pages; 1 = homepage only).
By default, two report files are written to the current directory: <host>-<date>.md and <host>-<date>.html
  (the .html is a self-contained, printable report — open it and "Print to PDF"). Use --no-report to write none.
--report <file> overrides the default and writes exactly the file(s) you name (repeatable); the format is chosen
  by extension: .html/.htm -> HTML, .json -> JSON, .sarif -> SARIF (GitHub code-scanning), anything else -> Markdown.
--lang selects the report chrome language (en or fr; default en). The 109 checks stay in English.
--user-agent overrides the crawler User-Agent (e.g. "GPTBot/1.0") to test UA-based blocking.
--cwv opts into Core Web Vitals via one (slow, ~15-30s) PageSpeed Insights call; without it the CWV checks skip.
--psi-key <key> supplies a Google PSI/CrUX API key (recommended: the keyless endpoint is rate-limited).
--psi-strategy selects the PSI form factor (default mobile).
Exit codes: 0 = score >= min-score, 1 = below, 2 = unreachable/error.`;

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
      'regression-tolerance': { type: 'string', default: '0' },
      'entity-graph': { type: 'string' },
      emit: { type: 'string' },
      report: { type: 'string', short: 'r', multiple: true },
      'no-report': { type: 'boolean', default: false },
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

if (values.version) {
  console.log(createRequire(import.meta.url)('../package.json').version);
  process.exit(0);
}

const url = positionals[0];
if (values.help || !url) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
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
if ((failOnRegression || values['regression-tolerance'] !== '0') && values.baseline === undefined) {
  console.error(`findable-audit: --fail-on-regression / --regression-tolerance require --baseline <file>\n\n${USAGE}`);
  process.exit(2);
}
// --entity-graph <file>: validate the target extension up front.
const entityGraphFile = values['entity-graph'];
if (entityGraphFile !== undefined) {
  if (entityGraphFile.trim() === '' || pickEntityGraphRenderer(entityGraphFile) === null) {
    console.error(`findable-audit: --entity-graph file must end in .json, .dot or .mmd (got "${entityGraphFile}")\n\n${USAGE}`);
    process.exit(2);
  }
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

try {
  const checks = buildChecks({ indexnowKey: values['indexnow-key'] });
  const auditOpts = { timeoutMs, maxPages, userAgent, cwv: values.cwv, psiKey, psiStrategy: psiStrategy as 'mobile' | 'desktop', includeEntityGraph: entityGraphFile !== undefined || emitDir !== undefined };
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
        competitorReports.push(await runAudit(cu, checks, auditOpts));
      } catch (err) {
        console.error(`findable-audit: skipping "${cu}" (${(err as Error).message})`);
      }
    }
  }
  const compare = competitorReports.length > 0;
  const reports = [report, ...competitorReports];

  console.log(values.json ? renderJson(report) : compare ? renderCompareTerminal(reports, langTyped) : renderTerminal(report));
  if (diff && !values.json) console.log('\n' + renderDiffTerminal(diff, langTyped));
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
  for (const file of targets) {
    let body: string;
    if (/\.sarif$/i.test(file)) body = renderSarif(report);
    else if (/\.json$/i.test(file)) body = renderJson(report);
    else if (/\.html?$/i.test(file)) body = compare ? renderCompareHtml(reports, now, langTyped) : renderHtml(report, now, langTyped, { diff });
    else body = compare ? renderCompareMarkdown(reports, langTyped) : renderMarkdown(report, now, langTyped, { diff });
    try {
      writeFileSync(file, body, 'utf8');
      console.error(`report written to ${file}`);
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
      console.error(`generated indexing files in ${emitDir} (${written.length} files)`);
      console.error(langTyped === 'fr'
        ? '⚠ fichiers génériques — relire avant de déployer, surtout robots.txt'
        : '⚠ generic files — review before deploying, especially robots.txt');
    } catch (err) {
      console.error(`findable-audit: cannot write generated files to "${emitDir}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }
  // --entity-graph <file>: write the JSON-LD entity graph in the chosen format.
  if (entityGraphFile !== undefined && report.entityGraph) {
    const renderer = pickEntityGraphRenderer(entityGraphFile)!;
    try {
      writeFileSync(entityGraphFile, renderer(report.entityGraph), 'utf8');
      console.error(`entity graph written to ${entityGraphFile}`);
    } catch (err) {
      console.error(`findable-audit: cannot write entity graph to "${entityGraphFile}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }

  const regressed = failOnRegression && baseline !== undefined && report.score < baseline.score - regressionTolerance;
  process.exitCode = reportWriteFailed ? 2 : regressed ? 1 : report.score >= minScore ? 0 : 1;
} catch (err) {
  if (err instanceof UnreachableSiteError) {
    console.error(`findable-audit: ${err.message}`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
