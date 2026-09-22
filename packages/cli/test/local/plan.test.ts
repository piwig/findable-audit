import { describe, expect, it } from 'vitest';
import { LOCAL_CONTEXT_SCHEMA, LocalContextError, parseLocalContext } from '../../src/local/context.js';
import { buildLocalPlan } from '../../src/local/plan.js';
import { renderLocalPlanJson, renderLocalPlanMarkdown } from '../../src/report/local-plan.js';
import type { AuditReport } from '../../src/runner.js';

const report: AuditReport = {
  url: 'https://example.test/', score: 72, grade: 'C', familyScores: [], sampledPages: ['/', '/services'],
  results: [
    { id: 'nap-consistency', family: 'structured-data', evidence: 'measured', status: 'warn', points: 1, maxPoints: 3, message: 'phone differs' },
    { id: 'sd-localbusiness', family: 'structured-data', evidence: 'measured', status: 'fail', points: 0, maxPoints: 3, message: 'missing geo' },
  ],
};

const raw = JSON.stringify({
  schema: LOCAL_CONTEXT_SCHEMA,
  business: { name: 'Atelier Exemple', address: '1 rue du Test', phone: '0102030405', googleBusinessProfile: 'https://maps.google.com/?cid=1' },
  services: ['Réparation', 'réparation', 'Entretien'], areas: ['Orgères'], priorityQuestions: ['Réparez-vous les vélos électriques ?'],
  competitors: [{ name: 'Concurrent', website: 'https://competitor.example/' }], verifiedAt: '2026-09-08',
});

describe('local context and plan', () => {
  it('normalizes client-supplied lists and turns audit gaps into explicit actions', () => {
    const context = parseLocalContext(raw);
    expect(context.services).toEqual(['Réparation', 'Entretien']);
    const plan = buildLocalPlan(report, context, 'fr');
    expect(plan.actions.map((item) => item.id)).toContain('nap-consistency');
    expect(plan.actions.map((item) => item.id)).toContain('profile-review');
    expect(plan.actions.map((item) => item.id)).toContain('competitor-compare');
    expect(plan.disclosure).toContain('ne se connecte pas à Google');
  });

  it('never copies supplied address or phone into the plan artifact', () => {
    const plan = buildLocalPlan(report, parseLocalContext(raw), 'en');
    expect(renderLocalPlanJson(plan)).not.toContain('1 rue du Test');
    expect(renderLocalPlanJson(plan)).not.toContain('0102030405');
    expect(renderLocalPlanMarkdown(plan)).toContain('Local readiness plan');
  });

  it('fails closed for malformed context', () => {
    expect(() => parseLocalContext('{"schema":"wrong"}')).toThrow(LocalContextError);
    expect(() => parseLocalContext(JSON.stringify({ schema: LOCAL_CONTEXT_SCHEMA, business: { name: '' } }))).toThrow('business.name');
  });
});
