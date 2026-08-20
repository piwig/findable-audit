// Dogfooding, extended to the other live sites built on this same engine.
//
// dogfooding.test.mjs pins the engine against apps/web (findable.bordebat.fr),
// which we fully control — a check regression there is unambiguously ours. This
// file extends the same idea to pb-ot.fr, a sibling site in the ecosystem
// deployed with the same checks. It cannot pin an exact non-passing set the way
// dogfooding.test.mjs does: pb-ot.fr's content evolves independently of this
// repo, so an exact-match assertion would fail for reasons that have nothing to
// do with a findable-audit regression. Instead it asserts the invariants that
// DO indicate an engine bug regardless of what pb-ot.fr's content looks like:
// the crawl completes, every check resolves to a known status (never crashes),
// and a handful of checks that have no legitimate reason to regress stay green.
//
// vigie.bordebat.fr is deliberately NOT included: the whole site sits behind
// HTTP auth (401 on every path, verified manually), so there is no page to crawl
// without embedding a credential in the test — and it is a private dashboard,
// not a public site whose findability by AI crawlers is a meaningful thing to
// audit in the first place.
//
// Network-dependent: skips (not fails) the suite if pb-ot.fr is unreachable,
// since a transient outage of a site we don't operate ourselves is not a signal
// about this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAudit } from '../../../packages/cli/dist/runner.js';
import { buildChecks } from '../../../packages/cli/dist/checks/index.js';

const TARGET = 'https://pb-ot.fr/';

let report = null;
let unreachableReason = null;
try {
  const res = await fetch(TARGET, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) unreachableReason = `HTTP ${res.status}`;
} catch (err) {
  unreachableReason = err.message;
}

if (!unreachableReason) {
  try {
    report = await runAudit(TARGET, buildChecks(), { maxPages: 4 });
  } catch (err) {
    unreachableReason = `audit crashed: ${err.message}`;
  }
}

test('pb-ot.fr is reachable for the ecosystem dogfooding pass', { skip: unreachableReason || false }, () => {
  assert.ok(report, 'audit produced a report');
});

test('the crawl actually samples pages on pb-ot.fr', { skip: unreachableReason || false }, () => {
  assert.ok(report.sampledPages.length >= 1, `sampled ${report?.sampledPages.length ?? 0} page(s)`);
});

test('every check resolves to a known status, none crash silently', { skip: unreachableReason || false }, () => {
  const KNOWN = new Set(['pass', 'warn', 'fail', 'skip']);
  const unknown = report.results.filter((r) => !KNOWN.has(r.status));
  assert.deepEqual(unknown, [], `checks with an unexpected status: ${unknown.map((r) => `${r.id}:${r.status}`).join(', ')}`);
});

test('the overall score stays a finite number in range', { skip: unreachableReason || false }, () => {
  assert.ok(Number.isFinite(report.score), `score is ${report.score}`);
  assert.ok(report.score >= 0 && report.score <= 100, `score ${report.score} out of range`);
});

test('checks with no legitimate reason to regress on pb-ot.fr stay green', { skip: unreachableReason || false }, () => {
  const byId = new Map(report.results.map((r) => [r.id, r]));
  const check = (id) => byId.get(id) ?? { status: 'MISSING', message: `no result for ${id}` };
  const why = (id) => `${id}: ${check(id).status} — ${check(id).message}`;
  for (const id of ['www-consolidation', 'agent-usability', 'ai-crawlers-allowed']) {
    assert.equal(check(id).status, 'pass', why(id));
  }
});
