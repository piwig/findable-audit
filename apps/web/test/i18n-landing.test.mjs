// Tests for the landing/selector/404 keys this sub-phase (2C) owns in the
// shared web i18n catalog. Does not assert on 2B's progress/error-lifecycle
// keys — those belong to sub-phase 2B's own test suite.

import test from 'node:test';
import assert from 'node:assert/strict';

import { WEB_MESSAGES, t } from '../lib/i18n.mjs';

test('both languages define a complete landing catalog', () => {
  for (const lang of ['en', 'fr']) {
    const s = t(lang).landing;
    assert.equal(typeof s.title, 'string');
    assert.equal(typeof s.eyebrow, 'string');
    assert.equal(typeof s.h1Lead, 'string');
    assert.equal(typeof s.h1Accent, 'string');
    assert.equal(typeof s.h1Tail, 'string');
    assert.equal(typeof s.lead, 'string');
    assert.equal(typeof s.urlLabel, 'string');
    assert.equal(typeof s.cta, 'string');
    assert.equal(typeof s.hint, 'string');
    assert.equal(typeof s.familiesTitle, 'string');
    assert.equal(typeof s.howTitle, 'string');
    assert.ok(Array.isArray(s.families) && s.families.length === 8 && s.families.every((f) => typeof f === 'string'));
    assert.ok(Array.isArray(s.steps) && s.steps.length === 3
      && s.steps.every((st) => typeof st.t === 'string' && typeof st.d === 'string'));
    assert.ok(s.title.length > 0);
  }
});

test('landing strings actually differ between en and fr (not copy-pasted)', () => {
  assert.notEqual(WEB_MESSAGES.en.landing.lead, WEB_MESSAGES.fr.landing.lead);
  assert.notEqual(WEB_MESSAGES.en.landing.cta, WEB_MESSAGES.fr.landing.cta);
  assert.notEqual(WEB_MESSAGES.en.landing.h1Accent, WEB_MESSAGES.fr.landing.h1Accent);
});

test('both languages define selector labels for every supported language', () => {
  for (const lang of ['en', 'fr']) {
    const s = t(lang).selector;
    assert.equal(typeof s.ariaLabel, 'string');
    assert.equal(typeof s.en, 'string');
    assert.equal(typeof s.fr, 'string');
  }
  assert.equal(WEB_MESSAGES.en.selector.ariaLabel, 'Language');
  assert.equal(WEB_MESSAGES.fr.selector.ariaLabel, 'Langue');
});

test('both languages define a 404 (error.notFound) message', () => {
  for (const lang of ['en', 'fr']) {
    const s = t(lang).error.notFound;
    assert.equal(typeof s.title, 'string');
    assert.equal(typeof s.message, 'string');
  }
  assert.notEqual(WEB_MESSAGES.en.error.notFound.title, WEB_MESSAGES.fr.error.notFound.title);
});

test('t() falls back to English for an unrecognised lang', () => {
  assert.equal(t('de'), WEB_MESSAGES.en);
});
