# Sub-phase 2C: Web i18n Routing + Bilingual Landing Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give `apps/web` real `/en` / `/fr` path-prefix routing with reciprocal hreflang, a per-page `lang` attribute, an Accept-Language redirect on `/`, a language-selector control, and a placeholder-but-functional bilingual landing page — final landing visual design deferred.

**Architecture:** Two new pure/hermetic library modules (`lib/lang.mjs` for prefix parsing + Accept-Language negotiation, `lib/lang-selector.mjs` for the selector widget) sit alongside the extended web chrome catalog (`lib/i18n.mjs`, whose `landing`/`selector`/`error.notFound` namespaces this sub-phase owns). `server.mjs` gains one well-isolated routing block, inserted right after its existing pathname parse and before its existing dispatch chain: it 302-redirects `/`, rewrites `/en/*` and `/fr/*` requests to their unprefixed equivalent (forcing `lang` onto the query string so 2B's job routes — which read `lang` from the query per the Phase-2 contract — pick it up with zero further coupling), and 301-redirects legacy unprefixed human pages to their `/en` form. `landingPage()`/`shell()` are extended to take `lang`, render reciprocal hreflang tags, and mount the selector; a new `localizedErrorPage()` handles the generic 404 in both languages, kept deliberately separate from the pre-existing `errorPage()` that sub-phase 2B also extends, to avoid a fragile cross-plan signature coupling.

**Tech Stack:** Node ≥20 built-ins only (`node:http`, `node:test`, `node:assert/strict`, global `fetch`), zero new npm dependencies, ESM (`.mjs`, no build step for `apps/web`).

## Global Constraints

- Node >=20, TypeScript/ESM internal imports end in .js; ZERO new npm dependencies (apps/web stays zero-dep, Node built-ins only); no process.exit after the audit starts; report HTML self-contained (external `<a>` doc links allowed, no external embedded resources, no inline on* handlers); SSRF guard (assertPublicUrl/blockPrivateHosts) UNCHANGED; perfect-site=100 e2e invariant preserved (additive). Cross-platform (path.join, no POSIX shell in code). Tests: vitest for packages/cli, node:test on a real local HTTP server for apps/web. All `node:test` commands in this plan run with `apps/web` as the working directory (`cd apps/web && node --test test/...`) — never invoke `node --test` from the repo root or from `packages/cli`.

## Assumptions this plan makes about sibling sub-phases (read before executing)

This plan is authored to compose with 2A/2B per the Phase-2 shared interface contract, but 2A/2B's actual code may not exist yet (or may differ in incidental ways not pinned by the contract) at the time this plan is executed. To keep 2C independently implementable and testable (per the "each plan should produce working, testable software on its own" rule), it makes these explicit, documented choices:

1. **`apps/web/lib/i18n.mjs`** is jointly owned: 2B introduces `progress`/most of `error` (job lifecycle messages), 2C introduces `landing`/`selector`/`error.notFound`. Task 2 below gives the *complete* set of keys 2C needs. **2B is the sole creator of this file.** The 2A→2B→2C landing order is enforced, so by the time this task executes the file MUST already exist. If it already exists, **merge** — add the `landing`, `selector` and `error.notFound` keys into the existing per-language objects and the existing `t(lang)` helper; do not delete 2B's keys. If it does **not** exist yet, HARD-FAIL this task (stop and flag that the landing order was violated) rather than creating the file fresh — 2C must never become the file's creator.
2. **2B's job routes (`/audit`, `/audit/stream`, `/audit/result`, `/audit/export`) read the target language from `url.searchParams.get('lang')`** — this is given verbatim by the Phase-2 contract's route table (`GET /audit?url=&lang=`). 2C's prefix routing (Task 4) integrates with these routes purely by rewriting the incoming request's pathname and forcing `lang` onto its query string *before* the existing dispatch chain runs — it never calls into 2B's handler functions by name. This means Task 4 has **zero dependency on 2B's internal function names**, only on that one query-param contract, and its own tests (which hit `/audit.json` and the SSRF-blocked path of `/audit`) exercise this integration without depending on 2B's job-store internals at all.
3. **The pre-existing `errorPage(title, message, opts)` helper** (`server.mjs`, current lines 124-133) is very likely also extended by 2B (to localize job-lifecycle errors). Rather than guess 2B's new signature, 2C introduces its own, separately-named `localizedErrorPage(lang, title, message, opts)` (Task 5) used only for the generic 404 this sub-phase owns. This avoids two independently-executed plans racing to redefine the same function signature. A later cleanup pass can unify them once 2B has actually landed.
4. **Reciprocal hreflang is added to the landing pages only** (`/en/` ↔ `/fr/`), not to job/progress/result/error pages. Rationale: hreflang is meant for indexable alternate-language content; every page in `apps/web` already ships `<meta name="robots" content="noindex">` (current `shell()`, line 96) and job pages are further ephemeral (tied to one job id in one language) — putting hreflang on them would be exactly the kind of SEO anti-pattern this tool audits *against*. This is flagged as an open question in Self-Review, not silently decided.
5. Line numbers cited below for `apps/web/server.mjs` are from the file as it stands **before** 2B's changes land (read in full while writing this plan). If 2B has already landed, locate the same code by the function/variable names given (`landingPage`, `shell`, the `pathname = new URL(...)` parse, the final 404 `send(...)` call) rather than by line number.

## File Structure

- **Create** `apps/web/lib/lang.mjs` — pure routing helpers: `SUPPORTED_LANGS`, `DEFAULT_LANG`, `negotiateLang(acceptLanguageHeader)`, `splitLangPrefix(pathname)`, `withLangPrefix(lang, path)`. No I/O, fully hermetic.
- **Create** `apps/web/test/lang.test.mjs` — tests for the above.
- **Modify** `apps/web/lib/i18n.mjs` — web UI chrome catalog; this sub-phase adds/owns the `landing`, `selector`, and `error.notFound` namespaces (see Assumption 1). 2B is the sole creator of this file; 2C hard-fails if it is absent rather than creating it.
- **Create** `apps/web/test/i18n-landing.test.mjs` — tests for the `landing`/`selector`/`error.notFound` keys this sub-phase adds.
- **Modify** `apps/web/test/i18n.test.mjs` — sub-phase 2B's test file; remove the assertions that `landing`/`selector`/`error.notFound` are empty stubs, now that Task 2 fills them (see Task 2 Step 4).
- **Create** `apps/web/lib/lang-selector.mjs` — `renderLangSelector(lang)`: pure HTML-fragment renderer for the EN/FR switcher.
- **Create** `apps/web/test/lang-selector.test.mjs` — tests for the selector markup.
- **Modify** `apps/web/server.mjs` — add the prefix-routing block (root redirect, `/en` `/fr` dispatch rewrite, legacy-path redirect); localize `landingPage()`/`shell()` (lang attribute, hreflang, selector mount, prefixed form action); add `localizedErrorPage()` and route the generic 404 through it.
- **Create** `apps/web/test/lang-routing.test.mjs` — real local HTTP server integration tests for the redirect/dispatch logic (Task 4).
- **Create** `apps/web/test/lang-landing.test.mjs` — real local HTTP server integration tests for the localized landing/404 pages (Task 5).
- **Modify** `apps/web/README.md` — document the `/en` `/fr` routes and the Accept-Language redirect (folded into Task 5's commit).

## Task 1: `apps/web/lib/lang.mjs` — prefix parsing + Accept-Language negotiation

**Files:**
- Create: `apps/web/lib/lang.mjs`
- Test: `apps/web/test/lang.test.mjs`

**Interfaces:**
- Consumes: nothing (pure, no dependency on 2A/2B).
- Produces (consumed by Tasks 3, 4, 5): `export const SUPPORTED_LANGS = ['en', 'fr']`; `export const DEFAULT_LANG = 'en'`; `export function negotiateLang(acceptLanguageHeader: string|undefined): 'en'|'fr'`; `export function splitLangPrefix(pathname: string): {lang: 'en'|'fr', rest: string}|null`; `export function withLangPrefix(lang: 'en'|'fr', path: string): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/lang.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test test/lang.test.mjs`
Expected: FAIL — `Cannot find module '../lib/lang.mjs'` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/lang.mjs`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test test/lang.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/lang.mjs apps/web/test/lang.test.mjs
git commit -m "feat(web): add /en /fr prefix-parsing and Accept-Language negotiation helpers"
```

## Task 2: Extend `apps/web/lib/i18n.mjs` with landing + selector + 404 strings

**Files:**
- Modify: `apps/web/lib/i18n.mjs` (see Assumption 1 — 2B is the sole creator; merge these keys into the existing file, hard-fail if it is absent)
- Modify: `apps/web/test/i18n.test.mjs` (2B's test file — remove the now-stale "stubs empty" assertions for `landing`/`selector`/`error.notFound`, per Step 4 below)
- Test: `apps/web/test/i18n-landing.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (consumed by Tasks 3, 5): `export const WEB_MESSAGES: Record<'en'|'fr', {landing: {...}, selector: {...}, error: {notFound: {title, message}, ...}}>`; `export function t(lang: 'en'|'fr')`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/i18n-landing.test.mjs`:

```js
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
    assert.equal(typeof s.h1, 'string');
    assert.equal(typeof s.lead, 'string');
    assert.equal(typeof s.feature1, 'string');
    assert.equal(typeof s.feature2, 'string');
    assert.equal(typeof s.feature3, 'string');
    assert.equal(typeof s.urlLabel, 'string');
    assert.equal(typeof s.cta, 'string');
    assert.equal(typeof s.hint, 'string');
    assert.ok(s.title.length > 0);
  }
});

test('landing strings actually differ between en and fr (not copy-pasted)', () => {
  assert.notEqual(WEB_MESSAGES.en.landing.lead, WEB_MESSAGES.fr.landing.lead);
  assert.notEqual(WEB_MESSAGES.en.landing.cta, WEB_MESSAGES.fr.landing.cta);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test test/i18n-landing.test.mjs`
Expected: FAIL — `Cannot find module '../lib/i18n.mjs'` (if 2B has not landed yet) or, if it exists, FAIL with `WEB_MESSAGES.en.landing is undefined` (2B's file exists but lacks the `landing`/`selector`/`error.notFound` keys this sub-phase adds).

- [ ] **Step 3: Write the implementation**

Check whether `apps/web/lib/i18n.mjs` exists. **2B is the sole creator of this file** (see Assumption 1) — if it does NOT exist yet, HARD-FAIL this step: stop, do not create the file, and flag that the enforced 2A→2B→2C landing order was violated (2B has not landed). If it already exists (2B landed first), open it and merge the `landing`, `selector`, and `error.notFound` keys into each language's existing object, and merge the doc-comment note below into the file's header comment — keep every other key 2B defined (`progress`, other `error.*` entries, `WEB_MESSAGES`, `t()`) exactly as 2B wrote them.

```js
// apps/web/lib/i18n.mjs
// Web-UI chrome catalog: strings for the landing page, language selector,
// the "audit in progress" screen, and generic error pages — in each
// supported language. This is SEPARATE from packages/cli/src/report/i18n.ts
// (the audit-report chrome catalog): that one covers the report itself,
// this one covers the site around it.
//
// OWNERSHIP NOTE: sub-phase 2B owns `progress` and the job-lifecycle parts
// of `error` (rate-limited, busy, timeout, unreachable...). Sub-phase 2C
// owns `landing`, `selector`, and `error.notFound`. When both have landed,
// this file holds the union of both sets of keys under one `t(lang)`.

/** @typedef {'en'|'fr'} Lang */

export const WEB_MESSAGES = {
  en: {
    landing: {
      title: 'findable-audit — SEO & GEO audit',
      h1: 'findable-audit',
      lead: "Audit a website's SEO and GEO — how findable it is by AI search crawlers (GPTBot, ClaudeBot, PerplexityBot…) and classic search engines.",
      feature1: '107 checks across 8 weighted families — AI access, structured data, technical SEO, on-page, performance, accessibility, security.',
      feature2: 'A single score out of 100 and an A–F grade, with a prioritized action plan.',
      feature3: 'Multi-page crawl, Core Web Vitals (when configured), and exportable Markdown / HTML / JSON reports.',
      urlLabel: 'Website URL',
      cta: 'Audit',
      hint: 'Enter a public http(s) URL. Internal, private and reserved addresses are refused.',
    },
    selector: {
      ariaLabel: 'Language',
      en: 'English',
      fr: 'Français',
    },
    error: {
      notFound: { title: 'Not found', message: 'No such page.' },
    },
  },
  fr: {
    landing: {
      title: 'findable-audit — audit SEO & GEO',
      h1: 'findable-audit',
      lead: "Auditez le SEO et le GEO d'un site — sa findabilité par les crawlers IA (GPTBot, ClaudeBot, PerplexityBot…) et les moteurs de recherche classiques.",
      feature1: '107 vérifications réparties sur 8 familles pondérées : accès IA, données structurées, SEO technique, on-page, performance, accessibilité, sécurité.',
      feature2: "Un score sur 100 et une note A–F, avec un plan d'action priorisé.",
      feature3: 'Crawl multi-pages, Core Web Vitals (si configurés), et rapports exportables en Markdown / HTML / JSON.',
      urlLabel: 'URL du site',
      cta: 'Auditer',
      hint: 'Entrez une URL http(s) publique. Les adresses internes, privées ou réservées sont refusées.',
    },
    selector: {
      ariaLabel: 'Langue',
      en: 'English',
      fr: 'Français',
    },
    error: {
      notFound: { title: 'Introuvable', message: "Cette page n'existe pas." },
    },
  },
};

/**
 * @param {string} lang
 * @returns {typeof WEB_MESSAGES['en']}
 */
export function t(lang) {
  return WEB_MESSAGES[lang] ?? WEB_MESSAGES.en;
}
```

- [ ] **Step 4: Update sub-phase 2B's `apps/web/test/i18n.test.mjs` so it no longer asserts these namespaces are empty**

Sub-phase 2B's own test file (`apps/web/test/i18n.test.mjs`) asserts that the `landing`, `selector`, and `error.notFound` namespaces are placeholder-empty stubs pending this sub-phase, e.g.:

```js
assert.deepEqual(m.landing, {});
assert.deepEqual(m.selector, {});
assert.deepEqual(m.error.notFound, {});
```

Now that Step 3 above fills those namespaces with real content, these three assertions go RED, and this plan's own later full-suite run (`node --test test/`) would fail. Open `apps/web/test/i18n.test.mjs` and DELETE those three `assert.deepEqual(..., {})` lines (and, if a `test(...)` block exists solely to assert emptiness, remove that whole block). Do not replace them with assertions on the filled values — `apps/web/test/i18n-landing.test.mjs` (Step 1 above) already covers the filled `landing`/`selector`/`error.notFound` content in full, so duplicating that coverage in 2B's file would only add another cross-plan coupling. Leave every other assertion in `apps/web/test/i18n.test.mjs` (2B's `progress`/job-lifecycle `error.*` keys) untouched.

(Per Assumption 1's hard-fail rule, if `apps/web/lib/i18n.mjs` didn't exist Step 3 above would already have halted, so `apps/web/test/i18n.test.mjs` is guaranteed to exist by the time this step runs.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && node --test test/i18n-landing.test.mjs && node --test test/i18n.test.mjs`
Expected: PASS — all tests green, including 2B's `i18n.test.mjs` now that its stale "stubs empty" assertions are gone.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/i18n.mjs apps/web/test/i18n-landing.test.mjs apps/web/test/i18n.test.mjs
git commit -m "feat(web): add landing/selector/404 strings to the web i18n catalog"
```

## Task 3: `apps/web/lib/lang-selector.mjs` — the language-selector control

**Files:**
- Create: `apps/web/lib/lang-selector.mjs`
- Test: `apps/web/test/lang-selector.test.mjs`

**Interfaces:**
- Consumes: `SUPPORTED_LANGS` from `./lang.mjs` (Task 1); `t(lang)` from `./i18n.mjs` (Task 2).
- Produces (consumed by Task 5): `export function renderLangSelector(lang: 'en'|'fr'): string` — an HTML `<nav>` fragment, safe to inline (no user input, only static labels).

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/lang-selector.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test test/lang-selector.test.mjs`
Expected: FAIL — `Cannot find module '../lib/lang-selector.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/lang-selector.mjs`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test test/lang-selector.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/lang-selector.mjs apps/web/test/lang-selector.test.mjs
git commit -m "feat(web): add the EN/FR language-selector widget"
```

## Task 4: `server.mjs` — path-prefix routing (redirect, dispatch rewrite, legacy redirect)

**Files:**
- Modify: `apps/web/server.mjs` (imports; insert routing block right after the pathname parse, currently lines 348-354 — see Assumption 5 if line numbers have shifted)
- Test: `apps/web/test/lang-routing.test.mjs`

**Interfaces:**
- Consumes: `negotiateLang`, `splitLangPrefix`, `DEFAULT_LANG` from `./lib/lang.mjs` (Task 1); the pre-existing `landingPage()` — this task's routing block already calls it as `landingPage(split.lang)` (the pre-2C signature ignores the extra argument, so this is safe before Task 5 lands; Task 5 then gives the function definition a `lang` parameter that actually uses it, with zero further call-site changes needed); the pre-existing `send(res, status, contentType, body, extraHeaders)`.
- Produces (consumed by Task 5, and by 2B's job routes per Assumption 2): the request handler now sets `req.__lang` to the prefix-derived language whenever a `/en/*` or `/fr/*` path was matched, and rewrites `req.url` to the unprefixed pathname with `lang=<code>` forced onto the query string before falling through to the existing (2B-extended) dispatch chain.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/lang-routing.test.mjs`:

```js
// Integration tests for the /en /fr path-prefix routing, against a real
// local HTTP server (no mocks). Requires `npm run build` in packages/cli
// first, since server.mjs imports the built CLI library.
//
// Each request either hits a fast SSRF-rejection path or a plain redirect,
// so no real outbound network call is ever made.

import test from 'node:test';
import assert from 'node:assert/strict';

// Bind to a fixed high port for this test file's server instance (node:test
// runs each test file in its own process, so a hard-coded port is safe here
// and avoids the `Number(process.env.PORT) || 3021` fallback swallowing "0").
process.env.PORT = '31021';

const { server } = await import('../server.mjs');
if (!server.listening) {
  await new Promise((resolve) => server.once('listening', resolve));
}
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
});

test('GET / redirects (302) to /en/ when no Accept-Language is sent', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/en/');
});

test('GET / redirects (302) to /fr/ when Accept-Language prefers French', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual', headers: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5' } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/fr/');
});

test('GET /en/ and /fr/ both serve the landing page (200)', async () => {
  const en = await fetch(`${base}/en/`);
  const fr = await fetch(`${base}/fr/`);
  assert.equal(en.status, 200);
  assert.equal(fr.status, 200);
});

test('GET /healthz is untouched by prefix routing', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('GET /audit.json is never redirected, even without a language prefix', async () => {
  // 127.0.0.1 is SSRF-blocked, so this returns fast without a real network call.
  const res = await fetch(`${base}/audit.json?url=http://127.0.0.1`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'blocked');
});

test('GET /audit (legacy, unprefixed) redirects (301) to /en/audit, keeping the query', async () => {
  const res = await fetch(`${base}/audit?url=http://127.0.0.1`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/en/audit?url=http%3A%2F%2F127.0.0.1');
});

test('GET /en/audit forces lang=en through to the existing SSRF-guarded /audit handling', async () => {
  const res = await fetch(`${base}/en/audit?url=http://127.0.0.1`, { redirect: 'manual' });
  // The SSRF guard rejects before any job/report logic runs, so this proves
  // the rewrite (prefix -> unprefixed pathname + forced lang=en) reached the
  // existing /audit dispatch, regardless of whether 2B's job-based handler
  // or the pre-2B synchronous handler is in place.
  assert.equal(res.status, 400);
});

test('GET /audit/stream, /audit/result, /audit/export (unprefixed) are never redirected — only /audit is human-navigable', async () => {
  for (const p of ['/audit/stream', '/audit/result', '/audit/export']) {
    const res = await fetch(`${base}${p}?job=x`, { redirect: 'manual' });
    assert.notEqual(res.status, 301, `${p} should not 301-redirect (would add a wasteful extra hop)`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npm run --prefix ../../packages/cli build && node --test test/lang-routing.test.mjs`
Expected: FAIL — `/` returns 200 (still serves the landing page directly, no redirect); `/audit` (legacy) returns its normal SSRF-blocked response instead of a 301.

- [ ] **Step 3: Implement the routing block**

In `apps/web/server.mjs`, add the import (near the top, alongside the other `./lib/*` imports at lines 22-25):

```js
import { negotiateLang, splitLangPrefix, DEFAULT_LANG } from './lib/lang.mjs';
```

Then, inside the `http.createServer((req, res) => { ... })` callback, immediately after the existing pathname parse (today's lines 348-354:

```js
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    send(res, 400, 'text/plain; charset=utf-8', 'Bad Request');
    return;
  }
```

) and *before* the existing `if (pathname === '/healthz') { ... }` branch, insert:

```js
  // --- i18n path-prefix routing (sub-phase 2C) ------------------------------
  // Every human-facing page lives under /en or /fr. `/` redirects to the
  // Accept-Language match (else English). Only `/audit` is human-navigable
  // (typed/bookmarked directly), so only it 301-redirects to its English form
  // when requested unprefixed. `/audit/stream`, `/audit/result`, and
  // `/audit/export` are never navigated to directly — 2B's progress page
  // hardcodes them as unprefixed URLs (the EventSource source, the
  // <noscript> refresh link, and the download-bar links), so redirecting
  // them would add a wasteful extra 301 hop to every SSE/result/export
  // request. They — like `/healthz` and `/audit.json` — stay global,
  // unprefixed routes left untouched by this block.
  const HUMAN_PATHS = new Set(['/audit']);

  if (pathname === '/') {
    const lang = negotiateLang(req.headers['accept-language']);
    send(res, 302, 'text/plain; charset=utf-8', 'Found', { location: `/${lang}/` });
    return;
  }

  const split = splitLangPrefix(pathname);
  if (split) {
    // Rewrite the request so the existing (2B-extended) dispatch chain below
    // sees the unprefixed pathname, with `lang` forced onto the query string.
    // 2B's job routes read `lang` from the query per the Phase-2 contract, so
    // no further coupling to their internals is needed here.
    const rewritten = new URL(req.url, 'http://localhost');
    rewritten.pathname = split.rest;
    rewritten.searchParams.set('lang', split.lang);
    req.url = rewritten.pathname + rewritten.search;
    req.__lang = split.lang;
    pathname = split.rest;

    if (pathname === '/') {
      send(res, 200, 'text/html; charset=utf-8', landingPage(split.lang));
      return;
    }
    // Any other rest path (/audit, /audit/stream, /audit/result, /audit/export,
    // or an unknown path) falls through to the dispatch chain below.
  } else if (HUMAN_PATHS.has(pathname)) {
    const rewritten = new URL(req.url, 'http://localhost');
    rewritten.pathname = `/${DEFAULT_LANG}${pathname}`;
    send(res, 301, 'text/plain; charset=utf-8', 'Moved Permanently', { location: rewritten.pathname + rewritten.search });
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test test/lang-routing.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/server.mjs apps/web/test/lang-routing.test.mjs
git commit -m "feat(web): add /en /fr path-prefix routing, Accept-Language redirect on /, and legacy-path redirects"
```

## Task 5: Localize the landing page + hreflang + selector mount + 404

**Files:**
- Modify: `apps/web/server.mjs` (`shell()`, `landingPage()`, `PAGE_STYLE`, the final 404 branch — today's lines 68-133 and 379; see Assumption 5)
- Modify: `apps/web/README.md` (document the new routes)
- Test: `apps/web/test/lang-landing.test.mjs`

**Interfaces:**
- Consumes: `t` from `./lib/i18n.mjs` (Task 2); `renderLangSelector` from `./lib/lang-selector.mjs` (Task 3); `negotiateLang` from `./lib/lang.mjs` (Task 1); `req.__lang` set by Task 4's routing block.
- Produces: `shell(title, bodyHtml, { lang, alternates })`; `landingPage(lang)`; `localizedErrorPage(lang, title, message, opts)` — a new helper, deliberately distinct from the pre-existing `errorPage()` (see Assumption 3).

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/lang-landing.test.mjs`:

```js
// Integration tests for the localized landing page, hreflang tags, the
// mounted language selector, and the localized 404 — against a real local
// HTTP server. Requires `npm run build` in packages/cli first.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '31022'; // distinct from lang-routing.test.mjs's port.

const { server } = await import('../server.mjs');
if (!server.listening) {
  await new Promise((resolve) => server.once('listening', resolve));
}
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
});

test('/en/ has the correct lang attribute, reciprocal hreflang, English copy and selector', async () => {
  const res = await fetch(`${base}/en/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="alternate" hreflang="en" href="\/en\/">/);
  assert.match(html, /<link rel="alternate" hreflang="fr" href="\/fr\/">/);
  assert.match(html, /<link rel="alternate" hreflang="x-default" href="\/en\/">/);
  assert.match(html, /Website URL/);
  assert.match(html, /<a href="\/fr\/" hreflang="fr" lang="fr">Français<\/a>/);
  assert.match(html, /action="\/en\/audit"/);
});

test('/fr/ has the correct lang attribute, reciprocal hreflang, French copy and selector', async () => {
  const res = await fetch(`${base}/fr/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<link rel="alternate" hreflang="en" href="\/en\/">/);
  assert.match(html, /<link rel="alternate" hreflang="fr" href="\/fr\/">/);
  assert.match(html, /URL du site/);
  assert.match(html, /<a href="\/en\/" hreflang="en" lang="en">English<\/a>/);
  assert.match(html, /action="\/fr\/audit"/);
});

test('/en/does-not-exist is a localized English 404', async () => {
  const res = await fetch(`${base}/en/does-not-exist`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Not found/);
});

test('/fr/does-not-exist is a localized French 404', async () => {
  const res = await fetch(`${base}/fr/does-not-exist`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Introuvable/);
});

test('an unsupported prefix falls through to a best-effort-localized 404 (Accept-Language)', async () => {
  const res = await fetch(`${base}/de/whatever`, { headers: { 'accept-language': 'fr' } });
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Introuvable/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test test/lang-landing.test.mjs`
Expected: FAIL — `/en/` has no `hreflang` links and no `<html lang="en">` (shell still hardcodes `lang="en"` unconditionally per today's line 92); `/en/does-not-exist` returns an unlocalized 404 with no `<html lang="en">` distinction from `/fr/does-not-exist`.

- [ ] **Step 3: Implement the localization**

Add the import (alongside Task 4's import):

```js
import { t } from './lib/i18n.mjs';
import { renderLangSelector } from './lib/lang-selector.mjs';
```

Append a selector rule to `PAGE_STYLE` (today's constant, lines 68-88) — add before the closing backtick:

```js
  .lang-switch { font-size: .85rem; color: #777; margin: 0 0 1.5rem; }
  .lang-switch a { color: #1a7f37; text-decoration: none; }
  .lang-switch a:hover { text-decoration: underline; }
  .lang-switch [aria-current] { font-weight: 600; color: #1a1a1a; }
```

**Merge note (2B lands first):** The code block below shows 2C's `shell()` as if starting from the pre-2B version. Per the enforced 2A→2B→2C order, sub-phase 2B will very likely have already landed and modified `shell()` itself — adding its own `lang` handling (used to localize job/progress/error page chrome) and CSS additions to `PAGE_STYLE` (e.g. a progress-bar rule). Do **not** blind-replace 2B's `shell()` with the block below. Instead **merge**: keep 2B's `lang` option plumbing and any progress-bar (or other) CSS it added to `PAGE_STYLE`, and layer this sub-phase's `alternates`/hreflang handling and the `renderLangSelector(lang)` mount on top. The result must still expose the `{lang, alternates}` option shape this sub-phase's callers (`landingPage()`, `localizedErrorPage()`) rely on, while preserving whatever 2B added.

Replace `shell()` (today's lines 90-108):

```js
function shell(title, bodyHtml, { lang = 'en', alternates } = {}) {
  const hreflangLinks = alternates
    ? `\n<link rel="alternate" hreflang="en" href="${escapeHtml(alternates.en)}">`
      + `\n<link rel="alternate" hreflang="fr" href="${escapeHtml(alternates.fr)}">`
      + `\n<link rel="alternate" hreflang="x-default" href="${escapeHtml(alternates.en)}">`
    : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>${hreflangLinks}
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${renderLangSelector(lang)}
${bodyHtml}
<footer>findable-audit · <a href="${REPO_URL}">source on GitHub</a></footer>
</main>
</body>
</html>
`;
}
```

Replace `landingPage()` (today's lines 110-122) — note the FINAL VISUAL DESIGN is intentionally deferred (see the file-level comment added below); this delivers real, functional, correctly-structured bilingual copy, not the pb-ot.fr-inspired restyle:

```js
// The landing page's final visual design (pb-ot.fr-inspired restyle) is
// DEFERRED to a separate visual-companion mockup + user-validation pass (see
// spec addendum §7.1 and §8, sub-phase 2C). This function delivers the
// functional bilingual structure — i18n wiring, hreflang, selector, form —
// using the existing minimal PAGE_STYLE; a future pass restyles it without
// changing this DOM contract (form action, input name, selector markup).
// Note: Task 4's routing block already calls this as `landingPage(split.lang)`
// (the pre-2C zero-arg signature simply ignored the extra argument until now),
// so no call-site change is needed here — only this definition.
function landingPage(lang = 'en') {
  const s = t(lang).landing;
  return shell(s.title, `
<h1>${escapeHtml(s.h1)}</h1>
<p class="lead">${escapeHtml(s.lead)}</p>
<ul class="features">
  <li>${escapeHtml(s.feature1)}</li>
  <li>${escapeHtml(s.feature2)}</li>
  <li>${escapeHtml(s.feature3)}</li>
</ul>
<form method="get" action="/${lang}/audit">
  <input type="url" name="url" placeholder="https://example.com" aria-label="${escapeHtml(s.urlLabel)}"
    autocomplete="off" autocapitalize="off" spellcheck="false" required>
  <button type="submit">${escapeHtml(s.cta)}</button>
</form>
<p class="hint">${escapeHtml(s.hint)}</p>
`, { lang, alternates: { en: '/en/', fr: '/fr/' } });
}
```

Add a new helper right after the pre-existing `errorPage()` (today's lines 124-133), kept separate per Assumption 3:

```js
// Localized 404 for the generic catch-all route. Kept separate from the
// pre-existing errorPage() (which sub-phase 2B also extends for job-lifecycle
// errors) to avoid two independently-authored sub-phases racing to redefine
// the same function signature.
function localizedErrorPage(lang, title, message, { status = 404 } = {}) {
  const body = `
<div class="err">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</div>
<p><a href="/${lang}/">&larr; ${lang === 'fr' ? 'Retour' : 'Back'}</a></p>
`;
  return { status, html: shell(title, body, { lang }) };
}
```

Finally, replace the request handler's final catch-all 404 (today's line 379):

```js
  send(res, 404, 'text/html; charset=utf-8', errorPage('Not found', 'No such page.', { status: 404 }).html);
```

with:

```js
  {
    const lang = req.__lang ?? negotiateLang(req.headers['accept-language']);
    const notFound = t(lang).error.notFound;
    const page = localizedErrorPage(lang, notFound.title, notFound.message, { status: 404 });
    send(res, page.status, 'text/html; charset=utf-8', page.html);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test test/lang-landing.test.mjs && node --test test/`
Expected: PASS — `lang-landing.test.mjs` green, and the FULL `apps/web` test suite (`abuse.test.mjs`, `ssrf.test.mjs`, `lang.test.mjs`, `i18n-landing.test.mjs`, `lang-selector.test.mjs`, `lang-routing.test.mjs`, `lang-landing.test.mjs`) green — no regressions.

- [ ] **Step 5: Update the README and commit**

In `apps/web/README.md`, add a short section documenting the new entry points (adjust wording to match the file's existing tone/heading style once opened):

```markdown
## Languages

The site is served under two path prefixes: `/en` and `/fr`. Visiting `/`
redirects (302) to whichever the browser's `Accept-Language` header prefers,
defaulting to `/en/` otherwise. Every page carries reciprocal `hreflang`
`<link>` tags between the two landing pages and the correct `lang` attribute.
The legacy unprefixed `/audit` page redirects (301) to its `/en` form, since
it is the only human-navigable (typed/bookmarked) route. `/audit/stream`,
`/audit/result`, `/audit/export`, `/healthz`, and `/audit.json` are global,
unprefixed routes left untouched by language routing — they are never
navigated to directly, and redirecting them would add a wasteful extra hop
to every progress/result/export request.
```

```bash
git add apps/web/server.mjs apps/web/test/lang-landing.test.mjs apps/web/README.md
git commit -m "feat(web): localize the landing page, mount hreflang + selector, and localize the 404"
```

## Self-Review

**1. Spec coverage** (spec §7.1, §7.3, §8, and the Phase-2 shared interface contract's "2C produces" section):
- Path-prefix `/en` `/fr` routing (not query-param-only) → Task 4.
- `/` redirects to Accept-Language match else `/en` → Task 4.
- Reciprocal hreflang `<link>` tags between `/en` and `/fr` → Task 5 (scoped to landing pages; see Assumption 4).
- Correct `lang` attribute per page → Task 5 (`shell()`'s `lang` param) for landing/404; job/progress/result pages get theirs from 2A/2B's `renderHtml(report, undefined, lang)` since Task 4's rewrite forces `lang` onto the query string 2B's routes read.
- Extend `apps/web/lib/i18n.mjs` with landing + selector strings → Task 2.
- Language selector control → Task 3, mounted in Task 5.
- Bilingual landing SCAFFOLDING, final visual design deferred → Task 5 (explicit deferral comment in `landingPage()`, functional real copy in both languages, no TBD/placeholder text).
- Progress/error/result pages served under the correct prefix + language → satisfied via Task 4's query-param-forcing rewrite (Assumption 2), with zero new coupling to 2B's internals.

**2. Placeholder scan:** no `TBD`/`TODO`/"add error handling"/"similar to Task N" anywhere above; every code step shows complete, real code (including the actual EN/FR landing copy, not lorem ipsum).

**3. Type consistency:** `'en'|'fr'` is used identically as the `Lang` shape across all five tasks (`lang.mjs`'s `SUPPORTED_LANGS`/`negotiateLang`/`splitLangPrefix`, `i18n.mjs`'s `WEB_MESSAGES`/`t()`, `lang-selector.mjs`'s `renderLangSelector`, and `server.mjs`'s `shell`/`landingPage`/`localizedErrorPage`) — matching the Phase-2 contract's `Lang = 'en' | 'fr'`. `splitLangPrefix`'s `{lang, rest}` shape is used consistently in Task 4 (destructured as `split.lang`/`split.rest`). `shell()`'s third parameter shape (`{lang, alternates}`) is used identically by both its callers (`landingPage()` and `localizedErrorPage()`) in Task 5.

**4. Open questions for the controller / next design pass:**
- Should hreflang extend beyond the landing pages once a decision is made on whether `apps/web` should be indexable at all (currently every page, including landing, ships `meta robots noindex`)? Left out of scope here (Assumption 4) — flagging since it interacts with the deferred landing visual-design pass.
- The generic 404 (`localizedErrorPage`) and the pre-existing `errorPage()` (extended separately by 2B) will likely want unifying once 2B has actually landed — left as a documented follow-up (Assumption 3) rather than guessed at now.
