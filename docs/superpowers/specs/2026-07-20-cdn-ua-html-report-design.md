# Spec — infra-path exclusion, `--user-agent`, printable HTML report

Date : 2026-07-20
Statut : en revue (validation utilisateur requise avant plan)
Portée : `packages/cli`

## 1. Contexte et objectif

Après avoir audité 5 sites réels avec la version multi-pages, deux limites et
un besoin sont apparus :

1. **Faux positif `broken-internal-links`** : sur tout site derrière Cloudflare,
   le lien injecté `/cdn-cgi/l/email-protection` (et autres `/cdn-cgi/…`) est
   compté comme lien interne cassé. Ce ne sont pas des pages de contenu.
2. **Sites filtrant par User-Agent** (ex. `espace-client.edf.fr` → 503) : l'UA
   codé en dur `findable-audit/0.1` est bloqué ; impossible de tester ce que
   verrait un vrai crawler IA.
3. **Rapport partageable** : besoin d'un rapport d'audit en Markdown **et** PDF.
   Décision produit : le PDF passe par un **HTML autonome imprimable** (zéro
   dépendance runtime), le PDF étant obtenu via « Imprimer en PDF » du navigateur.

Aucune nouvelle dépendance npm. Style du rapport : **sobre professionnel** (fond
blanc, accents de couleur discrets sur les statuts, orienté impression).

## 2. Feature 1 — exclusion des chemins d'infrastructure

### 2.1 Nouveau module `src/crawl-filters.ts`

Regroupe les filtres de crawl partagés (aujourd'hui `NON_PAGE_EXT` vit dans
`sampler.ts`) :

```ts
/** Extensions that are never HTML pages worth crawling. */
export const NON_PAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|mp4|webm|css|js|json|xml|txt)$/i;

/** Infrastructure endpoints injected by CDNs/WAFs — never content pages. */
export const INFRA_PATH = /^\/cdn-cgi\//i;

/** true when a pathname is a crawlable content path (not an infra endpoint). */
export function isContentPath(pathname: string): boolean {
  return !INFRA_PATH.test(pathname);
}
```

`sampler.ts` importe `NON_PAGE_EXT` et `isContentPath` depuis ce module (au lieu
de définir `NON_PAGE_EXT` en local) et exclut aussi les chemins infra lors de la
sélection des candidats.

### 2.2 `links.ts`

`internalLinks` filtre les liens dont le pathname échoue `isContentPath` : ces
URLs ne sont plus fetchées ni comptées comme cassées.

### 2.3 Tests

- `test/checks/links.test.ts` : ajouter au fixture `links-fallback` un lien
  `<a href="/cdn-cgi/l/email-protection">` (cible inexistante → 404 si fetchée).
  `broken-internal-links` doit rester `pass` (le lien infra est ignoré, pas
  fetché).
- Le test sampler existant reste vert : `/cdn-cgi/…` est exclu des candidats,
  donc l'échantillon ne change pas (`['/', '/one.html', '/two.html']`).

## 3. Feature 2 — flag `--user-agent`

### 3.1 `Crawler` (`src/crawler.ts`)

Le constructeur accepte un 3e paramètre optionnel :

```ts
constructor(url: string, private timeoutMs = 10_000, private userAgent = DEFAULT_UA) { … }
```

où `DEFAULT_UA = 'findable-audit/0.1 (+https://github.com/piwig/findable-audit)'`
(la valeur actuelle, extraite en constante). Le header `user-agent` du `fetch`
utilise `this.userAgent`.

### 3.2 `runner.ts`

`AuditOptions` gagne `userAgent?: string`, passé au `Crawler` :
`new Crawler(url, opts.timeoutMs, opts.userAgent)`.

### 3.3 CLI (`src/index.ts`)

- Nouvelle option `'user-agent': { type: 'string' }`.
- Si fournie : `trim()` non vide, sinon erreur `exit 2` (avant `runAudit`, comme
  la validation `--timeout`/`--max-pages`).
- Passée via `runAudit(..., { timeoutMs, maxPages, userAgent })`.
- USAGE mis à jour.

Note : les checks robots (`ai-crawlers-allowed`, etc.) évaluent toujours contre
la liste `AI_BOTS` indépendamment de l'UA de fetch — inchangés. Le flag n'affecte
que les réponses HTTP réelles (contenu, statut), ce qui est le but (tester le
filtrage par UA).

### 3.4 Tests

- `test/crawler.test.ts` : un serveur http qui capture `req.headers['user-agent']`.
  - Défaut : l'UA reçu commence par `findable-audit`.
  - Override : `new Crawler(url, undefined, 'GPTBot/1.0')` → l'UA reçu vaut
    exactement `GPTBot/1.0`.

## 4. Feature 3 — rapport HTML imprimable + `--report` multi-formats

### 4.1 `src/report/html.ts`

```ts
export function renderHtml(report: AuditReport): string;
```

HTML **autonome** (un seul fichier, CSS inline, aucun `src`/`href` externe),
style sobre pro :

- En-tête : titre `findable-audit report`, l'URL auditée, la **date de
  génération** (`new Date().toISOString().slice(0, 10)`), un **badge de score**
  coloré (vert ≥ 80, ambre ≥ 60, rouge sinon).
- Liste des `sampledPages`.
- Une section par famille (mêmes libellés que le rapport terminal), chaque check
  en ligne : pastille de statut (vert/ambre/rouge/gris), `id`, `points/maxPoints`,
  `message`, et le `fix` en dessous pour les non-`pass`.
- Légende des statuts.
- `@media print` : fond blanc, `break-inside: avoid` sur chaque check, marges
  d'impression correctes.
- Échappement HTML de tout contenu dérivé du site audité (`message`, `fix`, URL,
  ids) via un helper `escapeHtml`.

Réutilise les libellés de familles ; pour éviter un doublon, `FAMILY_LABELS` est
exporté depuis `report/terminal.ts` et importé par `html.ts` (ou déplacé dans un
petit module partagé si plus propre — au choix de l'implémenteur, sans dupliquer
la table).

### 4.2 CLI (`src/index.ts`)

- `report` devient `{ type: 'string', short: 'r', multiple: true }` →
  `values.report` est `string[] | undefined`.
- Pour chaque chemin : le format est choisi par extension —
  `.html`/`.htm` → `renderHtml`, sinon → `renderMarkdown`.
- Écrit chaque fichier ; **tout** échec d'écriture → `exitCode = 2` (comportement
  existant conservé, jamais de `process.exit` après l'audit — contrainte
  Windows/libuv).
- USAGE : `--report <file.md|file.html>` (répétable).

Exemple :

```
findable audit https://site.fr --report audit.md --report audit.html
```

### 4.3 JSON — inchangé

`renderJson` reste identique (le champ `sampledPages` existe déjà).

### 4.4 Tests

- `test/report/html.test.ts` (avec un `AuditReport` factice) :
  - contient le score et `100/100`-style, chaque libellé de famille présent ;
  - **autonome** : contient `<style`, et aucune ressource externe
    (`/(src|href)=["']https?:/i` absent) ;
  - un `fix` d'un check en échec apparaît ;
  - `escapeHtml` : un `message` contenant `<script>` est échappé (`&lt;script&gt;`).
- `test/cli.test.ts` : `--report out.md --report out.html` écrit deux fichiers ;
  le `.html` commence par `<!doctype html` (ou `<html`), le `.md` par le titre
  Markdown. (Réutilise le pattern de test CLI existant.)

## 5. Docs

- `README.md` : documenter `--user-agent` et le `--report` multi-format
  (md + html/pdf) dans la section usage ; une phrase sur l'exclusion `/cdn-cgi/`.
- Le guide des checks (`docs/guide.md` / `docs/guide.fr.md`) : note sur le
  comportement `/cdn-cgi/` de `broken-internal-links` (une ligne).

## 6. Contraintes (rappel)

- Node ≥ 20, ESM (`.js` aux imports). Zéro nouvelle dépendance npm.
- Jamais de `process.exit()` après le lancement de l'audit (crash libuv Windows) ;
  la validation d'arguments avant `runAudit` peut utiliser `process.exit`.
- Le contrat e2e `perfect-site` = 100/100 doit tenir (features additives).
- Déterminisme : `renderHtml` inclut une date ; les tests assertent la présence
  d'éléments, pas la valeur exacte de la date.

## 7. Self-review

- ✔ Zéro dépendance ajoutée ; PDF via HTML imprimable (décision produit).
- ✔ `--report` multiple + dispatch par extension = rétro-compatible (un seul
  `--report x.md` marche toujours).
- ✔ Feature additive : aucun check existant modifié, e2e préservé.
- ✔ `INFRA_PATH` factorisé (pas de twin sampler/links).
- ✔ Échappement HTML du contenu tiers (sécurité : le rapport peut contenir du
  texte issu du site audité).
- ⚠ Point ouvert : faut-il exclure d'autres préfixes d'infra que `/cdn-cgi/`
  (ex. `/__` de certains frameworks) ? Décision : **non** pour l'instant
  (YAGNI), seul `/cdn-cgi/` est un faux positif observé.
