import { describe, it, expect } from 'vitest';
import { effortOf } from '../../src/report/effort.js';

describe('effortOf', () => {
  it('uses the family default when the check has no override', () => {
    expect(effortOf('an-unknown-check', 'performance')).toBe('involved');
    expect(effortOf('canonical', 'technical-seo')).toBe('quick');
    expect(effortOf('json-ld-valid', 'structured-data')).toBe('moderate');
    expect(effortOf('images-alt', 'accessibility')).toBe('quick');
  });
  it('applies per-check overrides regardless of family default', () => {
    expect(effortOf('content-without-js', 'on-page')).toBe('involved'); // needs SSR
    expect(effortOf('asset-caching', 'performance')).toBe('quick');     // quick perf-config win
    expect(effortOf('broken-internal-links', 'technical-seo')).toBe('moderate');
    expect(effortOf('open-graph', 'structured-data')).toBe('quick');
    expect(effortOf('content-depth', 'llm-content')).toBe('moderate');
  });
});
