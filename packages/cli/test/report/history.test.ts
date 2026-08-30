import { describe, it, expect } from 'vitest';
import { parseHistory, appendHistory, renderSparklineSvg, checkTransitions, HISTORY_MAX_ENTRIES, type HistoryEntry } from '../../src/report/history.js';
import { renderHtml } from '../../src/report/html.js';
import type { AuditReport } from '../../src/runner.js';

function report(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://ex.com/',
    score: 70,
    grade: 'C',
    familyScores: [{ family: 'ai-access', score: 70, weight: 0.2, earned: 14, max: 20 }],
    sampledPages: ['/'],
    results: [],
    ...over,
  };
}

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { date: '2026-08-01T00:00:00.000Z', url: 'https://ex.com/', score: 70, families: { 'ai-access': 70 }, ...over };
}

describe('parseHistory', () => {
  it('round-trips a valid series', () => {
    const series = [entry(), entry({ score: 75 })];
    expect(parseHistory(JSON.stringify(series))).toEqual(series);
  });

  it('accepts an empty array (fresh series)', () => {
    expect(parseHistory('[]')).toEqual([]);
  });

  it('throws on JSON that is not an array', () => {
    expect(() => parseHistory('{"foo":1}')).toThrow(/array/i);
  });

  it('throws on entries missing the required shape (foreign JSON is refused)', () => {
    expect(() => parseHistory(JSON.stringify([{ name: 'not-a-history' }]))).toThrow(/date, url, score/);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseHistory('not json')).toThrow();
  });

  it('accepts entries without checks (pre-A100 series) but refuses a non-object checks', () => {
    expect(parseHistory(JSON.stringify([entry()]))).toHaveLength(1);
    expect(() => parseHistory(JSON.stringify([entry({ checks: 'nope' as never })]))).toThrow(/checks/);
    expect(() => parseHistory(JSON.stringify([entry({ checks: [1] as never })]))).toThrow(/checks/);
  });
});

describe('checkTransitions', () => {
  it('returns empty when fewer than 2 entries carry checks', () => {
    expect(checkTransitions([])).toEqual([]);
    expect(checkTransitions([entry({ checks: { a: 'pass' } })])).toEqual([]);
    expect(checkTransitions([entry(), entry({ checks: { a: 'pass' } })])).toEqual([]);
  });

  it('reports regressions first, then improvements, alphabetically', () => {
    const series = [
      entry({ checks: { up: 'fail', down: 'pass', same: 'pass', bad2: 'pass' } }),
      entry({ checks: { up: 'pass', down: 'warn', same: 'pass', bad2: 'fail' } }),
    ];
    expect(checkTransitions(series)).toEqual([
      { id: 'bad2', from: 'pass', to: 'fail', regressed: true },
      { id: 'down', from: 'pass', to: 'warn', regressed: true },
      { id: 'up', from: 'fail', to: 'pass', regressed: false },
    ]);
  });

  it('ignores checks present on only one side (tooling change, not site change)', () => {
    const series = [
      entry({ checks: { gone: 'pass', stays: 'pass' } }),
      entry({ checks: { added: 'fail', stays: 'pass' } }),
    ];
    expect(checkTransitions(series)).toEqual([]);
  });

  it('compares the last two entries that have checks, skipping older ones in between', () => {
    const series = [
      entry({ checks: { a: 'pass' } }),
      entry(), // pre-A100 run in the middle
      entry({ checks: { a: 'fail' } }),
    ];
    expect(checkTransitions(series)).toEqual([{ id: 'a', from: 'pass', to: 'fail', regressed: true }]);
  });
});

describe('appendHistory', () => {
  it('appends date, url, overall score and per-family subscores', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const next = appendHistory([], report({ score: 81 }), now);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      date: '2026-08-01T12:00:00.000Z',
      url: 'https://ex.com/',
      score: 81,
      families: { 'ai-access': 70 },
      checks: {},
    });
  });

  it('records the status of every check (A100)', () => {
    const r = report({
      results: [
        { id: 'robots-ai', status: 'pass' },
        { id: 'llms-txt', status: 'fail' },
      ] as AuditReport['results'],
    });
    const next = appendHistory([], r, new Date());
    expect(next[0].checks).toEqual({ 'robots-ai': 'pass', 'llms-txt': 'fail' });
  });

  it('does not mutate the prior series', () => {
    const prior = [entry()];
    appendHistory(prior, report(), new Date());
    expect(prior).toHaveLength(1);
  });

  it(`caps the series at ${HISTORY_MAX_ENTRIES} entries, dropping the oldest first`, () => {
    const prior = Array.from({ length: HISTORY_MAX_ENTRIES }, (_, i) => entry({ score: i % 100 }));
    const next = appendHistory(prior, report({ score: 99 }), new Date());
    expect(next).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(next[0]).toEqual(prior[1]); // oldest dropped
    expect(next[next.length - 1].score).toBe(99);
  });
});

describe('renderSparklineSvg', () => {
  it('returns empty for fewer than 2 points', () => {
    expect(renderSparklineSvg([])).toBe('');
    expect(renderSparklineSvg([50])).toBe('');
  });

  it('renders a polyline with one coordinate pair per value and an end dot', () => {
    const svg = renderSparklineSvg([10, 50, 90]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<circle');
    const pts = /points="([^"]+)"/.exec(svg);
    expect(pts).not.toBeNull();
    expect(pts![1].split(' ')).toHaveLength(3);
  });

  it('clamps out-of-range values into the 0-100 viewport', () => {
    const svg = renderSparklineSvg([-20, 500], { width: 100, height: 20 });
    for (const [, yv] of [...svg.matchAll(/,\s*([\d.]+)/g)]) {
      expect(Number(yv)).toBeGreaterThanOrEqual(0);
      expect(Number(yv)).toBeLessThanOrEqual(20);
    }
  });
});

describe('renderHtml with --history', () => {
  it('shows no trends section without history or with a single run', () => {
    expect(renderHtml(report(), new Date(), 'en')).not.toContain('class="trends"');
    expect(renderHtml(report(), new Date(), 'en', { history: [entry()] })).not.toContain('class="trends"');
  });

  it('renders sparklines (overall + family) once the series holds 2+ runs of the same url', () => {
    const history = [entry({ score: 60 }), entry({ score: 70 })];
    const html = renderHtml(report(), new Date(), 'en', { history });
    expect(html).toContain('class="trends"');
    expect(html).toContain('Score over time');
    expect(html).toContain('2 audits in this series');
    expect((html.match(/class="spark"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('ignores history entries for other urls', () => {
    const history = [entry({ url: 'https://other.com/' }), entry({ url: 'https://other.com/' }), entry()];
    const html = renderHtml(report(), new Date(), 'en', { history });
    expect(html).not.toContain('class="trends"');
  });

  it('localises the section in French', () => {
    const history = [entry({ score: 60 }), entry({ score: 70 })];
    const html = renderHtml(report(), new Date(), 'fr', { history });
    expect(html).toContain('Score dans le temps');
    expect(html).toContain('2 audits dans cette série');
  });

  it('lists per-check changes when the two latest runs carry checks (A100)', () => {
    const history = [
      entry({ checks: { 'llms-txt': 'pass', 'robots-ai': 'pass' } }),
      entry({ checks: { 'llms-txt': 'fail', 'robots-ai': 'pass' } }),
    ];
    const html = renderHtml(report(), new Date(), 'en', { history });
    expect(html).toContain('Changed since the previous audit');
    expect(html).toContain('trend-worse');
    expect(html).toContain('llms-txt');
    expect(html).not.toContain('robots-ai</code>');
  });

  it('says so when checks are tracked but nothing moved', () => {
    const history = [
      entry({ checks: { 'llms-txt': 'pass' } }),
      entry({ checks: { 'llms-txt': 'pass' } }),
    ];
    const html = renderHtml(report(), new Date(), 'en', { history });
    expect(html).toContain('No check changed status since the previous audit.');
  });

  it('keeps the pre-A100 output for series without checks', () => {
    const history = [entry({ score: 60 }), entry({ score: 70 })];
    const html = renderHtml(report(), new Date(), 'en', { history });
    expect(html).not.toContain('Changed since the previous audit');
    expect(html).not.toContain('No check changed status');
  });
});
