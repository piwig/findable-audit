import { expect, it } from 'vitest';
import { buildLocalPlan } from '../../src/local/plan.js';
import { renderLocalPlanMarkdown } from '../../src/report/local-plan.js';
import type { AuditReport } from '../../src/runner.js';
import { LOCAL_CONTEXT_SCHEMA, parseLocalContext } from '../../src/local/context.js';

it('rejects overlong supplied questions before crawling', () => {
  expect(() => parseLocalContext(JSON.stringify({ schema: LOCAL_CONTEXT_SCHEMA, business: { name: 'Test' }, priorityQuestions: ['x'.repeat(501)] }))).toThrow(/500/);
});

it('preserves proof and safely renders supplied questions, while old audits remain unverified', () => {
  const question = '<img src=x> [click](javascript:x)';
  const context = { schema: LOCAL_CONTEXT_SCHEMA, business: { name: '<script>x</script>' }, priorityQuestions: [question] };
  const report: AuditReport = { url: 'https://example.org', score: 100, grade: 'A', results: [], familyScores: [], sampledPages: ['/'],
    priorityAnswers: [{ question, status: 'found', proof: { kind: 'prose', excerpt: '<iframe>Answer</iframe>', path: '/' } }] };
  const plan = buildLocalPlan(report, context, 'fr');
  expect(plan.questions?.[0].proof?.excerpt).toContain('<iframe>');
  const md = renderLocalPlanMarkdown(plan);
  expect(md).toContain('&lt;iframe&gt;');
  expect(md).not.toContain('<img');
  expect(md).not.toContain('<script>');
  expect(md).not.toContain('[click](javascript:x)');
  delete report.priorityAnswers;
  expect(buildLocalPlan(report, context, 'fr').questions?.[0].status).toBe('review');
});
