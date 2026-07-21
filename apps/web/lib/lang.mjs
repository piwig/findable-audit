// /en /fr path-prefix routing helpers. Pure, hermetic — no I/O, no server
// dependency. Shared by server.mjs (routing) and lib/lang-selector.mjs.

/** @typedef {'en'|'fr'} Lang */

/** @type {Lang[]} */
export const SUPPORTED_LANGS = ['en', 'fr'];

/** @type {Lang} */
export const DEFAULT_LANG = 'en';

/**
 * Pick the best supported language from an Accept-Language header, honouring
 * q-values. Falls back to DEFAULT_LANG when the header is missing/empty or
 * names no supported language.
 * @param {string|undefined} acceptLanguageHeader
 * @returns {Lang}
 */
export function negotiateLang(acceptLanguageHeader) {
  if (!acceptLanguageHeader) return DEFAULT_LANG;

  const entries = acceptLanguageHeader
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam ? parseFloat(qParam.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const primary = tag.split('-')[0];
    if (SUPPORTED_LANGS.includes(primary)) return /** @type {Lang} */ (primary);
  }
  return DEFAULT_LANG;
}

/**
 * Split a pathname into its language prefix and the rest, if it has one.
 * `/en` and `/en/` both yield `rest: '/'`. Returns null for unsupported
 * prefixes (so callers can tell "/de/audit" apart from a real match) and for
 * paths that merely start with "en"/"fr" without a segment boundary
 * (e.g. "/english").
 * @param {string} pathname
 * @returns {{lang: Lang, rest: string}|null}
 */
export function splitLangPrefix(pathname) {
  const match = /^\/(en|fr)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const rest = match[2] && match[2] !== '' ? match[2] : '/';
  return { lang: /** @type {Lang} */ (match[1]), rest };
}

/**
 * Build a prefixed path from a language and an unprefixed path.
 * @param {Lang} lang
 * @param {string} path
 * @returns {string}
 */
export function withLangPrefix(lang, path) {
  return path === '/' ? `/${lang}/` : `/${lang}${path}`;
}
