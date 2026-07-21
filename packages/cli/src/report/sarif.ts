import { createRequire } from 'node:module';
import type { AuditReport } from '../runner.js';
import type { CheckResult } from '../types.js';

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
 * Render the audit as SARIF 2.1.0 — the format GitHub code-scanning (and other
 * CI tools) ingest. Each failing/warning check becomes a result; passing and
 * skipped checks are omitted (SARIF is a findings format). The overall score
 * and grade are attached as run properties.
 */
export function renderSarif(report: AuditReport): string {
  const findings = report.results.filter((r) => r.status === 'fail' || r.status === 'warn');

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

  const results = findings.map((r) => ({
    ruleId: r.id,
    ruleIndex: ruleIndex.get(r.id),
    level: levelOf(r.status),
    message: { text: r.fix ? `${r.message} — Fix: ${r.fix}` : r.message },
    locations: [{
      physicalLocation: { artifactLocation: { uri: report.url } },
    }],
    properties: { pointsLost: r.maxPoints - r.points, family: r.family },
  }));

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
