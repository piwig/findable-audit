# Spec — lisibilité du rapport, dashboard Core Web Vitals, écran « test en cours » (SSE), export web

Date : 2026-07-21
Statut : en revue (validation utilisateur requise avant plan)
Portée : `packages/cli` (données + renderers) **et** `apps/web` (flux async, SSE, export)

## 1. Contexte et objectif

Le rapport d'audit est aujourd'hui un empilement vertical sobre (badges score/grade,
barres de sous-scores, tables de checks). Côté web (`apps/web/server.mjs`), le flux
est **100 % synchrone** : le `<form>` GET navigue vers `/audit?url=` qui **bloque**
jusqu'à la fin puis renvoie le rapport d'un bloc — **aucun écran d'attente**, et
`CSP: script-src 'none'` interdit tout JS front. Les Core Web Vitals **ne sont pas
mesurés** côté web (`runAudit` appelé sans `cwv`) et leurs valeurs chiffrées ne sont
de toute façon **pas exposées** dans `AuditReport` (elles vivent dans `crawler.psi`
pendant le run).

Quatre besoins validés avec l'utilisateur :

1. **Écran « test en cours »** pendant l'analyse, avec **progression réelle** streamée.
2. **Dashboard Core Web Vitals** lisible et « joli » dans le rapport de résultats.
3. Rapport **plus lisible** + **conseils/recommandations actionnables** (avec liens).
4. **Export** du rapport en **Markdown** et **HTML** depuis l'UI web.

Contraintes fortes conservées : **zéro nouvelle dépendance npm** (CLI et web),
cross-platform strict, `process.exitCode` (jamais `process.exit` après l'audit),
rapport HTML **autonome/imprimable**, durcissement SSRF intact.

## 2. Décisions de design (maquettes validées)

| # | Sujet | Décision |
|---|-------|----------|
| 1 | Écran « test en cours » | **Progression réelle via SSE** — stepper : phases qui se cochent + barre + compteur `n/107` + activité live |
| 2 | Direction visuelle | **A · Sobre raffiné** — clair, une colonne, imprimable/PDF ; + bandeau verdict ; **tables de checks détaillées conservées** |
| 3 | Dashboard CWV | **Jauges radiales** colorées par seuil (bon / à améliorer / mauvais), couleur préservée à l'impression ; distingue **terrain (CrUX)** et **labo (Lighthouse)** |
| 4 | Conseils | **Plan d'action priorisé compact** (trié par impact) + **liens « En savoir plus »** (nouveau champ `docUrl`) ; détail conservé inline dans les tables |
| 5 | Export web | Boutons **Markdown** et **HTML** (téléchargement) sur la page de résultats |
| 6 | Source CWV web | **Clé PageSpeed via variable d'env `PSI_KEY`** sur le VPS ; repli « non mesuré » si absente |

Le langage graphique reste la palette actuelle (vert `#1a7f37`, ambre `#9a6700`,
rouge `#b42318`, gris `#999`). Aucune bascule dark-mode (Direction A = clair).

---

# PHASE 1 — Données + renderers (`packages/cli`)

Livrable autonome : améliore immédiatement les rapports CLI (`--cwv --psi-key`),
sans rien attendre du web. La Phase 2 consomme ces changements.

## 1.1 Propager les CWV dans `AuditReport`

`src/runner.ts` — le type racine gagne un champ optionnel, et le retour l'inclut :

```ts
import type { PsiResult } from './perf/psi.js';

export interface AuditReport {
  url: string;
  score: number;
  grade: Grade;
  familyScores: FamilyScore[];
  sampledPages: string[];
  results: CheckResult[];
  /** Raw PageSpeed data when --cwv was requested; null = attempted & failed; undefined = not requested. */
  psi?: PsiResult | null;
}
```

Au retour de `runAudit` (aujourd'hui `runner.ts:79`), ajouter `psi: crawler.psi`.
`renderJson` (stringify direct) l'expose automatiquement. **Additif, non cassant.**

## 1.2 Champ `docUrl` (liens « En savoir plus »)

Objectif : chaque recommandation porte un lien de documentation, **avec couverture
garantie** via un repli par famille.

- `src/types.ts` — `Check` gagne `docUrl?: string` (override par check, optionnel) ;
  `CheckResult` gagne `docUrl?: string`.
- Nouveau module `src/doc-urls.ts` :

```ts
import type { Family } from './types.js';
/** Fallback documentation link per family (used when a check has no docUrl). */
export const FAMILY_DOC_URL: Record<Family, string> = {
  'ai-access':       'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
  'llm-content':     'https://llmstxt.org/',
  'structured-data': 'https://schema.org/docs/schemas.html',
  'technical-seo':   'https://developers.google.com/search/docs',
  'on-page':         'https://developers.google.com/search/docs/appearance',
  performance:       'https://web.dev/explore/learn-core-web-vitals',
  accessibility:     'https://www.w3.org/WAI/WCAG21/quickref/',
  security:          'https://developer.mozilla.org/docs/Web/Security',
};
```

- `makeResult` (`types.ts:103-113`) résout le lien une fois :

```ts
export function makeResult(
  check: Pick<Check, 'id' | 'family' | 'maxPoints' | 'docUrl'>,
  status: CheckStatus, message: string, fix?: string,
): CheckResult {
  const points = status === 'pass' ? check.maxPoints
               : status === 'warn' ? Math.floor(check.maxPoints / 2) : 0;
  const docUrl = check.docUrl ?? FAMILY_DOC_URL[check.family];
  return { id: check.id, family: check.family, status, points, maxPoints: check.maxPoints, message, fix, docUrl };
}
```

Ainsi **toute** reco a un lien, sans annoter les 107 checks. Les `docUrl` par check
(plus précis) seront renseignés progressivement sur les checks à fort taux d'échec
(CWV → web.dev/lcp,cls,inp ; JSON-LD → schema.org du type ; HSTS → MDN…). Le champ
`docUrl` n'est affiché que pour `warn`/`fail` (comme `fix`).

## 1.3 Refonte de `renderHtml` (Direction A)

`src/report/html.ts` — nouvel ordre de sections (la constante `STYLE` est étendue ;
`@media print` conserve `print-color-adjust: exact` sur badges/barres/**anneaux CWV**) :

1. **Bandeau verdict (hero)** : grand carré score `/100` coloré + grade + **phrase de
   verdict** générée. Verdict = fonction pure de (`grade`, nb de `fail`) :
   ex. B → « Bonne base — N priorités pour viser A », F → « Fondations à corriger :
   N points critiques ». Table de phrases par grade dans `html.ts`.
2. **Ligne de stats** (discrète) : `X réussis · Y à corriger · Z pages` (dérivé de
   `results` + `sampledPages`).
3. **Sous-scores par famille** : barres actuelles, conservées/soignées.
4. **Dashboard Core Web Vitals** — **rendu seulement si `report.psi` est présent** :
   - **Jauges radiales** (Option 2) pour les 4 métriques terrain CrUX : **LCP, INP,
     CLS, TTFB**. Chaque anneau via `conic-gradient` inline, couleur = bucket calculé
     avec `CWV_THRESHOLDS` (`perf/psi.ts:58-67`) : ≤good → vert, ≤poor → ambre,
     sinon rouge. Valeur au centre + libellé.
   - Bandeau de verdict global CrUX (`field.overallCategory` → PASSED/À AMÉLIORER/
     ÉCHEC) + mention `mobile|desktop` et `origin` (« données origine » si fallback).
   - Ligne **labo Lighthouse** compacte (repliée visuellement) : Perf `perfScore`,
     FCP, TBT — tags « labo ».
   - Si `psi === null`/`undefined` : encart discret « Core Web Vitals non mesurés —
     lancez avec `--cwv --psi-key` » (web : « configurez `PSI_KEY` »). **Jamais** de
     section vide.
   - Nouveau helper `src/report/cwv.ts` (`renderCwvHtml(psi): string`) pour isoler la
     logique (testable seul, réutilisable md). `bucketOf(metric, value)` factorisé.
5. **Plan d'action** (`src/report/recommendations.ts`, nouveau module partagé) :
   - `collectRecommendations(results): Recommendation[]` = les `results` `fail`/`warn`
     ayant un `fix`, chacun avec `impact = maxPoints - points` et
     `weighted = impact * FAMILY_WEIGHTS[family]`.
   - Rendu en **deux groupes** : « 🔴 À corriger en priorité » (`fail`) puis
     « 🟠 À améliorer » (`warn`), chaque groupe **trié par `weighted` décroissant**.
     Ligne = pastille sévérité + chip famille + `fix` + badge `+{impact} pts` +
     lien « En savoir plus → » (`docUrl`). Cap d'affichage à **12** items avec
     « +N autres (voir détail ci-dessous) ». (Le badge `+N pts` = points récupérables
     du check, indicatif.)
6. **Tables de checks détaillées par famille** — **conservées** (comportement actuel
   `html.ts:76-92`) : chaque `fail`/`warn` montre `fix` + lien « En savoir plus → »
   inline (ajout du lien à la ligne existante).
7. Footer.

Invariants de sécurité conservés : tout texte tiers passe par `escapeHtml` ; les
`docUrl` sont **des constantes internes** (jamais dérivées du site audité) donc sûres
en `href` ; autonome (aucune ressource externe), aucun handler `on*` inline.

## 1.4 Parité `renderMarkdown`

`src/report/markdown.ts` — mêmes informations, format texte :
- Ligne de verdict sous le titre.
- Section `## Core Web Vitals` = **table** (Métrique | Valeur p75 | Statut | Source
  terrain/labo) via `renderCwvMarkdown(psi)` dans `report/cwv.ts` ; omise si pas de
  `psi`.
- Section `## Recommended fixes` existante enrichie : réutilise
  `collectRecommendations`, ajoute la colonne/segment **lien** (`docUrl`) et le badge
  d'impact. Tri identique au HTML.
- Tables de checks par famille : inchangées (ajout d'un lien Markdown sur `fix`).

## 1.5 Tests (Phase 1)

- `test/runner*.test.ts` : `psi` propagé dans `AuditReport` (présent si `--cwv`,
  absent/`null` sinon). Invariant e2e `perfect-site` = 100/100 **inchangé** (additif).
- `test/types` : `makeResult` renseigne `docUrl` = override sinon repli famille ;
  `docUrl` présent pour `warn`/`fail`.
- `test/report/cwv.test.ts` (fixture `PsiResult`) : `bucketOf` mappe correctement
  chaque seuil ; `renderCwvHtml` produit une jauge par métrique présente ; INP absent
  → non rendu (pas de faux zéro) ; `renderCwvMarkdown` → table cohérente.
- `test/report/recommendations.test.ts` : tri `fail` avant `warn`, puis par `weighted`
  décroissant ; cap à 12 + mention du reste.
- `test/report/html.test.ts` (mise à jour) : maquette avec `psi` → contient les
  jauges CWV + le bandeau verdict + le plan d'action + des liens `href` de doc ;
  **sans** `psi` → encart « non mesurés » et **pas** de section CWV vide ; toujours
  autonome (aucun `src|href` externe **autre que** les `docUrl` de doc attendus —
  ajuster l'assertion pour autoriser les liens de doc connus, interdire tout autre
  hôte), aucun handler `on*`, `@media print` présent, contenu tiers échappé.
- `test/report/markdown.test.ts` : section CWV + fixes avec liens.

---

# PHASE 2 — Flux web async, SSE, « test en cours », CWV, export (`apps/web`)

Dépend de la Phase 1 (nouveau `renderHtml`, `psi`, `onProgress`).

## 2.1 Instrumentation du moteur (`packages/cli/src/runner.ts`)

`AuditOptions` gagne un callback optionnel (non cassant) :

```ts
export type AuditPhase = 'connect' | 'sample' | 'checks' | 'cwv' | 'score';
export interface AuditProgress {
  phase: AuditPhase;
  done: number;        // checks terminés (phase 'checks')
  total: number;       // = checks.length (107)
  checkId?: string;
  family?: Family;
}
// AuditOptions:
onProgress?: (ev: AuditProgress) => void;
```

Émissions : `connect` (avant/après fetch homepage + SSRF), `sample` (après crawl),
puis dans la **boucle d'exécution des checks** un événement `checks` après chaque
`await check.run(ctx)` (`done` incrémenté, `checkId`/`family` renseignés), `cwv`
autour de `fetchPsi` (`runner.ts:61-67`), `score` avant `computeScore`. Purement
best-effort (try/catch autour de l'appel), n'altère jamais le résultat.

## 2.2 Store de jobs (`apps/web/lib/jobs.mjs`, nouveau)

Map en mémoire bornée + TTL (calqué sur `lib/cache.mjs`) :

```
Job = { id, url, status:'running'|'done'|'error', progress:AuditProgress|null,
        report|null, html|null, error|null, createdAt }
```

- `createJob(url) → id` (id = hash aléatoire) ; `getJob(id)` ; TTL (~5 min) + purge ;
  cap de taille. Respecte `MAX_CONCURRENT` (jobs `running`) et le cache URL existant
  (URL déjà en cache → job `done` immédiat).

## 2.3 Nouvelles routes (`apps/web/server.mjs`)

Le flux devient asynchrone. Routes GET (405 sinon, inchangé) :

| Route | Rôle |
|-------|------|
| `GET /audit?url=` | **Crée un job**, répond **immédiatement** la **page « test en cours »** (HTML + script à nonce ouvrant l'SSE). Ne bloque plus. |
| `GET /audit/stream?job=<id>` | **SSE** : lance/rattache le job, `event: progress` (phase, done/total, %, activité) puis `event: done` (`{resultUrl}`) ou `event: error`. |
| `GET /audit/result?job=<id>` | Rapport HTML final (nouveau `renderHtml`) depuis `job.report`. Repli sans-JS (voir 2.5). |
| `GET /audit/export?job=<id>&format=md\|html` | Téléchargement : `renderMarkdown`/`renderHtml` + `Content-Disposition: attachment; filename="<host>-<date>.<ext>"`. Repli `?url=` si job expiré. |
| `GET /audit.json?url=` | **Inchangé** (API synchrone, sans progression). |
| `GET /` `/healthz` | Inchangés. |

La **page « test en cours »** (générée par une fonction dédiée, style Direction A) :
stepper (Connexion & sécurité → Échantillonnage → Analyse des checks `n/107` →
Core Web Vitals → Score & rapport) + barre + activité. Un `<script nonce=…>` inline
ouvre `EventSource('/audit/stream?job=<id>')`, met à jour le DOM, et sur `done`
navigue vers `resultUrl`. Le rendu **résultats** (`renderHtml`) reste **sans JS**.

## 2.4 SSE : exécution du job

À la première connexion `/audit/stream?job=id` : lancer `runAudit` avec
`onProgress` qui **pousse chaque événement** en SSE (throttle léger, ex. ≤ 20/s).
Stocker le `report` + `renderHtml(report)` dans le job à la fin, envoyer
`event: done`. Sur erreur (SSRF/timeout/injoignable) → `event: error` + message
« friendly » (réutiliser les libellés existants `server.mjs:282-328`). Reconnexion
EventSource → rattachement idempotent (si `done`, renvoyer `done` direct).

## 2.5 CSP, sécurité, repli sans-JS

- **CSP** : seule la page « test en cours » reçoit `script-src 'nonce-<rnd>'` +
  `connect-src 'self'` (pour l'EventSource). Nonce aléatoire par réponse. **Toutes
  les autres pages** (résultats, landing, erreurs) restent `script-src 'none'`.
  Les invariants « pas de handler inline » du rapport (`html.test.ts`) tiennent :
  ils portent sur `renderHtml`, pas sur la page web d'attente.
- **Repli sans-JS** : la page « test en cours » inclut
  `<noscript><meta http-equiv="refresh" content="2;url=/audit/result?job=<id>"></noscript>`.
  `/audit/result` : si le job n'est pas `done`, renvoyer une page légère avec
  `Refresh: 2` (auto-rechargement) au lieu de bloquer — l'audit tourne côté serveur.
- SSRF : **aucune modification** de la garde `assertPublicUrl()` / `blockPrivateHosts`.
- Rate-limit, cache, `MAX_CONCURRENT` : conservés (au niveau création de job / stream).

## 2.6 Activation CWV côté web + budget temps

- Lire `PSI_KEY` (env). Si présente : `runAudit(..., { …, cwv:true, psiKey:
  process.env.PSI_KEY, psiStrategy:'mobile', onProgress })`. Sinon : pas de `cwv`
  (dashboard « non mesuré », inchangé côté rendu).
- L'audit tournant en **job de fond**, il n'est plus borné par le timeout HTTP de la
  requête. Relever `AUDIT_TIMEOUT_MS` à **~90 s** quand `cwv` est actif (l'appel PSI
  vaut jusqu'à 45 s) ; garder 45 s sinon. La progression SSE (phase `cwv`) informe
  l'utilisateur pendant l'attente PageSpeed.

## 2.7 Boutons d'export (page résultats)

La page `/audit/result` (donc le HTML de `renderHtml`) affiche deux liens de
téléchargement **⬇ Markdown** / **⬇ HTML** pointant vers `/audit/export?job=…`.
Comme le rapport `renderHtml` est réutilisé tel quel, l'injection se fait comme
l'actuel lien retour (`reportWithBackLink`, `server.mjs:136-143`) — une petite barre
d'actions insérée avant `</body>`, **sans** ajouter de JS (simples `<a href>`,
CSP-safe).

## 2.8 Déploiement (VPS) — note

Mémoire [[findable-audit-web-deploiement]] : le vhost nginx `findable.conf` doit,
**sur la location `/audit/stream`**, désactiver le buffering et allonger le timeout :
`proxy_buffering off; proxy_read_timeout 120s; proxy_set_header Connection '';`
(HTTP/1.1). Ajouter `PSI_KEY=<clé>` à l'environnement du service `findable-web`
(`Environment=` systemd ou fichier d'env). Ces changements sont **manuels au
redéploiement** ; le code fonctionne sans (SSE marche en direct, CWV « non mesuré »
sans clé). Guider l'utilisateur pour obtenir une clé PageSpeed (gratuite, Google
Cloud console → API PageSpeed Insights).

## 2.9 Tests (Phase 2)

Tests `node:test` sur vrai serveur HTTP local (pattern existant `apps/web/test`) —
la **cible** de l'audit est un serveur local de fixture (pas d'appel PSI réel : clé
absente → phase `cwv` « non mesuré ») :

- `runner` : `onProgress` appelé pour chaque check (`done` va de 1 à `total`) et
  l'ordre des phases est `connect → sample → checks → (cwv) → score`.
- `/audit?url=` → 200, page « test en cours », en-tête CSP avec `nonce-…` +
  `connect-src 'self'`, `<script nonce=…>` présent, `<noscript>` refresh présent.
- `/audit/stream?job=id` → `Content-Type: text/event-stream`, émet ≥1 `progress`
  puis `done` avec `resultUrl` ; `/audit/result?job=id` → rapport HTML (contient le
  score, les sections, `script-src 'none'`).
- `/audit/export?job=id&format=md` → `text/markdown` + `Content-Disposition:
  attachment` ; `format=html` → `text/html` attachment ; extension/nom de fichier ok.
- Repli sans-JS : `/audit/result` d'un job non terminé → en-tête `Refresh`.
- Régression : tests SSRF (`test/ssrf.test.mjs`) et abus (`test/abuse.test.mjs`)
  **inchangés/verts** ; les 542 tests CLI restent verts.

## 3. Documentation

- `apps/web/README.md` : nouveau flux (async + SSE), `PSI_KEY`, note nginx SSE,
  boutons d'export. Corriger au passage les constantes périmées (concurrence/timeout).
- `README.md` racine + `docs/guide*.md` : mention du **dashboard CWV**, du **plan
  d'action** et des **liens de doc** dans les rapports ; export web md/html.

## 4. Contraintes (rappel)

- Node ≥ 20, ESM. **Zéro dépendance npm** (CLI et web restent zéro-dép).
- Jamais de `process.exit()` après le lancement de l'audit (crash libuv Windows).
- Cross-platform strict (`path.join`, pas de shell POSIX). `.gitattributes` LF.
- Rapport HTML **autonome/imprimable** (jauges CWV lisibles en PDF via
  `print-color-adjust`). Aucun JS dans le rendu **résultats**.
- SSRF : garde inchangée. CSP relâchée **uniquement** sur la page d'attente (nonce).
- Déterminisme des tests : asserter la présence d'éléments, pas la date exacte.

## 5. Découpage / ordre d'implémentation

1. **P1** (CLI) : 1.1 `psi` → 1.2 `docUrl` → `report/cwv.ts` + `report/recommendations.ts`
   → 1.3 `renderHtml` → 1.4 `renderMarkdown` → tests. **Livrable seul** (rapports CLI
   améliorés). 2. **P2** (web) : 2.1 `onProgress` → 2.2 jobs → 2.3/2.4 routes+SSE →
   2.5 CSP/repli → 2.6 CWV → 2.7 export → tests → docs → déploiement.

## 6. Self-review

- ✔ Tous les changements de **données** sont **additifs** (`psi?`, `docUrl?`,
  `onProgress?`) → e2e `perfect-site`=100 préservé, JSON rétro-compatible.
- ✔ Le dashboard CWV se **dégrade proprement** (encart « non mesuré », jamais vide) —
  couvre le cas web sans clé **et** CLI sans `--cwv`.
- ✔ **Zéro dépendance** : SSE = `text/event-stream` natif, jauges = `conic-gradient`
  CSS, jobs = Map en mémoire. Aucune lib.
- ✔ CSP relâchée **au strict minimum** (page d'attente uniquement, nonce) ; rendu
  résultats et SSRF inchangés → surface de sécurité maîtrisée.
- ✔ Repli **sans-JS** (noscript refresh) → l'écran d'attente n'est jamais un cul-de-sac.
- ✔ Couverture des liens de doc **garantie** par repli famille sans annoter 107 checks ;
  raffinement per-check incrémental.
- ✔ Logique CWV/reco **factorisée** (`report/cwv.ts`, `report/recommendations.ts`) →
  partagée HTML/Markdown, testable isolément, fichiers focalisés.
- ⚠ Point ouvert : le badge « +N pts » est indicatif (points récupérables du check),
  pas le delta exact du score pondéré/renormalisé. Décision : **acceptable** (lisible,
  honnête via le libellé), pas de calcul de delta exact (complexité inutile).
- ⚠ Point ouvert : groupement du plan d'action par **sévérité** (`fail`/`warn`) faute
  de signal d'effort ; les libellés « gains rapides » des maquettes deviennent
  « à corriger en priorité / à améliorer » (plus honnête). Un champ `effort?` par check
  reste possible plus tard (YAGNI pour l'instant).

---

## 7. Addendum 2026-07-21 — exigences supplémentaires (Phase 2)

Ajoutées en cours d'exécution ; **n'affectent pas la Phase 1** (renderers CLI). À intégrer au plan Phase 2 (`apps/web`).

### 7.1 Refonte de la landing page (user-friendly + design soigné)
- Rendre la page d'accueil de `apps/web` plus accueillante et jolie (aujourd'hui : `landingPage()` minimal dans `server.mjs`, un `<form>` + hint).
- **Source de design** : s'inspirer de **pb-ot.fr** (sources locales `C:\IA\PB OpenTech`, site Astro ; SEO/GEO/AEO très abouti — voir mémoire [[pb-opentech-site]]). Reprendre son langage visuel (hero clair, typographie, accents, sections « ce que ça fait / pourquoi », CTA) **adapté** à findable-audit (thème clair, accent vert `#1a7f37`, cohérent avec le rapport Direction A). Contraintes web conservées : zéro-dép, CSP stricte hors page d'attente, autonome.
- À la reprise Phase 2 : proposer 1-2 maquettes (compagnon visuel) avant implémentation, puis valider.

### 7.2 Export JSON (en plus de HTML et MD)
- **Web** : ajouter un 3ᵉ bouton **⬇ JSON** sur la page de résultats, et étendre la route d'export à `format=md|html|json` → `renderJson(report)` avec `Content-Type: application/json` + `Content-Disposition: attachment; filename="<host>-<date>.json"`. (`renderJson` existe déjà.)
- **CLI** : étendre le dispatch par extension de `--report` (`index.ts` : aujourd'hui `.html?`→`renderHtml`, sinon `renderMarkdown`) pour gérer **`.json`→`renderJson`**. Petit ajout non cassant.
- Tests : route export json (content-type + disposition) ; dispatch CLI `--report out.json` écrit du JSON valide (`JSON.parse` ok).
