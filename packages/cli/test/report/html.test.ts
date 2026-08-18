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
      message: 'llms.txt missing', messageTemplate: 'llms.txt missing', messageParams: [],
      fix: 'Add a /llms.txt file.', docUrl: 'https://llmstxt.org/' },
    { id: 'json-ld', family: 'structured-data', status: 'pass', points: 10, maxPoints: 10,
      message: '1 valid JSON-LD block(s)', messageTemplate: '{0} valid JSON-LD block(s)', messageParams: [1] },
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
  it('renders each family as an OPEN <details> by default (printable) with a summary + status dot', () => {
    expect(html).toMatch(/<details class="fam" open>/);
    expect(html).toContain('<summary class="fam-sum">');
    expect(html).toContain('class="fam-dot'); // worst-status indicator on the summary
  });
  it('keeps the family label a heading and gives the status dot a text alternative (a11y)', () => {
    // a heading inside <summary> preserves screen-reader heading navigation
    expect(html).toMatch(/<summary class="fam-sum"><h2>/);
    // the colour dot is not colour-only: role=img + an accessible name
    expect(html).toMatch(/class="fam-dot (bad|ok|good)" role="img" aria-label="[^"]+"/);
  });
  it('collapses families (closed <details>) when collapsed:true', () => {
    const collapsed = renderHtml(report, new Date('2026-07-20T00:00:00Z'), 'en', { collapsed: true });
    expect(collapsed).toContain('<details class="fam">'); // no `open`
    expect(collapsed).not.toMatch(/<details class="fam" open>/);
    expect(collapsed).toContain('<summary class="fam-sum">');
    expect(collapsed).toContain('Answer-engine content'); // family label still present (in the summary)
  });
  it('shows an inline (self-contained) logomark in the report title', () => {
    // the logomark is an inline SVG next to the title — no external asset, no data URI
    expect(html).toMatch(/<h1 class="report-h1"><svg[^>]*viewBox="0 0 32 32"/);
    expect(html).toContain('linearGradient');
    expect(html).not.toMatch(/<img\b/i); // logo must not be a raster/external image
  });
  it('is responsive (viewport meta + a mobile media query that stacks the hero)', () => {
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toMatch(/@media\s*\(max-width:\s*640px\)/);
    // the mobile block stacks the hero vertically — `flex-direction: column`
    // appears only inside that block (the base .hero defaults to row).
    expect(html).toMatch(/flex-direction:\s*column/);
    // and it breaks long space-less tokens (e.g. the audited URL) so they don't
    // force horizontal scroll on phones — `overflow-wrap: anywhere` on body.
    expect(html).toMatch(/body\s*\{[^}]*overflow-wrap:\s*anywhere/);
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
  it('states the verdict in plain language, not an adjective, plus a stats line', () => {
    // The weakest axis here is "understood" (llm-content 0, structured-data 100),
    // and it is under 60 -> the strong wording of that axis.
    expect(html).toContain('class="hero"');
    expect(html).toMatch(/it can describe you, it cannot cite you/);
    expect(html).toMatch(/2 to fix/);          // 1 fail + 1 warn ('evil') => 2
  });
  it('regroups the eight families into three reader-facing axes', () => {
    expect(html).toContain('class="axes"');
    for (const axis of ['Reachable', 'Understood', 'Usable']) expect(html).toContain(axis);
    // ai-access / technical-seo are absent from this fixture -> that axis is n/a,
    // never a misleading 0.
    expect(html).toMatch(/<div class="axis-score">n\/a<\/div>/);
  });
  it('offers four anchors in a sticky bar (no JS)', () => {
    expect(html).toContain('class="tocbar"');
    for (const id of ['#verdict', '#plan', '#cwv', '#detail']) expect(html).toContain(`href="${id}"`);
    expect(html).toMatch(/position:\s*sticky/);
  });
  it('groups the action plan into effort lanes with a real score projection', () => {
    expect(html).toContain('Action plan');
    expect(html).toContain('class="lane"');
    expect(html).toMatch(/Quick wins|Moderate|Bigger projects/); // llms-txt=Moderate, evil=Quick win
    expect(html).toContain('Add a /llms.txt file.');             // the fix text
    expect(html).toMatch(/\+\d+ pts/);                           // impact badge
    // The projection is the recomputed score, not a point sum: fixing llms-txt
    // alone (llm-content 0 -> 10/10) re-blends the weighted subscores to 91.
    expect(html).toContain('the 1 of them: 72 → 91 (A)');
  });
  it('names the offending paths on a plan item (says WHERE, not only what)', () => {
    const withPaths = renderHtml({
      ...report,
      results: [{ ...report.results[0], message: 'no <h1> on /a and /b/c' }],
    }, new Date('2026-07-20T00:00:00Z'));
    expect(withPaths).toContain('class="ap-where"');
    expect(withPaths).toContain('<code>/a</code>');
    expect(withPaths).toContain('<code>/b/c</code>');
  });
  it('carries a ready-to-paste snippet in the per-item "how to do it"', () => {
    expect(html).toContain('class="ap-how"');
    expect(html).toContain('How to do it');
    expect(html).toContain('class="snippet"');  // llms-txt has a catalogued snippet
  });
  it('adds a doc link next to the fix in the per-family check table', () => {
    // llms-txt is a failing llm-content check -> family fallback docUrl (llmstxt.org)
    expect(html).toMatch(/class="fix">Add a \/llms\.txt file\.[\s\S]*?href="https:\/\/llmstxt\.org\/"/);
  });
});

describe('renderHtml layer 3 — the detail', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'));

  it('leads each row with the human title and demotes the technical id to a tag', () => {
    expect(html).toContain('<span class="ck-title">The /llms.txt orientation file</span>');
    expect(html).toContain('<code class="ck-id">llms-txt</code>');
  });
  it('folds the passing checks behind a disclosure that counts them', () => {
    // structured-data has exactly one passing check (json-ld) in this fixture.
    expect(html).toContain('<details class="pass-list">');
    expect(html).toContain('Show the 1 passing check');
    // …and a family with no issue at all says so rather than showing an empty table.
    expect(html).toContain('class="fam-none"');
  });
  it('folds the 8-family breakdown rather than leading with it', () => {
    expect(html).toMatch(/<details class="breakdown">\s*<summary>The detail of the 8 scoring families/);
  });
});

describe('renderHtml theming', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'));

  it('ships a dark theme driven by the same tokens as the charts', () => {
    expect(html).toContain('color-scheme: light dark');
    expect(html).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    // The gauge reads the report's tokens, so it flips with the page.
    expect(html).toContain('var(--ink, #1a1a1a)');
  });
  it('does not tint the whole page with the grade colour', () => {
    // Only status-bearing elements carry a band class; the verdict card itself
    // is neutral (its background is the panel token, not the grade colour).
    expect(html).toMatch(/\.hero \{[^}]*background: var\(--panel\)/);
  });
});

describe('renderHtml stats line', () => {
  it('agrees with itself on the page plural (1 page, not "1 pages")', () => {
    const one = renderHtml({ ...report, sampledPages: ['/'] }, new Date('2026-07-20T00:00:00Z'));
    expect(one).toContain('1 page<');
    expect(one).not.toContain('1 pages');
    const two = renderHtml(report, new Date('2026-07-20T00:00:00Z'));
    expect(two).toContain('2 pages');
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
    expect(html).toMatch(/il peut vous décrire, pas vous citer/); // FR verdict sentence
    expect(html).toMatch(/2 à corriger/);          // FR stats
    expect(html).toContain('Sous-scores par catégorie');
    expect(html).toContain("Plan d'action");
    expect(html).toContain('Compréhensible');      // FR axis label
    expect(html).toMatch(/Rapide|Modéré|Chantier/); // FR effort lanes
    expect(html).toContain('Pages auditées :');
    expect(html).toContain('En savoir plus →');
  });
  it('localizes the message, the fix and adds a French "why" per check', () => {
    // The dynamic message is rebuilt in French from its template (#1, lot E).
    expect(html).toContain('llms.txt absent');
    expect(html).not.toContain('llms.txt missing');
    // An interpolated message keeps its values while the wording changes.
    expect(html).toContain('1 bloc(s) JSON-LD valides');
    // The fix is now translated on a French report (#1/#53) — no English fix leak.
    expect(html).toContain('Ajoutez un fichier /llms.txt');
    expect(html).not.toContain('Add a /llms.txt file.');
    // A French "why this matters" line is shown for catalogued checks.
    expect(html).toMatch(/class="why"/);
    expect(html).toMatch(/Vérifie que \/llms\.txt/);
  });
});

describe('renderHtml — entity graph section (#58)', () => {
  const withGraph: AuditReport = {
    ...report,
    entityGraph: {
      nodes: [
        { id: '#org', types: ['Organization'], name: 'Acme', pages: ['/'], synthetic: false },
        { id: '#site', types: ['WebSite'], name: 'acme.com', pages: ['/'], synthetic: false },
        { id: '#ghost', types: [], pages: [], synthetic: true },
      ],
      edges: [
        { from: '#site', to: '#org', property: 'publisher' },
        { from: '#org', to: '#ghost', property: 'parentOrganization' },
      ],
      stats: { nodes: 3, edges: 2, danglingRefs: 1, components: 1 },
    },
  };

  it('draws the graph when the report carries one', () => {
    const html = renderHtml(withGraph, new Date('2026-07-27T00:00:00Z'));
    expect(html).toContain('class="eg"');
    expect(html).toContain('class="eg-svg"');
    expect(html).toContain('Acme');
  });

  it('legends the dangling reference it just drew', () => {
    const html = renderHtml(withGraph, new Date('2026-07-27T00:00:00Z'));
    expect(html).toContain('eg-legend');
    expect(html).toContain('eg-node-broken');
  });

  it('warns when the graph is not one connected whole', () => {
    const split = { ...withGraph, entityGraph: { ...withGraph.entityGraph!, stats: { ...withGraph.entityGraph!.stats, components: 2 } } };
    expect(renderHtml(split, new Date('2026-07-27T00:00:00Z'))).toMatch(/eg-note/);
  });

  it('omits the whole section when the audit carries no graph', () => {
    const html = renderHtml(report, new Date('2026-07-27T00:00:00Z'));
    expect(html).not.toContain('<div class="eg">');
    // The stylesheet always ships every rule; it is the markup that must be absent.
    expect(html).not.toContain('<svg class="eg-svg"');
  });

  it('translates the section heading', () => {
    const fr = renderHtml(withGraph, new Date('2026-07-27T00:00:00Z'), 'fr');
    expect(fr).toContain("Graphe d&#39;entités");
  });
});

describe('renderHtml — A52 accessibility/performance cross-link', () => {
  const withBoth: AuditReport = {
    ...report,
    results: [
      ...report.results,
      { id: 'contrast', family: 'accessibility', status: 'fail', points: 0, maxPoints: 4,
        message: 'low contrast text', messageTemplate: 'low contrast text', messageParams: [],
        fix: 'Raise the contrast ratio.' },
      { id: 'page-weight', family: 'performance', status: 'warn', points: 1, maxPoints: 4,
        message: 'heavy page', messageTemplate: 'heavy page', messageParams: [],
        fix: 'Trim page weight.' },
    ],
  };

  it('adds a note in the accessibility section when performance also has open issues', () => {
    const html = renderHtml(withBoth, new Date('2026-07-20T00:00:00Z'));
    expect(html).toContain('<p class="fam-cross-link">');
    expect(html).toContain('overlap with accessibility');
  });

  it('omits the note when performance has no open issues', () => {
    const onlyA11y: AuditReport = {
      ...report,
      results: [
        ...report.results,
        { id: 'contrast', family: 'accessibility', status: 'fail', points: 0, maxPoints: 4,
          message: 'low contrast text', messageTemplate: 'low contrast text', messageParams: [],
          fix: 'Raise the contrast ratio.' },
      ],
    };
    expect(renderHtml(onlyA11y, new Date('2026-07-20T00:00:00Z'))).not.toContain('overlap with accessibility');
  });

  it('translates the note in French', () => {
    const fr = renderHtml(withBoth, new Date('2026-07-20T00:00:00Z'), 'fr');
    expect(fr).toContain('fam-cross-link');
    expect(fr).toContain('recoupe');
  });
});
