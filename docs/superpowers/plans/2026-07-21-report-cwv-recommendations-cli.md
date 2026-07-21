# Phase 1 — Rapport lisible : dashboard CWV, plan d'action, liens de doc (CLI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrichir les rapports HTML & Markdown de findable-audit avec un dashboard Core Web Vitals (jauges radiales), un plan d'action priorisé, des liens « En savoir plus », un bandeau verdict — sans nouvelle dépendance, en gardant le rapport autonome/imprimable.

**Architecture:** Changements de données **additifs** dans `packages/cli` : `AuditReport.psi` propagé depuis le run, champ `docUrl` (avec repli par famille) sur les résultats. Deux modules de rendu partagés HTML/Markdown (`report/cwv.ts`, `report/recommendations.ts`) + un helper `report/verdict.ts`. `renderHtml`/`renderMarkdown` consomment ces briques. Aucune modification du moteur d'audit hors la propagation `psi`.

**Tech Stack:** Node ≥20, TypeScript ESM (imports en `.js`), vitest. Zéro dépendance npm. Rendu HTML autonome (CSS inline, `@media print` avec `print-color-adjust: exact`).

## Global Constraints

- Node ≥ 20, TypeScript ESM : **tous les imports internes finissent en `.js`**.
- **Zéro nouvelle dépendance npm.**
- Jamais de `process.exit()` après le lancement de l'audit (crash libuv Windows).
- Cross-platform strict (`path.join`, pas de shell POSIX dans le code).
- Rapport HTML **autonome** : aucune ressource externe embarquée (`<link>/<script>/<img src=…>`), aucun handler `on*` inline. Les liens `<a href="https://…">` de documentation sont autorisés (ce ne sont pas des ressources embarquées) et pointent vers des **constantes internes** (jamais du contenu dérivé du site audité).
- Tout texte dérivé du site audité passe par `escapeHtml` (HTML) / `cell` (Markdown).
- Déterminisme des tests : asserter la présence d'éléments, pas la date exacte.
- Palette : vert `#1a7f37` (bon), ambre `#9a6700` (à améliorer), rouge `#b42318` (mauvais), gris `#999` (skip).
- Invariant e2e : `perfect-site` = 100/100 doit rester vrai (changements additifs).

---

## File Structure

- **Modifier** `packages/cli/src/runner.ts` — `AuditReport.psi` + retour.
- **Créer** `packages/cli/src/doc-urls.ts` — `FAMILY_DOC_URL` (repli par famille).
- **Modifier** `packages/cli/src/types.ts` — `Check.docUrl?`, `CheckResult.docUrl?`, `makeResult` résout `docUrl`.
- **Créer** `packages/cli/src/report/verdict.ts` — `verdictOf(grade, failCount)`.
- **Créer** `packages/cli/src/report/cwv.ts` — `bucketOf`, `renderCwvHtml`, `renderCwvMarkdown`.
- **Créer** `packages/cli/src/report/recommendations.ts` — `collectRecommendations` + type `Recommendation`.
- **Modifier** `packages/cli/src/report/terminal.ts` — ajouter `FAMILY_SHORT`.
- **Modifier** `packages/cli/src/report/html.ts` — hero/verdict, stats, CWV, plan d'action, liens de doc, STYLE.
- **Modifier** `packages/cli/src/report/markdown.ts` — verdict, section CWV, fixes enrichis, liens.
- **Créer** tests : `test/report/cwv.test.ts`, `test/report/recommendations.test.ts`, `test/report/verdict.test.ts`.
- **Modifier** tests : `test/runner.test.ts`, `test/report/html.test.ts`, `test/report/markdown.test.ts`.
- **Modifier** docs : `README.md`, `docs/guide.md`, `docs/guide.fr.md`, `apps/web/README.md` (mention Phase 2 à venir — ici juste CLI).

---

## Task 1: Propager `psi` dans `AuditReport`

**Files:**
- Modify: `packages/cli/src/runner.ts:11-22` (interface) et `:79` (retour)
- Test: `packages/cli/test/runner.test.ts`

**Interfaces:**
- Consumes: `PsiResult` depuis `./perf/psi.js` (déjà importé indirectement via types).
- Produces: `AuditReport.psi?: PsiResult | null` — consommé par Tasks 6, 9 (renderers).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `test/runner.test.ts`, dans le `describe('runAudit', …)` :

```ts
  it('carries psi through to the report (undefined without --cwv, no PSI call)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const report = await runAudit(srv.url, buildChecks({ indexnowKey: 'testkey123' }));
    expect('psi' in report).toBe(true);
    expect(report.psi).toBeUndefined();
  });
```

- [ ] **Step 2: Lancer le test — il échoue**

Run: `cd packages/cli && npx vitest run test/runner.test.ts -t "carries psi"`
Expected: FAIL — `'psi' in report` est `false` (le champ n'est pas retourné).

- [ ] **Step 3: Implémenter**

Dans `runner.ts`, importer le type et enrichir l'interface + le retour :

```ts
import type { PsiResult } from './perf/psi.js';
```

Interface `AuditReport` — ajouter après `results`:

```ts
  results: CheckResult[];
  /** Raw PageSpeed data: PsiResult when --cwv succeeded, null when it failed, undefined when not requested. */
  psi?: PsiResult | null;
```

Retour (`runner.ts:79`) :

```ts
  return { url: crawler.baseUrl.toString(), score, grade, familyScores, sampledPages, results, psi: crawler.psi };
```

- [ ] **Step 4: Lancer le test — il passe**

Run: `cd packages/cli && npx vitest run test/runner.test.ts`
Expected: PASS (tous les tests runner verts).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/runner.ts packages/cli/test/runner.test.ts
git commit -m "feat(cli): propagate PageSpeed psi into AuditReport"
```

---

## Task 2: Champ `docUrl` + repli par famille

**Files:**
- Create: `packages/cli/src/doc-urls.ts`
- Modify: `packages/cli/src/types.ts` (`Check`, `CheckResult`, `makeResult`)
- Test: `packages/cli/test/report/verdict.test.ts` **non** — voir Step 1 (nouveau petit test dans un fichier dédié `test/doc-urls.test.ts`)
- Create: `packages/cli/test/doc-urls.test.ts`

**Interfaces:**
- Produces: `FAMILY_DOC_URL: Record<Family, string>` ; `CheckResult.docUrl?: string` (résolu = override du check sinon repli famille) — consommé par Tasks 6-9.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/cli/test/doc-urls.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { makeResult } from '../src/types.js';
import { FAMILY_DOC_URL } from '../src/doc-urls.js';

describe('docUrl resolution in makeResult', () => {
  it('falls back to the family doc URL when the check has none', () => {
    const r = makeResult({ id: 'x', family: 'performance', maxPoints: 5 }, 'fail', 'slow');
    expect(r.docUrl).toBe(FAMILY_DOC_URL.performance);
  });
  it('prefers the check-level docUrl override', () => {
    const r = makeResult(
      { id: 'x', family: 'performance', maxPoints: 5, docUrl: 'https://web.dev/lcp/' },
      'warn', 'meh',
    );
    expect(r.docUrl).toBe('https://web.dev/lcp/');
  });
  it('exposes a doc URL for every family', () => {
    const families = ['ai-access','llm-content','structured-data','technical-seo','on-page','performance','accessibility','security'] as const;
    for (const f of families) expect(FAMILY_DOC_URL[f]).toMatch(/^https:\/\//);
  });
});
```

- [ ] **Step 2: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/doc-urls.test.ts`
Expected: FAIL — `../src/doc-urls.js` introuvable / `r.docUrl` undefined.

- [ ] **Step 3: Implémenter**

Créer `packages/cli/src/doc-urls.ts` :

```ts
import type { Family } from './types.js';

/** Canonical documentation link per family — the fallback when a check has no own docUrl. */
export const FAMILY_DOC_URL: Record<Family, string> = {
  'ai-access': 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
  'llm-content': 'https://llmstxt.org/',
  'structured-data': 'https://schema.org/docs/schemas.html',
  'technical-seo': 'https://developers.google.com/search/docs',
  'on-page': 'https://developers.google.com/search/docs/appearance',
  performance: 'https://web.dev/explore/learn-core-web-vitals',
  accessibility: 'https://www.w3.org/WAI/WCAG21/quickref/',
  security: 'https://developer.mozilla.org/en-US/docs/Web/Security',
};
```

Dans `types.ts` :

1. `Check` — ajouter `docUrl?`:

```ts
export interface Check {
  id: string;
  family: Family;
  maxPoints: number;
  /** Optional per-check documentation link; falls back to FAMILY_DOC_URL[family] in makeResult. */
  docUrl?: string;
  run(ctx: CrawlContext): Promise<CheckResult>;
}
```

2. `CheckResult` — ajouter `docUrl?` après `fix?`:

```ts
  fix?: string;
  /** Resolved documentation link (check override or family fallback). Present on every result. */
  docUrl?: string;
```

3. `makeResult` — importer le repli et le résoudre :

```ts
import { FAMILY_DOC_URL } from './doc-urls.js';

export function makeResult(
  check: Pick<Check, 'id' | 'family' | 'maxPoints' | 'docUrl'>,
  status: CheckStatus,
  message: string,
  fix?: string,
): CheckResult {
  const points =
    status === 'pass' ? check.maxPoints :
    status === 'warn' ? Math.floor(check.maxPoints / 2) : 0;
  const docUrl = check.docUrl ?? FAMILY_DOC_URL[check.family];
  return { id: check.id, family: check.family, status, points, maxPoints: check.maxPoints, message, fix, docUrl };
}
```

Note : `doc-urls.ts` n'importe qu'un **type** de `types.ts` (effacé à la compilation) → aucun cycle d'import runtime.

- [ ] **Step 4: Lancer — passe**

Run: `cd packages/cli && npx vitest run test/doc-urls.test.ts`
Expected: PASS.

- [ ] **Step 5: Vérifier l'invariant e2e (rien cassé)**

Run: `cd packages/cli && npx vitest run test/e2e.test.ts test/runner.test.ts`
Expected: PASS (le champ `docUrl` est additif ; `perfect-site` reste 100/100).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/doc-urls.ts packages/cli/src/types.ts packages/cli/test/doc-urls.test.ts
git commit -m "feat(cli): add docUrl to results with per-family fallback"
```

---

## Task 3: Module `report/cwv.ts` (bucket + rendu jauges/table)

**Files:**
- Create: `packages/cli/src/report/cwv.ts`
- Test: `packages/cli/test/report/cwv.test.ts`

**Interfaces:**
- Consumes: `PsiResult`, `CWV_THRESHOLDS` depuis `../perf/psi.js`.
- Produces: `bucketOf(value, t): 'good'|'ni'|'poor'` ; `renderCwvHtml(psi: PsiResult): string` ; `renderCwvMarkdown(psi: PsiResult): string` — consommés par Tasks 6, 9.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/cli/test/report/cwv.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePsi } from '../../src/perf/psi.js';
import { bucketOf, renderCwvHtml, renderCwvMarkdown } from '../../src/report/cwv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'psi-sample.json'), 'utf8'));
const psi = parsePsi(sample, 'mobile'); // lcp1800 inp150 cls0.05 ttfb400 all FAST, lab perf0.98

describe('bucketOf (lower is better)', () => {
  it('classifies against good/poor thresholds inclusively', () => {
    expect(bucketOf(2500, { good: 2500, poor: 4000 })).toBe('good');
    expect(bucketOf(3000, { good: 2500, poor: 4000 })).toBe('ni');
    expect(bucketOf(4001, { good: 2500, poor: 4000 })).toBe('poor');
  });
});

describe('renderCwvHtml', () => {
  const html = renderCwvHtml(psi);
  it('renders one gauge per present field metric', () => {
    for (const name of ['LCP', 'INP', 'CLS', 'TTFB']) expect(html).toContain(name);
  });
  it('colors gauges via conic-gradient and keeps values readable', () => {
    expect(html).toContain('conic-gradient');
    expect(html).toContain('1.8 s'); // LCP 1800ms
    expect(html).toContain('150 ms'); // INP
    expect(html).toContain('0.05'); // CLS
  });
  it('shows the compact Lighthouse lab line', () => {
    expect(html).toContain('98'); // perfScore 0.98 -> 98/100
  });
  it('does not render a metric absent from the field data', () => {
    const noInp = { ...psi, field: { ...psi.field, inp: undefined } };
    expect(renderCwvHtml(noInp)).not.toContain('>INP<');
  });
});

describe('renderCwvMarkdown', () => {
  it('renders a table with a status per present metric', () => {
    const md = renderCwvMarkdown(psi);
    expect(md).toContain('## Core Web Vitals');
    expect(md).toMatch(/\| LCP \| 1\.8 s \|/);
  });
});
```

- [ ] **Step 2: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/cwv.test.ts`
Expected: FAIL — `../../src/report/cwv.js` introuvable.

- [ ] **Step 3: Implémenter**

Créer `packages/cli/src/report/cwv.ts` :

```ts
import type { PsiResult } from '../perf/psi.js';
import { CWV_THRESHOLDS } from '../perf/psi.js';

export type Bucket = 'good' | 'ni' | 'poor';

/** Lower-is-better bucketing against good/poor thresholds (inclusive). */
export function bucketOf(value: number, t: { good: number; poor: number }): Bucket {
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'ni';
  return 'poor';
}

const CLS = { good: '#1a7f37', ni: '#9a6700', poor: '#b42318' } as const;
const CSSCLASS: Record<Bucket, string> = { good: 'good', ni: 'ok', poor: 'bad' };
const LABEL: Record<Bucket, string> = { good: 'bon', ni: 'à améliorer', poor: 'mauvais' };
const MD_STATUS: Record<Bucket, string> = { good: '✅ Bon', ni: '⚠️ À améliorer', poor: '❌ Mauvais' };

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

function assessment(psi: PsiResult): { cls: string; label: string } {
  const oc = psi.field.overallCategory;
  if (oc === 'FAST') return { cls: 'good', label: 'PASSED' };
  if (oc === 'AVERAGE') return { cls: 'ok', label: 'À AMÉLIORER' };
  if (oc === 'SLOW') return { cls: 'bad', label: 'ÉCHEC' };
  // fallback: worst present bucket
  const buckets = METRICS.map((m) => psi.field[m.key]).filter(Boolean)
    .map((fm, i) => bucketOf((fm as { p75: number }).p75, METRICS[i].t));
  if (buckets.includes('poor')) return { cls: 'bad', label: 'ÉCHEC' };
  if (buckets.includes('ni')) return { cls: 'ok', label: 'À AMÉLIORER' };
  if (buckets.length) return { cls: 'good', label: 'PASSED' };
  return { cls: 'ok', label: 'NON CONCLUANT' };
}

export function renderCwvHtml(psi: PsiResult): string {
  const a = assessment(psi);
  const src = psi.field.origin ? 'CrUX origine' : 'CrUX terrain';
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
      <div class="cwv-bucket ${CSSCLASS[b]}">${LABEL[b]}</div>
    </div>`;
  }).join('');

  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `<div class="cwv-lab">Labo Lighthouse : Perf ${Math.round(lab.perfScore * 100)}/100${
        lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${
        lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''} <span class="cwv-tag">labo</span></div>`
    : '';

  return `<section class="cwv">
<h2>Core Web Vitals</h2>
<p class="cwv-assess-line"><span class="cwv-assess ${a.cls}">${a.label}</span> <span class="cwv-src">${src} · ${psi.strategy}</span></p>
<div class="cwv-grid">${gauges}</div>
${labLine}
</section>`;
}

export function renderCwvMarkdown(psi: PsiResult): string {
  const rows = METRICS.map((m) => {
    const fm = psi.field[m.key];
    if (!fm) return '';
    const b = bucketOf(fm.p75, m.t);
    return `| ${m.name} | ${m.fmt(fm.p75)} | ${MD_STATUS[b]} | ${psi.field.origin ? 'origin' : 'field'} |`;
  }).filter(Boolean).join('\n');
  const lab = psi.lab;
  const labLine = lab.perfScore != null
    ? `\n_Lab (Lighthouse): Perf ${Math.round(lab.perfScore * 100)}/100${lab.fcp != null ? ` · FCP ${Math.round(lab.fcp)} ms` : ''}${lab.tbt != null ? ` · TBT ${Math.round(lab.tbt)} ms` : ''}_\n`
    : '';
  return `## Core Web Vitals\n\n| Metric | p75 | Status | Source |\n|---|---|---|---|\n${rows}\n${labLine}`;
}
```

- [ ] **Step 4: Lancer — passe**

Run: `cd packages/cli && npx vitest run test/report/cwv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report/cwv.ts packages/cli/test/report/cwv.test.ts
git commit -m "feat(cli): CWV dashboard renderer (radial gauges + markdown table)"
```

---

## Task 4: Module `report/recommendations.ts`

**Files:**
- Create: `packages/cli/src/report/recommendations.ts`
- Test: `packages/cli/test/report/recommendations.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `Family` (`../types.js`), `FAMILY_WEIGHTS` (`../scoring.js`).
- Produces: `Recommendation` type ; `collectRecommendations(results): Recommendation[]` (trié fails-first puis par `weighted` desc) — consommé par Tasks 7, 9.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/cli/test/report/recommendations.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { collectRecommendations } from '../../src/report/recommendations.js';
import type { CheckResult } from '../../src/types.js';

const results: CheckResult[] = [
  { id: 'pass-no-fix', family: 'on-page', status: 'pass', points: 5, maxPoints: 5, message: 'ok' },
  { id: 'warn-sec', family: 'security', status: 'warn', points: 2, maxPoints: 4, message: 'm', fix: 'do x', docUrl: 'https://d/sec' },
  { id: 'fail-perf', family: 'performance', status: 'fail', points: 0, maxPoints: 6, message: 'm', fix: 'do y', docUrl: 'https://d/perf' },
  { id: 'fail-onpage', family: 'on-page', status: 'fail', points: 0, maxPoints: 3, message: 'm', fix: 'do z' },
  { id: 'skip-x', family: 'performance', status: 'skip', points: 0, maxPoints: 4, message: 'm', fix: 'ignored' },
];

describe('collectRecommendations', () => {
  const recs = collectRecommendations(results);
  it('keeps only fail/warn checks that have a fix', () => {
    expect(recs.map((r) => r.id)).toEqual(['fail-perf', 'fail-onpage', 'warn-sec']);
  });
  it('orders fails before warns, then by weighted impact desc', () => {
    // fail-perf: impact 6 * weight(performance .10)=0.6 ; fail-onpage: 3 * (.12)=0.36 -> perf first
    expect(recs[0].id).toBe('fail-perf');
    expect(recs[1].id).toBe('fail-onpage');
    expect(recs[2].status).toBe('warn');
  });
  it('computes recoverable points as impact', () => {
    expect(recs[0].impact).toBe(6);
    expect(recs.find((r) => r.id === 'warn-sec')!.impact).toBe(2);
  });
});
```

- [ ] **Step 2: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/recommendations.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Créer `packages/cli/src/report/recommendations.ts` :

```ts
import type { CheckResult, Family } from '../types.js';
import { FAMILY_WEIGHTS } from '../scoring.js';

export interface Recommendation {
  id: string;
  family: Family;
  status: 'fail' | 'warn';
  fix: string;
  docUrl?: string;
  /** Recoverable points on this check (maxPoints - points). */
  impact: number;
  /** impact weighted by the family's score weight — the cross-family priority key. */
  weighted: number;
}

/** fail/warn checks that carry a fix, sorted fails-first then by weighted impact desc. */
export function collectRecommendations(results: CheckResult[]): Recommendation[] {
  return results
    .filter((r): r is CheckResult & { fix: string } =>
      !!r.fix && (r.status === 'fail' || r.status === 'warn'))
    .map((r) => {
      const impact = r.maxPoints - r.points;
      return {
        id: r.id,
        family: r.family,
        status: r.status as 'fail' | 'warn',
        fix: r.fix,
        docUrl: r.docUrl,
        impact,
        weighted: impact * FAMILY_WEIGHTS[r.family],
      };
    })
    .sort((a, b) => (a.status === b.status ? b.weighted - a.weighted : a.status === 'fail' ? -1 : 1));
}
```

- [ ] **Step 4: Lancer — passe**

Run: `cd packages/cli && npx vitest run test/report/recommendations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report/recommendations.ts packages/cli/test/report/recommendations.test.ts
git commit -m "feat(cli): collectRecommendations — prioritized action-plan data"
```

---

## Task 5: `verdict.ts` + bandeau hero & stats dans `renderHtml`

**Files:**
- Create: `packages/cli/src/report/verdict.ts`
- Test: `packages/cli/test/report/verdict.test.ts`
- Modify: `packages/cli/src/report/html.ts` (STYLE + corps), `packages/cli/test/report/html.test.ts`

**Interfaces:**
- Produces: `verdictOf(grade: Grade, failCount: number): string` — consommé par Task 9 (markdown).

- [ ] **Step 1: Écrire le test verdict qui échoue**

Créer `packages/cli/test/report/verdict.test.ts` :

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

- [ ] **Step 2: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/verdict.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `verdict.ts`**

```ts
import type { Grade } from '../scoring.js';

/** One-line human verdict from the grade and the number of failing checks. */
export function verdictOf(grade: Grade, failCount: number): string {
  const n = failCount;
  switch (grade) {
    case 'A': return n === 0 ? 'Excellent — findabilité IA au top.' : `Très bon — ${n} point(s) à polir.`;
    case 'B': return `Bonne base — ${n} priorité(s) pour viser A.`;
    case 'C': return `Correct — ${n} priorité(s) freinent la findabilité.`;
    case 'D': return `Fragile — ${n} correction(s) importantes à traiter.`;
    default:  return `Fondations à corriger : ${n} point(s) critique(s).`;
  }
}
```

- [ ] **Step 4: Test verdict passe**

Run: `cd packages/cli && npx vitest run test/report/verdict.test.ts`
Expected: PASS.

- [ ] **Step 5: Écrire le test html hero/stats qui échoue**

Ajouter dans `test/report/html.test.ts`, dans le premier `describe('renderHtml', …)` :

```ts
  it('shows a verdict line and a stats line in the hero', () => {
    // report has grade C and 1 failing check (llms-txt)
    expect(html).toMatch(/priorité/i);            // verdict text for grade C
    expect(html).toContain('class="hero"');
    expect(html).toMatch(/1 à corriger/);          // 1 fail + 0 warn? -> warn 'evil' too => 2
  });
```

Note: le fixture `report` a 1 `fail` + 1 `warn` → « à corriger » compte fail+warn = 2. Ajuster l'assertion à `/2 à corriger/`.

- [ ] **Step 6: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts -t "hero"`
Expected: FAIL — pas de `class="hero"`.

- [ ] **Step 7: Implémenter hero + stats dans `html.ts`**

Importer verdict en tête :

```ts
import { verdictOf } from './verdict.js';
```

Remplacer le bloc `.badges` + `.pages` actuel (`html.ts:126-130`) par le hero et la ligne de stats. Dans le corps `return`, remplacer :

```html
<p class="badges">
  <span class="score ${scoreClass(report.score)}">Score: ${report.score}/100</span>
  <span class="grade ${gradeClass(report.grade)}">Grade ${escapeHtml(report.grade)}</span>
</p>
<p class="pages">Pages audited: ${pages}</p>
```

par :

```html
<header class="hero">
  <div class="hero-score ${scoreClass(report.score)}">${report.score}<span>/100</span></div>
  <div class="hero-meta">
    <span class="grade ${gradeClass(report.grade)}">Grade ${escapeHtml(report.grade)}</span>
    <div class="verdict">${escapeHtml(verdictOf(report.grade, failCount))}</div>
  </div>
</header>
<p class="stats">${passed} réussis · ${toFix} à corriger · ${report.sampledPages.length} pages</p>
<p class="pages">Pages audited: ${pages}</p>
```

Et calculer les compteurs juste avant le `return` (après `subscoreSection`) :

```ts
  const passed = report.results.filter((r) => r.status === 'pass').length;
  const failCount = report.results.filter((r) => r.status === 'fail').length;
  const toFix = report.results.filter((r) => r.status === 'fail' || r.status === 'warn').length;
```

Ajouter au `STYLE` (avant le bloc `@media print`) :

```css
  .hero { display: flex; align-items: center; gap: 1rem; margin: 1rem 0 .75rem;
    padding: 1rem; border: 1px solid #ececec; border-radius: 12px; background: #fbfbfb; }
  .hero-score { font-weight: 800; font-size: 2rem; line-height: 1; color: #fff;
    border-radius: 12px; padding: .6rem .8rem; min-width: 3.4rem; text-align: center; }
  .hero-score span { display: block; font-size: .7rem; font-weight: 600; opacity: .85; }
  .hero-score.good { background: #1a7f37; } .hero-score.ok { background: #9a6700; } .hero-score.bad { background: #b42318; }
  .hero-meta .verdict { color: #555; font-size: .95rem; margin-top: .3rem; }
  .stats { color: #666; font-size: .85rem; margin: 0 0 .25rem; }
```

Ajouter `.hero-score` à la liste `print-color-adjust` du bloc `@media print` :

```css
    .bar-fill, .score, .grade, .fam-score, .hero-score { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
```

- [ ] **Step 8: Lancer — passe (et non-régression)**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts`
Expected: PASS. (Les anciennes assertions `Grade C` / score `72` restent vraies : le hero contient toujours `Grade C` et `72`.)

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/report/verdict.ts packages/cli/src/report/html.ts packages/cli/test/report/verdict.test.ts packages/cli/test/report/html.test.ts
git commit -m "feat(cli): hero verdict band + stats line in HTML report"
```

---

## Task 6: Intégrer le dashboard CWV dans `renderHtml`

**Files:**
- Modify: `packages/cli/src/report/html.ts` (import cwv, section conditionnelle, STYLE), `packages/cli/test/report/html.test.ts`

**Interfaces:**
- Consumes: `renderCwvHtml` (Task 3), `AuditReport.psi` (Task 1).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `test/report/html.test.ts` un nouveau `describe` (le fixture `psi-sample.json` est déjà utilisé par cwv.test) :

```ts
import { parsePsi } from '../../src/perf/psi.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('renderHtml Core Web Vitals section', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sample = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'psi-sample.json'), 'utf8'));
  it('renders the CWV dashboard when psi is present', () => {
    const html = renderHtml({ ...report, psi: parsePsi(sample, 'mobile') });
    expect(html).toContain('Core Web Vitals');
    expect(html).toContain('conic-gradient');
    expect(html).toContain('LCP');
  });
  it('shows a discreet "non mesuré" note when psi is absent', () => {
    const html = renderHtml(report); // no psi
    expect(html).toMatch(/non mesur/i);
    expect(html).not.toContain('conic-gradient');
  });
});
```

- [ ] **Step 2: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts -t "Core Web Vitals"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Import en tête de `html.ts` :

```ts
import { renderCwvHtml } from './cwv.js';
```

Construire la section avant le `return` :

```ts
  const cwvSection = report.psi
    ? renderCwvHtml(report.psi)
    : `<p class="cwv-note">Core Web Vitals non mesurés — lancez avec <code>--cwv --psi-key &lt;clé&gt;</code>.</p>`;
```

Insérer `${cwvSection}` dans le corps, **entre** `${subscoreSection}` et `${sections.join('\n')}` :

```html
${subscoreSection}
${cwvSection}
${sections.join('\n')}
```

Ajouter au `STYLE` :

```css
  .cwv { margin: 1.25rem 0; }
  .cwv-assess-line { margin: .25rem 0 .5rem; }
  .cwv-assess { display: inline-block; font-weight: 700; font-size: .78rem; padding: .15rem .55rem; border-radius: 6px; color: #fff; }
  .cwv-assess.good { background: #1a7f37; } .cwv-assess.ok { background: #9a6700; } .cwv-assess.bad { background: #b42318; }
  .cwv-src { color: #888; font-size: .8rem; }
  .cwv-grid { display: flex; gap: 1.1rem; flex-wrap: wrap; margin: .5rem 0; }
  .cwv-gauge { text-align: center; }
  .cwv-ring { width: 76px; height: 76px; border-radius: 50%; margin: 0 auto .3rem; display: flex; align-items: center; justify-content: center; }
  .cwv-inner { width: 58px; height: 58px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
  .cwv-val { font-weight: 700; font-size: .9rem; }
  .cwv-name { font-size: .78rem; font-weight: 700; }
  .cwv-bucket { font-size: .72rem; }
  .cwv-bucket.good { color: #1a7f37; } .cwv-bucket.ok { color: #9a6700; } .cwv-bucket.bad { color: #b42318; }
  .cwv-lab { color: #666; font-size: .8rem; margin-top: .35rem; }
  .cwv-tag { font-size: .65rem; color: #77c; background: #eef0fb; padding: .05rem .35rem; border-radius: 4px; }
  .cwv-note { color: #888; font-size: .85rem; margin: 1rem 0; }
```

Ajouter `.cwv-ring` au bloc `@media print` :

```css
    .bar-fill, .score, .grade, .fam-score, .hero-score, .cwv-ring { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
```

- [ ] **Step 4: Lancer — passe**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report/html.ts packages/cli/test/report/html.test.ts
git commit -m "feat(cli): render Core Web Vitals gauge dashboard in HTML report"
```

---

## Task 7: Plan d'action priorisé dans `renderHtml` + `FAMILY_SHORT`

**Files:**
- Modify: `packages/cli/src/report/terminal.ts` (ajout `FAMILY_SHORT`), `packages/cli/src/report/html.ts` (section + STYLE), `packages/cli/test/report/html.test.ts`

**Interfaces:**
- Consumes: `collectRecommendations` (Task 4), `FAMILY_SHORT` (nouveau).
- Produces: `FAMILY_SHORT: Record<Family, string>` — utilisé aussi par Task 9.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `test/report/html.test.ts` (dans le premier `describe`) :

```ts
  it('renders a prioritized action plan with severity groups and impact', () => {
    expect(html).toContain('Plan d\'action');
    expect(html).toMatch(/À corriger en priorité/);   // fails group (llms-txt)
    expect(html).toContain('Add a /llms.txt file.');    // the fix text
    expect(html).toMatch(/\+\d+ pts/);                  // impact badge
  });
```

> Note d'ordre : le fixture `report` de `html.test.ts` n'a **pas** encore de `docUrl` à ce stade → le plan d'action n'émet aucun `href` externe ici, et l'assertion « aucune ressource externe » reste verte. Les liens « En savoir plus » (plan d'action **et** tables) sont introduits et testés en **Task 8**, qui met à jour cette assertion et ajoute `docUrl` au fixture.

- [ ] **Step 2: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts -t "action plan"`
Expected: FAIL.

- [ ] **Step 3: Ajouter `FAMILY_SHORT` dans `terminal.ts`**

Après `FAMILY_LABELS` (`terminal.ts:15`) :

```ts
/** Short family chips for the action plan / compact UI. */
export const FAMILY_SHORT: Record<Family, string> = {
  'ai-access': 'Accès IA',
  'llm-content': 'Contenu IA',
  'structured-data': 'Données',
  'technical-seo': 'SEO',
  'on-page': 'On-page',
  performance: 'Perf',
  accessibility: 'A11y',
  security: 'Sécurité',
};
```

- [ ] **Step 4: Implémenter la section plan d'action dans `html.ts`**

Imports en tête :

```ts
import { FAMILY_LABELS, FAMILY_SHORT } from './terminal.js';
import { collectRecommendations } from './recommendations.js';
```

(fusionner avec l'import `FAMILY_LABELS` existant).

Construire la section avant le `return` :

```ts
  const recs = collectRecommendations(report.results);
  const CAP = 12;
  const shown = recs.slice(0, CAP);
  const renderApGroup = (title: string, items: typeof shown): string => {
    if (items.length === 0) return '';
    const rows = items.map((r) => {
      const more = r.docUrl
        ? ` <a class="ap-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">En savoir plus →</a>` : '';
      return `<div class="ap-item">
        <span class="ap-sev ${r.status}"></span>
        <span class="chip">${escapeHtml(FAMILY_SHORT[r.family])}</span>
        <span class="ap-fix">${escapeHtml(r.fix)}${more}</span>
        <span class="ap-imp">+${r.impact} pts</span>
      </div>`;
    }).join('\n');
    return `<div class="ap-group"><h3>${title}</h3>${rows}</div>`;
  };
  const actionPlan = recs.length > 0
    ? `<section class="action-plan">
<h2>Plan d'action</h2>
${renderApGroup('🔴 À corriger en priorité', shown.filter((r) => r.status === 'fail'))}
${renderApGroup('🟠 À améliorer', shown.filter((r) => r.status === 'warn'))}
${recs.length > CAP ? `<p class="ap-more-note">+${recs.length - CAP} autre(s) — voir le détail par famille ci-dessous.</p>` : ''}
</section>`
    : '';
```

Insérer `${actionPlan}` dans le corps, **entre** `${cwvSection}` et `${sections.join('\n')}` :

```html
${cwvSection}
${actionPlan}
${sections.join('\n')}
```

Note sécurité : `r.docUrl` provient de `FAMILY_DOC_URL` (constantes) ou d'un override de check (constante interne) — jamais du site audité — donc sûr en `href` sans échappement d'URL. `r.fix` est échappé.

Ajouter au `STYLE` :

```css
  .action-plan { margin: 1.25rem 0; }
  .ap-group h3 { font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; color: #888; margin: .9rem 0 .3rem; }
  .ap-item { display: flex; align-items: baseline; gap: .5rem; padding: .4rem 0; border-top: 1px solid #f2f2f2; }
  .ap-sev { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; position: relative; top: .35rem; }
  .ap-sev.fail { background: #b42318; } .ap-sev.warn { background: #9a6700; }
  .chip { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .02em;
    color: #555; background: #f0f0f0; padding: .1rem .45rem; border-radius: 20px; flex: 0 0 auto; }
  .ap-fix { flex: 1; font-size: .9rem; color: #333; }
  .ap-more { color: #1a7f37; font-size: .82rem; white-space: nowrap; }
  .ap-imp { font-size: .78rem; font-weight: 700; color: #1a7f37; background: #e7f4ec;
    padding: .1rem .45rem; border-radius: 20px; white-space: nowrap; flex: 0 0 auto; }
  .ap-more-note { color: #888; font-size: .82rem; margin: .5rem 0 0; }
```

- [ ] **Step 5: Lancer — passe**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/report/terminal.ts packages/cli/src/report/html.ts packages/cli/test/report/html.test.ts
git commit -m "feat(cli): prioritized action plan with doc links in HTML report"
```

---

## Task 8: Liens de doc dans les tables de checks + correctif assertion « ressources externes »

**Files:**
- Modify: `packages/cli/src/report/html.ts` (lignes de check), `packages/cli/test/report/html.test.ts`

**Interfaces:**
- Consumes: `CheckResult.docUrl` (Task 2).

- [ ] **Step 1: Mettre à jour l'assertion « no external resource » (elle va casser)**

Dans `test/report/html.test.ts`, remplacer le test existant :

```ts
  it('references no external resource (fully inline)', () => {
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
  });
```

par (autorise les liens `<a>` de doc, interdit toute ressource embarquée externe) :

```ts
  it('embeds no external resource (inline only; doc <a> links allowed)', () => {
    // Forbid external embedded resources (styles, scripts, images, iframes)…
    expect(html).not.toMatch(/<(?:link|script|img|iframe|source)\b[^>]*\b(?:src|href)\s*=\s*["']https?:/i);
    // …but the only external hrefs allowed are documentation anchors.
    const externalHrefs = [...html.matchAll(/href\s*=\s*["'](https?:[^"']+)["']/gi)].map((m) => m[1]);
    for (const href of externalHrefs) {
      expect(href).toMatch(/^https:\/\/(web\.dev|developers\.google\.com|schema\.org|llmstxt\.org|developer\.mozilla\.org|www\.w3\.org|github\.com)/);
    }
  });
```

- [ ] **Step 2: Écrire le test « doc link dans la table » qui échoue**

Ajouter dans le même `describe` :

```ts
  it('adds a doc link next to the fix in the per-family check table', () => {
    // llms-txt is a failing llm-content check -> family fallback docUrl (llmstxt.org)
    expect(html).toMatch(/class="fix">Add a \/llms\.txt file\.[\s\S]*?href="https:\/\/llmstxt\.org\/"/);
  });
```

Note : le fixture `report` de `html.test.ts` a des checks **sans** `docUrl` (objets littéraux). Pour ce test, ajouter `docUrl` au check `llms-txt` du fixture :

```ts
    { id: 'llms-txt', family: 'llm-content', status: 'fail', points: 0, maxPoints: 10,
      message: 'llms.txt missing', fix: 'Add a /llms.txt file.', docUrl: 'https://llmstxt.org/' },
```

- [ ] **Step 3: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts -t "doc link"`
Expected: FAIL — pas de lien dans la table.

- [ ] **Step 4: Implémenter le lien dans la ligne de check**

Dans `html.ts`, la construction de `fix` par ligne (`html.ts:82-83`) devient :

```ts
    const link = r.docUrl && r.status !== 'pass' && r.status !== 'skip'
      ? ` <a class="fix-more" href="${r.docUrl}" target="_blank" rel="noopener noreferrer">En savoir plus →</a>` : '';
    const fix = r.fix && r.status !== 'pass' && r.status !== 'skip'
      ? `<div class="fix">${escapeHtml(r.fix)}${link}</div>` : '';
```

Ajouter au `STYLE` :

```css
  .fix-more { color: #1a7f37; font-size: .8rem; white-space: nowrap; }
```

- [ ] **Step 5: Lancer — passe**

Run: `cd packages/cli && npx vitest run test/report/html.test.ts`
Expected: PASS (y compris l'assertion « embeds no external resource » mise à jour).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/report/html.ts packages/cli/test/report/html.test.ts
git commit -m "feat(cli): inline doc links in per-family check tables"
```

---

## Task 9: Parité `renderMarkdown` (verdict, CWV, fixes enrichis)

**Files:**
- Modify: `packages/cli/src/report/markdown.ts`, `packages/cli/test/report/markdown.test.ts`

**Interfaces:**
- Consumes: `verdictOf` (Task 5), `renderCwvMarkdown` (Task 3), `collectRecommendations` (Task 4).

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter dans `test/report/markdown.test.ts` (adapter au fixture existant du fichier — réutiliser son `report`) :

```ts
  it('shows a verdict line under the score', () => {
    expect(md).toMatch(/priorité|Excellent|Bonne base|Fragile|Fondations/i);
  });
  it('renders a Core Web Vitals table when psi is present', () => {
    const withPsi = renderMarkdown({ ...report, psi: parsePsi(sample, 'mobile') });
    expect(withPsi).toContain('## Core Web Vitals');
    expect(withPsi).toMatch(/\| LCP \|/);
  });
  it('adds doc links to the recommended fixes', () => {
    // a fail/warn check with docUrl should render a markdown link
    expect(md).toMatch(/\[.*?\]\(https?:\/\/[^)]+\)/);
  });
```

Ajouter en tête du fichier de test les imports `parsePsi` + lecture de `psi-sample.json` (comme dans `cwv.test.ts`), et un `docUrl` sur au moins un check fail/warn du fixture `report`.

- [ ] **Step 2: Lancer — échoue**

Run: `cd packages/cli && npx vitest run test/report/markdown.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter dans `markdown.ts`**

Imports en tête :

```ts
import { verdictOf } from './verdict.js';
import { renderCwvMarkdown } from './cwv.js';
import { collectRecommendations } from './recommendations.js';
```

Ligne de verdict — après l'en-tête score (`markdown.ts:18-19`) :

```ts
    `**Score: ${report.score}/100** · **Grade ${report.grade}** — ${now.toISOString().slice(0, 10)}`,
    '',
    `> ${verdictOf(report.grade, report.results.filter((r) => r.status === 'fail').length)}`,
    '',
```

Section CWV — après le bloc `Category subscores` (avant la boucle des familles) :

```ts
  if (report.psi) {
    lines.push(renderCwvMarkdown(report.psi), '');
  }
```

Remplacer le bloc `## Recommended fixes` (`markdown.ts:47-56`) par une version basée sur `collectRecommendations`, avec lien + impact :

```ts
  const recs = collectRecommendations(report.results);
  if (recs.length > 0) {
    lines.push('## Recommended fixes', '');
    for (const r of recs) {
      const link = r.docUrl ? ` — [doc](${r.docUrl})` : '';
      lines.push(`- ${ICONS[r.status]} **\`${r.id}\`** (+${r.impact} pts) — ${r.fix}${link}`);
    }
    lines.push('');
  }
```

- [ ] **Step 4: Lancer — passe**

Run: `cd packages/cli && npx vitest run test/report/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report/markdown.ts packages/cli/test/report/markdown.test.ts
git commit -m "feat(cli): markdown parity — verdict, CWV table, enriched fixes"
```

---

## Task 10: Docs + suite complète

**Files:**
- Modify: `README.md`, `docs/guide.md`, `docs/guide.fr.md`

- [ ] **Step 1: Documenter**

- `README.md` : dans la description des rapports, ajouter une phrase sur le **dashboard Core Web Vitals** (jauges, terrain/labo), le **plan d'action priorisé** et les **liens « En savoir plus »**. (Section CWV visible avec `--cwv --psi-key`.)
- `docs/guide.md` + `docs/guide.fr.md` : une ligne sur la nouvelle présentation du rapport (verdict + dashboard CWV + plan d'action).

> **Demandes utilisateur (2026-07-21) — traitées en fin de Phase 2, pas ici :**
> 1. **Refonte complète du README** décrivant l'ensemble des nouveautés (Phase 1 rapports **+** Phase 2 web : écran « test en cours », export MD/HTML). À faire en dernier, une fois les features web réelles, pour éviter de documenter du vaporware.
> 2. **Badge/lien « Tester en ligne »** en tête de README, pointant vers l'UI web déployée. URL à confirmer (voir §Scope ci-dessous) — probablement `https://findable.bordebat.fr` (derrière Cloudflare, renvoie 403 aux bots mais servie aux vrais navigateurs). Forme suggérée : un badge Markdown `[![Tester en ligne](https://img.shields.io/badge/Tester%20en%20ligne-findable-1a7f37)](<URL>)` + une phrase « Auditez une URL directement dans le navigateur, sans installer ».

- [ ] **Step 2: Lancer la suite CLI complète**

Run: `cd packages/cli && npm test`
Expected: PASS — 542 tests existants + nouveaux tests verts. Vérifier en particulier `test/e2e.test.ts` (`perfect-site` = 100/100).

- [ ] **Step 3: Vérifier le build TypeScript**

Run: `cd packages/cli && npm run build`
Expected: compile sans erreur de type (les nouveaux modules et champs sont typés).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/guide.md docs/guide.fr.md
git commit -m "docs: report CWV dashboard, action plan, doc links"
```

---

## Self-Review

**1. Spec coverage (Phase 1) :**
- §1.1 psi → Task 1 ✔ · §1.2 docUrl+repli → Task 2 ✔ · §1.3 hero/stats → Task 5 ✔, CWV dashboard → Tasks 3+6 ✔, plan d'action → Tasks 4+7 ✔, tables conservées + liens → Task 8 ✔ · §1.4 markdown → Task 9 ✔ · §1.5 tests → répartis dans chaque tâche ✔ · §3 docs → Task 10 ✔.
- Hors périmètre ici (Phase 2, plan séparé) : `onProgress`, jobs, SSE, CSP, export web, activation CWV web. Le champ `psi` et `renderHtml`/`renderMarkdown` refondus sont les pré-requis livrés par cette Phase 1.

**2. Placeholder scan :** aucun TODO/TBD ; chaque étape de code montre le code complet ; commandes exactes avec sortie attendue.

**3. Type consistency :** `renderCwvHtml`/`renderCwvMarkdown`/`bucketOf` (Task 3) ↔ consommés Tasks 6/9 ; `collectRecommendations`/`Recommendation` (Task 4) ↔ Tasks 7/9 ; `verdictOf(grade, failCount)` (Task 5) ↔ Task 9 ; `FAMILY_SHORT` (Task 7) ↔ Task 9 ; `AuditReport.psi` (Task 1) ↔ Tasks 6/9 ; `CheckResult.docUrl` (Task 2) ↔ Tasks 7/8/9. Signatures cohérentes.

**Points de vigilance implémentation :**
- L'assertion `no external resource` de `html.test.ts` **doit** être remplacée (Task 8 Step 1) avant d'ajouter des liens, sinon rouge.
- Ordre des sections dans le corps `renderHtml` : hero → stats → pages → subscores → **cwv** → **action-plan** → tables → footer.
- `doc-urls.ts` n'importe qu'un type de `types.ts` (pas de cycle runtime).
