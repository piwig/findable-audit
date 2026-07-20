# Spec — Crawl multi-pages, nouveaux checks et skills du plugin

Date : 2026-07-20
Statut : en revue (validation utilisateur requise avant implémentation)
Portée : `packages/cli` + `plugin/`

## 1. Contexte et objectif

`findable-audit` audite aujourd'hui **uniquement la homepage** (plus quelques
ressources racine : `/robots.txt`, sitemap, `llms.txt`, clé IndexNow). Les 16
checks existants couvrent 4 familles : `ai-access`, `llm-content`,
`structured-data`, `seo-fundamentals`.

Objectif de cette itération (design approuvé en conversation) :

1. **Échantillonnage multi-pages** : auditer la homepage **+ un échantillon de
   pages internes** découvertes via le sitemap (fallback : liens internes de la
   homepage).
2. **Nouveaux checks** exploitant cet échantillon (hygiène SEO technique +
   couverture GEO par page).
3. **Compléter les skills manquantes du plugin** (`plugin/skills/` est vide
   alors que `plugin/.claude-plugin/plugin.json` existe).

Le scoring reste auto-normalisé (le runner divise `points` par `maxPoints`
cumulés, les `skip` sont exclus) : **aucun rééquilibrage manuel** des checks
existants n'est nécessaire.

## 2. Architecture — échantillonnage multi-pages

### 2.1 `PageSampler` (nouveau : `src/sampler.ts`)

```ts
export interface PageSample {
  pages: FetchedResource[];   // homepage incluse, HTML uniquement, même origine
  source: 'sitemap' | 'links' | 'homepage-only';
}
export async function samplePages(ctx: CrawlContext, maxPages: number): Promise<PageSample>;
```

Algorithme :

1. Récupérer les URLs du sitemap (réutilise la découverte de
   `checks/sitemap.ts`, extraite en helper partagé `discoverSitemap(ctx)`)
   → prendre les `<loc>` de **même origine** (`ctx.baseUrl.origin`), dédupliqués.
   Si la racine est un `<sitemapindex>`, suivre au plus les 2 premiers
   sous-sitemaps (borne de coût).
2. Fallback si aucun sitemap : liens internes `<a href>` de la homepage
   (même origine, sans `#fragment`, sans extensions binaires évidentes).
3. Échantillonner de façon **déterministe** : homepage + les `maxPages - 1`
   premières URLs triées par (profondeur de chemin croissante, ordre
   lexicographique) — reproductible d'un run à l'autre, mélange pages proches
   de la racine et sections.
4. Fetch séquentiel via `ctx.fetch()` (déjà caché + timeouts) ; ne garder que
   les réponses HTML `text/html` avec `status < 400`. Les URLs en échec sont
   comptées mais n'invalident pas l'échantillon.
5. `maxPages = 1` ⇒ comportement actuel (homepage seule), `source: 'homepage-only'`.

Le sample est calculé **une seule fois** dans `runAudit` et transmis aux checks.

### 2.2 Extension de `CrawlContext` (`types.ts`)

```ts
export interface CrawlContext {
  baseUrl: URL;
  fetch(path: string): Promise<FetchedResource | null>;
  /** Pages HTML échantillonnées (homepage incluse). Rempli par le runner. */
  sample?: PageSample;
}
```

Optionnelle (`?`) pour ne pas casser les tests unitaires existants qui
construisent un `Crawler` nu : un check multi-page sans `sample` retombe sur
la homepage seule.

### 2.3 Agrégation par page (helper `src/checks/aggregate.ts`)

Les checks multi-pages évaluent un prédicat par page puis agrègent :

- **pass** : 100 % des pages conformes ;
- **warn** : ≥ 80 % conformes ;
- **fail** : sinon.
Le message liste jusqu'à 3 URLs fautives (`page /a, /b (+2 autres)`).

## 3. Nouveaux checks

| id | famille | maxPoints | verdict |
|---|---|---|---|
| `meta-robots-noindex` | seo-fundamentals | 6 | fail si une page échantillonnée porte `noindex`/`none` (meta robots **ou** header `x-robots-tag`) |
| `redirect-hygiene` | seo-fundamentals | 4 | `http://` → `https://` doit aboutir (via `finalUrl`) ; warn si la homepage subit une chaîne (finalUrl ≠ URL demandée après normalisation trailing-slash) |
| `broken-internal-links` | seo-fundamentals | 8 | liens internes des pages échantillonnées (dédupliqués, max 30 vérifiés) → `status < 400` ; agrégation §2.3 sur les liens |
| `unique-titles` | seo-fundamentals | 5 | `<title>` et meta description **uniques** sur l'échantillon ; skip si < 2 pages |
| `hreflang` | seo-fundamentals | 3 | skip si aucun `link[hreflang]` ; si présent : chaque alternate répond 200 et contient un hreflang retour (réciprocité, max 5 vérifiées) |
| `images-alt` | llm-content | 4 | ≥ 90 % des `<img>` des pages échantillonnées ont un `alt` non vide (les images décoratives `alt=""` comptent comme conformes si `role="presentation"` absent → simple : `alt` attribut présent) |
| `schema-coverage` | structured-data | 5 | ≥ 50 % des pages échantillonnées ont au moins un bloc JSON-LD valide (réutilise `extractJsonLd`) |

Notes :

- Tous utilisent `ctx.sample` ; sans sample ⇒ homepage seule (checks restent
  définis, jamais crashés — le runner marque déjà `skip` sur exception).
- `canonical` existant (homepage) reste ; on **étend son message** seulement
  si trivial, sinon inchangé (non-goal : pas de refonte des checks existants).
- Parsing HTML : mêmes techniques regex/`node-html-parser` que les checks
  existants (aligné sur ce qu'utilise `fundamentals.ts`).

## 4. CLI et rapports

- Nouveau flag : `--max-pages <n>` (défaut **10**, `1` = homepage only).
  Validation identique à `--timeout` (nombre entier positif, sinon exit 2).
- `runAudit(url, checks, { timeoutMs, maxPages })` : construit le sampler
  après le fetch homepage, l'attache au crawler (`crawler.sample = ...`).
- Rapports : aucun changement de structure. `renderTerminal`,
  `renderJson`, `renderMarkdown` affichent naturellement les nouveaux checks
  via leurs familles existantes. Le JSON gagne un champ `sampledPages:
  string[]` au niveau racine (additif, non-breaking).
- USAGE mis à jour dans `index.ts`.

## 5. Tests et fixtures

- Nouvelle fixture `test/fixtures/multi-page/` : sitemap 4 pages, 1 page avec
  `noindex`, 1 lien interne cassé, titres dupliqués sur 2 pages, images sans
  alt — exerce chaque nouveau check en fail/warn.
- Nouvelle fixture minimale `test/fixtures/hreflang/` (2 pages réciproques).
- `perfect-site` : ajouter les pages/attributs nécessaires pour **rester à
  100/100** (sitemap multi-pages, alt partout, titres uniques, hreflang absent
  ⇒ skip).
- Tests unitaires : `test/sampler.test.ts` (sitemap, fallback liens,
  déterminisme, maxPages=1) + `test/checks/multi-page.test.ts`.
- e2e existant inchangé dans son contrat (`score === 100`).

## 6. Skills du plugin (`plugin/skills/`)

Trois skills à créer (structure standard `skills/<name>/SKILL.md`) :

1. **`audit-site`** — lancer `findable-audit <url> [--report]`, interpréter le
   rapport par famille, prioriser les fixes (fail > warn, points décroissants).
2. **`implement-geo`** — corriger les findings côté site : générer
   `llms.txt`/`llms-full.txt`, JSON-LD (entité + NAP), règles robots.txt pour
   les crawlers IA, sitemap + IndexNow.
3. **`fix-technical-seo`** — corriger les findings SEO techniques : canonical,
   meta robots, redirections, liens cassés, titres/descriptions, hreflang.

Chaque SKILL.md : frontmatter `name` + `description` (déclencheurs explicites),
corps court pointant vers la CLI et les conventions du repo.
`plugin.json` inchangé (les skills sont découvertes par convention de dossier).

## 7. Non-goals

- Pas de rendu JavaScript (crawl statique uniquement, comme aujourd'hui).
- Pas de parallélisation du fetch (le cache + 10 pages suffisent).
- Pas de refonte du scoring ni des checks existants.
- Pas de vérification des liens **externes** (coût/flakiness).

## 8. Self-review (faite avant soumission)

- ✔ `CrawlContext.sample` optionnel ⇒ zéro breaking change sur les tests
  unitaires qui instancient `Crawler` directement.
- ✔ Déterminisme de l'échantillon ⇒ scores reproductibles en CI.
- ✔ Bornes de coût partout (10 pages, 30 liens, 5 hreflang, 2 sous-sitemaps).
- ✔ Windows : toujours pas de `process.exit()` prématuré (contrainte libuv
  documentée dans `index.ts` respectée).
- ⚠ Point ouvert 1 : seuils d'agrégation (100 %/80 %) — valeurs par défaut
  proposées, ajustables par check.
- ⚠ Point ouvert 2 : `broken-internal-links` à 8 pts pèse lourd ; réduire à 6
  si trop punitif sur les gros sites.
