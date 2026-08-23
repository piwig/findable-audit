import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from './helpers/server.js';
import { buildChecks } from '../src/checks/index.js';
import { runAudit, UnreachableSiteError } from '../src/runner.js';
import type { Check } from '../src/types.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });

describe('runAudit', () => {
  it('throws UnreachableSiteError for a dead host', async () => {
    await expect(runAudit('http://127.0.0.1:1', buildChecks(), { timeoutMs: 500 }))
      .rejects.toBeInstanceOf(UnreachableSiteError);
  });
  it('produces a normalized score over non-skipped checks', async () => {
    const srv = await serveFixture(path.join(fixtures, 'llm-good'));
    closers.push(srv.close);
    const report = await runAudit(srv.url, buildChecks());
    expect(report.results).toHaveLength(144);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
    const skipped = report.results.filter((r) => r.status === 'skip');
    // The 8 CWV checks (cwv-*, lab-*, lighthouse-perf) skip without --cwv (no PSI call).
    // link-equity-map skips because llm-good only samples the homepage (< 3 pages);
    // csr-content-parity and ai-serving-parity both run and pass on this fixture.
    // broken-subresources and indexing-conflicts skip on this fixture: the homepage
    // references no same-origin subresource, and the fixture ships no sitemap to
    // cross-reference against robots.txt.
    // The 4 GEO-advanced checks skip on this homepage-only fixture: freshness-coherence
    // (< 2 freshness sources), hedging-rate/chunk-boundary (no substantial page) and
    // answer-units (no pillar page ≥300 words). Of the LOT 5 pair, chunk-retrieval-sim
    // skips for the same reason as answer-units; injection-hygiene runs and passes.
    // The three #22 transport checks skip on a loopback fixture: it is served over plain
    // HTTP, so there is no handshake to read, and it emits no CDN/edge headers.
    // The semantic pair skips too: keyword-cannibalization needs 2 pages, and this
    // homepage carries neither 3 title/H1 topic words nor 100 words of prose.
    // llm-good ships no JSON-LD at all, so the two structured-data overlays have nothing
    // to grade: rich-result-eligibility (no Google-documented type) and sd-page-entity
    // (no WebPage/CreativeWork node to carry `about`).
    // consistent-help skips too: llm-good only samples the homepage (< 2 pages to compare).
    expect(skipped.map((r) => r.id).sort()).toEqual([
      'alt-descriptive', 'anchor-target-profile', 'answer-headings', 'answer-units', 'asset-caching', 'broken-internal-links',
      'broken-subresources', 'canonical-resolves', 'cdn-edge-cache', 'chunk-boundary', 'chunk-retrieval-sim', 'consistent-help', 'content-author-eeat',
      'content-freshness', 'content-uniqueness', 'cwv-assessment', 'cwv-cls', 'cwv-inp', 'cwv-lcp',
      'cwv-ttfb', 'extractable-structure', 'figure-caption', 'form-labels', 'freshness-coherence', 'hedging-rate',
      'hreflang', 'hreflang-x-default', 'hsts', 'http-protocol', 'https', 'iframe-title',
      'indexing-conflicts', 'indexnow', 'internal-equity-leaks', 'internal-link-context', 'internal-linking', 'json-ld-entity',
      'json-ld-valid', 'keyword-cannibalization', 'lab-fcp', 'lab-tbt', 'lighthouse-perf', 'link-equity-map',
      'mixed-content', 'nap-consistency', 'outbound-citations', 'outbound-link-health', 'pagination-canonical', 'redirect-chains',
      'redirect-hygiene', 'rich-result-eligibility', 'robots-wellformed', 'sameas-verified', 'schema-coverage', 'sd-article',
      'sd-breadcrumb', 'sd-faq', 'sd-graph-integrity', 'sd-localbusiness', 'sd-organization', 'sd-page-entity',
      'sd-product', 'sd-special-types', 'sd-video', 'sd-website-searchaction', 'sitemap-index-limits', 'sitemap-lastmod',
      'sitemap-orphans', 'sitemap-urls-valid', 'tls-version', 'topical-focus', 'trailing-slash', 'unique-titles',
      'www-consolidation',
    ]);
  });
  it('marks a crashing check as skip and excludes it from the score', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const boom: Check = {
      id: 'boom', family: 'ai-access', maxPoints: 50,
      async run() { throw new Error('kaboom'); },
    };
    const report = await runAudit(srv.url, [...buildChecks({ indexnowKey: 'testkey123' }), boom]);
    const r = report.results.find((x) => x.id === 'boom')!;
    expect(r.status).toBe('skip');
    expect(r.points).toBe(0);
    expect(r.message).toContain('kaboom');
    // The 50 maxPoints of the crashed check must not dilute the score.
    expect(report.score).toBe(100);
  });
  it('carries psi through to the report (undefined without --cwv, no PSI call)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const report = await runAudit(srv.url, buildChecks({ indexnowKey: 'testkey123' }));
    expect('psi' in report).toBe(true);
    expect(report.psi).toBeUndefined();
  });
});
