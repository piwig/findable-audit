import { describe, it, expect } from 'vitest';
import { renderScoreGauge, renderPriorityBars, renderCompareChart, renderImpactEffortScatter, COMPARE_SERIES, type ScatterPoint } from '../../src/report/charts.js';
import { renderHtml } from '../../src/report/html.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import { renderCompareHtml } from '../../src/report/compare.js';
import { renderDiffHtmlSection, type ReportDiff } from '../../src/report/diff.js';
import type { AuditReport } from '../../src/runner.js';
import type { FamilyScore } from '../../src/scoring.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// Points lost (max - earned): llm-content 10, technical-seo 2, security 2,
// structured-data 0. Ties (technical-seo / security) must keep canonical order.
const familyScores: FamilyScore[] = [
  { family: 'llm-content', score: 0, weight: 0.18, earned: 0, max: 10 },
  { family: 'structured-data', score: 100, weight: 0.15, earned: 10, max: 10 },
  { family: 'technical-seo', score: 75, weight: 0.15, earned: 6, max: 8 },
  { family: 'security', score: 50, weight: 0.07, earned: 2, max: 4 },
];

const report: AuditReport = {
  url: 'https://example.com/',
  score: 72,
  grade: 'C',
  familyScores,
  sampledPages: ['/'],
  results: [
    { id: 'llms-txt', family: 'llm-content', status: 'fail', points: 0, maxPoints: 10,
      message: 'llms.txt missing', fix: 'Add a /llms.txt file.' },
  ],
};

function rep(url: string, score: number, fams: Array<[FamilyScore['family'], number]>): AuditReport {
  return {
    url, score, grade: score >= 90 ? 'A' : score >= 80 ? 'B' : 'C',
    familyScores: fams.map(([family, s]) => ({ family, score: s, weight: 0.1, earned: s, max: 100 })),
    sampledPages: ['/'], results: [],
  };
}

// ---------------------------------------------------------------------------
// Score gauge (donut)
// ---------------------------------------------------------------------------
describe('renderScoreGauge', () => {
  it('renders a deterministic donut arc via pathLength=100 + integer dasharray', () => {
    const svg = renderScoreGauge(72, 'C', 'en');
    expect(svg).toContain('pathLength="100"');
    expect(svg).toContain('stroke-dasharray="72 28"');
    expect(svg).toContain('stroke-dashoffset="25"'); // starts at 12 o'clock
    expect(renderScoreGauge(72, 'C', 'en')).toBe(svg); // same input -> same markup
  });
  it('colors the arc by status band (>=80 green, 60-79 amber, <60 red)', () => {
    expect(renderScoreGauge(80, 'B', 'en')).toContain('stroke="#1a7f37"');
    expect(renderScoreGauge(72, 'C', 'en')).toContain('stroke="#9a6700"');
    expect(renderScoreGauge(59, 'F', 'en')).toContain('stroke="#b42318"');
  });
  it('omits the value arc entirely at score 0 (no rounded-cap dot artifact)', () => {
    const svg = renderScoreGauge(0, 'F', 'en');
    expect(svg).not.toContain('stroke-dasharray');
    expect(svg).toContain('stroke="var(--track, #eee)"'); // track still present
  });
  it('is accessible: role=img + localized aria-label + <title>, number in ink not series color', () => {
    const en = renderScoreGauge(72, 'C', 'en');
    expect(en).toMatch(/<svg[^>]*role="img"/);
    expect(en).toContain('aria-label="Overall score: 72 out of 100 — grade C"');
    expect(en).toContain('<title>Overall score: 72 out of 100 — grade C</title>');
    // The hero number wears a text token, not a series colour. The token is a
    // CSS variable so the dark theme flips it, with the light value as fallback
    // for a chart lifted out of the document.
    expect(en).toContain('fill="var(--ink, #1a1a1a)">72</text>');
    const fr = renderScoreGauge(72, 'C', 'fr');
    expect(fr).toContain('aria-label="Score global : 72 sur 100 — note C"');
  });
  it('clamps and rounds out-of-range / fractional scores', () => {
    expect(renderScoreGauge(101, 'A', 'en')).toContain('stroke-dasharray="100 0"');
    expect(renderScoreGauge(71.6, 'C', 'en')).toContain('stroke-dasharray="72 28"');
  });
});

// ---------------------------------------------------------------------------
// Priority bars (points lost per family)
// ---------------------------------------------------------------------------
describe('renderPriorityBars', () => {
  const svg = renderPriorityBars(familyScores, 'en');

  it('sorts rows by points lost descending, ties broken by canonical family order', () => {
    const at = (label: string) => svg.indexOf(label);
    // lost: llm-content 10 > technical-seo 2 = security 2 > structured-data 0
    expect(at('Answer-engine content')).toBeGreaterThan(-1);
    // labels are HTML-escaped in the markup (mirrors renderHtml's convention)
    expect(at('Answer-engine content')).toBeLessThan(at('Technical SEO'));
    expect(at('Technical SEO')).toBeLessThan(at('Security &amp; trust'));
    expect(at('Security &amp; trust')).toBeLessThan(at('Structured data &amp; metadata'));
  });
  it('scales bar width to points lost (max lost = full 330px zone)', () => {
    expect(svg).toContain('h326'); // llm-content: 330px wide bar, rounded 4px data-end
    expect(svg).toContain('h62');  // lost 2 -> round(2/10*330)=66 -> path h62
    expect(svg).toContain('width="330"'); // full-scale track behind every bar
  });
  it('colors bars by the family score status band', () => {
    expect(svg).toContain('fill="#b42318"'); // llm-content 0 & security 50
    expect(svg).toContain('fill="#9a6700"'); // technical-seo 75
  });
  it('direct-labels the bar tip with points lost and the right edge with the subscore', () => {
    expect(svg).toContain('−10 pts');
    expect(svg).toContain('>0/100</text>');
    expect(svg).toContain('>75/100</text>');
  });
  it('gives every row a native tooltip <title> with the full family label', () => {
    expect(svg).toMatch(/<g><title>Answer-engine content[^<]*<\/title>/);
  });
  it('renders tracks only (no bars, no minus labels) when nothing is lost', () => {
    const perfect = renderPriorityBars(
      [{ family: 'security', score: 100, weight: 0.07, earned: 4, max: 4 }], 'en');
    expect(perfect).toContain('width="330"'); // track
    expect(perfect).not.toContain('−');
    expect(perfect).not.toContain('<path');
  });
  it('is deterministic and localized', () => {
    expect(renderPriorityBars(familyScores, 'en')).toBe(svg);
    const fr = renderPriorityBars(familyScores, 'fr');
    expect(fr).toContain('Contenu moteur de réponse');
    expect(fr).toContain('aria-label="Où regagner des points"');
  });
});

describe('renderImpactEffortScatter', () => {
  const points: ScatterPoint[] = [
    { id: 'ai-crawlers-allowed', label: 'AI crawlers allowed', impact: 10, effort: 'quick', status: 'fail' },
    { id: 'content-depth', label: 'Content depth', impact: 6, effort: 'moderate', status: 'warn' },
    { id: 'content-without-js', label: 'Content without JS', impact: 4, effort: 'involved', status: 'fail' },
  ];

  it('returns an empty string when there is nothing to plot', () => {
    expect(renderImpactEffortScatter([], 'en')).toBe('');
  });

  it('plots one dot per point, colored by status', () => {
    const svg = renderImpactEffortScatter(points, 'en');
    expect((svg.match(/<circle/g) ?? []).length).toBe(3);
    expect(svg).toContain('fill="#b42318"'); // fail
    expect(svg).toContain('fill="#9a6700"'); // warn
  });

  it('gives every dot a native tooltip <title> naming the check, points and effort', () => {
    const svg = renderImpactEffortScatter(points, 'en');
    expect(svg).toContain('<title>AI crawlers allowed — +10 pts (Quick win)</title>');
  });

  it('labels the three fixed effort lanes on the X axis', () => {
    const svg = renderImpactEffortScatter(points, 'en');
    expect(svg).toContain('>Quick win<');
    expect(svg).toContain('>Moderate<');
    expect(svg).toContain('>Involved<');
  });

  it('dodges two points sharing the same lane and a close impact so neither hides the other', () => {
    const overlapping: ScatterPoint[] = [
      { id: 'a', label: 'A', impact: 5, effort: 'quick', status: 'fail' },
      { id: 'b', label: 'B', impact: 5, effort: 'quick', status: 'warn' },
    ];
    const svg = renderImpactEffortScatter(overlapping, 'en');
    const xs = [...svg.matchAll(/cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBe(2);
    expect(xs[0]).not.toBe(xs[1]);
  });

  it('is deterministic and localized', () => {
    const svg = renderImpactEffortScatter(points, 'en');
    expect(renderImpactEffortScatter(points, 'en')).toBe(svg);
    const fr = renderImpactEffortScatter(points, 'fr');
    expect(fr).toContain('aria-label="Impact vs effort : 3 contrôles à corriger, positionnés selon les points récupérables et l&#39;effort estimé"');
  });
});

// ---------------------------------------------------------------------------
// Compare chart (grouped bars, fixed categorical series)
// ---------------------------------------------------------------------------
describe('renderCompareChart', () => {
  const you = rep('https://you.example/', 72, [['llm-content', 40], ['security', 50]]);
  const rival = rep('https://rival.example/', 81, [['llm-content', 60]]);
  const html = renderCompareChart([you, rival], 'en');

  it('assigns fixed series colors in entity order (you always green first)', () => {
    expect(COMPARE_SERIES).toEqual(['#1a7f37', '#2a78d6', '#4a3aa7']);
    expect(html).toContain('fill="#1a7f37"');
    expect(html).toContain('fill="#2a78d6"');
    expect(html.indexOf('#1a7f37')).toBeLessThan(html.indexOf('#2a78d6'));
  });
  it('scales bars on a fixed 0-100 -> 330px axis and labels each tip with the score', () => {
    expect(html).toContain('h128'); // you llm-content: round(40/100*330)=132 -> h128 + 4px cap
    expect(html).toContain('h194'); // rival llm-content: 198 -> h194
    expect(html).toContain('>40</text>');
    expect(html).toContain('>60</text>');
  });
  it('separates bars of a group with a 2px surface gap (10px bars, 12px pitch)', () => {
    const ys = [...html.matchAll(/<path d="M150 (\d+)/g)].map((m2) => Number(m2[1]));
    const llmRow = ys.slice(0, 2);
    expect(llmRow[1] - llmRow[0]).toBe(12);
  });
  it('skips the bar (not the row) for a family missing from one site', () => {
    // security row exists (you has it) but carries a single bar
    expect(html).toContain('Security &amp; trust');
    expect((html.match(/<path /g) ?? []).length).toBe(3); // 2 llm bars + 1 security bar
  });
  it('renders a mandatory legend with escaped hosts and the "(You)" marker', () => {
    expect(html).toContain('you.example (You)');
    expect(html).toContain('rival.example');
    expect(html).toContain('background:#1a7f37');
    const evil = renderCompareChart([rep('nope <x> url', 10, [['security', 10]]), rival], 'en');
    expect(evil).toContain('nope &lt;x&gt; url');
    expect(evil).not.toContain('<x>');
  });
  it('is accessible, localized and deterministic', () => {
    expect(html).toMatch(/<svg[^>]*role="img"/);
    expect(html).toContain('aria-label="Family scores by site"');
    expect(renderCompareChart([you, rival], 'en')).toBe(html);
    expect(renderCompareChart([you, rival], 'fr')).toContain('you.example (Vous)');
  });
  it('refuses to cycle hues: more than 3 sites -> no chart (table remains the view)', () => {
    const four = [you, rival, rep('https://a.example/', 1, [['security', 1]]), rep('https://b.example/', 2, [['security', 2]])];
    expect(renderCompareChart(four, 'en')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Baseline delta indicators (▲/▼/=)
// ---------------------------------------------------------------------------
describe('renderDiffHtmlSection delta indicators', () => {
  const diff: ReportDiff = {
    baselineScore: 70, currentScore: 74, scoreDelta: 4,
    familyDeltas: [
      { family: 'security', baseline: 50, current: 54, delta: 4 },
      { family: 'llm-content', baseline: 40, current: 37, delta: -3 },
      { family: 'technical-seo', baseline: 75, current: 75, delta: 0 },
    ],
    regressions: [], improvements: [], added: [], removed: [],
  };
  const html = renderDiffHtmlSection(diff, 'en');

  it('marks up ▲ (up, teal), ▼ (down, red) and = (flat, gray) next to the signed number', () => {
    expect(html).toMatch(/color:#0f766e"[^>]*aria-hidden="true">▲<\/span> \+4/);
    expect(html).toMatch(/color:#b91c1c"[^>]*aria-hidden="true">▼<\/span> -3/);
    expect(html).toMatch(/color:#6b7280"[^>]*aria-hidden="true">=<\/span> 0/);
  });
  it('keeps the glyph decorative (aria-hidden) and the number as the text channel', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('+4'); // signed values still present
  });
  it('prepends the arrow to the overall score delta too', () => {
    expect(html).toMatch(/▲<\/span> \(\+4\)|\(<span[^>]*>▲<\/span> \+4\)/);
  });
});

// ---------------------------------------------------------------------------
// Integration: report + compare documents
// ---------------------------------------------------------------------------
describe('report integration', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'));

  it('puts the gauge in the verdict card and the priority bars in the folded breakdown', () => {
    // Layer 1 carries exactly ONE score visual: the gauge, inside the hero.
    expect(html).toMatch(/<header class="hero">\s*<svg class="viz-gauge"/);
    expect(html).toContain('stroke-dasharray="72 28"');
    // The bars moved down into the 8-family breakdown, which is folded by default.
    expect(html).toMatch(/<details class="breakdown">[\s\S]*Where to regain points/);
  });
  it('shows the score exactly once as a visual, and keeps the subscore table', () => {
    // The old hero pastille duplicated the gauge's number — it is gone.
    expect(html).not.toContain('hero-score');
    expect((html.match(/class="viz-gauge"/g) ?? []).length).toBe(1);
    expect(html).toContain('class="subscore-table"');
  });
  it('omits the family breakdown when familyScores is empty, but keeps the verdict gauge', () => {
    const none = renderHtml({ ...report, familyScores: [] }, new Date('2026-07-20T00:00:00Z'));
    expect(none).not.toContain('<details class="breakdown">');
    expect(none).not.toContain('Where to regain points');
    // The overall score still exists, so layer 1 still shows it.
    expect(none).toContain('class="viz-gauge"');
  });
  it('renders in French', () => {
    const fr = renderHtml(report, new Date('2026-07-20T00:00:00Z'), 'fr');
    expect(fr).toContain('aria-label="Score global : 72 sur 100 — note C"');
    expect(fr).toContain('Où regagner des points');
  });
  it('leaves the markdown report byte-unchanged (HTML-only feature)', () => {
    expect(renderMarkdown(report, new Date('2026-07-20T00:00:00Z'))).not.toContain('svg');
  });
  it('embeds the grouped chart + legend in the compare document', () => {
    const you = rep('https://you.example/', 72, [['llm-content', 40]]);
    const rival = rep('https://rival.example/', 81, [['llm-content', 60]]);
    const cmp = renderCompareHtml([you, rival], new Date('2026-07-20T00:00:00Z'));
    expect(cmp).toContain('aria-label="Family scores by site"');
    expect(cmp).toContain('you.example (You)');
    expect(cmp.indexOf('role="img"')).toBeLessThan(cmp.indexOf('<table')); // chart above the table view
  });
});
