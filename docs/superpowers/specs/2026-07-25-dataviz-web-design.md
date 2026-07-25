# Dataviz page résultats — design : SVG serveur (jauge, priorités, compare, deltas)

> Réfs : roadmap tâche 5 (« Dataviz de la page résultats web »).
> Périmètre : visualisations SVG inline générées CÔTÉ SERVEUR, zéro lib, zéro JS
> client obligatoire, FR/EN, déterministes. Hors périmètre : nouvelle dépendance,
> git push, deploy/VPS, npm publish, poids/décomptes des checks, tout JS client
> au-delà des `<title>` SVG natifs (tooltips navigateur = progressive enhancement gratuit).

## Où vivent les templates (constat, vérifié)

- `apps/web/server.mjs` ne rend PAS le rapport lui-même : il importe
  `renderHtml` / `renderCompareHtml` depuis `packages/cli/dist/report/*` et
  injecte seulement un chrome (barre download) au-dessus du `<body>`.
- Le rapport HTML autonome du CLI (`--report x.html`, export web `format=html`)
  passe par le MÊME `renderHtml`.
- La section baseline (`--baseline`) est `renderDiffHtmlSection` dans
  `packages/cli/src/report/diff.ts`, embarquée par `renderHtml(…, { diff })`
  (CLI uniquement — le web ne fournit jamais de baseline, la section n'y
  apparaît donc pas, sans branche spéciale).

**Décision : le code de rendu SVG vit dans `packages/cli/src/report/charts.ts`**
(nouveau module partagé, pur, sans dépendance), consommé par `html.ts`,
`compare.ts` et `diff.ts`. Web + CLI restent un seul chemin de rendu ; le
rapport autonome est correct par construction.

## Contraintes transverses

- **Déterminisme** : fonctions pures des données du rapport ; aucune date, aucun
  aléa ; largeurs/arcs arrondis à l'entier (`Math.round`) ; mêmes données →
  markup byte-identique (testé par double appel).
- **Accessibilité** : chaque `<svg>` porte `role="img"` + `aria-label` localisé
  + `<title>` ; le texte reste en encres neutres (#1a1a1a/#555/#888), jamais en
  couleur de série ; les glyphes ▲/▼/= sont `aria-hidden` avec la valeur signée
  en texte à côté ; les tableaux existants (sous-scores, compare, deltas)
  restent les « table views » accessibles — on n'en retire rien.
- **Additif, zéro casse** : `cli.test.ts` épingle `.hero-score`,
  `html.test.ts` épingle la table `.subscore-table`, `compare.test.ts` épingle
  la table compare → tout est AJOUTÉ, rien n'est remplacé ni renommé.
- **Palette** (skill dataviz, `validate_palette.js` exécuté) :
  - Statut (jauge + barres priorités — la couleur SIGNIFIE bon/moyen/mauvais) :
    les tokens existants du rapport `#1a7f37` (≥80) / `#9a6700` (60–79) /
    `#b42318` (<60) via `scoreClass` — inchangés, cohérents avec tout le reste.
  - Catégoriel (compare — la couleur = identité du site, ordre FIXE, jamais
    recyclé) : vous=`#1a7f37` (vert marque), concurrent 1=`#2a78d6` (bleu),
    concurrent 2=`#4a3aa7` (violet). Validation : pire ΔE CVD adjacent 13.0
    (≥8), plancher vision normale 16.3 (≥15), contraste ≥3:1 — ALL PASS.
  - Deltas : `#0f766e` (hausse) / `#b91c1c` (baisse) — couleurs déjà utilisées
    par la section diff — et `#6b7280` (=).

## A. Jauge/donut de score global — `renderScoreGauge(score, grade, lang)`

- Donut SVG `viewBox="0 0 120 120"` : piste `<circle>` #eee épaisseur 10 ;
  arc de valeur = `<circle pathLength="100" stroke-dasharray="S ${100−S}"
  stroke-dashoffset="25">` (départ à midi) — **aucune trigonométrie flottante**,
  arc exact et déterministe pour tout S entier 0–100. `stroke-linecap="round"`,
  fill de l'arc `none`, couleur = bande `scoreClass`.
- Centre : score en 30px graisse 800 encre primaire (chiffres proportionnels,
  pas de tabular-nums sur un grand nombre isolé), dessous `/100 · <grade>` en
  12px encre secondaire. La lettre est du TEXTE (jamais colorée série) ; le
  statut est porté par l'arc.
- `role="img"`, `aria-label` = `m.vizScoreLabel(score, grade)`
  (EN « Overall score: 72 out of 100 — grade C » / FR « Score global : 72 sur
  100 — note C »), `<title>` identique.

## B. Barres par famille (priorisation) — `renderPriorityBars(familyScores, lang)`

- **La grandeur encodée est `lost = max − earned`** (points perdus bruts de la
  famille, définition de la mission), **tri décroissant**, égalité départagée
  par l'ordre canonique des familles (déterminisme).
- SVG `viewBox="0 0 560 H"`, H = 8 + n×32 : par famille une rangée de 32px —
  libellé court (`FAMILY_SHORT_I18N`, 12px encre primaire, ancré fin à x=142) +
  `<title>` = libellé long ; zone barre x=150…480 (330px) : piste #f2f2f2
  hauteur 14 pleine largeur, barre en couleur de statut (`scoreClass(score)` de
  la famille), **bout de barre arrondi 4px côté données, carré à la base**
  (path `h w−4 q 4 0 4 4 v 6 q 0 4 −4 4 h −(w−4) z` ; barre < 4px → rect brut) ;
  échelle : max(lost) → 330px, `Math.round` ; tout à 0 perdu → pistes seules.
- Étiquettes directes (règle « valeur au bout de la barre ») : `−N pts` à
  bar+6 (11px, encre secondaire ; `0 pt` si rien de perdu) et le sous-score
  `S/100` ancré fin à x=556 (11px, encre muette). Pas de grille (valeurs aux
  bouts), pas de légende (une seule série par sens de lecture — statut).
- `role="img"`, `aria-label` = `m.vizTitle` ; chaque rangée est un `<g>` avec
  son propre `<title>` (« Sécurité & confiance : 50/100, −2 pts ») → tooltip
  natif sans JS.

## C. Intégration rapport (`html.ts`)

- Nouvelle `<section class="viz">` insérée entre `.pages` et `.subscores` :
  panneau flex (bordure/fond identiques au `.hero`) = jauge (A) à gauche +
  `<h2>` `m.vizTitle` et barres (B) à droite ; `width:100%`/`height:auto` via
  CSS pour la responsivité, wrap en colonne sous 640px.
- Omise entièrement quand `familyScores` est vide (miroir exact de la règle de
  la section sous-scores). La table `.subscore-table` (ordre canonique, poids)
  reste telle quelle : c'est la vue table + la vue « pondération », la
  vue SVG est la vue « priorisation ».
- `@media print` : ajout de `.viz svg` à la règle `print-color-adjust`.

## D. Mode compare — `renderCompareChart(reports, lang)` (`compare.ts`)

- Inséré entre `.meta` et la table ; barres horizontales groupées par famille
  (familles = `familiesOf`, ordre canonique ; sites = ordre des rapports, vous
  d'abord — l'ordre et les couleurs suivent l'ENTITÉ, jamais le rang).
- Rangée par famille : libellé court ancré fin (12px) + `<title>` long ;
  n barres de 10px, **écart 2px** (surface gap), échelle FIXE 0–100 → 330px
  (les scores de familles sont déjà 0–100 — comparabilité directe entre
  rangées) ; valeur `S` au bout de chaque barre (10px encre secondaire — ≤3
  séries, valeurs 1–3 chiffres : reste sobre) ; famille absente d'un site →
  pas de barre (la table affiche déjà « — »).
- **Légende obligatoire (≥2 séries)** : au-dessus du SVG, en HTML — pastille
  10px couleur série + host (échappé) + ` (Vous)` sur le premier
  (`m.compareYou`). Couleurs : `COMPARE_SERIES = ['#1a7f37','#2a78d6','#4a3aa7']`
  exporté par `charts.ts` (max 3 sites déjà garanti : `MAX_COMPARE_COMPETITORS=2`
  côté web ; le CLI en accepte plus → au-delà de 3, les sites suivants recyclent
  la dernière teinte ? NON — jamais de recyclage : au-delà de 3 sites le
  graphique est omis, la table reste (cap de séries du skill)).
- `role="img"` + `aria-label` = `m.compareChartLabel` ; `<title>` par barre
  (« host — Famille : 72/100 »).

## E. Deltas baseline — `diff.ts`

- Colonne Δ du tableau familles et ligne score global : glyphe ▲ (delta>0,
  #0f766e) / ▼ (delta<0, #b91c1c) / = (delta 0, #6b7280), `aria-hidden="true"`,
  suivi de la valeur signée existante (`sign(n)`) qui reste le canal textuel ;
  delta null → « — » inchangé. Pas de nouveau SVG : indicateur typographique
  sobre, déterministe, correct en FR/EN sans i18n supplémentaire.

## F. i18n (`ReportMessages`, EN+FR)

- `vizScoreLabel: (score, grade) => string` — aria-label jauge (voir §A).
- `vizTitle: string` — EN « Where to regain points » / FR « Où regagner des
  points » (titre du panneau + aria-label des barres).
- `compareChartLabel: string` — EN « Family scores by site » / FR « Scores par
  famille et par site ».

## G. Plan de test (RED d'abord)

- `packages/cli/test/report/charts.test.ts` (nouveau, vitest) :
  - jauge : dasharray `"72 28"`, bandes couleur aux bornes 80/60/59, arrondi
    des scores, aria-label FR/EN, `<title>`, déterminisme (double appel ===) ;
  - priorités : tri par points perdus décroissants (fixture aux `lost`
    distincts + égalité → ordre canonique), largeur ∝ lost, piste présente,
    couleur statut par famille, `−N pts` + `S/100`, cas tout-parfait (barres
    nulles, libellés présents), déterminisme ;
  - compare : ordre/couleurs de série fixes, gap 2px entre barres d'un groupe,
    légende avec hosts échappés (`<`→`&lt;`), famille absente → pas de barre,
    >3 rapports → chaîne vide ;
  - deltas : `renderDiffHtmlSection` contient ▲/+4, ▼/−3, =/0, aria-hidden,
    FR/EN inchangés par ailleurs.
  - intégration : `renderHtml` contient `class="viz"` + jauge + barres,
    l'omet si `familyScores: []` ; `renderCompareHtml` contient le graphe +
    légende ; les sorties md/terminal inchangées.
- `apps/web/test/dataviz.test.mjs` (nouveau, node --test) : serveur démarré
  (port 0), job seedé avec `html: renderHtml(report, undefined, 'fr',
  { collapsed: true })` depuis `dist/` → `/audit/result` sert la jauge + les
  barres avec les libellés FR, aucun `<script>` dans le corps du rapport
  (CSP `script-src 'none'` intacte) ; idem compare via `renderCompareHtml`.

## H. Gates

- `cd packages/cli && npx tsc --noEmit && npx vitest run` puis `npm run build`
  (le web importe `dist/`).
- `cd apps/web && node --test <TOUS les fichiers .test.mjs EXPLICITES>`
  (répertoire nu buggé sous Windows), y compris le nouveau.
