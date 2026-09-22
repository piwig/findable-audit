import { describe, it, expect } from 'vitest';
import { verdictOf } from '../../src/report/verdict.js';

describe('verdictOf', () => {
  it('limits every grade to sampled checks without claiming visibility outcomes', () => {
    for (const grade of ['A', 'B', 'C', 'D', 'F'] as const) {
      const en = verdictOf(grade, 2, 'en');
      const fr = verdictOf(grade, 2, 'fr');
      expect(en).toContain('sample');
      expect(en).toContain('2 failed checks');
      expect(en).toContain('does not establish indexing, rankings or AI citations');
      expect(fr).toContain('échantillon');
      expect(fr).toContain('2 contrôles en échec');
      expect(fr).toContain('ne démontre ni indexation, ni classement, ni citation IA');
      expect(en + fr).not.toMatch(/top-tier|au top|holding back|freinent|pour viser A|to reach an A/);
    }
  });
  it('varies by grade and failing-check count', () => {
    expect(verdictOf('A', 0)).toContain('Strong results');
    expect(verdictOf('B', 3)).toContain('3 failed checks');
    expect(verdictOf('F', 5, 'fr')).toContain('Résultats très faibles');
  });

  it('defaults to English', () => {
    expect(verdictOf('C', 2)).toContain('Mixed results');
    expect(verdictOf('A', 0)).toContain('Strong results');
    expect(verdictOf('F', 3)).toContain('Very low results');
  });

  it('renders French when asked', () => {
    expect(verdictOf('C', 2, 'fr')).toContain('Résultats contrastés');
    expect(verdictOf('D', 1, 'fr')).toContain('Résultats faibles');
    expect(verdictOf('F', 3, 'fr')).toContain('Résultats très faibles');
  });
});
