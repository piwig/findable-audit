import { describe, it, expect } from 'vitest';
import { renderBadge } from '../../src/report/badge.js';
import type { AuditReport } from '../../src/runner.js';

function reportWith(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://example.com/',
    score: 91,
    grade: 'A',
    familyScores: [],
    sampledPages: ['/'],
    results: [],
    ...over,
  };
}

/** Width of a <rect> by its 1-based order of appearance in the markup. */
function rectWidths(svg: string): number[] {
  return [...svg.matchAll(/<rect[^>]*\swidth="([\d.]+)"/g)].map((m) => Number(m[1]));
}

describe('renderBadge', () => {
  it('renders a self-contained SVG: no script, no external resource', () => {
    const svg = renderBadge(reportWith());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<image/i);
    // The only URL allowed in the document is the SVG namespace itself.
    expect(svg.match(/https?:\/\//g)).toEqual(['http://']);
  });

  it('shows the grade and the score out of 100, plus the findable label', () => {
    const svg = renderBadge(reportWith({ score: 91, grade: 'A' }));
    expect(svg).toContain('>findable<');
    expect(svg).toContain('>A 91/100<');
  });

  it('wears the status colour of its band — same thresholds as the report', () => {
    expect(renderBadge(reportWith({ score: 80, grade: 'B' }))).toContain('#1a7f37');
    expect(renderBadge(reportWith({ score: 79, grade: 'C' }))).toContain('#9a6700');
    expect(renderBadge(reportWith({ score: 60, grade: 'D' }))).toContain('#9a6700');
    expect(renderBadge(reportWith({ score: 59, grade: 'E' }))).toContain('#b42318');
  });

  it('renders the extreme scores without collapsing', () => {
    for (const score of [0, 100]) {
      const svg = renderBadge(reportWith({ score, grade: score === 0 ? 'F' : 'A' }));
      expect(svg).toContain(`${score}/100<`);
      expect(rectWidths(svg).every((w) => w > 0)).toBe(true);
    }
  });

  it('constrains every text run to the box it was measured for', () => {
    const svg = renderBadge(reportWith());
    const texts = [...svg.matchAll(/<text[^>]*>/g)].map((m) => m[0]);
    expect(texts).toHaveLength(2);
    for (const t of texts) {
      expect(t).toMatch(/textLength="[\d.]+"/);
      expect(t).toContain('lengthAdjust="spacingAndGlyphs"');
    }
  });

  it('grows with its content: a wider value yields a wider badge', () => {
    const narrow = renderBadge(reportWith({ score: 7, grade: 'F' }));
    const wide = renderBadge(reportWith({ score: 100, grade: 'A' }));
    const widthOf = (svg: string) => Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)![1]);
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow));
    // The two segments always tile the full width exactly.
    for (const svg of [narrow, wide]) {
      const [label, value] = rectWidths(svg);
      expect(label + value).toBeCloseTo(widthOf(svg), 5);
    }
  });

  it('is accessible: role, aria-label and a title carrying host and audit date', () => {
    const svg = renderBadge(reportWith({
      url: 'https://findable.bordebat.fr/fr/',
      generatedAt: '2026-07-27T09:00:00.000Z',
    }));
    expect(svg).toContain('role="img"');
    expect(svg).toMatch(/aria-label="[^"]*91\/100[^"]*"/);
    expect(svg).toContain('<title>');
    expect(svg).toContain('findable.bordebat.fr');
    expect(svg).toContain('2026-07-27');
  });

  it('omits the date when the report has none, rather than inventing one', () => {
    const svg = renderBadge(reportWith());
    expect(svg).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('escapes a hostile URL instead of breaking out of the markup', () => {
    const svg = renderBadge(reportWith({ url: 'https://ex"><script>alert(1)</script>.com/' }));
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('is byte-identical across calls (no date, no randomness)', () => {
    const r = reportWith({ generatedAt: '2026-07-27T09:00:00.000Z' });
    expect(renderBadge(r)).toBe(renderBadge(r));
  });

  it('clamps and rounds a score outside or between the integers', () => {
    expect(renderBadge(reportWith({ score: 91.4 }))).toContain('>A 91/100<');
    expect(renderBadge(reportWith({ score: -5, grade: 'F' }))).toContain('>F 0/100<');
    expect(renderBadge(reportWith({ score: 140, grade: 'A' }))).toContain('>A 100/100<');
  });
});
