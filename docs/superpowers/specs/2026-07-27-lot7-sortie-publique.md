# LOT 7 — « Sortie publique » (spec, 2026-07-27)

Le produit est profond (120 checks, 8 familles, CLI + web + plugin + Action) et la
faiblesse reconnue au §6 de `docs/competitive-analysis-and-roadmap.md` — « traction non
prouvée » — est aujourd'hui mesurable : paquet npm **non publié** (404 sur les trois noms
plausibles), dépôt public **0 étoile, 0 topic, pas de homepage**, et les deux artefacts
que voient en premier un visiteur npm et un reviewer (`packages/cli/README.md`,
`action.yml`) annoncent encore **113 checks** au lieu de 120.

Ce lot ne rend pas l'outil plus intelligent. Il le rend **installable, citable et à jour**.

## Contraintes héritées (CLAUDE.md)

- Zéro nouvelle dépendance runtime. Le badge est un builder de chaîne pur, comme
  `report/charts.ts`.
- Cross-platform strict : `path.join`, aucun shell POSIX dans le code livré.
- `process.exitCode`, jamais `process.exit`, dans tout chemin qui suit un `fetch`.
- Le décompte de checks vient de `buildChecks().length`, jamais d'un document antérieur.
- Sujets de commit : une ligne, français sans accents, `type(scope): …`.

## A. Badge de score (#12) — `--report <fichier>.svg`

Le dispatch de `--report` choisit déjà le format par extension (`.sarif`, `.json`,
`.xml`, `.html`, sinon Markdown). On ajoute `.svg` → **badge**. Aucun nouveau flag :
l'Action expose déjà `report:`, donc le badge arrive gratuitement en CI.

`packages/cli/src/report/badge.ts`, `renderBadge(report): string` :

- SVG **autonome** : aucune ressource externe, aucun script, aucun `<image>`. Il sera
  servi par le proxy d'images de GitHub, qui rend le fichier hors de tout document.
- Couleurs **littérales** (pas de `var(--…)` comme dans `charts.ts` : il n'y a pas de
  document hôte pour les résoudre), reprises telles quelles de `statusColor` —
  `≥80 #1a7f37`, `≥60 #9a6700`, sinon `#b42318`. La couleur garde le même sens que
  partout ailleurs dans le rapport : bon / moyen / mauvais.
- Deux segments : libellé `findable` sur l'encre de marque `#1c2230`, valeur
  `<grade> <score>/100` sur la couleur de statut.
- Largeur calculée par une table de largeurs de glyphes (11px, pile sans-serif système),
  et **`textLength` + `lengthAdjust="spacingAndGlyphs"`** posés sur chaque `<text>` : le
  texte est contraint à la boîte calculée, donc le rendu reste juste même si la police
  estimée n'est pas celle du client. C'est ce qui remplace des métriques de police
  qu'on n'a pas.
- `role="img"`, `aria-label` et `<title>` comme les autres SVG du projet. Le titre porte
  l'hôte audité et, s'il est présent, `generatedAt` — la fraîcheur est lisible au survol
  plutôt que promise.
- Déterministe : mêmes entrées → octets identiques. Anglais uniquement, comme le
  terminal, le JSON, le SARIF et le JUnit.

Verdicts couverts par les tests : bande verte / ambre / rouge, bornes 0 et 100,
échappement d'une URL hostile, absence de `<script`/`href`, stabilité octet-pour-octet,
et l'intégration CLI (`--report x.svg` écrit bien un badge).

## B. Publication npm

`packages/cli/package.json` est déjà prêt (`bin`, `files`, `publishConfig.access:
public`, `repository.directory`, MIT). Manquent :

- `prepublishOnly: npm run build` — `files` ne contient que `dist`, donc publier sans
  build publierait un paquet vide ou périmé. C'est le seul vrai risque de ce lot.
- `.github/workflows/release.yml` : sur tag `v*`, `npm ci` → build → tests → publish avec
  `--provenance` (`id-token: write`), secret `NPM_TOKEN`. Publier depuis CI plutôt que
  depuis un poste donne l'attestation de provenance, qui est exactement le genre de
  signal qu'un dossier OSS peut montrer.

La publication elle-même reste une action de l'utilisateur : elle exige soit `npm login`,
soit un secret `NPM_TOKEN` sur le dépôt. Rien dans ce lot ne publie sans son geste.

## C. Décomptes périmés — et la raison qu'ils rotent

`packages/cli/README.md` (×2) et `action.yml` disent 113. Ils ne sont **pas** dans la
table de propagation de `.claude/skills/findable-new-check/SKILL.md`, qui liste neuf
fichiers : c'est exactement pourquoi ils sont périmés. On corrige les trois occurrences
**et** on ajoute les deux fichiers à la table du skill — sinon la même dérive revient au
prochain check.

Les décomptes anciens dans `docs/superpowers/`, `docs/research/` et l'archive du §0 de la
roadmap sont **historiques** : ils restent tels quels.

## D. Métadonnées du dépôt

`gh repo edit` : homepage `https://findable.bordebat.fr`, topics (`seo`, `geo`,
`ai-search`, `llms-txt`, `core-web-vitals`, `accessibility`, `cli`, `site-audit`,
`generative-engine-optimization`, `ai-crawlers`). Sans topics, le dépôt n'apparaît dans
aucune page de sujet GitHub — c'est de la découvrabilité gratuite non réclamée.

## Non-goals

- Pas de publication automatique au push : le tag reste un geste délibéré.
- Pas de changement du défaut `version: local` de l'Action. Il garantit que l'Action et le
  moteur qu'elle exécute viennent du même commit ; la publication npm ne rend pas ce
  choix moins vrai. Seul le commentaire qui dit « en attendant la publication » change.
- Pas de badge auto-rafraîchi par un workflow qui committe sur `main` : un commit de bot
  hebdomadaire sur un dépôt de candidature coûte plus en bruit qu'il ne rapporte. Le
  badge du README est régénéré à la main, et sa date est dans son `<title>`.
- Pas de soumission au Marketplace GitHub depuis ici : elle se coche dans l'UI d'une
  release. `action.yml` a déjà `branding`, donc le dépôt est éligible ; la marche à
  suivre est notée dans le rapport de lot.

## Checklist d'intégration

1. `report/badge.ts` + tests unitaires (`test/report/badge.test.ts`).
2. Dispatch `.svg` dans `index.ts` + ligne d'aide `--report` dans `USAGE`.
3. Test d'intégration CLI dans `cli-report-dispatch.test.ts`.
4. Décomptes 113 → 120 (`packages/cli/README.md` ×2, `action.yml`) + deux lignes ajoutées
   à la table du skill.
5. `prepublishOnly` + `release.yml`.
6. Badge du dépôt dans `README.md`, généré par un audit réel de findable.bordebat.fr.
7. `npm run build --workspaces && npm test --workspaces`, puis `cd apps/web && node --test`.
8. Commit ; push sur go explicite.
