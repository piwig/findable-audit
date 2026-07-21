import { describe, it, expect } from 'vitest';
import { verdictOf } from '../../src/report/verdict.js';

describe('verdictOf', () => {
  it('varies by grade and failing-check count', () => {
    expect(verdictOf('A', 0)).toMatch(/Excellent/i);
    expect(verdictOf('B', 3)).toMatch(/3/);
    expect(verdictOf('F', 5)).toMatch(/critique/i);
  });
});
