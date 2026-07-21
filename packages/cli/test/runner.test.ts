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
    expect(report.results).toHaveLength(107);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
    const skipped = report.results.filter((r) => r.status === 'skip');
    // The 8 CWV checks (cwv-*, lab-*, lighthouse-perf) skip without --cwv (no PSI call).
    expect(skipped.map((r) => r.id).sort()).toEqual([
      'alt-descriptive', 'answer-headings', 'asset-caching', 'broken-internal-links', 'canonical-resolves', 'content-author-eeat',
      'content-freshness', 'content-uniqueness', 'cwv-assessment', 'cwv-cls', 'cwv-inp', 'cwv-lcp', 'cwv-ttfb',
      'extractable-structure', 'figure-caption', 'form-labels', 'hreflang',
      'hreflang-x-default', 'hsts', 'https', 'iframe-title', 'indexnow', 'internal-linking',
      'lab-fcp', 'lab-tbt', 'lighthouse-perf', 'mixed-content',
      'nap-consistency', 'outbound-citations', 'pagination-canonical', 'redirect-chains', 'redirect-hygiene',
      'robots-wellformed', 'schema-coverage', 'sd-article', 'sd-breadcrumb', 'sd-faq', 'sd-graph-integrity',
      'sd-localbusiness', 'sd-product', 'sd-special-types', 'sd-video', 'sd-website-searchaction',
      'sitemap-index-limits', 'sitemap-lastmod', 'sitemap-orphans', 'sitemap-urls-valid', 'trailing-slash',
      'unique-titles', 'www-consolidation',
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
