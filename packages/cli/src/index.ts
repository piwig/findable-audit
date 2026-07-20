#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { buildChecks } from './checks/index.js';
import { runAudit, UnreachableSiteError } from './runner.js';
import { renderTerminal } from './report/terminal.js';
import { renderJson } from './report/json.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    'min-score': { type: 'string', default: '60' },
    'indexnow-key': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const url = positionals[0];
if (values.help || !url) {
  console.log(`Usage: findable <url> [--json] [--min-score <n>] [--indexnow-key <key>]

Audits a website's readiness for AI search (GEO) and technical SEO.
Exit codes: 0 = score >= min-score, 1 = below, 2 = unreachable/error.`);
  process.exit(values.help ? 0 : 2);
}

try {
  const report = await runAudit(/^https?:\/\//.test(url) ? url : `https://${url}`,
    buildChecks({ indexnowKey: values['indexnow-key'] }));
  console.log(values.json ? renderJson(report) : renderTerminal(report));
  process.exit(report.score >= Number(values['min-score']) ? 0 : 1);
} catch (err) {
  if (err instanceof UnreachableSiteError) {
    console.error(`findable-audit: ${err.message}`);
    process.exit(2);
  }
  throw err;
}
