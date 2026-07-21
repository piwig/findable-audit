# Phase 2A — i18n foundation + bilingual report chrome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax.

**Goal:** Give `packages/cli` a report-chrome message catalog with EN+FR variants so the CLI can emit its Markdown/HTML/terminal reports in either language (default **EN**). Every hardcoded FR/EN chrome string and every family label moves into `packages/cli/src/report/i18n.ts`; renderer signatures gain a trailing `lang` param (default `'en'`). The 107 check `message`/`fix` strings stay English (explicitly out of scope). Remove the dead `.badges` / `.score` CSS left from Phase 1.

**Architecture:** One new leaf module `report/i18n.ts` with **zero runtime imports** (only type-only imports of `Grade` and `Family`). It exports `Lang`, `ReportMessages`, `MESSAGES`, `messages(lang)`, `FAMILY_LABELS_I18N`, `FAMILY_SHORT_I18N`. `terminal.ts` re-derives its `FAMILY_LABELS`/`FAMILY_SHORT` from the **EN** catalog entries (terminal output stays English). `verdict.ts`, `cwv.ts`, `html.ts`, `markdown.ts` read chrome through `messages(lang)` and append a trailing `lang` param. No import cycles: `i18n.ts` imports nothing at runtime; every renderer imports `i18n.ts`.

**Tech Stack:** Node ≥20, TypeScript ESM (`.js` import specifiers), vitest. No new dependencies.

## Global Constraints

Copied verbatim from `phase2-reconcile-handoff.md` (CONTRAINTES):

> Node ≥20 ESM (imports `.js`) ; ZÉRO dépendance npm (apps/web reste zéro-dép) ; pas de `process.exit` après le début de l'audit ; rapport HTML autonome (liens `<a>` doc autorisés) ; garde SSRF inchangée ; invariant `perfect-site`=100 préservé ; cross-platform (`path.join`) ; tests vitest (packages/cli) + node:test sur vrai serveur HTTP local (apps/web).

Additional contract-adherence rules for this sub-phase (from the handoff "Durcissements" + interface contract):

- `packages/cli/src/report/i18n.ts` exports EXACTLY: `Lang`, `ReportMessages`, `MESSAGES`, `messages(lang)`, `FAMILY_LABELS_I18N`, `FAMILY_SHORT_I18N`.
- Renderer signatures append `lang` **LAST** with default `'en'`, so existing 2-arg calls keep compiling:
  - `renderHtml(report: AuditReport, now?: Date, lang?: Lang): string`
  - `renderMarkdown(report: AuditReport, now?: Date, lang?: Lang): string`
  - `verdictOf(grade: Grade, failCount: number, lang?: Lang): string`
  - `renderCwvHtml(psi: PsiResult, lang?: Lang): string`
  - `renderCwvMarkdown(psi: PsiResult, lang?: Lang): string`
- The 107 checks' `message`/`fix` text is NEVER translated.
- Terminal output stays English (its labels re-derive from the EN catalog).

**Run commands** (all from `packages/cli/`): targeted test `cd packages/cli && npx vitest run test/report/<file>.test.ts`; full suite `cd packages/cli && npx vitest run`; type check `cd packages/cli && npx tsc --noEmit`.

## File Structure

```
packages/cli/src/report/
  i18n.ts            (NEW — Lang, ReportMessages, MESSAGES, messages, FAMILY_*_I18N)
  terminal.ts        (MOD — FAMILY_LABELS/FAMILY_SHORT derived from EN catalog)
  verdict.ts         (MOD — lang param, delegates to messages(lang).verdict)
  cwv.ts             (MOD — lang param, labels via messages(lang))
  html.ts            (MOD — lang param, chrome via messages(lang), dead CSS removed)
  markdown.ts        (MOD — lang param, chrome via messages(lang))
packages/cli/test/report/
  i18n.test.ts           (NEW — catalog contract)
  terminal-i18n.test.ts  (NEW — terminal derivation)
  verdict.test.ts        (MOD — existing, extended with EN/FR coverage; FR "critique" assertion pinned to lang='fr')
  cwv.test.ts            (MOD — existing, extended with EN/FR coverage; existing threshold/INP/fallback tests preserved)
  html.test.ts           (MOD — EN default flips + FR render + EN-invariant guard)
  markdown.test.ts       (MOD — FR render + EN-invariant guard)
```

---

## Task 1 — Create `report/i18n.ts` (catalog: Lang, ReportMessages, MESSAGES, messages, FAMILY_*_I18N)

**Files:**
- Create: `packages/cli/src/report/i18n.ts`
- Test: `packages/cli/test/report/i18n.test.ts`

**Interfaces:**
- Produces: `export type Lang = 'en' | 'fr'`; `export interface ReportMessages`; `export const MESSAGES: Record<Lang, ReportMessages>`; `export function messages(lang: Lang): ReportMessages`; `export const FAMILY_LABELS_I18N: Record<Lang, Record<Family, string>>`; `export const FAMILY_SHORT_I18N: Record<Lang, Record<Family, string>>`.
- Consumes (type-only): `Grade` from `../scoring.js`, `Family` from `../types.js`.

**Steps:**

- [ ] Write the failing test `packages/cli/test/report/i18n.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  messages, MESSAGES, FAMILY_LABELS_I18N, FAMILY_SHORT_I18N,
} from '../../src/report/i18n.js';
import type { Family } from '../../src/types.js';

const FAMILIES: Family[] = [
  'ai-access', 'llm-content', 'structured-data', 'technical-seo',
  'on-page', 'performance', 'accessibility', 'security',
];

describe('report i18n catalog', () => {
  it('exposes en and fr message sets', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(['en', 'fr']);
    expect(messages('en')).toBe(MESSAGES.en);
    expect(messages('fr')).toBe(MESSAGES.fr);
  });

  it('localizes chrome strings', () => {
    expect(messages('en').categorySubscores).toBe('Category subscores');
    expect(messages('fr').categorySubscores).toBe('Sous-scores par catégorie');
    expect(messages('en').actionPlan).toBe('Action plan');
    expect(messages('fr').actionPlan).toBe("Plan d'action");
    expect(messages('en').gradeLabel).toBe('Grade');
    expect(messages('fr').gradeLabel).toBe('Note');
  });

  it('builds parameterized strings per language', () => {
    expect(messages('en').stats(1, 2, 3)).toBe('1 passed · 2 to fix · 3 pages');
    expect(messages('fr').stats(1, 2, 3)).toBe('1 réussis · 2 à corriger · 3 pages');
    expect(messages('en').verdict('C', 2)).toMatch(/priority/);
    expect(messages('fr').verdict('C', 2)).toMatch(/priorité/);
    expect(messages('en').verdict('A', 0)).toMatch(/Excellent/);
    expect(messages('fr').verdict('A', 0)).toMatch(/Excellent/);
    expect(messages('en').moreRecs(5)).toBe('+5 more — see the per-family detail below.');
    expect(messages('fr').moreRecs(5)).toBe('+5 autre(s) — voir le détail par famille ci-dessous.');
  });

  it('localizes CWV labels', () => {
    expect(messages('en').cwvBucket.ni).toBe('needs improvement');
    expect(messages('fr').cwvBucket.ni).toBe('à améliorer');
    expect(messages('en').cwvAssess.slow).toBe('FAILED');
    expect(messages('fr').cwvAssess.slow).toBe('ÉCHEC');
    expect(messages('en').cwvSrcField).toBe('CrUX field');
    expect(messages('fr').cwvSrcField).toBe('CrUX terrain');
  });

  it('has a label + short label for every family in both languages', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const f of FAMILIES) {
        expect(typeof FAMILY_LABELS_I18N[lang][f]).toBe('string');
        expect(FAMILY_LABELS_I18N[lang][f].length).toBeGreaterThan(0);
        expect(typeof FAMILY_SHORT_I18N[lang][f]).toBe('string');
        expect(FAMILY_SHORT_I18N[lang][f].length).toBeGreaterThan(0);
      }
    }
    expect(FAMILY_LABELS_I18N.en['ai-access']).toBe('AI crawler access');
    expect(FAMILY_LABELS_I18N.fr['ai-access']).toBe('Accès crawler IA');
    expect(FAMILY_SHORT_I18N.en.security).toBe('Security');
    expect(FAMILY_SHORT_I18N.fr.security).toBe('Sécurité');
  });
});
```
- [ ] Run `cd packages/cli && npx vitest run test/report/i18n.test.ts` → **expected FAIL** (module `../../src/report/i18n.js` does not exist).
- [ ] Implement `packages/cli/src/report/i18n.ts` with COMPLETE code:
```ts
import type { Grade } from '../scoring.js';
import type { Family } from '../types.js';

export type Lang = 'en' | 'fr';

/** Bucket keys shared with cwv.ts (kept literal to avoid a runtime import cycle). */
type CwvBucketKey = 'good' | 'ni' | 'poor';
type CwvAssessKey = 'passed' | 'average' | 'slow' | 'inconclusive';

/** Every report-chrome label. The 107 checks' own message/fix text is NOT here. */
export interface ReportMessages {
  // document chrome
  reportTitle: string;   // HTML <h1> + <title> prefix
  mdTitle: string;       // Markdown <h1> brand
  gradeLabel: string;    // grade badge / score line prefix
  outOf100: string;      // "/100" suffix in the hero
  categorySubscores: string;
  pagesAudited: string;  // HTML "Pages audited:" line label
  learnMore: string;     // doc-link anchor text
  footer: string;        // HTML footer line
  // hero stats + verdict
  stats: (passed: number, toFix: number, pages: number) => string;
  verdict: (grade: Grade, failCount: number) => string;
  // action plan
  actionPlan: string;
  fixFirst: string;      // fails group heading
  improve: string;       // warns group heading
  moreRecs: (n: number) => string;
  pts: string;           // impact unit
  // markdown-only chrome
  mdScore: string;                 // "Score:" label
  mdSubscoreHeader: string;        // subscore table header row
  mdCheckHeader: string;           // per-family check table header row
  mdRecommendedFixes: string;      // recommendations heading
  mdDoc: string;                   // "doc" link text
  mdFooter: string;                // footer line
  // Core Web Vitals chrome
  cwvTitle: string;
  cwvNotMeasured: string;          // HTML note (contains <code> markup)
  cwvBucket: Record<CwvBucketKey, string>;
  cwvMdStatus: Record<CwvBucketKey, string>;
  cwvAssess: Record<CwvAssessKey, string>;
  cwvSrcOrigin: string;            // HTML "CrUX origin"
  cwvSrcField: string;             // HTML "CrUX field"
  cwvMdHeader: string;             // CWV markdown table header row
  cwvMdSrcOrigin: string;          // CWV markdown source cell
  cwvMdSrcField: string;
  cwvLabPrefix: string;            // HTML lab line prefix
  cwvLabTag: string;               // HTML lab tag text
  cwvLabMdPrefix: string;          // markdown lab line prefix
}

export const MESSAGES: Record<Lang, ReportMessages> = {
  en: {
    reportTitle: 'findable-audit report',
    mdTitle: 'findable-audit',
    gradeLabel: 'Grade',
    outOf100: '/100',
    categorySubscores: 'Category subscores',
    pagesAudited: 'Pages audited:',
    learnMore: 'Learn more →',
    footer: 'Generated by findable-audit · https://github.com/piwig/findable-audit',
    stats: (passed, toFix, pages) => `${passed} passed · ${toFix} to fix · ${pages} pages`,
    verdict: (grade, n) => {
      switch (grade) {
        case 'A': return n === 0 ? 'Excellent — top-tier AI findability.' : `Very good — ${n} point(s) to polish.`;
        case 'B': return `Solid base — ${n} priority(ies) to reach an A.`;
        case 'C': return `Decent — ${n} priority issue(s) holding back findability.`;
        case 'D': return `Fragile — ${n} important fix(es) to address.`;
        default:  return `Foundations to fix — ${n} critical point(s).`;
      }
    },
    actionPlan: 'Action plan',
    fixFirst: '🔴 Fix first',
    improve: '🟠 Improve',
    moreRecs: (n) => `+${n} more — see the per-family detail below.`,
    pts: 'pts',
    mdScore: 'Score:',
    mdSubscoreHeader: '| Family | Subscore | Weight | Earned/Max |',
    mdCheckHeader: '| | Check | Points | Result |',
    mdRecommendedFixes: 'Recommended fixes',
    mdDoc: 'doc',
    mdFooter: '_Generated by [findable-audit](https://github.com/piwig/findable-audit)_',
    cwvTitle: 'Core Web Vitals',
    cwvNotMeasured: 'Core Web Vitals not measured — run with <code>--cwv --psi-key &lt;key&gt;</code>.',
    cwvBucket: { good: 'good', ni: 'needs improvement', poor: 'poor' },
    cwvMdStatus: { good: '✅ Good', ni: '⚠️ Needs improvement', poor: '❌ Poor' },
    cwvAssess: { passed: 'PASSED', average: 'NEEDS WORK', slow: 'FAILED', inconclusive: 'INCONCLUSIVE' },
    cwvSrcOrigin: 'CrUX origin',
    cwvSrcField: 'CrUX field',
    cwvMdHeader: '| Metric | p75 | Status | Source |',
    cwvMdSrcOrigin: 'origin',
    cwvMdSrcField: 'field',
    cwvLabPrefix: 'Lighthouse lab: Perf',
    cwvLabTag: 'lab',
    cwvLabMdPrefix: 'Lab (Lighthouse): Perf',
  },
  fr: {
    reportTitle: 'Rapport findable-audit',
    mdTitle: 'findable-audit',
    gradeLabel: 'Note',
    outOf100: '/100',
    categorySubscores: 'Sous-scores par catégorie',
    pagesAudited: 'Pages auditées :',
    learnMore: 'En savoir plus →',
    footer: 'Généré par findable-audit · https://github.com/piwig/findable-audit',
    stats: (passed, toFix, pages) => `${passed} réussis · ${toFix} à corriger · ${pages} pages`,
    verdict: (grade, n) => {
      switch (grade) {
        case 'A': return n === 0 ? 'Excellent — findabilité IA au top.' : `Très bon — ${n} point(s) à polir.`;
        case 'B': return `Bonne base — ${n} priorité(s) pour viser A.`;
        case 'C': return `Correct — ${n} priorité(s) freinent la findabilité.`;
        case 'D': return `Fragile — ${n} correction(s) importantes à traiter.`;
        default:  return `Fondations à corriger : ${n} point(s) critique(s).`;
      }
    },
    actionPlan: "Plan d'action",
    fixFirst: '🔴 À corriger en priorité',
    improve: '🟠 À améliorer',
    moreRecs: (n) => `+${n} autre(s) — voir le détail par famille ci-dessous.`,
    pts: 'pts',
    mdScore: 'Score :',
    mdSubscoreHeader: '| Famille | Sous-score | Poids | Acquis/Max |',
    mdCheckHeader: '| | Contrôle | Points | Résultat |',
    mdRecommendedFixes: 'Corrections recommandées',
    mdDoc: 'doc',
    mdFooter: '_Généré par [findable-audit](https://github.com/piwig/findable-audit)_',
    cwvTitle: 'Core Web Vitals',
    cwvNotMeasured: 'Core Web Vitals non mesurés — lancez avec <code>--cwv --psi-key &lt;clé&gt;</code>.',
    cwvBucket: { good: 'bon', ni: 'à améliorer', poor: 'mauvais' },
    cwvMdStatus: { good: '✅ Bon', ni: '⚠️ À améliorer', poor: '❌ Mauvais' },
    cwvAssess: { passed: 'PASSED', average: 'À AMÉLIORER', slow: 'ÉCHEC', inconclusive: 'NON CONCLUANT' },
    cwvSrcOrigin: 'CrUX origine',
    cwvSrcField: 'CrUX terrain',
    cwvMdHeader: '| Métrique | p75 | Statut | Source |',
    cwvMdSrcOrigin: 'origine',
    cwvMdSrcField: 'terrain',
    cwvLabPrefix: 'Labo Lighthouse : Perf',
    cwvLabTag: 'labo',
    cwvLabMdPrefix: 'Labo (Lighthouse) : Perf',
  },
};

export function messages(lang: Lang): ReportMessages {
  return MESSAGES[lang];
}

/**
 * Family display labels per language. Order is canonical (matches FAMILY_WEIGHTS
 * / renderers). EN values equal the Phase-1 terminal labels so terminal output
 * is unchanged when it re-derives from the EN entries.
 */
export const FAMILY_LABELS_I18N: Record<Lang, Record<Family, string>> = {
  en: {
    'ai-access': 'AI crawler access',
    'llm-content': 'Answer-engine content',
    'structured-data': 'Structured data & metadata',
    'technical-seo': 'Technical SEO',
    'on-page': 'On-page & content',
    performance: 'Performance & Core Web Vitals',
    accessibility: 'Accessibility',
    security: 'Security & trust',
  },
  fr: {
    'ai-access': 'Accès crawler IA',
    'llm-content': 'Contenu moteur de réponse',
    'structured-data': 'Données structurées & métadonnées',
    'technical-seo': 'SEO technique',
    'on-page': 'On-page & contenu',
    performance: 'Performance & Core Web Vitals',
    accessibility: 'Accessibilité',
    security: 'Sécurité & confiance',
  },
};

/** Short family chips for the action plan / compact UI. */
export const FAMILY_SHORT_I18N: Record<Lang, Record<Family, string>> = {
  en: {
    'ai-access': 'AI access',
    'llm-content': 'AI content',
    'structured-data': 'Data',
    'technical-seo': 'SEO',
    'on-page': 'On-page',
    performance: 'Perf',
    accessibility: 'A11y',
    security: 'Security',
  },
  fr: {
    'ai-access': 'Accès IA',
    'llm-content': 'Contenu IA',
    'structured-data': 'Données',
    'technical-seo': 'SEO',
    'on-page': 'On-page',
    performance: 'Perf',
    accessibility: 'A11y',
    security: 'Sécurité',
  },
};
```
- [ ] Run `cd packages/cli && npx vitest run test/report/i18n.test.ts` → **expected PASS**.
- [ ] Run `cd packages/cli && npx tsc --noEmit` → **expected PASS**.
- [ ] Commit: `feat(cli/report): add i18n catalog (Lang, ReportMessages, MESSAGES, family labels)`

---

## Task 2 — Derive terminal `FAMILY_LABELS` / `FAMILY_SHORT` from the EN catalog

**Files:**
- Modify: `packages/cli/src/report/terminal.ts`
- Test: `packages/cli/test/report/terminal-i18n.test.ts` (new)

**Interfaces:**
- Consumes: `FAMILY_LABELS_I18N`, `FAMILY_SHORT_I18N` from `./i18n.js`.
- Produces (unchanged names): `export const FAMILY_LABELS: Record<Family, string>` (= `FAMILY_LABELS_I18N.en`), `export const FAMILY_SHORT: Record<Family, string>` (= `FAMILY_SHORT_I18N.en`). `renderTerminal(report)` unchanged.

**Steps:**

- [ ] Write the failing test `packages/cli/test/report/terminal-i18n.test.ts`:
```ts
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
```
- [ ] Run `cd packages/cli && npx vitest run test/report/terminal-i18n.test.ts` → **expected FAIL** (`toBe` reference check fails: terminal still owns its own literal objects, and `FAMILY_SHORT.security` is currently the FR `'Sécurité'`).
- [ ] Edit `packages/cli/src/report/terminal.ts` — replace the two literal exports (the `FAMILY_LABELS` and `FAMILY_SHORT` `const` object blocks, lines 5–27) with derivations, and add the import. New top of file:
```ts
import pc from 'picocolors';
import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { FAMILY_LABELS_I18N, FAMILY_SHORT_I18N } from './i18n.js';

/** Terminal output stays English: labels & short chips derive from the EN catalog. */
export const FAMILY_LABELS: Record<Family, string> = FAMILY_LABELS_I18N.en;
export const FAMILY_SHORT: Record<Family, string> = FAMILY_SHORT_I18N.en;
```
Leave `ICONS` and `renderTerminal` exactly as they are.
- [ ] Run `cd packages/cli && npx vitest run test/report/terminal-i18n.test.ts` → **expected PASS**.
- [ ] Run `cd packages/cli && npx vitest run` → **expected PASS** (existing html/markdown suites still import `FAMILY_LABELS` from terminal and get the unchanged EN values).
- [ ] Commit: `refactor(cli/report): derive terminal FAMILY_LABELS/FAMILY_SHORT from EN catalog`

---

## Task 3 — Thread `lang` through `verdictOf`

**Files:**
- Modify: `packages/cli/src/report/verdict.ts`
- Modify: `packages/cli/test/report/html.test.ts` (verdict assertion → EN)
- Modify: `packages/cli/test/report/markdown.test.ts` (verdict assertion → EN)
- Modify: `packages/cli/test/report/verdict.test.ts` (existing — from Phase 1; extend in place, do NOT overwrite the file)

**Interfaces:**
- Produces: `verdictOf(grade: Grade, failCount: number, lang?: Lang): string` — delegates to `messages(lang).verdict(grade, failCount)`.
- Consumes: `messages`, `Lang` from `./i18n.js`.

> Note: `html.ts` and `markdown.ts` still call `verdictOf(grade, failCount)` (2 args) until Tasks 5–6. Because the new default is `'en'`, their default render's verdict becomes English now, so this task also flips the two existing verdict assertions (html line ~92, markdown line ~80) to EN to keep the suite green.

**Steps:**

- [ ] `packages/cli/test/report/verdict.test.ts` already exists (Phase 1):
```ts
import { describe, it, expect } from 'vitest';
import { verdictOf } from '../../src/report/verdict.js';

describe('verdictOf', () => {
  it('varies by grade and failing-check count', () => {
    expect(verdictOf('A', 0)).toMatch(/Excellent/i);
    expect(verdictOf('B', 3)).toMatch(/3/);
    expect(verdictOf('F', 5)).toMatch(/critique/i);
  });
});
```
  Its last assertion relies on the current French default and will break once `verdictOf` defaults to `'en'` (the EN string says "critical", not "critique"). **Modify this file in place — pin that one assertion to French explicitly and APPEND two new `it` blocks to the same `describe`** (do not replace or delete the existing `it`):
```ts
import { describe, it, expect } from 'vitest';
import { verdictOf } from '../../src/report/verdict.js';

describe('verdictOf', () => {
  it('varies by grade and failing-check count', () => {
    expect(verdictOf('A', 0)).toMatch(/Excellent/i);
    expect(verdictOf('B', 3)).toMatch(/3/);
    expect(verdictOf('F', 5, 'fr')).toMatch(/critique/i);
  });

  it('defaults to English', () => {
    expect(verdictOf('C', 2)).toMatch(/priority/);
    expect(verdictOf('A', 0)).toMatch(/Excellent/);
    expect(verdictOf('F', 3)).toMatch(/Foundations/);
  });

  it('renders French when asked', () => {
    expect(verdictOf('C', 2, 'fr')).toMatch(/priorité/);
    expect(verdictOf('D', 1, 'fr')).toMatch(/Fragile/);
    expect(verdictOf('F', 3, 'fr')).toMatch(/Fondations/);
  });
});
```
  Only the 3rd expectation of the first `it` changes (adds the explicit `'fr'` arg) — its "critique" coverage for grade F is fully preserved, just pinned to French instead of relying on the old default. The two appended `it` blocks add the EN-default and FR-on-request coverage required by the interface contract. Net effect: 1 existing `it` kept (assertion tweaked), 2 new `it`s added — no coverage removed.
- [ ] Run `cd packages/cli && npx vitest run test/report/verdict.test.ts` → **expected FAIL** (`verdictOf('C', 2)` currently returns the French `Correct — 2 priorité(s)…`, so `/priority/` does not match; the 3-arg calls also fail to type-check/run since `verdict.ts` doesn't accept a `lang` param yet).
- [ ] Replace the full body of `packages/cli/src/report/verdict.ts`:
```ts
import type { Grade } from '../scoring.js';
import { messages, type Lang } from './i18n.js';

/** One-line human verdict from the grade and the number of failing checks. */
export function verdictOf(grade: Grade, failCount: number, lang: Lang = 'en'): string {
  return messages(lang).verdict(grade, failCount);
}
```
- [ ] In `packages/cli/test/report/html.test.ts`, flip the verdict assertion in the "shows a verdict line and a stats line in the hero" test from `expect(html).toMatch(/priorité/i);` to `expect(html).toMatch(/priority/i);` (leave the `class="hero"` and stats assertions untouched here — the stats line is updated in Task 5).
- [ ] In `packages/cli/test/report/markdown.test.ts`, flip the verdict assertion in the "shows a verdict line under the score" test from `expect(md).toMatch(/priorité|Excellent|Bonne base|Fragile|Fondations/i);` to `expect(md).toMatch(/priority|Decent|Excellent|Solid|Fragile|Foundations/i);`.
- [ ] Run `cd packages/cli && npx vitest run test/report/verdict.test.ts` → **expected PASS** (all three `it` blocks green, including the preserved FR "critique" coverage now pinned to `lang='fr'`).
- [ ] Run `cd packages/cli && npx vitest run` → **expected PASS** (html/markdown verdict assertions now match the EN default; stats/action-plan/cwv-note assertions still match the FR chrome that html.ts emits until Task 5).
- [ ] Run `cd packages/cli && npx tsc --noEmit` → **expected PASS**.
- [ ] Commit: `feat(cli/report): thread lang through verdictOf via i18n catalog`

---

## Task 4 — Localize the Core Web Vitals renderers

**Files:**
- Modify: `packages/cli/src/report/cwv.ts`
- Modify: `packages/cli/test/report/cwv.test.ts` (existing — from Phase 1; extend in place, do NOT overwrite the file)

**Interfaces:**
- Produces: `renderCwvHtml(psi: PsiResult, lang?: Lang): string`; `renderCwvMarkdown(psi: PsiResult, lang?: Lang): string`. `bucketOf` and `Bucket` unchanged.
- Consumes: `messages`, `Lang` from `./i18n.js`.

**Steps:**

- [ ] `packages/cli/test/report/cwv.test.ts` already exists (Phase 1) and carries coverage that must be preserved: `bucketOf` threshold inclusivity (`describe('bucketOf (lower is better)', …)`), the INP-absent non-render check, and the overallCategory-absent fallback regression test (`'derives the assessment from present metrics when overallCategory is absent …'`). Its `describe('renderCwvHtml', …)` block computes a shared `const html = renderCwvHtml(psi);` once (default lang) and reuses it across `it`s. **Modify this file in place — do NOT replace it:**
  - Fix the one FR-hardcoded assertion that breaks once the default flips to EN: in the overallCategory-absent fallback test, `expect(renderCwvHtml(psiNoOverall)).toContain('ÉCHEC');` → `expect(renderCwvHtml(psiNoOverall)).toContain('FAILED');` (update the adjacent comment from `-> ÉCHEC` to `-> FAILED` too). This keeps the regression test's logic (TTFB-only fallback bucketing) fully intact — only the expected literal changes to match the new EN default.
  - APPEND two new `it` blocks to the existing `describe('renderCwvHtml', ...)` (after its current four `it`s), reusing the describe's shared `html` const for the EN-default assertion and calling with `'fr'` for the French one:
```ts
  it('defaults to English (assessment + CrUX source)', () => {
    expect(html).toMatch(/PASSED|NEEDS WORK|FAILED|INCONCLUSIVE/);
    expect(html).toMatch(/CrUX (origin\b|field)/);
  });
  it('renders French labels when asked', () => {
    const htmlFr = renderCwvHtml(psi, 'fr');
    expect(htmlFr).toMatch(/PASSED|À AMÉLIORER|ÉCHEC|NON CONCLUANT/);
    expect(htmlFr).toMatch(/CrUX (origine|terrain)/);
  });
```
  - APPEND two new `it` blocks to the existing `describe('renderCwvMarkdown', ...)` (after its current single `it`):
```ts
  it('defaults to English status + header', () => {
    const md = renderCwvMarkdown(psi);
    expect(md).toContain('| Metric | p75 | Status | Source |');
    expect(md).toMatch(/✅ Good|⚠️ Needs improvement|❌ Poor/);
  });
  it('renders French status + header when asked', () => {
    const md = renderCwvMarkdown(psi, 'fr');
    expect(md).toContain('| Métrique | p75 | Statut | Source |');
    expect(md).toMatch(/✅ Bon|⚠️ À améliorer|❌ Mauvais/);
  });
```
  Net effect: all existing `it`s kept (one literal fixed), 4 new `it`s added — no coverage removed.
- [ ] Run `cd packages/cli && npx vitest run test/report/cwv.test.ts` → **expected FAIL** (default EN assertions fail: the current renderer hardcodes `CrUX origine`/`CrUX terrain` and `| Metric …` header with `✅ Bon` status, so `/CrUX (origin\b|field)/` and `/✅ Good|…/` don't match; the fixed-up `'FAILED'` assertion also fails pre-implementation since the renderer still emits `'ÉCHEC'` unconditionally).
- [ ] Replace the full body of `packages/cli/src/report/cwv.ts`:
```ts
import type { PsiResult } from '../perf/psi.js';
import { CWV_THRESHOLDS } from '../perf/psi.js';
import { messages, type Lang } from './i18n.js';

export type Bucket = 'good' | 'ni' | 'poor';

/** Lower-is-better bucketing against good/poor thresholds (inclusive). */
export function bucketOf(value: number, t: { good: number; poor: number }): Bucket {
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'ni';
  return 'poor';
}

const CLS = { good: '#1a7f37', ni: '#9a6700', poor: '#b42318' } as const;
const CSSCLASS: Record<Bucket, string> = { good: 'good', ni: 'ok', poor: 'bad' };

type FieldKey = 'lcp' | 'inp' | 'cls' | 'ttfb';
interface Metric { key: FieldKey; name: string; t: { good: number; poor: number }; fmt: (v: number) => string; }

const METRICS: Metric[] = [
  { key: 'lcp', name: 'LCP', t: CWV_THRESHOLDS.lcp, fmt: (v) => `${(v / 1000).toFixed(1)} s` },
  { key: 'inp', name: 'INP', t: CWV_THRESHOLDS.inp, fmt: (v) => `${Math.round(v)} ms` },
  { key: 'cls', name: 'CLS', t: CWV_THRESHOLDS.cls, fmt: (v) => v.toFixed(2) },
  { key: 'ttfb', name: 'TTFB', t: CWV_THRESHOLDS.ttfb, fmt: (v) => `${(v / 1000).toFixed(1)} s` },
];

/** Fuller arc = better (indicative); the bucket colour + label carry the authoritative signal. */
function arcPct(value: number, t: { good: number; poor: number }): number {
  const frac = Math.max(0.05, Math.min(1, 1 - value / t.poor));
  return Math.round(frac * 100);
}

type AssessKey = 'passed' | 'average' | 'slow' | 'inconclusive';

function assessment(psi: PsiResult): { cls: string; key: AssessKey } {
  const oc = psi.field.overallCategory;
  if (oc === 'FAST') return { cls: 'good', key: 'passed' };
  if (oc === 'AVERAGE') return { cls: 'ok', key: 'average' };
  if (oc === 'SLOW') return { cls: 'bad', key: 'slow' };
  // fallback: worst present bucket — keep each metric bound to its own threshold
  const buckets = METRICS
    .filter((m) => psi.field[m.key])
    .map((m) => bucketOf(psi.field[m.key]!.p75, m.t));
  if (buckets.includes('poor')) return { cls: 'bad', key: 'slow' };
  if (buckets.includes('ni')) return { cls: 'ok', key: 'average' };
  if (buckets.length) return { cls: 'good', key: 'passed' };
  return { cls: 'ok', key: 'inconclusive' };
}

export function renderCwvHtml(psi: PsiResult, lang: Lang = 'en'): string {
  const t = messages(lang);
  const a = assessment(psi);
  const src = psi.field.origin ? t.cwvSrcOrigin : t.cwvSrcField;
  const gauges = METRICS.map((m) => {
    const fm = psi.field[m.key];
    if (!fm) return '';
    const b = bucketOf(fm.p75, m.t);
    const pct = arcPct(fm.p75, m.t);
    return `<div class="cwv-gauge">
      <div class="cwv-ring" style="background:conic-gradient(${CLS[b]} 0 ${pct}%, #eee ${pct}% 100%)">
        <div class="cwv-inner"><span class="cwv-val">${m.fmt(fm.p75)}</span></div>
      </div>
      <div class="cwv-name">${m.name}</div>
      <div class="cwv-bucket ${CSSCLASS[b]}">${t.cwvBucket[b]}</div>
    </div>`;
  }).join('');

  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `<div class="cwv-lab">${t.cwvLabPrefix} ${Math.round(lab.perfScore * 100)}/100${
        lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${
        lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''} <span class="cwv-tag">${t.cwvLabTag}</span></div>`
    : '';

  return `<section class="cwv">
<h2>${t.cwvTitle}</h2>
<p class="cwv-assess-line"><span class="cwv-assess ${a.cls}">${t.cwvAssess[a.key]}</span> <span class="cwv-src">${src} · ${psi.strategy}</span></p>
<div class="cwv-grid">${gauges}</div>
${labLine}
</section>`;
}

export function renderCwvMarkdown(psi: PsiResult, lang: Lang = 'en'): string {
  const t = messages(lang);
  const rows = METRICS.map((m) => {
    const fm = psi.field[m.key];
    if (!fm) return '';
    const b = bucketOf(fm.p75, m.t);
    return `| ${m.name} | ${m.fmt(fm.p75)} | ${t.cwvMdStatus[b]} | ${psi.field.origin ? t.cwvMdSrcOrigin : t.cwvMdSrcField} |`;
  }).filter(Boolean).join('\n');
  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `\n_${t.cwvLabMdPrefix} ${Math.round(lab.perfScore * 100)}/100${lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''}_\n`
    : '';
  return `## ${t.cwvTitle}\n\n${t.cwvMdHeader}\n|---|---|---|---|\n${rows}\n${labLine}`;
}
```
- [ ] Run `cd packages/cli && npx vitest run test/report/cwv.test.ts` → **expected PASS**.
- [ ] Run `cd packages/cli && npx vitest run` → **expected PASS** (html/markdown call `renderCwvHtml/Markdown` with one arg → EN default; their existing CWV assertions are language-neutral: `Core Web Vitals`, `conic-gradient`, `LCP`, table header).
- [ ] Run `cd packages/cli && npx tsc --noEmit` → **expected PASS**.
- [ ] Commit: `feat(cli/report): localize Core Web Vitals renderers via messages(lang)`

---

## Task 5 — `renderHtml` gains `lang`; move chrome to catalog; remove dead `.badges`/`.score` CSS

**Files:**
- Modify: `packages/cli/src/report/html.ts`
- Modify: `packages/cli/test/report/html.test.ts` (EN-default assertions flip; add FR describe)

**Interfaces:**
- Produces: `renderHtml(report: AuditReport, now?: Date, lang?: Lang): string`.
- Consumes: `messages`, `FAMILY_LABELS_I18N`, `FAMILY_SHORT_I18N`, `Lang` from `./i18n.js`; `verdictOf(…, lang)`; `renderCwvHtml(psi, lang)`.

**Steps:**

- [ ] In `packages/cli/test/report/html.test.ts`, update the EN-default assertions that reference French chrome (the render is now EN by default):
  - In "shows a verdict line and a stats line in the hero": change `expect(html).toMatch(/2 à corriger/);` to `expect(html).toMatch(/2 to fix/);`.
  - In "renders a prioritized action plan…": change `expect(html).toContain('Plan d\'action');` to `expect(html).toContain('Action plan');` and `expect(html).toMatch(/À corriger en priorité/);` to `expect(html).toMatch(/Fix first/);`.
  - In the CWV "shows a discreet … note when psi is absent" test: change `expect(html).toMatch(/non mesur/i);` to `expect(html).toMatch(/not measured/i);`.
  - Add a dead-CSS guard to the first "self-contained HTML document" test: `expect(html).not.toContain('.badges {'); expect(html).not.toContain('.score.good {');`.
  - Append a new describe block for the French render:
```ts
describe('renderHtml in French', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'), 'fr');
  it('sets the document language and localizes chrome', () => {
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Rapport findable-audit');
    expect(html).toContain('<span class="grade ok">Note C</span>');
    expect(html).toMatch(/priorité/);              // FR verdict for grade C
    expect(html).toMatch(/2 à corriger/);          // FR stats
    expect(html).toContain('Sous-scores par catégorie');
    expect(html).toContain("Plan d'action");
    expect(html).toMatch(/À corriger en priorité/);
    expect(html).toMatch(/À améliorer/);
    expect(html).toContain('Pages auditées :');
    expect(html).toContain('En savoir plus →');
  });
  it('keeps the 107-check messages/fixes in English', () => {
    expect(html).toContain('llms.txt missing');
    expect(html).toContain('Add a /llms.txt file.');
  });
});
```
- [ ] Run `cd packages/cli && npx vitest run test/report/html.test.ts` → **expected FAIL** (`renderHtml` still emits French chrome and `<html lang="en">`: the updated EN assertions `2 to fix` / `Action plan` / `Fix first` / `not measured` fail, and the FR block's `<html lang="fr">` / `Rapport findable-audit` / `Note C` fail).
- [ ] Edit `packages/cli/src/report/html.ts`. **(a)** Replace the imports (lines 1–6) with:
```ts
import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { verdictOf } from './verdict.js';
import { renderCwvHtml } from './cwv.js';
import { collectRecommendations } from './recommendations.js';
import { messages, FAMILY_LABELS_I18N, FAMILY_SHORT_I18N, type Lang } from './i18n.js';
```
**(b)** In `STYLE`, delete the three dead lines (the `.badges` rule and the two `.score` badge rules — originals below) and remove `.score,` from the `@media print` selector list:
```
  .badges { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; margin: 0 0 .25rem; }
  .score { display: inline-block; font-weight: 700; font-size: 1.1rem; padding: .35rem .8rem;
    border-radius: 6px; color: #fff; }
  .score.good { background: #1a7f37; } .score.ok { background: #9a6700; } .score.bad { background: #b42318; }
```
The print rule changes from `.bar-fill, .score, .grade, .fam-score, .hero-score, .cwv-ring { … }` to `.bar-fill, .grade, .fam-score, .hero-score, .cwv-ring { … }`. Leave `scoreClass`, `gradeClass`, and all other CSS untouched.
**(c)** Replace the entire `renderHtml` function (from `export function renderHtml…` to its closing brace) with:
```ts
export function renderHtml(report: AuditReport, now: Date = new Date(), lang: Lang = 'en'): string {
  const m = messages(lang);
  const familyLabels = FAMILY_LABELS_I18N[lang];
  const familyShort = FAMILY_SHORT_I18N[lang];
  const date = now.toISOString().slice(0, 10);
  const families = Object.keys(familyLabels) as Family[];
  const sections: string[] = [];

  for (const family of families) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    const rows = results.map((r) => {
      const link = r.docUrl && r.status !== 'pass' && r.status !== 'skip'
        ? ` <a class="fix-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">${m.learnMore}</a>` : '';
      const fix = r.fix && r.status !== 'pass' && r.status !== 'skip'
        ? `<div class="fix">${escapeHtml(r.fix)}${link}</div>` : '';
      return `<tr class="row">
        <td class="st ${r.status}">${STATUS_LABEL[r.status]}</td>
        <td><code>${escapeHtml(r.id)}</code><div class="msg">${escapeHtml(r.message)}</div>${fix}</td>
        <td class="pts">${r.points}/${r.maxPoints}</td>
      </tr>`;
    }).join('\n');
    sections.push(`<h2>${escapeHtml(familyLabels[family])} <span class="pts">(${earned}/${max})</span></h2>
      <table>${rows}</table>`);
  }

  const pages = report.sampledPages.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ');

  const subscoreRows = report.familyScores.map((fs) => {
    const cls = scoreClass(fs.score);
    const label = escapeHtml(familyLabels[fs.family]);
    const weightPct = Math.round(fs.weight * 100);
    return `<tr>
        <td class="fam-label">${label}</td>
        <td class="fam-score ${cls}">${fs.score}</td>
        <td class="fam-weight">${weightPct}%</td>
        <td class="fam-bar"><div class="bar"><div class="bar-fill ${cls}" style="width:${fs.score}%"></div></div></td>
      </tr>`;
  }).join('\n');

  const subscoreSection = report.familyScores.length > 0
    ? `<section class="subscores">
<h2>${m.categorySubscores}</h2>
<table class="subscore-table">${subscoreRows}</table>
</section>`
    : '';

  const passed = report.results.filter((r) => r.status === 'pass').length;
  const failCount = report.results.filter((r) => r.status === 'fail').length;
  const toFix = report.results.filter((r) => r.status === 'fail' || r.status === 'warn').length;

  const cwvSection = report.psi
    ? renderCwvHtml(report.psi, lang)
    : `<p class="cwv-note">${m.cwvNotMeasured}</p>`;

  const recs = collectRecommendations(report.results);
  const CAP = 12;
  const shown = recs.slice(0, CAP);
  const renderApGroup = (title: string, items: typeof shown): string => {
    if (items.length === 0) return '';
    const rows = items.map((r) => {
      const more = r.docUrl
        ? ` <a class="ap-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">${m.learnMore}</a>` : '';
      return `<div class="ap-item">
        <span class="ap-sev ${r.status}"></span>
        <span class="chip">${escapeHtml(familyShort[r.family])}</span>
        <span class="ap-fix">${escapeHtml(r.fix)}${more}</span>
        <span class="ap-imp">+${r.impact} ${m.pts}</span>
      </div>`;
    }).join('\n');
    return `<div class="ap-group"><h3>${title}</h3>${rows}</div>`;
  };
  const actionPlan = recs.length > 0
    ? `<section class="action-plan">
<h2>${m.actionPlan}</h2>
${renderApGroup(m.fixFirst, shown.filter((r) => r.status === 'fail'))}
${renderApGroup(m.improve, shown.filter((r) => r.status === 'warn'))}
${recs.length > CAP ? `<p class="ap-more-note">${m.moreRecs(recs.length - CAP)}</p>` : ''}
</section>`
    : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${m.reportTitle} — ${escapeHtml(report.url)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${m.reportTitle}</h1>
<div class="meta">${escapeHtml(report.url)} · ${date}</div>
<header class="hero">
  <div class="hero-score ${scoreClass(report.score)}">${report.score}<span>${m.outOf100}</span></div>
  <div class="hero-meta">
    <span class="grade ${gradeClass(report.grade)}">${m.gradeLabel} ${escapeHtml(report.grade)}</span>
    <div class="verdict">${escapeHtml(verdictOf(report.grade, failCount, lang))}</div>
  </div>
</header>
<p class="stats">${m.stats(passed, toFix, report.sampledPages.length)}</p>
<p class="pages">${m.pagesAudited} ${pages}</p>
${subscoreSection}
${cwvSection}
${actionPlan}
${sections.join('\n')}
<footer>${m.footer}</footer>
</body>
</html>
`;
}
```
- [ ] Run `cd packages/cli && npx vitest run test/report/html.test.ts` → **expected PASS** (EN default now emits `Action plan`/`Fix first`/`2 to fix`/`not measured` and `<html lang="en">`; the FR block sees `<html lang="fr">`/`Note C`/FR chrome; the 107-check strings remain English).
- [ ] Run `cd packages/cli && npx tsc --noEmit` → **expected PASS**.
- [ ] Commit: `feat(cli/report): render HTML report in en/fr, drop dead .badges/.score CSS`

---

## Task 6 — `renderMarkdown` gains `lang`; move chrome to catalog

**Files:**
- Modify: `packages/cli/src/report/markdown.ts`
- Modify: `packages/cli/test/report/markdown.test.ts` (add FR describe + EN-invariant guard)

**Interfaces:**
- Produces: `renderMarkdown(report: AuditReport, now?: Date, lang?: Lang): string`.
- Consumes: `messages`, `FAMILY_LABELS_I18N`, `Lang` from `./i18n.js`; `verdictOf(…, lang)`; `renderCwvMarkdown(psi, lang)`.

> Markdown chrome was already English in Phase 1, so the existing EN assertions stay green unchanged; the failing test for this task is the new French render (the current renderer ignores a 3rd arg and emits EN).

**Steps:**

- [ ] Append to `packages/cli/test/report/markdown.test.ts` a French describe block + an EN-invariant guard:
```ts
describe('renderMarkdown in French', () => {
  const md = renderMarkdown(report, new Date('2026-07-20T12:00:00Z'), 'fr');
  it('localizes the report chrome', () => {
    expect(md).toContain('**Score : 72/100**');
    expect(md).toContain('**Note C**');
    expect(md).toMatch(/priorité/);                       // FR verdict, grade C
    expect(md).toContain('## Sous-scores par catégorie');
    expect(md).toContain('| Famille | Sous-score | Poids | Acquis/Max |');
    expect(md).toContain('| Accès crawler IA | 25/100 | 16% | 4/16 |');
    expect(md).toContain('## Accès crawler IA (4/16)');
    expect(md).toContain('## On-page & contenu (2/4)');
    expect(md).toContain('## Corrections recommandées');
  });
  it('keeps the 107-check messages/fixes in English', () => {
    expect(md).toContain('AI crawlers blocked: GPTBot');
    expect(md).toContain('Remove the Disallow rules.');
  });
});
```
- [ ] Run `cd packages/cli && npx vitest run test/report/markdown.test.ts` → **expected FAIL** (the current `renderMarkdown` ignores `lang`, so it emits `**Score: …**`/`**Grade C**`/`## Category subscores`/English family labels — the FR assertions fail).
- [ ] Replace the full body of `packages/cli/src/report/markdown.ts`:
```ts
import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { verdictOf } from './verdict.js';
import { renderCwvMarkdown } from './cwv.js';
import { collectRecommendations } from './recommendations.js';
import { messages, FAMILY_LABELS_I18N, type Lang } from './i18n.js';

const ICONS: Record<CheckResult['status'], string> = {
  pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️',
};

/** Escape characters that would break a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderMarkdown(report: AuditReport, now: Date = new Date(), lang: Lang = 'en'): string {
  const m = messages(lang);
  const familyLabels = FAMILY_LABELS_I18N[lang];
  const failCount = report.results.filter((r) => r.status === 'fail').length;
  const lines: string[] = [
    `# ${m.mdTitle} — ${report.url}`,
    '',
    `**${m.mdScore} ${report.score}/100** · **${m.gradeLabel} ${report.grade}** — ${now.toISOString().slice(0, 10)}`,
    '',
    `> ${verdictOf(report.grade, failCount, lang)}`,
    '',
  ];

  if (report.familyScores.length > 0) {
    lines.push(`## ${m.categorySubscores}`, '');
    lines.push(m.mdSubscoreHeader);
    lines.push('|---|---|---|---|');
    for (const fs of report.familyScores) {
      const weightPct = Math.round(fs.weight * 100);
      lines.push(`| ${cell(familyLabels[fs.family])} | ${fs.score}/100 | ${weightPct}% | ${fs.earned}/${fs.max} |`);
    }
    lines.push('');
  }

  if (report.psi) {
    lines.push(renderCwvMarkdown(report.psi, lang), '');
  }

  for (const family of Object.keys(familyLabels) as Family[]) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    lines.push(`## ${familyLabels[family]} (${earned}/${max})`, '');
    lines.push(m.mdCheckHeader);
    lines.push('|---|---|---|---|');
    for (const r of results) {
      lines.push(`| ${ICONS[r.status]} | \`${r.id}\` | ${r.points}/${r.maxPoints} | ${cell(r.message)} |`);
    }
    lines.push('');
  }

  const recs = collectRecommendations(report.results);
  if (recs.length > 0) {
    lines.push(`## ${m.mdRecommendedFixes}`, '');
    for (const r of recs) {
      const link = r.docUrl ? ` — [${m.mdDoc}](${r.docUrl})` : '';
      lines.push(`- ${ICONS[r.status]} **\`${r.id}\`** (+${r.impact} ${m.pts}) — ${r.fix}${link}`);
    }
    lines.push('');
  }

  lines.push('---', '', m.mdFooter, '');
  return lines.join('\n');
}
```
- [ ] Run `cd packages/cli && npx vitest run test/report/markdown.test.ts` → **expected PASS** (EN default keeps `# findable-audit — …`, `**Score: 72/100**`, `**Grade C**`, `## Category subscores`, `## AI crawler access (4/16)`, `## Recommended fixes`; the FR block sees the localized chrome).
- [ ] Run `cd packages/cli && npx tsc --noEmit` → **expected PASS**.
- [ ] Commit: `feat(cli/report): render Markdown report in en/fr`

---

## Task 7 — Full regression sweep + bilingual/English-invariant verification

**Files:**
- Test only: run the whole `packages/cli` suite and the type checker; add no new production code.

**Interfaces:** none (verification gate).

**Steps:**

- [ ] Run `cd packages/cli && npx vitest run` → **expected PASS** (all pre-existing tests plus `i18n.test.ts`, `terminal-i18n.test.ts`, `verdict.test.ts`, `cwv.test.ts`, and the new FR describe blocks; the Phase-1 count of 566 should be unchanged or higher, none red).
- [ ] Run `cd packages/cli && npx tsc --noEmit` → **expected PASS** (renderer signatures all end in `lang?: Lang` with default `'en'`; existing 2-arg `(report, now)` calls in `index.ts`/`runner.ts`/web still compile).
- [ ] Confirm by inspection that no check's `message`/`fix` string was moved into `i18n.ts` (only chrome/labels), and that `apps/web` and `index.ts` were **not** modified in this sub-phase (they belong to 2B/2C). If `cd packages/cli && npx tsc --noEmit` surfaces a call site that passed 3 positional args elsewhere, that is out of scope — note it for 2B and do not change it here.
- [ ] Commit (only if the sweep produced test-file tweaks; otherwise skip): `test(cli/report): FR render coverage + 107-check-English regression guard`

---

## Self-Review

**Spec / contract coverage**
- `i18n.ts` exports exactly `Lang`, `ReportMessages`, `MESSAGES`, `messages(lang)`, `FAMILY_LABELS_I18N`, `FAMILY_SHORT_I18N` (Task 1) — matches the "Durcissements" §2 export list.
- Renderer signatures append `lang` last with default `'en'`: `renderHtml` (T5), `renderMarkdown` (T6), `verdictOf` (T3), `renderCwvHtml`/`renderCwvMarkdown` (T4) — matches the contract exactly; existing `(report, now)` calls keep compiling (verified in T7 via `tsc`).
- Every hardcoded chrome string that was FR/EN in Phase 1 is now in `MESSAGES` with EN+FR values, each spelled out in Task 1: hero title/grade/`/100`/stats/verdict, `Category subscores`, `Pages audited:`, `Learn more →`, footer, `Action plan`/`Fix first`/`Improve`/`moreRecs`, markdown `Score:`/table headers/`Recommended fixes`/`doc`/footer, and all CWV labels (buckets, md status, assessment, CrUX source, lab prefixes/tag). Family labels + short chips in `FAMILY_LABELS_I18N`/`FAMILY_SHORT_I18N`.
- Dead `.badges` / `.score(.good/.ok/.bad)` CSS removed and dropped from the `@media print` selector (T5).
- Terminal stays English via EN re-derivation (T2); the 107 check `message`/`fix` strings are never translated — guarded by EN-invariant assertions in both html and markdown FR blocks (T5/T6) and re-checked in T7.

**Placeholder scan**
- No `TBD`/`TODO`/`FIXME`/"add error handling" anywhere. Every task ships complete, runnable code (full file bodies for `i18n.ts`, `verdict.ts`, `cwv.ts`, `markdown.ts`; full `renderHtml` + precise CSS edit for `html.ts`; concrete import/derivation edit for `terminal.ts`). Every catalog entry has both an EN and a FR value.

**Type consistency**
- `i18n.ts` uses only type-only imports (`Grade`, `Family`) → no runtime import cycle; all renderers import `i18n.ts` at runtime, `i18n.ts` imports no runtime module.
- `ReportMessages.verdict: (grade: Grade, failCount: number) => string` and `verdictOf(grade: Grade, failCount: number, lang?: Lang)` agree; `stats`/`moreRecs` are `(number…) => string`.
- `cwv.ts` `AssessKey` = `'passed'|'average'|'slow'|'inconclusive'` matches `ReportMessages.cwvAssess` keys; `Bucket` = `'good'|'ni'|'poor'` matches `cwvBucket`/`cwvMdStatus` keys.
- `Object.keys(FAMILY_LABELS_I18N[lang])` preserves the canonical family order (records declared in `FAMILY_WEIGHTS` order) so section/subscore ordering is unchanged.

**Open questions / deviations**
- None material. Minor within-contract choices: EN short chips are newly coined (`AI access`, `AI content`, `Data`, `SEO`, `On-page`, `Perf`, `A11y`, `Security`) since Phase-1 `FAMILY_SHORT` held only FR values and no test pinned them; FR `gradeLabel` = `Note` (matches project French usage "note A-F"). Both are asserted in the new tests, so they are locked, not loose.
