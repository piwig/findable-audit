#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { buildChecks } from './checks/index.js';
import { runAudit, UnreachableSiteError } from './runner.js';
import { renderTerminal } from './report/terminal.js';
import { renderJson } from './report/json.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';

const USAGE = `Usage: findable <url> [--json] [--report <file.md|file.html>] [--no-report] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--user-agent <ua>] [--indexnow-key <key>]

Audits a website's readiness for AI search (GEO) and technical SEO.
Samples up to --max-pages pages (default 10, homepage + sitemap/link-discovered pages; 1 = homepage only).
By default, two report files are written to the current directory: <host>-<date>.md and <host>-<date>.html
  (the .html is a self-contained, printable report — open it and "Print to PDF"). Use --no-report to write none.
--report <file> overrides the default and writes exactly the file(s) you name (repeatable); the format is chosen
  by extension: .html/.htm -> HTML, anything else -> Markdown.
--user-agent overrides the crawler User-Agent (e.g. "GPTBot/1.0") to test UA-based blocking.
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

const targetUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
if (!URL.canParse(targetUrl) || !/^https?:$/.test(new URL(targetUrl).protocol)) {
  console.error(`findable-audit: invalid URL "${url}"\n\n${USAGE}`);
  process.exit(2);
}

try {
  const report = await runAudit(targetUrl,
    buildChecks({ indexnowKey: values['indexnow-key'] }), { timeoutMs, maxPages, userAgent });
  console.log(values.json ? renderJson(report) : renderTerminal(report));
  // Decide which report files to write:
  //   --report given  -> exactly those (format by extension); default suppressed
  //   --no-report     -> none
  //   otherwise       -> <host>-<date>.md and .html in the current directory
  const now = new Date();
  const explicit = values.report ?? [];
  let targets: string[];
  if (explicit.length > 0) {
    targets = explicit;
  } else if (values['no-report']) {
    targets = [];
  } else {
    const base = defaultReportBase(report.url, now);
    targets = [`${base}.md`, `${base}.html`];
  }
  let reportWriteFailed = false;
  for (const file of targets) {
    const isHtml = /\.html?$/i.test(file);
    const body = isHtml ? renderHtml(report, now) : renderMarkdown(report, now);
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
  process.exitCode = reportWriteFailed ? 2 : report.score >= minScore ? 0 : 1;
} catch (err) {
  if (err instanceof UnreachableSiteError) {
    console.error(`findable-audit: ${err.message}`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
