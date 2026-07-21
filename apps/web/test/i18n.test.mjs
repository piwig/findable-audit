import test from 'node:test';
import assert from 'node:assert/strict';
import { WEB_MESSAGES, t } from '../lib/i18n.mjs';

test('WEB_MESSAGES has en and fr with the nested contract shape', () => {
  for (const lang of ['en', 'fr']) {
    const m = WEB_MESSAGES[lang];
    assert.ok(m, `${lang} present`);
    assert.equal(typeof m.progress, 'object');
    assert.equal(typeof m.progress.phases, 'object');
    // error is a NESTED object with the five keys
    for (const k of ['rateLimited', 'busy', 'timeout', 'unreachable', 'notFound']) {
      assert.ok(k in m.error, `error.${k} present in ${lang}`);
    }
    assert.ok('landing' in m && 'selector' in m);
  }
});

test('2B fills progress + error.{rateLimited,busy,timeout,unreachable}', () => {
  for (const lang of ['en', 'fr']) {
    const m = WEB_MESSAGES[lang];
    for (const k of ['rateLimited', 'busy', 'timeout', 'unreachable']) {
      assert.equal(typeof m.error[k].title, 'string');
      assert.equal(typeof m.error[k].message, 'string');
      assert.ok(m.error[k].title.length > 0);
    }
    assert.equal(typeof m.progress.title, 'string');
    assert.equal(typeof m.progress.phases.checks, 'string');
  }
});

test('2C stubs (landing, selector, error.notFound) are left empty for 2C to fill', () => {
  for (const lang of ['en', 'fr']) {
    const m = WEB_MESSAGES[lang];
    assert.deepEqual(m.landing, {});
    assert.deepEqual(m.selector, {});
    assert.deepEqual(m.error.notFound, {});
  }
});

test('t(lang) returns the catalogue, falling back to en for unknown', () => {
  assert.equal(t('fr'), WEB_MESSAGES.fr);
  assert.equal(t('en'), WEB_MESSAGES.en);
  assert.equal(t('zz'), WEB_MESSAGES.en);
});
