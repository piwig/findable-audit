// apps/web/lib/lang-selector.mjs
// Pure renderer for the site-wide EN/FR language switcher. Every page shell
// (landing, error, and — via 2B's own rendering — progress/result pages)
// mounts this near the top of <main>. No escaping is needed here: every
// piece of text is a static label from lib/i18n.mjs, never user input.

import { SUPPORTED_LANGS } from './lang.mjs';
import { t } from './i18n.mjs';

/**
 * @param {'en'|'fr'} lang the language of the page this selector is mounted on
 * @returns {string} an HTML <nav> fragment
 */
export function renderLangSelector(lang) {
  const s = t(lang).selector;
  const items = SUPPORTED_LANGS.map((code) => {
    const label = s[code];
    if (code === lang) return `<span aria-current="true">${label}</span>`;
    return `<a href="/${code}/" hreflang="${code}" lang="${code}">${label}</a>`;
  });
  return `<nav class="lang-switch" aria-label="${s.ariaLabel}">${items.join(' <span aria-hidden="true">·</span> ')}</nav>`;
}
