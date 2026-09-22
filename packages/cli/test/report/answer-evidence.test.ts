import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../src/report/html.js';
import type { AuditReport } from '../../src/runner.js';
import { renderPriorityAnswersMarkdown } from '../../src/report/answer-evidence.js';

const base: AuditReport = { url: 'https://example.com/', score: 100, grade: 'A', familyScores: [], sampledPages: ['/'], results: [] };

describe('answer evidence in the portable report', () => {
  const priority: AuditReport = { ...base, priorityAnswers: [
    { question: 'Combien coûte le site ?', status: 'found', proof: { path: '/tarifs/', kind: 'prose', heading: 'Combien coûte le site ?', excerpt: 'Le prix dépend du périmètre retenu.' } },
    { question: 'Quels délais de livraison ?', status: 'review', proof: { path: '/', kind: 'prose', excerpt: 'Nos délais de livraison sont discutés ensemble.' } },
    { question: 'Une question sans réponse ?', status: 'not-found' },
  ] };

  it('shows supplied questions before inferred questions, including when no matrix was requested', () => {
    const html = renderHtml(priority, new Date('2026-09-22'), 'fr');
    expect(html).toContain('id="priority-answers"');
    expect(html).toContain('Vos questions prioritaires');
    expect(html).toContain('Passage retrouvé');
    expect(html).toContain('À vérifier');
    expect(html).toContain('Absent de l’échantillon');
    expect(html).toContain('/tarifs/');
    expect(html).toContain('repérage lexical');
    expect(html).toContain('Le prix dépend du périmètre retenu.');
    expect(html).not.toContain('id="answer-evidence"');
    const withMatrix = renderHtml({ ...priority, answerMatrix: { subjects: [], zones: [], bucket: 'unknown', lang: 'fr', cells: [] } }, new Date('2026-09-22'), 'fr');
    expect(withMatrix.indexOf('id="priority-answers"')).toBeLessThan(withMatrix.indexOf('id="answer-evidence"'));
    expect(renderHtml(priority, new Date('2026-09-22'), 'en')).toContain('Your priority questions');
  });

  it('escapes supplied questions, excerpts and paths in both portable exports', () => {
    const hostile: AuditReport = { ...base, priorityAnswers: [{ question: '<script>alert(1)</script> [click](javascript:x)', status: 'review', proof: { path: '/<img>', kind: 'prose', excerpt: '<img src=x onerror=x> **test**', heading: '<iframe>' } }] };
    const html = renderHtml(hostile, new Date('2026-09-22'), 'fr');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<iframe>');
    expect(html).toContain('&lt;img');
    const md = renderPriorityAnswersMarkdown(hostile, 'en');
    expect(md).toContain('Review required');
    expect(md).toContain('&lt;script&gt;');
    expect(md).not.toContain('[click](javascript:x)');
    expect(md).not.toContain('<img');
    expect(renderPriorityAnswersMarkdown(base, 'fr')).toBe('');
  });

  it('shows the sampled scope without promising indexation or citations, including on old reports', () => {
    const html = renderHtml(base, new Date('2026-09-22'), 'fr');
    expect(html).toContain('Périmètre de cet audit');
    expect(html).toContain('1 page');
    expect(html).toContain('ne mesure ni les positions');
    expect(html).not.toContain('id="answer-evidence"');
  });

  it('renders every answer and escapes site-derived proof and question text without executable links', () => {
    const report = { ...base, answerMatrix: {
      subjects: [], zones: [], bucket: 'unknown', lang: 'fr', cells: [
        { subject: { name: 'Site' }, intent: 'price', question: '<img src=x onerror=alert(1)>', state: 'covered', evidence: 'prose', path: 'javascript:alert(1)', proof: { kind: 'prose', excerpt: '<script>alert(1)</script>', heading: 'Tarifs & délais' } },
        { subject: { name: 'Site' }, intent: 'price', question: 'Une autre question ?', state: 'missing', evidence: 'none' },
      ],
    } } as unknown as AuditReport;
    const html = renderHtml(report, new Date('2026-09-22'), 'fr');
    expect(html).toContain('id="answer-evidence"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('Absent de l’échantillon');
    expect(html).toContain('Tarifs &amp; délais');
  });

  it('offers evidence filters without JavaScript and leaves findings available to print', () => {
    const html = renderHtml(base, new Date('2026-09-22'), 'en');
    expect(html).toContain('name="evidence-filter"');
    expect(html).toContain('Measured findings');
    expect(html).toContain('Editorial advice');
    expect(html).not.toMatch(/<script\b/);
    expect(html).toMatch(/@media print/);
  });
});
