import { createRequire } from 'node:module';
import type { AuditReport } from '../runner.js';
import type { CheckResult } from '../types.js';
import type { ReportDiff } from './diff.js';

const VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)('../../package.json').version as string;
  } catch {
    return '0.0.0';
  }
})();

const TOOL_URI = 'https://github.com/piwig/findable-audit';

/** SARIF severity for a check status (only fail/warn are emitted as results). */
function levelOf(status: CheckResult['status']): 'error' | 'warning' {
  return status === 'fail' ? 'error' : 'warning';
}

/**
 * A relative, stable artifact path for a finding about a remote page.
 *
 * SARIF was designed for files in a checkout, and GitHub enforces it: when the
 * source root is a `file://` checkout — always, inside an Action — an absolute
 * `https` artifact URI makes it **reject the entire upload** ("SARIF URI scheme
 * https did not match the checkout URI scheme file"). We audit sites, not
 * files, so there is no repository path to point at; what we can do is emit a
 * relative pseudo-path that is legible, contains no traversal, and is identical
 * across runs so alert fingerprints stay stable. The real URL is not lost: it
 * stays on the run and on every result under `properties.url`.
 */
function artifactPathFor(url: string): string {
  let host = 'site';
  let pathname = '/';
  try {
    const parsed = new URL(url);
    host = parsed.host || 'site';
    pathname = parsed.pathname || '/';
  } catch { /* keep the defaults: a malformed URL still yields a valid path */ }
  const segments = pathname.split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, '-'));
  const safeHost = host.replace(/[^A-Za-z0-9.:-]/g, '-').replace(/:/g, '_');
  return ['findable-audit', safeHost, ...(segments.length > 0 ? segments : ['index'])].join('/');
}

/**
 * Render the audit as SARIF 2.1.0 — the format GitHub code-scanning (and other
 * CI tools) ingest. Each failing/warning check becomes a result; passing and
 * skipped checks are omitted (SARIF is a findings format). The overall score
 * and grade are attached as run properties.
 */
export function renderSarif(report: AuditReport, opts: { diff?: ReportDiff } = {}): string {
  const findings = report.results.filter((r) => r.status === 'fail' || r.status === 'warn');
  // Check ids that regressed vs the baseline (e.g. pass→warn, warn→fail).
  // Regressions are escalated to `error` so `--baseline` runs surface them in
  // code-scanning even when the new status is only `warn`.
  const regressedIds = new Set((opts.diff?.regressions ?? []).map((t) => t.id));

  // One rule per distinct check id that produced a finding.
  const ruleIndex = new Map<string, number>();
  const rules = [] as Array<Record<string, unknown>>;
  for (const r of findings) {
    if (ruleIndex.has(r.id)) continue;
    ruleIndex.set(r.id, rules.length);
    rules.push({
      id: r.id,
      name: r.id,
      shortDescription: { text: `${r.family}: ${r.id}` },
      ...(r.docUrl ? { helpUri: r.docUrl } : {}),
      properties: { family: r.family },
    });
  }

  const artifactUri = artifactPathFor(report.url);
  const results = findings.map((r) => {
    const regressed = regressedIds.has(r.id);
    return {
      ruleId: r.id,
      ruleIndex: ruleIndex.get(r.id),
      level: regressed ? 'error' : levelOf(r.status),
      message: { text: r.fix ? `${r.message} — Fix: ${r.fix}` : r.message },
      locations: [{
        physicalLocation: { artifactLocation: { uri: artifactUri } },
      }],
      properties: {
        pointsLost: r.maxPoints - r.points,
        family: r.family,
        url: report.url,
        ...(regressed ? { regressed: true } : {}),
      },
    };
  });

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'findable-audit',
          informationUri: TOOL_URI,
          version: VERSION,
          rules,
        },
      },
      results,
      properties: { score: report.score, grade: report.grade, auditedUrl: report.url },
    }],
  };
  return JSON.stringify(sarif, null, 2) + '\n';
}
