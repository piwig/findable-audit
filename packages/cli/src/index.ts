#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { buildChecks } from './checks/index.js';
import { runAudit, UnreachableSiteError } from './runner.js';
import { renderTerminal } from './report/terminal.js';
import { renderJson } from './report/json.js';

const USAGE = `Usage: findable <url> [--json] [--min-score <n>] [--timeout <ms>] [--indexnow-key <key>]

Audits a website's readiness for AI search (GEO) and technical SEO.
Exit codes: 0 = score >= min-score, 1 = below, 2 = unreachable/error.`;

const parseCliArgs = () =>
  parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      'min-score': { type: 'string', default: '60' },
      timeout: { type: 'string', default: '10000' },
      'indexnow-key': { type: 'string' },
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

const targetUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
if (!URL.canParse(targetUrl) || !/^https?:$/.test(new URL(targetUrl).protocol)) {
  console.error(`findable-audit: invalid URL "${url}"\n\n${USAGE}`);
  process.exit(2);
}

try {
  const report = await runAudit(targetUrl,
    buildChecks({ indexnowKey: values['indexnow-key'] }), { timeoutMs });
  console.log(values.json ? renderJson(report) : renderTerminal(report));
  // Do NOT call process.exit() here: on Windows, exiting while undici (fetch)
  // keep-alive sockets are still closing crashes Node with a libuv assertion
  // ("!(handle->flags & UV_HANDLE_CLOSING)", src\win\async.c). Setting
  // process.exitCode lets the event loop drain and the process exit cleanly.
  process.exitCode = report.score >= minScore ? 0 : 1;
} catch (err) {
  if (err instanceof UnreachableSiteError) {
    console.error(`findable-audit: ${err.message}`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
