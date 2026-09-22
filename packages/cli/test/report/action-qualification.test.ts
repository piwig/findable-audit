import { describe, it, expect } from 'vitest';
import { collectRecommendations, topFixes, recommendationAdvice, offendersOf } from '../../src/report/recommendations.js';
import { renderHtml } from '../../src/report/html.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import { renderTerminal } from '../../src/report/terminal.js';
import { renderSummaryHtml, renderSummaryMarkdown } from '../../src/report/summary.js';
import { computeScore } from '../../src/scoring.js';
import type { CheckResult } from '../../src/types.js';
import type { AuditReport } from '../../src/runner.js';

const check = (id: string, extra: Partial<CheckResult> = {}): CheckResult => ({ id, family: 'structured-data', evidence: 'measured', status: 'warn', message: 'Observed condition', fix: 'Do something', points: 1, maxPoints: 2, ...extra });
const report = (results: CheckResult[]): AuditReport => ({ url: 'https://example.com/', sampledPages: ['/', '/équipe', '/r%C3%A9paration', '/contact?type=pro'], results, ...computeScore(results) });

describe('action qualification', () => {
  it('does not turn optional declarations into priority corrections, even if scored fail', () => {
    const items = collectRecommendations(report(['sd-entity-grounding', 'sd-organization', 'rsl-license', 'llms-txt', 'llms-full-txt', 'sd-speakable', 'sd-website-searchaction'].map((id) => check(id, { status: 'fail', message: 'missing optional declaration' }))));
    expect(items.every((r) => r.kind === 'conditional')).toBe(true);
    expect(topFixes(items)).toEqual([]);
    for (const r of items) for (const lang of ['en', 'fr'] as const) expect(recommendationAdvice(r, lang).length).toBeGreaterThan(30);
  });
  it('distinguishes a declared broken SearchAction from an absent search feature', () => {
    const items = collectRecommendations([check('sd-website-searchaction', { message: 'SearchAction present but incomplete (target/query-input)' })]);
    expect(items[0].kind).toBe('fix');
    expect(recommendationAdvice(items[0], 'en')).toMatch(/declared|existing/);
  });
  it('keeps evidence and exact findings, and asks for review of heuristic or legacy results', () => {
    const legacy = check('legacy'); delete (legacy as Partial<CheckResult>).evidence;
    const items = collectRecommendations([check('heuristic', { evidence: 'heuristic', message: 'Observed content on /équipe' }), legacy]);
    expect(items.find((r) => r.id === 'heuristic')).toMatchObject({ kind: 'review', evidence: 'heuristic', finding: 'Observed content on /équipe' });
    expect(items.find((r) => r.id === 'legacy')).toMatchObject({ kind: 'review', evidence: 'unknown' });
  });
  it('prioritises measured defects over cheap optional points, then severity and effort', () => {
    const items = collectRecommendations([
      check('rsl-license', { family: 'ai-access', maxPoints: 100 }),
      check('cwv-lcp', { family: 'performance', status: 'fail', points: 0 }),
      check('broken-internal-links', { family: 'technical-seo', status: 'fail', points: 0 }),
      check('canonical', { family: 'technical-seo', status: 'fail', points: 0 }),
      check('heuristic', { evidence: 'heuristic', maxPoints: 100 }),
    ]);
    expect(topFixes(items).map((r) => r.id)).toEqual(['canonical', 'broken-internal-links', 'cwv-lcp', 'heuristic']);
  });
});

describe('observed locations', () => {
  it('preserves accents, encoding and queries while rejecting markup and foreign URLs', () => {
    const corpus = report([]);
    expect(offendersOf('bad </h1> on /équipe, /réparation and /contact?type=pro; profile https://other.example/équipe, /outside', corpus)).toEqual(['/équipe', '/r%C3%A9paration', '/contact?type=pro']);
    expect(offendersOf('https://other.example/équipe', corpus)).toEqual([]);
    expect(offendersOf('/équipe')).toEqual([]);
  });
  it('does not invent a homepage or a shorter sampled path from a path prefix', () => {
    expect(offendersOf('bad /équipe-longue and /contact?type=private', report([]))).toEqual([]);
  });
});

describe('shared presentation contract', () => {
  const fixture = report([
    check('advice-marker', { evidence: 'heuristic', message: 'Check this observation' }),
    check('rsl-license', { family: 'ai-access', message: 'No licence declared' }),
    check('first-marker', { family: 'security', status: 'fail', message: 'Observed failure on /équipe' }),
  ]);
  const renderers = [(r: AuditReport, lang: 'en' | 'fr') => renderHtml(r, undefined, lang), (r: AuditReport, lang: 'en' | 'fr') => renderMarkdown(r, undefined, lang), renderTerminal,
    (r: AuditReport, lang: 'en' | 'fr') => renderSummaryHtml(r, new Date(), lang), (r: AuditReport, lang: 'en' | 'fr') => renderSummaryMarkdown(r, new Date(), lang)];
  it('uses the same priority order and separates conditional advice in every format', () => {
    for (const render of renderers) for (const lang of ['en', 'fr'] as const) {
      const text = render(fixture, lang);
      expect(text.indexOf('first-marker')).toBeLessThan(text.indexOf('advice-marker'));
      expect(text).toContain(lang === 'fr' ? 'Conseil conditionnel' : 'Conditional advice');
      expect(text).toContain('Observed failure on');
      expect(text).not.toMatch(/best payoff|meilleur rendement|Doing these three/);
    }
  });
  it('escapes original evidence in HTML and Markdown and never changes the report', () => {
    const hostile = report([check('unsafe', { family: 'security', status: 'fail', message: '<img src=x onerror=alert(1)> /équipe', fix: '<script>bad()</script>' })]);
    const before = JSON.stringify(hostile);
    for (const render of renderers.filter((_r, i) => i !== 2)) {
      const text = render(hostile, 'en');
      expect(text).not.toContain('<img src=x');
      expect(text).not.toContain('<script>bad()');
      expect(text).toContain('&lt;img');
    }
    expect(JSON.stringify(hostile)).toBe(before);
  });
  it('does not turn a supplied documentation URL into executable HTML', () => {
    const hostile = report([check('unsafe', { status: 'fail', docUrl: 'javascript:alert(1)' })]);
    expect(renderHtml(hostile)).not.toContain('href="javascript:');
    expect(renderMarkdown(hostile)).not.toContain('](javascript:');
  });
});
