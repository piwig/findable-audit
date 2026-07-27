import { describe, it, expect } from 'vitest';
import { INTENT_GRID, BUCKETS, intentsFor, type IntentDef } from '../../src/answers/grid.js';
import { PREDICATES } from '../../src/answers/predicates.js';

/**
 * The grid is pure data, so it is locked by a table test rather than by unit tests on
 * behaviour — the same reasoning as test/message-i18n.test.ts. A grid entry that ships
 * without a French question, or whose two languages interpolate different placeholders,
 * is exactly the defect class that reached production twice on this project.
 */

const PLACEHOLDER = /\{(subject|zone)\}/g;

function placeholders(template: string): Set<string> {
  return new Set(template.match(PLACEHOLDER) ?? []);
}

describe('INTENT_GRID', () => {
  it('declares a non-empty question in both supported languages for every intent', () => {
    const incomplete = INTENT_GRID.filter(
      (i: IntentDef) => !i.question.en?.trim() || !i.question.fr?.trim(),
    );
    expect(incomplete.map((i) => i.id)).toEqual([]);
  });

  it('interpolates the same placeholders in both languages of an intent', () => {
    const divergent = INTENT_GRID.filter(
      (i: IntentDef) => ![...placeholders(i.question.en)].every((p) => placeholders(i.question.fr).has(p))
        || placeholders(i.question.en).size !== placeholders(i.question.fr).size,
    );
    expect(divergent.map((i) => i.id)).toEqual([]);
  });

  it('carries {subject} always, and {zone} exactly when the intent is zoned', () => {
    const wrong = INTENT_GRID.filter((i: IntentDef) => {
      const p = placeholders(i.question.en);
      return !p.has('{subject}') || p.has('{zone}') !== i.zoned;
    });
    expect(wrong.map((i) => i.id)).toEqual([]);
  });

  it('keeps every bucket to six intents at most', () => {
    const oversized = BUCKETS.filter((b) => intentsFor(b).length > 6);
    expect(oversized).toEqual([]);
  });

  it('registers exactly one predicate per intent, with no orphan predicate', () => {
    const intentIds = INTENT_GRID.map((i) => i.id).sort();
    expect(Object.keys(PREDICATES).sort()).toEqual(intentIds);
  });
});
