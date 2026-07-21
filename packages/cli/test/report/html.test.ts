import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../../src/report/html.js';
import { FAMILY_LABELS } from '../../src/report/terminal.js';
import { parsePsi } from '../../src/perf/psi.js';
import type { AuditReport } from '../../src/runner.js';
import type { FamilyScore } from '../../src/scoring.js';

const familyScores: FamilyScore[] = [
  { family: 'llm-content', score: 0, weight: 0.18, earned: 0, max: 10 },
  { family: 'structured-data', score: 100, weight: 0.15, earned: 10, max: 10 },
  { family: 'security', score: 50, weight: 0.07, earned: 2, max: 4 },
];

const report: AuditReport = {
  url: 'https://example.com/',
  score: 72,
  grade: 'C',
  familyScores,
  sampledPages: ['/', '/about'],
  results: [
    { id: 'llms-txt', family: 'llm-content', status: 'fail', points: 0, maxPoints: 10,
      message: 'llms.txt missing', fix: 'Add a /llms.txt file.', docUrl: 'https://llmstxt.org/' },
    { id: 'json-ld', family: 'structured-data', status: 'pass', points: 10, maxPoints: 10,
      message: '1 valid JSON-LD block(s)' },
    { id: 'evil', family: 'security', status: 'warn', points: 2, maxPoints: 4,
      message: 'weird <script>alert(1)</script> title', fix: 'Fix the <title>.' },
  ],
};

describe('renderHtml', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'));

  it('is a self-contained HTML document', () => {
    expect(html.trimStart()).toMatch(/^<!doctype html/i);
    expect(html).toContain('<style');
    expect(html).not.toContain('.badges {');
    expect(html).not.toContain('.score.good {');
  });
  it('embeds no external resource (inline only; doc <a> links allowed)', () => {
    // Forbid external embedded resources (styles, scripts, images, iframes)…
    expect(html).not.toMatch(/<(?:link|script|img|iframe|source)\b[^>]*\b(?:src|href)\s*=\s*["']https?:/i);
    // …but the only external hrefs allowed are documentation anchors.
    const externalHrefs = [...html.matchAll(/href\s*=\s*["'](https?:[^"']+)["']/gi)].map((m) => m[1]);
    for (const href of externalHrefs) {
      expect(href).toMatch(/^https:\/\/(web\.dev|developers\.google\.com|schema\.org|llmstxt\.org|developer\.mozilla\.org|www\.w3\.org|github\.com)/);
    }
  });
  it('has no inline event handlers (CSP-friendly)', () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
  it('shows the score, grade and audited URL', () => {
    expect(html).toContain('72');
    expect(html).toContain('Grade C');
    expect(html).toContain('https://example.com/');
  });
  it('shows the grade as a prominent badge colored by band (C -> amber/"ok")', () => {
    expect(html).toContain('<span class="grade ok">Grade C</span>');
  });
  it('lists every family that has results', () => {
    expect(html).toContain('Answer-engine content');
    expect(html).toContain('Structured data &amp; metadata');
    expect(html).toContain('Security &amp; trust');
  });
  it('shows a per-family subscore row (label, score, weight, bar) for every entry in familyScores', () => {
    for (const fs of familyScores) {
      // Mirror the HTML-escaping renderHtml applies to the (constant) label — these
      // labels only ever contain '&', so a literal replace is sufficient here.
      const escapedLabel = FAMILY_LABELS[fs.family].replace(/&/g, '&amp;');
      const weightPct = Math.round(fs.weight * 100);
      // Label and numeric subscore appear together within a table row.
      const rowMatch = new RegExp(
        `<tr>\\s*<td class="fam-label">${escapedLabel}</td>\\s*<td class="fam-score[^"]*">${fs.score}</td>\\s*<td class="fam-weight">${weightPct}%</td>`,
      );
      expect(html).toMatch(rowMatch);
      // The bar's width encodes the subscore, inline (no external assets/JS needed).
      expect(html).toContain(`style="width:${fs.score}%"`);
    }
  });
  it('titles the subscore summary section', () => {
    expect(html).toContain('Category subscores');
  });
  it('shows a fix for a failing check', () => {
    expect(html).toContain('Add a /llms.txt file.');
  });
  it('escapes site-derived text', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('shows a verdict line and a stats line in the hero', () => {
    // report has grade C and 1 failing check (llms-txt)
    expect(html).toMatch(/priority/i);            // verdict text for grade C
    expect(html).toContain('class="hero"');
    expect(html).toMatch(/2 to fix/);          // 1 fail + 1 warn ('evil') => 2
  });
  it('renders a prioritized action plan with severity groups and impact', () => {
    expect(html).toContain('Action plan');
    expect(html).toMatch(/Fix first/);   // fails group (llms-txt)
    expect(html).toContain('Add a /llms.txt file.');    // the fix text
    expect(html).toMatch(/\+\d+ pts/);                  // impact badge
  });
  it('adds a doc link next to the fix in the per-family check table', () => {
    // llms-txt is a failing llm-content check -> family fallback docUrl (llmstxt.org)
    expect(html).toMatch(/class="fix">Add a \/llms\.txt file\.[\s\S]*?href="https:\/\/llmstxt\.org\/"/);
  });
});

describe('renderHtml with no familyScores (edge case, e.g. every check skipped)', () => {
  const html = renderHtml({ ...report, familyScores: [] }, new Date('2026-07-20T00:00:00Z'));

  it('omits the subscore section entirely rather than rendering an empty table', () => {
    expect(html).not.toContain('Category subscores');
    expect(html).not.toContain('class="subscore-table"');
  });
});

describe('renderHtml Core Web Vitals section', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sample = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'psi-sample.json'), 'utf8'));
  it('renders the CWV dashboard when psi is present', () => {
    const html = renderHtml({ ...report, psi: parsePsi(sample, 'mobile') });
    expect(html).toContain('Core Web Vitals');
    expect(html).toContain('conic-gradient');
    expect(html).toContain('LCP');
  });
  it('shows a discreet "non mesuré" note when psi is absent', () => {
    const html = renderHtml(report); // no psi
    expect(html).toMatch(/not measured/i);
    expect(html).not.toContain('conic-gradient');
  });
});

describe('renderHtml in French', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'), 'fr');
  it('sets the document language and localizes chrome', () => {
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Rapport findable-audit');
    expect(html).toContain('<span class="grade ok">Note C</span>');
    expect(html).toMatch(/priorité/);              // FR verdict for grade C
    expect(html).toMatch(/2 à corriger/);          // FR stats
    expect(html).toContain('Sous-scores par catégorie');
    expect(html).toContain("Plan d'action");
    expect(html).toMatch(/À corriger en priorité/);
    expect(html).toMatch(/À améliorer/);
    expect(html).toContain('Pages auditées :');
    expect(html).toContain('En savoir plus →');
  });
  it('keeps the 107-check messages/fixes in English', () => {
    expect(html).toContain('llms.txt missing');
    expect(html).toContain('Add a /llms.txt file.');
  });
});
