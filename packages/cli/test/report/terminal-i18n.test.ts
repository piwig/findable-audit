import { describe, it, expect } from 'vitest';
import { FAMILY_LABELS, FAMILY_SHORT } from '../../src/report/terminal.js';
import { FAMILY_LABELS_I18N, FAMILY_SHORT_I18N } from '../../src/report/i18n.js';

describe('terminal labels derive from the EN catalog', () => {
  it('re-exports the EN family label maps by reference', () => {
    expect(FAMILY_LABELS).toBe(FAMILY_LABELS_I18N.en);
    expect(FAMILY_SHORT).toBe(FAMILY_SHORT_I18N.en);
  });
  it('keeps terminal output English', () => {
    expect(FAMILY_LABELS['ai-access']).toBe('AI crawler access');
    expect(FAMILY_SHORT.security).toBe('Security');
  });
});
