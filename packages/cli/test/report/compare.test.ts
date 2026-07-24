import { describe, it, expect } from 'vitest';
import { renderCompareMarkdown, renderCompareHtml, renderCompareTerminal } from '../../src/report/compare.js';
import type { AuditReport } from '../../src/runner.js';
import type { Family } from '../../src/types.js';

const mk = (url: string, score: number, grade: string, fam: Record<string, number>): AuditReport => ({
  url, score, grade: grade as AuditReport['grade'], sampledPages: ['/'], results: [],
  familyScores: Object.entries(fam).map(([f, s]) => ({ family: f as Family, score: s, weight: 0.1, earned: s, max: 100 })),
});

const you = mk('https://you.com/', 60, 'C', { 'ai-access': 50, 'technical-seo': 70 });
const rival = mk('https://rival.com/', 85, 'B', { 'ai-access': 90, 'technical-seo': 60 });

describe('competitive comparison', () => {
  it('markdown: table with overall + families, marks the leader, lists gaps', () => {
    const md = renderCompareMarkdown([you, rival]);
    expect(md).toContain('Competitive comparison');
    expect(md).toContain('you.com (You)');
    expect(md).toContain('rival.com');
    expect(md).toContain('Overall score');
    expect(md).toContain('Where you trail');
    expect(md).toMatch(/25 behind the leader/); // overall 85-60
    expect(md).toMatch(/40 behind the leader/); // ai-access 90-50
    // you lead technical-seo (70>60) → it must NOT be a gap
  });

  it('html: self-contained scorecard that marks leader cells and escapes', () => {
    const html = renderCompareHtml([you, rival]);
    expect(html.trimStart()).toMatch(/^<!doctype html/i);
    expect(html).toContain('class="s'); // score cells
    expect(html).toContain('lead');     // leader-cell class
    expect(html).not.toMatch(/<(?:link|script|img)\b[^>]*\b(?:src|href)\s*=\s*["']https?:/i);
  });

  it('terminal: plain-text table + gaps', () => {
    const t = renderCompareTerminal([you, rival]);
    expect(t).toContain('Competitive comparison');
    expect(t).toContain('Overall score');
    expect(t).toContain('Where you trail');
  });

  it('French labels when asked', () => {
    const md = renderCompareMarkdown([you, rival], 'fr');
    expect(md).toContain('Comparaison concurrentielle');
    expect(md).toContain('(Vous)');
    expect(md).toContain('Où vous êtes devancé');
    expect(md).toMatch(/sous le leader/);
  });

  it('reports no gaps when you lead every family', () => {
    const strong = mk('https://you.com/', 95, 'A', { 'ai-access': 99 });
    const weak = mk('https://rival.com/', 40, 'F', { 'ai-access': 30 });
    expect(renderCompareMarkdown([strong, weak])).toContain('You lead or match on every family');
  });
});

describe('CWV note in comparison mode', () => {
  const EN_NOTE = 'Core Web Vitals are not measured in comparison mode (lightweight audits)';
  const FR_NOTE = 'Core Web Vitals non mesurés en mode comparaison (audits allégés)';

  it('appears by default in markdown, html and terminal (EN)', () => {
    expect(renderCompareMarkdown([you, rival])).toContain(EN_NOTE);
    expect(renderCompareHtml([you, rival])).toContain(EN_NOTE);
    expect(renderCompareTerminal([you, rival])).toContain(EN_NOTE);
  });

  it('sits near the family scores: after the score table, before the gaps section (html)', () => {
    const html = renderCompareHtml([you, rival]);
    const at = html.indexOf(EN_NOTE);
    expect(at).toBeGreaterThan(html.indexOf('</table>'));
    expect(at).toBeLessThan(html.indexOf('Where you trail'));
  });

  it('is translated in French', () => {
    expect(renderCompareMarkdown([you, rival], 'fr')).toContain(FR_NOTE);
    expect(renderCompareHtml([you, rival], new Date(), 'fr')).toContain(FR_NOTE);
    expect(renderCompareTerminal([you, rival], 'fr')).toContain(FR_NOTE);
  });

  it('is suppressed when the compare audits did measure CWV (--cwv)', () => {
    expect(renderCompareMarkdown([you, rival], 'en', { cwvNote: false })).not.toContain(EN_NOTE);
    expect(renderCompareHtml([you, rival], new Date(), 'en', { cwvNote: false })).not.toContain(EN_NOTE);
    expect(renderCompareTerminal([you, rival], 'en', { cwvNote: false })).not.toContain(EN_NOTE);
  });
});
