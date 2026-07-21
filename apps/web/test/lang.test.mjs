// Hermetic tests for the /en /fr prefix-routing helpers: no server, no I/O.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORTED_LANGS, DEFAULT_LANG, negotiateLang, splitLangPrefix, withLangPrefix } from '../lib/lang.mjs';

test('SUPPORTED_LANGS / DEFAULT_LANG', () => {
  assert.deepEqual(SUPPORTED_LANGS, ['en', 'fr']);
  assert.equal(DEFAULT_LANG, 'en');
});

// --- negotiateLang ----------------------------------------------------------

test('negotiateLang picks fr when it is the only/preferred supported tag', () => {
  assert.equal(negotiateLang('fr-FR,fr;q=0.9,en;q=0.8'), 'fr');
  assert.equal(negotiateLang('fr'), 'fr');
});

test('negotiateLang picks en when it has the higher q-value', () => {
  assert.equal(negotiateLang('fr;q=0.5,en;q=0.9'), 'en');
});

test('negotiateLang ignores unsupported tags and falls back to a supported one', () => {
  assert.equal(negotiateLang('de-DE,de;q=0.9,fr;q=0.5'), 'fr');
});

test('negotiateLang falls back to DEFAULT_LANG when nothing supported is offered', () => {
  assert.equal(negotiateLang('de-DE,es;q=0.9'), 'en');
});

test('negotiateLang falls back to DEFAULT_LANG for missing/empty header', () => {
  assert.equal(negotiateLang(undefined), 'en');
  assert.equal(negotiateLang(''), 'en');
});

// --- splitLangPrefix ---------------------------------------------------------

test('splitLangPrefix parses a bare language root', () => {
  assert.deepEqual(splitLangPrefix('/en'), { lang: 'en', rest: '/' });
  assert.deepEqual(splitLangPrefix('/fr'), { lang: 'fr', rest: '/' });
  assert.deepEqual(splitLangPrefix('/en/'), { lang: 'en', rest: '/' });
});

test('splitLangPrefix parses a prefixed sub-path', () => {
  assert.deepEqual(splitLangPrefix('/en/audit'), { lang: 'en', rest: '/audit' });
  assert.deepEqual(splitLangPrefix('/fr/audit/result'), { lang: 'fr', rest: '/audit/result' });
});

test('splitLangPrefix returns null for an unsupported or non-prefixed path', () => {
  assert.equal(splitLangPrefix('/de/audit'), null);
  assert.equal(splitLangPrefix('/audit'), null);
  assert.equal(splitLangPrefix('/'), null);
});

test('splitLangPrefix does not false-match a path that merely starts with "en"/"fr"', () => {
  assert.equal(splitLangPrefix('/english'), null);
  assert.equal(splitLangPrefix('/frobnicate'), null);
});

// --- withLangPrefix -----------------------------------------------------------

test('withLangPrefix builds a prefixed path', () => {
  assert.equal(withLangPrefix('en', '/'), '/en/');
  assert.equal(withLangPrefix('fr', '/audit'), '/fr/audit');
});
