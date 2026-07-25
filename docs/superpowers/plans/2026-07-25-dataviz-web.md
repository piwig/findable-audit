# Dataviz page résultats — plan d'implémentation (tâche 5 roadmap)

> Spec : `docs/superpowers/specs/2026-07-25-dataviz-web-design.md`
> Branche : `main`, commits locaux uniquement (PAS de push/deploy/VPS/publish). TDD.
> git add CIBLÉ — jamais `audit-prod.*`, `findable.bordebat.fr-baseline.json`,
> `graphify-out/`, `docs/research/`, `extract_lantern.js`, `lantern_*.txt`,
> `pull_strings.js`, `final_quotes.js`, `quote_windows.js`.
> Interdits : nouvelle dépendance, modification des poids/décomptes des checks.

## Gates (après chaque tâche)

```bash
cd packages/cli && npx tsc --noEmit && npx vitest run   # CLI touché à chaque tâche
cd packages/cli && npm run build                        # le web importe dist/
cd apps/web && node --test abuse.test.mjs admin.test.mjs branding.test.mjs \
  compare.test.mjs dataviz.test.mjs generate.test.mjs i18n-landing.test.mjs \
  i18n.test.mjs jobs.test.mjs lang-landing.test.mjs lang-routing.test.mjs \
  lang-selector.test.mjs lang.test.mjs limits.test.mjs seo.test.mjs \
  server-async.test.mjs ssrf.test.mjs stats.test.mjs store-wiring.test.mjs \
  store.test.mjs turnstile-gate.test.mjs turnstile-landing.test.mjs turnstile.test.mjs
# fichiers EXPLICITES (le répertoire nu bugge sous Windows)
```

## Tâche A — module `charts.ts` : jauge + barres priorités + i18n

Fichiers : `packages/cli/src/report/charts.ts` (nouveau),
`packages/cli/src/report/i18n.ts` (3 clés `vizScoreLabel`/`vizTitle`/
`compareChartLabel`, EN+FR), `packages/cli/test/report/charts.test.ts` (nouveau).

1. RED : tests jauge (dasharray, bandes 80/60, aria FR/EN, `<title>`,
   déterminisme) + barres priorités (tri lost desc, égalité → ordre canonique,
   largeurs ∝, couleurs statut, `−N pts`, `S/100`, tout-parfait, déterminisme).
2. GREEN : `renderScoreGauge`, `renderPriorityBars`, `COMPARE_SERIES` per spec
   §A/§B ; échappement systématique des textes injectés.
3. Gate CLI (tsc + vitest ciblé puis complet).

## Tâche B — intégration `html.ts` (section `.viz`) + graphe compare + deltas

Fichiers : `packages/cli/src/report/html.ts` (section + CSS),
`packages/cli/src/report/compare.ts` (`renderCompareChart` branché + légende),
`packages/cli/src/report/diff.ts` (▲/▼/= colonne Δ),
`packages/cli/test/report/charts.test.ts` (append intégration).

1. RED : `renderHtml` contient `class="viz"` (omis si `familyScores: []`),
   `renderCompareHtml` contient graphe + légende hosts échappés + gap 2px,
   >3 rapports → pas de graphe, `renderDiffHtmlSection` contient ▲/▼/=
   aria-hidden ; md/terminal byte-inchangés sur la fixture.
2. GREEN : per spec §C/§D/§E — tout additif, aucun sélecteur existant renommé.
3. Gate CLI complet + `npm run build`.

## Tâche C — test web de bout en bout

Fichiers : `apps/web/test/dataviz.test.mjs` (nouveau).

1. RED impossible ici (le rendu vient de dist/ déjà GREEN) → le test valide le
   CHEMIN web : job seedé avec `renderHtml(…, 'fr', { collapsed: true })` de
   `dist/`, `/audit/result` sert jauge + barres FR, zéro `<script>` dans le
   rapport (CSP intacte) ; compare idem via `renderCompareHtml`.
2. Gate web : `node --test` avec la liste EXPLICITE ci-dessus (23 fichiers).

## Rendu final (skill dataviz, étape 7)

Screenshot du rapport rendu (serveur local, job seedé ou fixture HTML écrite en
temp — PAS dans le repo) : collisions d'étiquettes, géométrie, débordements.

## Commits (3 max, ciblés)

1. `docs(superpowers): spec + plan dataviz page resultats`
2. `feat(report): dataviz SVG serveur — jauge score, barres priorites par famille (charts.ts + i18n)`
3. `feat(report): compare groupe + deltas baseline + integration html/web (tests web dataviz)`
