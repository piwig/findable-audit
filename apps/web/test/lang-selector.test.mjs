// Pure-function tests for the language-selector widget. No server, no I/O.

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLangSelector } from '../lib/lang-selector.mjs';

test('renderLangSelector marks the current language and links to the other', () => {
  const html = renderLangSelector('en');
  assert.match(html, /<nav class="lang-switch" aria-label="Language">/);
  assert.match(html, /<span aria-current="true">English<\/span>/);
  assert.match(html, /<a href="\/fr\/" hreflang="fr" lang="fr">Français<\/a>/);
});

test('renderLangSelector flips current/other when lang is fr, with a French aria-label', () => {
  const html = renderLangSelector('fr');
  assert.match(html, /aria-label="Langue"/);
  assert.match(html, /<span aria-current="true">Français<\/span>/);
  assert.match(html, /<a href="\/en\/" hreflang="en" lang="en">English<\/a>/);
});

test('renderLangSelector never leaves an on* handler or external resource', () => {
  const html = renderLangSelector('en') + renderLangSelector('fr');
  assert.doesNotMatch(html, /\son\w+\s*=/i);
  assert.doesNotMatch(html, /<script/i);
});
