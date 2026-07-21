import { describe, it, expect } from 'vitest';
import { verdictOf } from '../../src/report/verdict.js';

describe('verdictOf', () => {
  it('varies by grade and failing-check count', () => {
    expect(verdictOf('A', 0)).toMatch(/Excellent/i);
    expect(verdictOf('B', 3)).toMatch(/3/);
    expect(verdictOf('F', 5, 'fr')).toMatch(/critique/i);
  });

  it('defaults to English', () => {
    expect(verdictOf('C', 2)).toMatch(/priority/);
    expect(verdictOf('A', 0)).toMatch(/Excellent/);
    expect(verdictOf('F', 3)).toMatch(/Foundations/);
  });

  it('renders French when asked', () => {
    expect(verdictOf('C', 2, 'fr')).toMatch(/priorité/);
    expect(verdictOf('D', 1, 'fr')).toMatch(/Fragile/);
    expect(verdictOf('F', 3, 'fr')).toMatch(/Fondations/);
  });
});
