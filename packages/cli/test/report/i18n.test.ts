import { describe, it, expect } from 'vitest';
import {
  messages, MESSAGES, FAMILY_LABELS_I18N, FAMILY_SHORT_I18N,
} from '../../src/report/i18n.js';
import type { Family } from '../../src/types.js';

const FAMILIES: Family[] = [
  'ai-access', 'llm-content', 'structured-data', 'technical-seo',
  'on-page', 'performance', 'accessibility', 'security',
];

describe('report i18n catalog', () => {
  it('exposes en and fr message sets', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(['en', 'fr']);
    expect(messages('en')).toBe(MESSAGES.en);
    expect(messages('fr')).toBe(MESSAGES.fr);
  });

  it('localizes chrome strings', () => {
    expect(messages('en').categorySubscores).toBe('Category subscores');
    expect(messages('fr').categorySubscores).toBe('Sous-scores par catégorie');
    expect(messages('en').actionPlan).toBe('Action plan');
    expect(messages('fr').actionPlan).toBe("Plan d'action");
    expect(messages('en').gradeLabel).toBe('Grade');
    expect(messages('fr').gradeLabel).toBe('Note');
  });

  it('builds parameterized strings per language', () => {
    expect(messages('en').stats(1, 2, 3)).toBe('1 passed · 2 to fix · 3 pages');
    expect(messages('fr').stats(1, 2, 3)).toBe('1 réussis · 2 à corriger · 3 pages');
    expect(messages('en').verdict('C', 2)).toMatch(/priority/);
    expect(messages('fr').verdict('C', 2)).toMatch(/priorité/);
    expect(messages('en').verdict('A', 0)).toMatch(/Excellent/);
    expect(messages('fr').verdict('A', 0)).toMatch(/Excellent/);
    expect(messages('en').moreRecs(5)).toBe('+5 more — see the per-family detail below.');
    expect(messages('fr').moreRecs(5)).toBe('+5 autre(s) — voir le détail par famille ci-dessous.');
  });

  it('localizes CWV labels', () => {
    expect(messages('en').cwvBucket.ni).toBe('needs improvement');
    expect(messages('fr').cwvBucket.ni).toBe('à améliorer');
    expect(messages('en').cwvAssess.slow).toBe('FAILED');
    expect(messages('fr').cwvAssess.slow).toBe('ÉCHEC');
    expect(messages('en').cwvSrcField).toBe('CrUX field');
    expect(messages('fr').cwvSrcField).toBe('CrUX terrain');
  });

  it('localizes the CWV KPI table headers', () => {
    expect(messages('en').cwvKpiHeader.metric).toBe('Metric');
    expect(messages('fr').cwvKpiHeader.metric).toBe('Métrique');
    expect(messages('en').cwvKpiHeader.rating).not.toBe(messages('fr').cwvKpiHeader.rating);
  });

  it('localizes the action-plan effort labels', () => {
    expect(messages('en').effortLabel.quick).toBe('Quick win');
    expect(messages('en').effortLabel.involved).toBe('Involved');
    expect(messages('fr').effortLabel.quick).toBe('Rapide');
    expect(messages('fr').effortLabel.involved).toBe('Conséquent');
    expect(messages('en').effortLabel).not.toEqual(messages('fr').effortLabel);
  });

  it('provides a bilingual CWV explainer + per-metric advice', () => {
    for (const lang of ['en', 'fr'] as const) {
      const m = messages(lang);
      expect(m.cwvIntro.length).toBeGreaterThan(20);
      expect(m.cwvExplainTitle.length).toBeGreaterThan(0);
      expect(m.cwvAdviceTitle.length).toBeGreaterThan(0);
      for (const k of ['lcp', 'inp', 'cls', 'ttfb'] as const) {
        expect(m.cwvMetricInfo[k].label).toContain(k.toUpperCase());
        expect(m.cwvMetricInfo[k].what.length).toBeGreaterThan(5);
        expect(m.cwvMetricInfo[k].advice.length).toBeGreaterThan(10);
      }
    }
    // the copy is actually translated, not shared
    expect(messages('en').cwvIntro).not.toBe(messages('fr').cwvIntro);
    expect(messages('en').cwvAdviceTitle).not.toBe(messages('fr').cwvAdviceTitle);
    // every per-metric string is genuinely translated (labels are metric names, so
    // they stay identical; `what` + `advice` must differ between locales)
    for (const k of ['lcp', 'inp', 'cls', 'ttfb'] as const) {
      expect(messages('en').cwvMetricInfo[k].what).not.toBe(messages('fr').cwvMetricInfo[k].what);
      expect(messages('en').cwvMetricInfo[k].advice).not.toBe(messages('fr').cwvMetricInfo[k].advice);
    }
  });

  it('has a label + short label for every family in both languages', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const f of FAMILIES) {
        expect(typeof FAMILY_LABELS_I18N[lang][f]).toBe('string');
        expect(FAMILY_LABELS_I18N[lang][f].length).toBeGreaterThan(0);
        expect(typeof FAMILY_SHORT_I18N[lang][f]).toBe('string');
        expect(FAMILY_SHORT_I18N[lang][f].length).toBeGreaterThan(0);
      }
    }
    expect(FAMILY_LABELS_I18N.en['ai-access']).toBe('AI crawler access');
    expect(FAMILY_LABELS_I18N.fr['ai-access']).toBe('Accès crawler IA');
    expect(FAMILY_SHORT_I18N.en.security).toBe('Security');
    expect(FAMILY_SHORT_I18N.fr.security).toBe('Sécurité');
  });
});
