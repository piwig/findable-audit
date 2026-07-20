import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../src/report/html.js';
import type { AuditReport } from '../../src/runner.js';

const report: AuditReport = {
  url: 'https://example.com/',
  score: 72,
  sampledPages: ['/', '/about'],
  results: [
    { id: 'llms-txt', family: 'llm-content', status: 'fail', points: 0, maxPoints: 10,
      message: 'llms.txt missing', fix: 'Add a /llms.txt file.' },
    { id: 'json-ld', family: 'structured-data', status: 'pass', points: 10, maxPoints: 10,
      message: '1 valid JSON-LD block(s)' },
    { id: 'evil', family: 'seo-fundamentals', status: 'warn', points: 2, maxPoints: 4,
      message: 'weird <script>alert(1)</script> title', fix: 'Fix the <title>.' },
  ],
};

describe('renderHtml', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'));

  it('is a self-contained HTML document', () => {
    expect(html.trimStart()).toMatch(/^<!doctype html/i);
    expect(html).toContain('<style');
  });
  it('references no external resource (fully inline)', () => {
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
  });
  it('shows the score and audited URL', () => {
    expect(html).toContain('72');
    expect(html).toContain('https://example.com/');
  });
  it('lists every family that has results', () => {
    expect(html).toContain('Content for LLMs');
    expect(html).toContain('Structured data');
    expect(html).toContain('SEO fundamentals');
  });
  it('shows a fix for a failing check', () => {
    expect(html).toContain('Add a /llms.txt file.');
  });
  it('escapes site-derived text', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
