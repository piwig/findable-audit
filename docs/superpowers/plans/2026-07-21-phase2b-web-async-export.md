# Phase 2B — Web async core: SSE "test en cours" + export + CWV — Implementation Plan

**REQUIRED SUB-SKILL:** Before implementing each task below, invoke `superpowers:test-driven-development` and follow its red→green→commit loop. Never write implementation before the failing test exists and has been observed to fail.

## Goal

Turn the synchronous `/audit` page into an **asynchronous, streamed** experience:

- `/audit?url=&lang=` returns a lightweight **"test en cours"** progress page immediately (nonce'd inline script + `<noscript>` fallback), instead of blocking ~10-90 s on a full audit.
- The audit runs server-side as an **in-memory job**; the browser follows its progress live over **Server-Sent Events** (`/audit/stream`).
- On completion the browser lands on `/audit/result`, which renders the final report with **download buttons** (`/audit/export?format=md|html|json`).
- **Core Web Vitals** turn on automatically when `PSI_KEY` is set in the environment (with a raised audit timeout).
- The CLI gains **`--report *.json`** dispatch and a **`--lang <en|fr>`** flag.

This sub-phase is the sole creator of `apps/web/lib/jobs.mjs` and `apps/web/lib/i18n.mjs` (the WEB chrome catalogue), and instruments the runner with `onProgress`. It **consumes** 2A's `renderHtml(report, now?, lang?)` / `renderMarkdown(report, now?, lang?)` / `renderJson(report)`.

## Architecture

```
Browser                         apps/web/server.mjs                      packages/cli (dist)
───────                         ───────────────────                      ──────────────────
GET /audit?url=&lang=  ─────►   rate-limit → SSRF assertPublicUrl
                                jobs.create({url,lang})  ──────────►     (nothing runs yet)
                        ◄─────  progress page (CSP nonce + noscript)

EventSource /audit/stream?job=  ensureStarted(job) ──► executeAudit ──►  runAudit(url, checks, {
  event: progress {phase,done,total}        onProgress → jobs.setProgress   onProgress, cwv?, signal})
  event: done | error                     (poll job → SSE frames)         ▲ emits AuditProgress
                        ◄─────

GET /audit/result?job=          ensureStarted(job); await settle
                        ◄─────  renderHtml(report,undefined,lang) + chrome (download bar)

GET /audit/export?job=&format=  renderJson / renderMarkdown / renderHtml
                        ◄─────  Content-Disposition: attachment; filename="host-date.ext"
```

- **Execution is lazy and idempotent.** `/audit` only *creates* the job. The audit is started (exactly once, guarded by a `running` map) by whichever of `/audit/stream` or `/audit/result` is hit first. This makes the JS path (SSE) and the `<noscript>` path (meta-refresh straight to `/audit/result`) share one execution.
- **SSE is poll-based.** The stream handler reads the job's latest `progress`/`status` on a short interval and emits frames. This decouples the runner from any single response and lets multiple readers (stream + result) observe one job.
- **SSRF guard is unchanged.** `assertPublicUrl` + `blockPrivateHosts:true` still gate every audit. `/audit` never fetches the target (execution is lazy), so creating a job for a public IP does not touch the network until a consumer starts it.

## Tech Stack

- `apps/web`: Node ≥20, **zero npm dependencies**, ESM `.mjs`, `node:http`, `node:crypto` (`randomUUID`, `randomBytes`). Tests: `node --test`.
- `packages/cli`: TypeScript, ESM imports with `.js` suffixes. Tests: `vitest`.
- SSE over `text/event-stream`; nonce CSP only on the progress page.

## Global Constraints

Copied verbatim from the shared contract (§ CONTRAINTES) — every task must respect these:

> **CONTRAINTES (tous)** : Node ≥20 ESM (imports `.js`) ; ZÉRO dépendance npm (apps/web reste zéro-dép) ; pas de `process.exit` après le début de l'audit ; rapport HTML autonome (liens `<a>` doc autorisés) ; garde SSRF inchangée ; invariant `perfect-site`=100 préservé ; cross-platform (`path.join`) ; tests vitest (packages/cli) + node:test sur vrai serveur HTTP local (apps/web).

Plus the two hardening clauses that bind 2B:

> **Durcissement #1** — `apps/web/lib/i18n.mjs` (catalogue chrome WEB) : créateur UNIQUE = 2B. 2B livre le squelette COMPLET : `export const WEB_MESSAGES` (nom d'export EXACT) de forme `Record<Lang, { progress:{…}, error:{ rateLimited, busy, timeout, unreachable, notFound }, landing:{…}, selector:{…} }>` + `export function t(lang)`. `error` est un objet IMBRIQUÉ. 2B remplit `progress` + `error.{rateLimited,busy,timeout,unreachable}` ; il laisse `landing`, `selector`, `error.notFound` en stubs vides que 2C REMPLIT (2C ajoute des valeurs, ne recrée JAMAIS le fichier).

> **Durcissement #3** — Pages d'erreur : 2C garde son `localizedErrorPage(lang, …)` distinct de `errorPage()` ; l'unification `errorPage`↔`localizedErrorPage` est un follow-up une fois 2B posé (noté ici : 2B garde `errorPage()` inchangé et ne crée PAS `localizedErrorPage`).

Additional 2B invariants:
- **CSP nonce only on the progress page.** Every other HTML page keeps `script-src 'none'`.
- **No `process.exit` after an audit starts.** (2B's server never calls `process.exit`; the CLI may only `process.exit` during arg validation, before `runAudit`.)
- **onProgress is best-effort:** wrapped in try/catch, never alters results, never throws into the audit.

## File Structure

```
packages/cli/src/runner.ts                    MODIFY  AuditPhase, AuditProgress, AuditOptions.onProgress + emission points
packages/cli/src/index.ts                     MODIFY  --lang <en|fr> flag, --report *.json dispatch
apps/web/lib/jobs.mjs                          NEW    in-memory bounded+TTL job store (2B sole creator)
apps/web/lib/i18n.mjs                          NEW    WEB_MESSAGES + t() skeleton (2B sole creator; 2C fills stubs)
apps/web/server.mjs                            MODIFY  async routes, SSE, progress page, export, CWV, lazy execution
packages/cli/test/runner-progress.test.ts      NEW    onProgress emission (vitest, local fixture)
packages/cli/test/cli-report-dispatch.test.ts   NEW    --report *.json + --lang (vitest, spawns built CLI)
apps/web/test/jobs.test.mjs                     NEW    job store lifecycle (node:test)
apps/web/test/i18n.test.mjs                     NEW    WEB_MESSAGES shape + stubs (node:test)
apps/web/test/server-async.test.mjs             NEW    progress page + SSE + result + export (node:test, real local server)
docs/... / apps/web README                     MODIFY  async flow, export, PSI_KEY, nginx SSE (Task 10)
```

> Build order note: `apps/web` imports `packages/cli/dist/*`. Every apps/web task (and its tests) requires a fresh `packages/cli` build first: `cd packages/cli && npm run build`. Tasks 1 and 9 (CLI) must therefore land and build before Tasks 4-8 tests are meaningful.

---

## Task 1 — Runner `onProgress` + `AuditProgress` types

**Files:** `packages/cli/src/runner.ts`, `packages/cli/test/runner-progress.test.ts`
**Interfaces:**
```ts
export type AuditPhase = 'connect' | 'sample' | 'checks' | 'cwv' | 'score';
export interface AuditProgress {
  phase: AuditPhase;
  done: number;
  total: number;
  checkId?: string;
  family?: Family;   // Family = the check-family union; see import note below
}
// AuditOptions gains:
onProgress?: (ev: AuditProgress) => void;
```

- [ ] Write the failing test `packages/cli/test/runner-progress.test.ts` with REAL code:
```ts
import { test, expect } from 'vitest';
import http from 'node:http';
import { runAudit, type AuditProgress } from '../src/runner.js';
import { buildChecks } from '../src/checks/index.js';

const FIXTURE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>Fixture</title><meta name="description" content="a test fixture page">' +
  '</head><body><h1>Hello</h1><p>Some readable content for the audit.</p></body></html>';

async function withFixture(fn: (base: string) => Promise<void>) {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as import('node:net').AddressInfo;
  try { await fn(`http://127.0.0.1:${port}/`); }
  finally { server.close(); }
}

test('runAudit emits ordered onProgress events across phases', async () => {
  await withFixture(async (base) => {
    const events: AuditProgress[] = [];
    await runAudit(base, buildChecks(), { onProgress: (e) => events.push(e) });

    expect(events.some((e) => e.phase === 'connect')).toBe(true);
    expect(events.some((e) => e.phase === 'sample')).toBe(true);
    expect(events.some((e) => e.phase === 'checks')).toBe(true);
    expect(events.some((e) => e.phase === 'score')).toBe(true);

    const checks = events.filter((e) => e.phase === 'checks');
    expect(checks.length).toBeGreaterThan(0);
    const last = checks[checks.length - 1];
    expect(last.done).toBe(last.total);          // monotone, ends at total
    expect(typeof last.checkId).toBe('string');  // per-check id present
  });
});

test('onProgress that throws never breaks the audit (best-effort)', async () => {
  await withFixture(async (base) => {
    const report = await runAudit(base, buildChecks(), {
      onProgress: () => { throw new Error('boom'); },
    });
    expect(report.score).toBeGreaterThanOrEqual(0);   // audit still completes
  });
});
```
- [ ] Run `cd packages/cli && npx vitest run test/runner-progress.test.ts` → **expect FAIL** (`onProgress` / `AuditProgress` do not exist yet; TS/compile error or assertion failure).
- [ ] Implement in `packages/cli/src/runner.ts`. `Family` is exported from `./types.js` (NOT from `./scoring.js` — `scoring.ts` itself only does `import type { CheckResult, Family } from './types.js';`, it does not re-export it). `runner.ts` already has `import type { Check, CheckResult } from './types.js';` — add `Family` to THAT import instead of adding it to the `scoring.js` import:
```ts
import type { Check, CheckResult, Family } from './types.js';
// ... (existing import { makeResult } from './types.js'; and other imports unchanged)
import { computeScore, type Grade, type FamilyScore } from './scoring.js';

export type AuditPhase = 'connect' | 'sample' | 'checks' | 'cwv' | 'score';

export interface AuditProgress {
  phase: AuditPhase;
  done: number;
  total: number;
  checkId?: string;
  family?: Family;
}
```
Add to `AuditOptions`:
```ts
  /**
   * Best-effort progress callback for a live UI (e.g. the web app's SSE stream).
   * Wrapped in try/catch by the runner: it never throws into the audit and never
   * alters results. Fired for phases connect → sample → (cwv) → checks → score.
   */
  onProgress?: (ev: AuditProgress) => void;
```
Rewrite the body of `runAudit` to emit at each phase boundary:
```ts
export async function runAudit(url: string, checks: Check[], opts: AuditOptions = {}): Promise<AuditReport> {
  const emit = (ev: AuditProgress): void => { try { opts.onProgress?.(ev); } catch { /* best-effort: never break the audit */ } };

  const crawler = new Crawler(url, opts.timeoutMs, opts.userAgent, {
    blockPrivateHosts: opts.blockPrivateHosts,
    signal: opts.signal,
  });

  emit({ phase: 'connect', done: 0, total: 1 });
  const home = await crawler.fetch('/');
  if (home === null) throw new UnreachableSiteError(`Cannot reach ${url}`);
  emit({ phase: 'connect', done: 1, total: 1 });

  crawler.sample = await samplePages(crawler, opts.maxPages ?? 10);
  emit({ phase: 'sample', done: crawler.sample.pages.length, total: opts.maxPages ?? 10 });

  if (opts.cwv) {
    emit({ phase: 'cwv', done: 0, total: 1 });
    crawler.psi = await fetchPsi(crawler.baseUrl.toString(), {
      key: opts.psiKey,
      strategy: opts.psiStrategy ?? 'mobile',
      signal: opts.signal,
    });
    emit({ phase: 'cwv', done: 1, total: 1 });
  }

  const results: CheckResult[] = [];
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    let res: CheckResult;
    try {
      res = await check.run(crawler);
    } catch (err) {
      res = makeResult(check, 'skip', `check crashed: ${(err as Error).message}`);
    }
    results.push(res);
    emit({ phase: 'checks', done: i + 1, total: checks.length, checkId: check.id, family: res.family });
  }

  const { score, grade, familyScores } = computeScore(results);
  emit({ phase: 'score', done: 1, total: 1 });
  const sampledPages = crawler.sample.pages.map(pathOf);
  return { url: crawler.baseUrl.toString(), score, grade, familyScores, sampledPages, results, psi: crawler.psi };
}
```
> `res.family` and `check.id`: `CheckResult.family` is the field `computeScore` already groups by, and `Check.id` is used by `makeResult`/`pathOf`; both exist. If TS complains about `res.family`, read the family from the check instead (`check.family`) — do not change the emitted shape.
- [ ] Run `cd packages/cli && npx vitest run test/runner-progress.test.ts` → **expect PASS**.
- [ ] Run the full CLI suite `cd packages/cli && npx vitest run` → **expect PASS** (perfect-site invariant untouched; `onProgress` is additive and optional).
- [ ] `git add -A && git commit -m "feat(runner): best-effort onProgress + AuditProgress phase events"`.

---

## Task 2 — `apps/web/lib/jobs.mjs` in-memory job store

**Files:** `apps/web/lib/jobs.mjs`, `apps/web/test/jobs.test.mjs`
**Interfaces:** `createJobStore({ ttlMs?, maxJobs? }) → { create, get, setProgress, finish, fail, prune, size }`. Job = `{ id, url, lang, status:'running'|'done'|'error', progress, report, html, error, createdAt }`.

- [ ] Write failing test `apps/web/test/jobs.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from '../lib/jobs.mjs';

test('create() returns a running job with a unique id and stored fields', () => {
  const store = createJobStore();
  const a = store.create({ url: 'https://example.com/', lang: 'fr' });
  const b = store.create({ url: 'https://example.org/', lang: 'en' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.status, 'running');
  assert.equal(a.url, 'https://example.com/');
  assert.equal(a.lang, 'fr');
  assert.equal(a.progress, null);
  assert.equal(store.get(a.id), a);
});

test('setProgress / finish / fail mutate the stored job', () => {
  const store = createJobStore();
  const j = store.create({ url: 'https://example.com/', lang: 'en' });
  store.setProgress(j.id, { phase: 'checks', done: 3, total: 10 });
  assert.equal(store.get(j.id).progress.done, 3);
  store.finish(j.id, { report: { score: 100 }, html: '<html></html>' });
  assert.equal(store.get(j.id).status, 'done');
  assert.equal(store.get(j.id).html, '<html></html>');
  const k = store.create({ url: 'https://x.test/', lang: 'en' });
  store.fail(k.id, 'timeout', 'too slow');
  assert.equal(store.get(k.id).status, 'error');
  assert.deepEqual(store.get(k.id).error, { code: 'timeout', message: 'too slow' });
});

test('get() treats an expired job as absent and prune() drops it', () => {
  const store = createJobStore({ ttlMs: 10 });
  const j = store.create({ url: 'https://example.com/', lang: 'en' });
  const future = Date.now() + 50;
  assert.equal(store.get(j.id, future), undefined);
});

test('prune() bounds the store to maxJobs (oldest evicted)', () => {
  const store = createJobStore({ maxJobs: 2 });
  const a = store.create({ url: 'a', lang: 'en' });
  store.create({ url: 'b', lang: 'en' });
  store.create({ url: 'c', lang: 'en' }); // triggers prune on create
  assert.equal(store.get(a.id), undefined); // oldest gone
  assert.equal(store.size, 2);
});
```
- [ ] Run `cd apps/web && node --test test/jobs.test.mjs` → **expect FAIL** (module missing).
- [ ] Implement `apps/web/lib/jobs.mjs`:
```js
// In-memory job store for asynchronous audits (no dependencies).
//
// Single-process, behind nginx: state lives in memory and resets on restart.
// Bounded two ways so it cannot grow without limit under abuse:
//   - TTL: a job older than ttlMs is treated as absent and pruned.
//   - maxJobs: on overflow the oldest (Map insertion order) job is evicted.
//
// Job shape (contract): { id, url, lang, status, progress, report, html, error, createdAt }.
//   status  : 'running' | 'done' | 'error'
//   progress: the latest AuditProgress snapshot, or null before the first event
//   report  : the AuditReport once done, else null
//   html    : the pre-rendered report HTML once done, else null
//   error   : { code, message } once failed, else null

import { randomUUID } from 'node:crypto';

export function createJobStore(opts = {}) {
  const ttlMs = opts.ttlMs ?? 180_000;
  const maxJobs = opts.maxJobs ?? 500;
  /** @type {Map<string, any>} */
  const jobs = new Map();

  function create({ url, lang }) {
    const job = {
      id: randomUUID(),
      url,
      lang,
      status: 'running',
      progress: null,
      report: null,
      html: null,
      error: null,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    prune();
    return job;
  }

  function get(id, now = Date.now()) {
    const job = jobs.get(id);
    if (!job) return undefined;
    if (now - job.createdAt >= ttlMs) { jobs.delete(id); return undefined; }
    return job;
  }

  function setProgress(id, progress) { const j = jobs.get(id); if (j) j.progress = progress; }
  function finish(id, { report, html }) { const j = jobs.get(id); if (j) { j.status = 'done'; j.report = report; j.html = html; } }
  function fail(id, code, message) { const j = jobs.get(id); if (j) { j.status = 'error'; j.error = { code, message }; } }

  function prune(now = Date.now()) {
    for (const [id, j] of jobs) if (now - j.createdAt >= ttlMs) jobs.delete(id);
    while (jobs.size > maxJobs) {
      const oldest = jobs.keys().next().value;
      if (oldest === undefined) break;
      jobs.delete(oldest);
    }
  }

  return { create, get, setProgress, finish, fail, prune, get size() { return jobs.size; } };
}
```
- [ ] Run `cd apps/web && node --test test/jobs.test.mjs` → **expect PASS**.
- [ ] `git add -A && git commit -m "feat(web): in-memory bounded+TTL job store"`.

---

## Task 3 — `apps/web/lib/i18n.mjs` WEB_MESSAGES skeleton + `t()`

**Files:** `apps/web/lib/i18n.mjs`, `apps/web/test/i18n.test.mjs`
**Interfaces:** `export const WEB_MESSAGES: Record<Lang, { progress:{…}, error:{ rateLimited, busy, timeout, unreachable, notFound }, landing:{…}, selector:{…} }>`; `export function t(lang)`. 2B fills `progress` + `error.{rateLimited,busy,timeout,unreachable}`; leaves `landing`, `selector`, `error.notFound` as **empty stubs** for 2C.

- [ ] Write failing test `apps/web/test/i18n.test.mjs`:
```js
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
```
- [ ] Run `cd apps/web && node --test test/i18n.test.mjs` → **expect FAIL** (module missing).
- [ ] Implement `apps/web/lib/i18n.mjs` (2B is the SOLE creator; 2C only ADDS values into the empty stubs, never recreates the file):
```js
// WEB chrome i18n catalogue for the public audit app (SEPARATE from the report
// catalogue that lives in packages/cli/src/report/i18n.ts).
//
// OWNERSHIP (contract hardening #1): 2B is the sole creator of this file and
// delivers the COMPLETE skeleton. 2B fills `progress` and
// `error.{rateLimited,busy,timeout,unreachable}`. It leaves `landing`,
// `selector` and `error.notFound` as empty {} stubs that 2C fills in place —
// 2C ADDS values, it never recreates this file.
//
// Shape: Record<Lang, {
//   progress: { title, heading, lead, phases:{connect,sample,checks,cwv,score}, done, failed, noscript, retry },
//   error:    { rateLimited, busy, timeout, unreachable, notFound },   // each {title,message}; notFound is a 2C stub
//   landing:  {},   // 2C
//   selector: {},   // 2C
// }>

export const WEB_MESSAGES = {
  en: {
    progress: {
      title: 'Audit in progress',
      heading: 'Auditing your site',
      lead: 'This usually takes 10-30 seconds. Please keep this page open.',
      phases: {
        connect: 'Connecting to the site…',
        sample: 'Discovering pages…',
        checks: 'Running checks…',
        cwv: 'Measuring Core Web Vitals…',
        score: 'Scoring…',
      },
      done: 'Done — loading your report…',
      failed: 'The audit could not be completed.',
      noscript: 'JavaScript is disabled. Your report will load automatically in a moment.',
      retry: 'Audit another site',
    },
    error: {
      rateLimited: { title: 'Too many requests', message: 'You have run too many audits in a short time. Please wait a moment and try again.' },
      busy: { title: 'Server busy', message: 'The server is busy running other audits. Please try again in a few seconds.' },
      timeout: { title: 'Audit timed out', message: 'The audit took too long and was stopped. The target site may be slow or unresponsive.' },
      unreachable: { title: 'Site unreachable', message: 'Could not reach that site — it may be down or blocking automated requests.' },
      notFound: {}, // 2C fills { title, message }
    },
    landing: {},  // 2C
    selector: {}, // 2C
  },
  fr: {
    progress: {
      title: 'Audit en cours',
      heading: 'Audit de votre site',
      lead: "Cela prend généralement 10 à 30 secondes. Gardez cette page ouverte.",
      phases: {
        connect: 'Connexion au site…',
        sample: 'Découverte des pages…',
        checks: 'Exécution des vérifications…',
        cwv: 'Mesure des Core Web Vitals…',
        score: 'Calcul du score…',
      },
      done: 'Terminé — chargement de votre rapport…',
      failed: "L'audit n'a pas pu être terminé.",
      noscript: 'JavaScript est désactivé. Votre rapport se chargera automatiquement dans un instant.',
      retry: 'Auditer un autre site',
    },
    error: {
      rateLimited: { title: 'Trop de requêtes', message: "Vous avez lancé trop d'audits en peu de temps. Patientez un instant puis réessayez." },
      busy: { title: 'Serveur occupé', message: "Le serveur exécute déjà d'autres audits. Réessayez dans quelques secondes." },
      timeout: { title: "L'audit a expiré", message: "L'audit a pris trop de temps et a été arrêté. Le site cible est peut-être lent ou ne répond pas." },
      unreachable: { title: 'Site injoignable', message: "Impossible de joindre ce site — il est peut-être hors ligne ou bloque les requêtes automatisées." },
      notFound: {}, // 2C
    },
    landing: {},  // 2C
    selector: {}, // 2C
  },
};

/** Return the WEB chrome catalogue for `lang`, falling back to English. */
export function t(lang) {
  return WEB_MESSAGES[lang] ?? WEB_MESSAGES.en;
}
```
- [ ] Run `cd apps/web && node --test test/i18n.test.mjs` → **expect PASS**.
- [ ] `git add -A && git commit -m "feat(web): WEB_MESSAGES i18n skeleton + t() (2B fills progress+errors, 2C stubs)"`.

---

## Task 4 — `/audit` progress page + nonce CSP + `<noscript>` fallback (server restructure)

**Files:** `apps/web/server.mjs`, `apps/web/test/server-async.test.mjs`
**Interfaces:** `GET /audit?url=&lang=` → 200 HTML progress page; response carries a per-request CSP `script-src 'nonce-…'`; body has one `<script nonce="…">` (EventSource client), a `<noscript>` meta-refresh to `/audit/result`, and `<html lang="…">`.

This task restructures `server.mjs`: imports, constants, `shell()` gains a `lang` option, `send()` stops clobbering a caller-supplied CSP, and the new `handleAuditStart` + `progressPage` are added. The lazy-execution plumbing (`executeAudit`, `ensureStarted`, `classifyError`) and the remaining routes are added in Tasks 5-8; wire the `/audit` route now.

- [ ] Write failing test additions in `apps/web/test/server-async.test.mjs` (shared harness reused by Tasks 5-8):
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

// Bind an ephemeral port BEFORE importing the server (which listens on import).
process.env.PORT = '0';
const { server, jobs } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

// A literal PUBLIC IP passes assertPublicUrl without DNS and is NOT blocked
// (see ssrf.test.mjs). /audit only CREATES the job — it never fetches the target
// (execution is lazy), so no outbound network call happens here.
const PUBLIC = 'http://93.184.216.34/';

test('GET /audit returns a nonce-CSP progress page (no audit run)', async () => {
  const res = await fetch(`${BASE}/audit?url=${encodeURIComponent(PUBLIC)}&lang=fr`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'nonce-[^']+'/);
  assert.match(csp, /connect-src 'self'/);
  const html = await res.text();
  assert.match(html, /<html lang="fr"/);
  const nonce = csp.match(/nonce-([^']+)/)[1];
  assert.ok(html.includes(`<script nonce="${nonce}">`), 'inline script carries the CSP nonce');
  assert.match(html, /<noscript>/);
  assert.match(html, /\/audit\/result\?job=/);   // noscript fallback target
  assert.match(html, /new EventSource\('\/audit\/stream\?job='/);
});

test('GET /audit with a blocked (localhost) URL returns an error page, no job', async () => {
  const before = jobs.size;
  const res = await fetch(`${BASE}/audit?url=${encodeURIComponent('http://localhost/')}`);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  assert.equal(jobs.size, before); // blocked before job creation
});

test('landing page still served at / with the default (script-src none) CSP', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'none'/);
});
```
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect FAIL** (`jobs` not exported; `/audit` still synchronous; no nonce CSP).
- [ ] Implement in `apps/web/server.mjs`:
  1. Add imports near the top:
```js
import crypto from 'node:crypto';

import { renderMarkdown } from '../../packages/cli/dist/report/markdown.js';
import { createJobStore } from './lib/jobs.mjs';
import { t } from './lib/i18n.mjs';
```
  2. Let tests bind an ephemeral port — change the PORT line so `'0'` is honoured (currently `Number(x) || 3021` turns 0 into 3021):
```js
const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 3021;
```
  3. Add the CWV timeout constant beside `AUDIT_TIMEOUT_MS`:
```js
const AUDIT_TIMEOUT_CWV_MS = 90_000; // raised cap when CWV (PageSpeed) is active; nginx proxy_read_timeout must be >= this.
```
  4. Create the job store beside the cache, and prune it in the existing sweep interval:
```js
const jobs = createJobStore({ ttlMs: 180_000, maxJobs: 500 });
```
   and in the `setInterval(...)` sweep body add `jobs.prune();`.
  5. `shell()` gains a `lang` option (default keeps existing behaviour):
```js
function shell(title, bodyHtml, { lang = 'en' } = {}) {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${bodyHtml}
<footer>findable-audit · <a href="${REPO_URL}">source on GitHub</a></footer>
</main>
</body>
</html>
`;
}
```
  6. `send()` must not clobber a caller-supplied CSP (the nonce page passes its own):
```js
function send(res, status, contentType, body, extraHeaders = {}) {
  const headers = {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  };
  // Default CSP for served HTML, unless the caller already set one (progress page).
  if (contentType.startsWith('text/html') && !('content-security-policy' in headers)) {
    headers['content-security-policy'] = CSP;
  }
  res.writeHead(status, headers);
  res.end(body);
}
```
  7. Add progress-bar CSS to `PAGE_STYLE` (append inside the template literal):
```css
  .progress { height: 8px; background: #eee; border-radius: 999px; overflow: hidden; margin: 0 0 1rem; }
  .bar { height: 100%; width: 0; background: #1a7f37; transition: width .3s ease; }
```
  8. Add a language normaliser and the progress page builder:
```js
function normalizeLang(raw) { return raw === 'fr' ? 'fr' : 'en'; }

function progressPage(jobId, lang, nonce) {
  const m = t(lang).progress;
  const id = encodeURIComponent(jobId);
  // Our own controlled catalogue; JSON.stringify + escape '<' guards against a
  // stray "</script>" ever appearing in a label.
  const labels = JSON.stringify(m.phases).replace(/</g, '\\u003c');
  const jobLiteral = JSON.stringify(jobId);
  const body = `
<h1>${escapeHtml(m.heading)}</h1>
<p class="lead">${escapeHtml(m.lead)}</p>
<div class="progress" role="progressbar" aria-live="polite" aria-label="${escapeHtml(m.heading)}">
  <div id="bar" class="bar" style="width:0%"></div>
</div>
<p id="status" class="hint">${escapeHtml(m.phases.connect)}</p>
<noscript>
  <meta http-equiv="refresh" content="0; url=/audit/result?job=${id}">
  <p>${escapeHtml(m.noscript)} <a href="/audit/result?job=${id}">${escapeHtml(m.done)}</a></p>
</noscript>
<script nonce="${nonce}">
(function () {
  var LABELS = ${labels};
  var status = document.getElementById('status');
  var bar = document.getElementById('bar');
  var job = ${jobLiteral};
  var es = new EventSource('/audit/stream?job=' + encodeURIComponent(job));
  es.addEventListener('progress', function (e) {
    try {
      var p = JSON.parse(e.data);
      if (status && LABELS[p.phase]) status.textContent = LABELS[p.phase];
      if (bar && p.total) bar.style.width = Math.round(p.done / p.total * 100) + '%';
    } catch (_) {}
  });
  es.addEventListener('done', function () { es.close(); window.location = '/audit/result?job=' + encodeURIComponent(job); });
  es.addEventListener('error', function () { es.close(); window.location = '/audit/result?job=' + encodeURIComponent(job); });
})();
</script>
`;
  return shell(m.title, body, { lang });
}
```
  9. Add `handleAuditStart` (rate-limit + SSRF, then create job + return progress page). It reuses the existing `errorPage`, `normalizeInput`, `assertPublicUrl`, `rateLimiter`, `clientIp`:
```js
async function handleAuditStart(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const lang = normalizeLang(parsed.searchParams.get('lang'));

  const ip = clientIp(req);
  const rl = rateLimiter.take(ip);
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    const e = t(lang).error.rateLimited;
    const p = errorPage(e.title, `${e.message} (~${retryAfter}s)`, { status: 429 });
    send(res, p.status, 'text/html; charset=utf-8', p.html, { 'retry-after': String(retryAfter) });
    return;
  }

  const rawUrl = parsed.searchParams.get('url') ?? '';
  const normalized = normalizeInput(rawUrl);
  if (normalized === '') {
    const p = errorPage('Missing URL', 'Please provide a URL to audit.');
    send(res, p.status, 'text/html; charset=utf-8', p.html);
    return;
  }

  let url;
  try {
    url = await assertPublicUrl(normalized);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      const p = errorPage('URL not allowed', err.message);
      send(res, p.status, 'text/html; charset=utf-8', p.html);
      return;
    }
    throw err;
  }

  // Create the job but DO NOT run the audit yet — execution is lazy, kicked off
  // by /audit/stream or /audit/result (whichever the client hits first).
  const job = jobs.create({ url: url.href, lang });
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; "
    + `script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; `
    + "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  send(res, 200, 'text/html; charset=utf-8', progressPage(job.id, lang, nonce), { 'content-security-policy': csp });
}
```
  10. In `http.createServer`, replace the old `/audit` branch so it calls the async starter (keep `/audit.json` on the synchronous `handleAudit`):
```js
  if (pathname === '/audit') {
    handleAuditStart(req, res).catch((err) => {
      console.error('unhandled /audit error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
```
  11. Export the job store for tests/introspection: change the final export to `export { server, jobs };`.
- [ ] Run `cd packages/cli && npm run build` then `cd apps/web && node --test test/server-async.test.mjs` → **expect PASS** for the Task 4 cases (SSE/result/export cases still fail until Tasks 5-7).
- [ ] `git add -A && git commit -m "feat(web): async /audit progress page with nonce CSP + noscript fallback"`.

---

## Task 5 — `/audit/stream` SSE running the job with `onProgress`

**Files:** `apps/web/server.mjs`, `apps/web/test/server-async.test.mjs`
**Interfaces:** `GET /audit/stream?job=` → `text/event-stream`; frames `event: progress` (data = the AuditProgress JSON), then terminal `event: done` (data `{}`) or `event: error` (data `{code,message}`). Starts the job (idempotent) via `ensureStarted`.

- [ ] Add failing test cases to `apps/web/test/server-async.test.mjs`:
```js
// Read an SSE stream until a terminal `event: done|error`, then abort.
async function readSse(url, { timeoutMs = 5000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (/\nevent: (done|error)\n/.test(buf) || buf.startsWith('event: done') || buf.startsWith('event: error')) break;
    }
  } finally { clearTimeout(timer); ac.abort(); }
  return { contentType: res.headers.get('content-type'), text: buf };
}

test('GET /audit/stream emits done immediately for an already-finished job', async () => {
  // Seed a completed job WITHOUT running an audit (no network).
  const job = jobs.create({ url: 'https://example.com/', lang: 'en' });
  jobs.finish(job.id, { report: { url: 'https://example.com/' }, html: '<html><body>ok</body></html>' });
  const { contentType, text } = await readSse(`${BASE}/audit/stream?job=${job.id}`);
  assert.match(contentType, /text\/event-stream/);
  assert.match(text, /event: done/);
});

test('GET /audit/stream emits error with code for a failed job', async () => {
  const job = jobs.create({ url: 'https://example.com/', lang: 'en' });
  jobs.fail(job.id, 'timeout', 'too slow');
  const { text } = await readSse(`${BASE}/audit/stream?job=${job.id}`);
  assert.match(text, /event: error/);
  assert.match(text, /"code":"timeout"/);
});

test('GET /audit/stream with an unknown job returns 404', async () => {
  const res = await fetch(`${BASE}/audit/stream?job=does-not-exist`);
  assert.equal(res.status, 404);
});
```
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect FAIL** for these cases (route not implemented).
- [ ] Implement in `apps/web/server.mjs`. Add the CWV helpers, `classifyError`, lazy-execution plumbing, and the SSE handler (place `executeAudit`/`ensureStarted` in the audit-execution section):
```js
const cwvActive = () => Boolean(process.env.PSI_KEY && process.env.PSI_KEY.trim());
const auditTimeout = () => (cwvActive() ? AUDIT_TIMEOUT_CWV_MS : AUDIT_TIMEOUT_MS);

const running = new Map(); // jobId -> Promise, so an audit runs at most once per job.

function classifyError(err, lang) {
  const e = t(lang).error;
  if (err instanceof AuditTimeoutError) return { code: 'timeout', message: e.timeout.message };
  if (err instanceof UnreachableSiteError) return { code: 'unreachable', message: e.unreachable.message };
  if (err && err.code === 'BUSY') return { code: 'busy', message: e.busy.message };
  console.error('audit error:', err);
  return { code: 'internal', message: 'Something went wrong while auditing that site.' };
}

async function executeAudit(job) {
  const key = job.url;
  const cached = cache.get(key);
  if (cached !== undefined) {
    jobs.finish(job.id, { report: cached, html: renderHtml(cached, undefined, job.lang) });
    return;
  }
  if (inFlight >= MAX_CONCURRENT) {
    jobs.fail(job.id, 'busy', t(job.lang).error.busy.message);
    return;
  }
  inFlight++;
  const ac = new AbortController();
  const opts = {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxPages: MAX_PAGES,
    blockPrivateHosts: true,          // fetch-layer SSRF guard, unchanged.
    signal: ac.signal,
    onProgress: (ev) => jobs.setProgress(job.id, ev),
  };
  if (cwvActive()) { opts.cwv = true; opts.psiKey = process.env.PSI_KEY; opts.psiStrategy = 'mobile'; }
  try {
    const report = await withTimeout(runAudit(key, checks, opts), auditTimeout());
    cache.set(key, report);
    jobs.finish(job.id, { report, html: renderHtml(report, undefined, job.lang) });
  } catch (err) {
    ac.abort();
    const { code, message } = classifyError(err, job.lang);
    jobs.fail(job.id, code, message);
  } finally {
    inFlight--;
  }
}

/** Start a job at most once. No-op (resolved) if it is already terminal. */
function ensureStarted(job) {
  if (job.status !== 'running') return Promise.resolve();
  let pr = running.get(job.id);
  if (!pr) { pr = executeAudit(job); running.set(job.id, pr); }
  return pr;
}

function jobFromQuery(req) {
  const parsed = new URL(req.url, 'http://localhost');
  const id = parsed.searchParams.get('job') ?? '';
  return jobs.get(id);
}

function handleStream(req, res, job) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',          // ask nginx not to buffer the stream.
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.write(': connected\n\n'); // open the stream immediately.
  ensureStarted(job);

  let lastSig = '';
  let quiet = 0;
  const tick = setInterval(() => {
    const j = jobs.get(job.id);
    if (!j) { clearInterval(tick); res.end(); return; }
    const p = j.progress;
    if (p) {
      const sig = `${p.phase}:${p.done}:${p.total}`;
      if (sig !== lastSig) {
        lastSig = sig; quiet = 0;
        res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`);
      }
    }
    if (j.status === 'done') { res.write('event: done\ndata: {}\n\n'); clearInterval(tick); res.end(); return; }
    if (j.status === 'error') {
      res.write(`event: error\ndata: ${JSON.stringify(j.error ?? { code: 'internal', message: '' })}\n\n`);
      clearInterval(tick); res.end(); return;
    }
    if (++quiet >= 50) { quiet = 0; res.write(': ping\n\n'); } // ~10s heartbeat keeps proxies open.
  }, 200);
  req.on('close', () => clearInterval(tick));
}
```
  Add the route in `http.createServer` (before the 404 fallback):
```js
  if (pathname === '/audit/stream') {
    const job = jobFromQuery(req);
    if (!job) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
    handleStream(req, res, job);
    return;
  }
```
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect PASS** for the Task 5 cases.
- [ ] `git add -A && git commit -m "feat(web): /audit/stream SSE with lazy idempotent job execution"`.

---

## Task 6 — `/audit/result` final report (JS and noscript paths)

**Files:** `apps/web/server.mjs`, `apps/web/test/server-async.test.mjs`
**Interfaces:** `GET /audit/result?job=` starts the job if needed, **awaits** it, then serves the localized report HTML (with a download/back chrome bar) or a localized error page. Awaiting makes the `<noscript>` meta-refresh path work with no JS.

- [ ] Add failing test cases:
```js
test('GET /audit/result serves the report with export + back chrome', async () => {
  const job = jobs.create({ url: 'https://example.com/', lang: 'en' });
  jobs.finish(job.id, { report: { url: 'https://example.com/' }, html: '<!doctype html><html><body>REPORT_BODY</body></html>' });
  const res = await fetch(`${BASE}/audit/result?job=${job.id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /REPORT_BODY/);
  assert.ok(html.includes(`/audit/export?job=${job.id}&format=md`));
  assert.ok(html.includes(`/audit/export?job=${job.id}&format=json`));
  assert.match(html, /Audit another site|href="\/"/);
});

test('GET /audit/result serves a localized error page for a failed job', async () => {
  const job = jobs.create({ url: 'https://example.com/', lang: 'fr' });
  jobs.fail(job.id, 'timeout', "L'audit a expiré (test)");
  const res = await fetch(`${BASE}/audit/result?job=${job.id}`);
  assert.equal(res.status, 200); // timeout returns 200 so Cloudflare shows our page
  const html = await res.text();
  assert.match(html, /expiré/);
});

test('GET /audit/result with unknown job returns 404', async () => {
  const res = await fetch(`${BASE}/audit/result?job=nope`);
  assert.equal(res.status, 404);
});
```
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect FAIL** for these cases.
- [ ] Implement in `apps/web/server.mjs`. Add a result-chrome helper (replaces the old `reportWithBackLink`, extending it with job-scoped export links) and `handleResult`:
```js
// Wrap the stored report HTML with a download bar + back link (job-scoped).
function withResultChrome(reportHtml, jobId, lang) {
  const id = encodeURIComponent(jobId);
  const retry = escapeHtml(t(lang).progress.retry);
  const bar = '<p style="max-width:860px;margin:1.5rem auto 0;font:15px -apple-system,Segoe UI,Roboto,sans-serif">'
    + `Download: <a href="/audit/export?job=${id}&format=md" style="color:#1a7f37">Markdown</a> · `
    + `<a href="/audit/export?job=${id}&format=html" style="color:#1a7f37">HTML</a> · `
    + `<a href="/audit/export?job=${id}&format=json" style="color:#1a7f37">JSON</a>`
    + `&nbsp;&nbsp;|&nbsp;&nbsp;<a href="/" style="color:#1a7f37">&larr; ${retry}</a></p>`;
  const marker = '</body>';
  const idx = reportHtml.lastIndexOf(marker);
  if (idx === -1) return reportHtml + bar;
  return reportHtml.slice(0, idx) + bar + '\n' + reportHtml.slice(idx);
}

// HTTP status per error code: timeout/unreachable return 200 (so Cloudflare shows
// OUR friendly page, not its branded 5xx); busy → 429; anything else → 502.
function statusForError(code) {
  if (code === 'timeout' || code === 'unreachable') return 200;
  if (code === 'busy') return 429;
  return 502;
}

async function handleResult(req, res, job) {
  await ensureStarted(job); // starts + awaits (idempotent); no-op if already terminal.
  const j = jobs.get(job.id);
  if (!j) { const p = errorPage('Not found', 'No such page.', { status: 404 }); send(res, p.status, 'text/html; charset=utf-8', p.html); return; }

  if (j.status === 'done' && j.html) {
    send(res, 200, 'text/html; charset=utf-8', withResultChrome(j.html, j.id, j.lang));
    return;
  }
  // Error (or the rare not-yet-terminal race): render a localized error page.
  const code = j.error?.code ?? 'internal';
  const cat = t(j.lang).error[code];
  const title = cat && cat.title ? cat.title : 'Audit failed';
  const message = j.error?.message ?? (cat && cat.message) ?? 'Something went wrong while auditing that site.';
  const status = statusForError(code);
  const p = errorPage(title, message, { status });
  send(res, p.status, 'text/html; charset=utf-8', p.html);
}
```
  Add the route:
```js
  if (pathname === '/audit/result') {
    const job = jobFromQuery(req);
    if (!job) { const p = errorPage('Not found', 'No such page.', { status: 404 }); send(res, p.status, 'text/html; charset=utf-8', p.html); return; }
    handleResult(req, res, job).catch((err) => {
      console.error('unhandled /audit/result error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
```
  Remove the now-unused `reportWithBackLink`. **Correction:** after this task rewires `/audit` to `handleAuditStart`, `handleAudit` is reached only via `/audit.json` with `wantJson=true` — but its existing `else` (HTML) branch still calls `reportWithBackLink(renderHtml(report))` (server.mjs, the `if (wantJson) { … } else { send(res, 200, 'text/html; charset=utf-8', reportWithBackLink(renderHtml(report))); }` block). That branch is now dead code, and deleting `reportWithBackLink` without removing it would leave a dangling reference. So THIS task must also make `handleAudit` **JSON-only**: drop the `wantJson` parameter and every `if (wantJson) {...} else {...}` branch, keeping only the JSON responses. Update the function to:
```js
// ---------------------------------------------------------------------------
// Route handler for /audit.json (JSON-only). The HTML flow is now the async
// /audit → /audit/stream → /audit/result path (handleAuditStart, handleStream,
// handleResult, handleExport) — see Tasks 4-7.
// ---------------------------------------------------------------------------
async function handleAudit(req, res) {
  const ip = clientIp(req);
  const rl = rateLimiter.take(ip);
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    send(res, 429, 'application/json; charset=utf-8',
      JSON.stringify({ error: 'rate_limited', retryAfterSeconds: retryAfter }),
      { 'retry-after': String(retryAfter) });
    return;
  }

  const parsed = new URL(req.url, 'http://localhost');
  const rawUrl = parsed.searchParams.get('url') ?? '';
  const normalized = normalizeInput(rawUrl);
  if (normalized === '') {
    send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing url parameter' }));
    return;
  }

  // 1) SSRF + validation. Failures are safe 400s.
  let url;
  try {
    url = await assertPublicUrl(normalized);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      send(res, 400, 'application/json; charset=utf-8',
        JSON.stringify({ error: 'blocked', reason: err.code, message: err.message }));
      return;
    }
    throw err;
  }

  // 2) Run the audit (concurrency-capped, timed).
  let report;
  try {
    report = await auditUrl(url);
  } catch (err) {
    if (err && err.code === 'BUSY') {
      const msg = 'The server is busy running other audits. Please try again in a few seconds.';
      send(res, 429, 'application/json; charset=utf-8', JSON.stringify({ error: 'busy', message: msg }),
        { 'retry-after': '5' });
      return;
    }
    if (err instanceof AuditTimeoutError) {
      const msg = 'The audit took too long and was stopped. The target site may be slow or unresponsive.';
      send(res, 504, 'application/json; charset=utf-8', JSON.stringify({ error: 'timeout', message: msg }));
      return;
    }
    if (err instanceof UnreachableSiteError) {
      const msg = `Could not reach ${url.href} — the site may be down or blocking automated requests.`;
      send(res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: 'unreachable', message: msg }));
      return;
    }
    // Unexpected failure: log server-side, return a generic message.
    console.error('audit error:', err);
    const msg = 'Something went wrong while auditing that site.';
    send(res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal', message: msg }));
    return;
  }

  // 3) Render JSON only — no reportWithBackLink, no HTML branch.
  send(res, 200, 'application/json; charset=utf-8', renderJson(report));
}
```
  Update the `/audit.json` route registration to match the new (parameterless) signature:
```js
  if (pathname === '/audit.json') {
    handleAudit(req, res).catch((err) => {
      console.error('unhandled /audit.json error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
```
  Leave `auditUrl` (used by `handleAudit` above and by `executeAudit` in Task 5) intact.
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect PASS** for the Task 6 cases.
- [ ] `git add -A && git commit -m "feat(web): /audit/result serves report (JS + noscript) with download chrome"`.

---

## Task 7 — `/audit/export?format=md|html|json` + Content-Disposition

**Files:** `apps/web/server.mjs`, `apps/web/test/server-async.test.mjs`
**Interfaces:** `GET /audit/export?job=&format=md|html|json` → the report as a downloadable file. `Content-Disposition: attachment; filename="<host>-<date>.<ext>"`. Content-types: `text/markdown`, `text/html`, `application/json`.

- [ ] Add failing test cases:
```js
function seedDone(lang = 'en') {
  const job = jobs.create({ url: 'https://example.com/', lang });
  // Minimal-but-valid AuditReport (shape from runner.ts). Empty arrays render
  // cleanly and touch no network. Extend minimally only if a renderer needs more.
  const report = { url: 'https://example.com/', score: 100, grade: 'A', familyScores: [], sampledPages: ['/'], results: [], psi: undefined };
  jobs.finish(job.id, { report, html: '<!doctype html><html><body>x</body></html>' });
  return job;
}

test('GET /audit/export?format=json returns JSON with an attachment filename', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/export?job=${job.id}&format=json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="example\.com-\d{4}-\d{2}-\d{2}\.json"/);
  const parsed = JSON.parse(await res.text());
  assert.equal(parsed.url, 'https://example.com/');
});

test('GET /audit/export?format=md returns markdown', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/export?job=${job.id}&format=md`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.match(res.headers.get('content-disposition'), /\.md"/);
});

test('GET /audit/export rejects an unknown format with 400', async () => {
  const job = seedDone();
  const res = await fetch(`${BASE}/audit/export?job=${job.id}&format=pdf`);
  assert.equal(res.status, 400);
});

test('GET /audit/export with unknown job returns 404', async () => {
  const res = await fetch(`${BASE}/audit/export?job=nope&format=md`);
  assert.equal(res.status, 404);
});
```
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect FAIL** for these cases.
- [ ] Implement in `apps/web/server.mjs`:
```js
function safeHost(urlHref) {
  try { return (new URL(urlHref).hostname || 'report').replace(/[^a-z0-9.-]/gi, '-'); }
  catch { return 'report'; }
}

async function handleExport(req, res, job, format) {
  await ensureStarted(job);
  const j = jobs.get(job.id);
  if (!j) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
  if (j.status !== 'done' || !j.report) {
    const p = errorPage('Report not ready', 'That report is not available for download.', { status: 409 });
    send(res, p.status, 'text/html; charset=utf-8', p.html);
    return;
  }

  let body, contentType, ext;
  if (format === 'json') { body = renderJson(j.report); contentType = 'application/json; charset=utf-8'; ext = 'json'; }
  else if (format === 'md') { body = renderMarkdown(j.report, undefined, j.lang); contentType = 'text/markdown; charset=utf-8'; ext = 'md'; }
  else { body = renderHtml(j.report, undefined, j.lang); contentType = 'text/html; charset=utf-8'; ext = 'html'; }

  const filename = `${safeHost(j.url)}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  send(res, 200, contentType, body, { 'content-disposition': `attachment; filename="${filename}"` });
}
```
  Add the route (validate `format` ∈ {md,html,json} first → 400):
```js
  if (pathname === '/audit/export') {
    const parsed = new URL(req.url, 'http://localhost');
    const format = parsed.searchParams.get('format') ?? '';
    if (format !== 'md' && format !== 'html' && format !== 'json') {
      send(res, 400, 'text/plain; charset=utf-8', 'format must be one of: md, html, json');
      return;
    }
    const job = jobFromQuery(req);
    if (!job) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
    handleExport(req, res, job, format).catch((err) => {
      console.error('unhandled /audit/export error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
```
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect PASS** (all cases green).
- [ ] `git add -A && git commit -m "feat(web): /audit/export md|html|json with Content-Disposition + result download buttons"`.

---

## Task 8 — CWV activation via `PSI_KEY` + timeout bump

**Files:** `apps/web/server.mjs`, `apps/web/test/server-async.test.mjs`
**Interfaces:** When `process.env.PSI_KEY` is set, the async audit (and the sync `/audit.json` path) pass `{ cwv:true, psiKey, psiStrategy:'mobile' }` and use the raised `AUDIT_TIMEOUT_CWV_MS` timeout. When unset, behaviour is exactly as before (CWV skipped).

Most of this landed in Task 5 (`cwvActive`, `auditTimeout`, and their use in `executeAudit`). This task wires the same into the synchronous `auditUrl` (`/audit.json`) and adds a focused test that does **not** hit the real PSI endpoint (assert the *decision*, not a network call).

- [ ] Add failing test cases:
```js
import { cwvActive as _cwvActive } from '../server.mjs'; // NOTE: only if exported; else test via behaviour below.

test('CWV decision follows PSI_KEY presence', async () => {
  const prev = process.env.PSI_KEY;
  try {
    delete process.env.PSI_KEY;
    // A blocked URL never runs the audit, so no PSI call; we assert the helper.
    // (Export cwvActive/auditTimeout for testability.)
    const mod = await import('../server.mjs');
    assert.equal(mod.cwvActive(), false);
    assert.equal(mod.auditTimeout(), 45000);
    process.env.PSI_KEY = 'test-key';
    assert.equal(mod.cwvActive(), true);
    assert.equal(mod.auditTimeout(), 90000);
  } finally {
    if (prev === undefined) delete process.env.PSI_KEY; else process.env.PSI_KEY = prev;
  }
});
```
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect FAIL** (`cwvActive`/`auditTimeout` not exported).
- [ ] Implement in `apps/web/server.mjs`:
  1. Update the synchronous `auditUrl` (used by `/audit.json`) to opt into CWV and use the CWV-aware timeout when `PSI_KEY` is set:
```js
  inFlight++;
  const ac = new AbortController();
  const opts = {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxPages: MAX_PAGES,
    blockPrivateHosts: true,
    signal: ac.signal,
  };
  if (cwvActive()) { opts.cwv = true; opts.psiKey = process.env.PSI_KEY; opts.psiStrategy = 'mobile'; }
  const auditPromise = runAudit(key, checks, opts);
  auditPromise.then(() => { inFlight--; }, () => { inFlight--; });

  let report;
  try {
    report = await withTimeout(auditPromise, auditTimeout());
  } catch (err) {
    ac.abort();
    throw err;
  }
```
  2. Export the two helpers for testability: `export { server, jobs, cwvActive, auditTimeout };`.
- [ ] Run `cd apps/web && node --test test/server-async.test.mjs` → **expect PASS**.
- [ ] `git add -A && git commit -m "feat(web): activate Core Web Vitals via PSI_KEY (raised audit timeout)"`.

---

## Task 9 — CLI `index.ts`: `--report *.json` dispatch + `--lang <en|fr>` flag

**Files:** `packages/cli/src/index.ts`, `packages/cli/test/cli-report-dispatch.test.ts`
**Interfaces:** `--lang <en|fr>` (default `en`), propagated to `renderHtml`/`renderMarkdown` as the last arg. Report file extension routes the renderer: `.json` → `renderJson`, `.html`/`.htm` → `renderHtml`, else `renderMarkdown`.

- [ ] Write failing test `packages/cli/test/cli-report-dispatch.test.ts` (spawns the built CLI against a local fixture — the CLI may audit loopback):
```ts
import { test, expect } from 'vitest';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const FIXTURE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>'
  + '<meta name="description" content="fixture"></head><body><h1>Hi</h1><p>content</p></body></html>';

async function withFixture(fn: (base: string) => void) {
  const server = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(FIXTURE_HTML); });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address() as import('node:net').AddressInfo;
  try { fn(`http://127.0.0.1:${port}/`); } finally { server.close(); }
}

test('--report *.json writes a valid JSON report', async () => {
  await withFixture((base) => {
    const out = path.join(process.cwd(), 'tmp-cli-report.json');
    rmSync(out, { force: true });
    const r = spawnSync(process.execPath, [DIST, base, '--report', out, '--min-score', '0'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(typeof parsed.score).toBe('number');
    rmSync(out, { force: true });
  });
});

test('--lang fr is accepted and writes the md report', async () => {
  await withFixture((base) => {
    const out = path.join(process.cwd(), 'tmp-cli-report-fr.md');
    rmSync(out, { force: true });
    const r = spawnSync(process.execPath, [DIST, base, '--report', out, '--lang', 'fr', '--min-score', '0'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    rmSync(out, { force: true });
  });
});

test('--lang xx is rejected with exit code 2', async () => {
  const r = spawnSync(process.execPath, [DIST, 'https://example.com', '--lang', 'xx'], { encoding: 'utf8' });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/--lang/);
});
```
- [ ] Run `cd packages/cli && npm run build && npx vitest run test/cli-report-dispatch.test.ts` → **expect FAIL** (`--lang` unknown / `.json` not dispatched).
- [ ] Implement in `packages/cli/src/index.ts`:
  1. Import the `Lang` type from 2A's report i18n module (2A owns it):
```ts
import type { Lang } from './report/i18n.js';
```
  2. Add the option to `parseCliArgs`:
```ts
      lang: { type: 'string' },
```
  3. Validate it (before `runAudit`, so `process.exit` is still safe here):
```ts
const lang = (values.lang ?? 'en');
if (lang !== 'en' && lang !== 'fr') {
  console.error(`findable-audit: invalid --lang value "${lang}" (expected "en" or "fr")\n\n${USAGE}`);
  process.exit(2);
}
const langTyped: Lang = lang;
```
  4. Replace the report-writing dispatch loop body:
```ts
  for (const file of targets) {
    let body: string;
    if (/\.json$/i.test(file)) body = renderJson(report);
    else if (/\.html?$/i.test(file)) body = renderHtml(report, now, langTyped);
    else body = renderMarkdown(report, now, langTyped);
    try {
      writeFileSync(file, body, 'utf8');
      console.error(`report written to ${file}`);
    } catch (err) {
      console.error(`findable-audit: cannot write report to "${file}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }
```
  5. Update `USAGE` to document `--lang <en|fr>` and the `.json` report extension:
```ts
const USAGE = `Usage: findable <url> [--json] [--report <file.md|file.html|file.json>] [--no-report] [--lang <en|fr>] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--user-agent <ua>] [--indexnow-key <key>] [--cwv] [--psi-key <key>] [--psi-strategy <mobile|desktop>]
...
--report <file> overrides the default and writes exactly the file(s) you name (repeatable); the format is chosen
  by extension: .html/.htm -> HTML, .json -> JSON, anything else -> Markdown.
--lang selects the report chrome language (en or fr; default en). The 107 checks stay in English.
...`;
```
  (Keep the rest of USAGE intact.)
- [ ] Run `cd packages/cli && npm run build && npx vitest run test/cli-report-dispatch.test.ts` → **expect PASS**.
- [ ] Run the full CLI suite `cd packages/cli && npx vitest run` → **expect PASS**.
- [ ] `git add -A && git commit -m "feat(cli): --report *.json dispatch + --lang <en|fr> flag"`.

---

## Task 10 — Deployment note (nginx SSE + PSI_KEY) + docs

**Files:** `apps/web/README.md` (or the repo guide / docs), plus an ops note referencing memory `[[findable-audit-web-deploiement]]`.
**Interfaces:** none (documentation + ops). No test; verification is a manual config review.

- [ ] Document the async flow, the new routes, JSON export, and `PSI_KEY` in `apps/web/README.md` (append a section):
  - Routes: `/audit` (progress page), `/audit/stream` (SSE), `/audit/result`, `/audit/export?format=md|html|json`, plus the unchanged `/audit.json`.
  - `PSI_KEY` env var: when set, Core Web Vitals turn on and the per-audit timeout rises to 90 s (so `nginx proxy_read_timeout` must be ≥ 90 s).
- [ ] Add the nginx SSE snippet to the deployment note (do NOT edit the live VPS from this repo; this is documentation the operator applies):
```nginx
# findable.conf — add a dedicated location for the SSE stream so nginx does not
# buffer it. The app also sends X-Accel-Buffering: no as a belt-and-braces.
location /audit/stream {
    proxy_pass http://127.0.0.1:3021;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
    proxy_read_timeout 120s;   # >= AUDIT_TIMEOUT_CWV_MS (90s) with headroom.
}

# Raise the general audit timeout too (CWV audits can take ~90s):
location /audit {
    proxy_pass http://127.0.0.1:3021;
    proxy_read_timeout 120s;
}
```
- [ ] Document the systemd unit change for CWV (operator applies on the VPS):
  ```
  # /etc/systemd/system/findable-web.service (or its EnvironmentFile)
  Environment=PSI_KEY=<google-pagespeed-api-key>
  ```
  Note: leaving `PSI_KEY` unset keeps the current keyless behaviour (CWV skipped, static perf heuristics still run).
- [ ] Add a follow-up marker (contract hardening #3): `errorPage()` (2B) and `localizedErrorPage()` (2C) stay separate for now; unify them once 2C lands. Record this in the README's "Known follow-ups" list.
- [ ] `git add -A && git commit -m "docs(web): async/SSE flow, JSON export, PSI_KEY + nginx SSE deployment note"`.

---

## Self-Review

- [ ] **Contract interfaces consumed exactly.** Renderers are called as `renderHtml(report, undefined, lang)` / `renderMarkdown(report, undefined, lang)` / `renderJson(report)` — `lang` last, matching 2A's `(report, now?, lang?)`. CLI imports `Lang` from `./report/i18n.js` (2A owns it). Routes are `/audit`, `/audit/stream`, `/audit/result`, `/audit/export`; `/audit.json` kept.
- [ ] **Sole ownership honoured.** 2B creates `apps/web/lib/jobs.mjs` and `apps/web/lib/i18n.mjs`. `i18n.mjs` exports `WEB_MESSAGES` (exact name) with **nested** `error`, fills `progress` + `error.{rateLimited,busy,timeout,unreachable}`, and leaves `landing`/`selector`/`error.notFound` as `{}` stubs for 2C. `t(lang)` returns the catalogue with an EN fallback.
- [ ] **CSP nonce only on the progress page.** `send()` now respects a caller-supplied CSP; every other HTML page still gets the default `script-src 'none'` CSP. The progress page is the only page with an inline `<script nonce>` and `connect-src 'self'`.
- [ ] **noscript path works.** `<noscript>` meta-refreshes to `/audit/result`, which starts+awaits the job (lazy, idempotent) and serves the report with no JS. The JS path streams via SSE then navigates to the same result route.
- [ ] **SSRF guard unchanged.** `assertPublicUrl` + `blockPrivateHosts:true` still gate every audit. `/audit` does not fetch the target (execution is lazy), so the progress-page test uses a public IP literal without any outbound call.
- [ ] **onProgress is best-effort.** Wrapped in try/catch inside `runAudit`; a throwing callback does not break the audit; results/score (perfect-site=100 invariant) are untouched — verified by the full CLI suite.
- [ ] **No `process.exit` after an audit starts.** The web server never calls `process.exit`; failures write to the job (`fail`) and are surfaced via SSE/result. The CLI only `process.exit`s during arg validation (`--lang`), before `runAudit`.
- [ ] **Zero dependencies.** Only `node:http`, `node:crypto`, and the CLI's built `dist/*`. SSE is hand-rolled; no npm additions.
- [ ] **Tests are hermetic.** CLI tests use local loopback fixtures (allowed: `blockPrivateHosts` off). apps/web tests bind an ephemeral port (`PORT=0`), seed jobs directly for the SSE/result/export happy paths, and never make a real outbound call. The minimal seeded `AuditReport` uses empty arrays; extend it only if a 2A renderer needs more fields.
- [ ] **Open question / assumption:** `AuditProgress.family` is typed `Family`, imported from `./types.js` (added to the existing `import type { Check, CheckResult } from './types.js';` — NOT from `./scoring.js`, which only re-uses `Family` without re-exporting it). `res.family` / `check.id` are assumed present on `CheckResult` / `Check` (used by `computeScore` / `makeResult`); if TS disagrees, read family from `check.family` without changing the emitted shape.
- [ ] **Deviation from contract:** none intended. The only additive choice beyond the contract is the poll-based SSE (interval reads the job's latest progress) rather than a push callback — chosen so stream + result can observe one lazily-started job; the emitted `event: progress|done|error` shape matches the contract.
