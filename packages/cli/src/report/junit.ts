import type { AuditReport } from '../runner.js';
import type { CheckResult } from '../types.js';

/** Escape a string for use in XML attribute values and text nodes. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** fail and warn both surface as JUnit <failure>s (distinguished by type=). */
function isFailure(r: CheckResult): boolean {
  return r.status === 'fail' || r.status === 'warn';
}

/** Body of a <failure> element: message plus fix, docs and points context. */
function failureBody(r: CheckResult): string {
  const lines = [r.message];
  if (r.fix) lines.push(`Fix: ${r.fix}`);
  if (r.docUrl) lines.push(`Docs: ${r.docUrl}`);
  lines.push(`Points: ${r.points}/${r.maxPoints}`);
  return lines.join('\n');
}

/**
 * Render the audit as JUnit XML — the test-report format GitLab CI
 * (artifacts:reports:junit) and Jenkins (junit step) ingest natively.
 *
 * One <testsuite> per family (canonical runner order), one <testcase> per check.
 * Mapping: fail -> <failure type="fail">, warn -> <failure type="warn"> (visible
 * in the CI test tab; the pipeline only fails via the CLI exit code —
 * --min-score / --fail-on-regression — never via this file), skip -> <skipped>,
 * pass -> a bare testcase.
 */
export function renderJunit(report: AuditReport): string {
  // Group results per family, preserving the canonical order the runner emits.
  const suites = new Map<string, CheckResult[]>();
  for (const r of report.results) {
    const list = suites.get(r.family);
    if (list) list.push(r);
    else suites.set(r.family, [r]);
  }

  let host = '';
  try { host = new URL(report.url).hostname; } catch { /* keep '' */ }
  const timestamp = report.generatedAt ? ` timestamp="${esc(report.generatedAt)}"` : '';

  const total = report.results.length;
  const failures = report.results.filter(isFailure).length;
  const skipped = report.results.filter((r) => r.status === 'skip').length;
  const rootName = `findable-audit — ${report.url} — score ${report.score}/100 (${report.grade})`;

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<testsuites name="${esc(rootName)}" tests="${total}" failures="${failures}" skipped="${skipped}" errors="0" time="0">`);
  for (const [family, checks] of suites) {
    const f = checks.filter(isFailure).length;
    const s = checks.filter((r) => r.status === 'skip').length;
    out.push(`  <testsuite name="${esc(family)}" tests="${checks.length}" failures="${f}" skipped="${s}" errors="0" time="0" hostname="${esc(host)}"${timestamp}>`);
    const famScore = report.familyScores.find((x) => x.family === family)?.score;
    if (famScore !== undefined) {
      out.push('    <properties>');
      out.push(`      <property name="score" value="${famScore}"/>`);
      out.push('    </properties>');
    }
    for (const r of checks) {
      const open = `    <testcase classname="findable-audit.${esc(family)}" name="${esc(r.id)}" time="0"`;
      if (r.status === 'pass') { out.push(`${open}/>`); continue; }
      out.push(`${open}>`);
      if (r.status === 'skip') out.push(`      <skipped message="${esc(r.message)}"/>`);
      else out.push(`      <failure type="${r.status}" message="${esc(r.message)}">${esc(failureBody(r))}</failure>`);
      out.push('    </testcase>');
    }
    out.push('  </testsuite>');
  }
  out.push('</testsuites>');
  return out.join('\n') + '\n';
}
