# Spec — « Meilleures features du backlog » : store JSONL, admin+stats, /compare web async, baseline diff, --entity-graph

Date : 2026-07-24 · Statut : validée par l'utilisateur (brainstorming du 2026-07-24)
Origine : backlog §11–13 de `docs/competitive-analysis-and-roadmap.md` (items §12.A admin, #36 compare web, §12.B monitoring/diff, §12.C entity-graph).

## Contexte et contraintes d'architecture

- `apps/web` : serveur `node:http` natif, **zéro dépendance npm**, lié à `127.0.0.1:3021` derrière nginx. Tout est en mémoire (job store TTL 180 s, cache résultat 60 s, rate-limit 20/min/IP). Aucune écriture disque aujourd'hui. i18n en/fr via `lib/i18n.mjs` + préfixes `/en` `/fr` (`lib/lang.mjs`).
- `packages/cli` : TypeScript strict NodeNext, build `tsc` → `dist/`, consommé par le web (`server.mjs` importe `../../packages/cli/dist/*`). Rendu HTML unique et partagé : `packages/cli/src/report/html.ts`. `--compare` CLI existant (`report/compare.ts` : `renderCompareTerminal/Html/Markdown`).
- Schéma de sortie : `AuditReport` (`runner.ts:21–34`) `{url, score, grade, familyScores, sampledPages, results, psi?}` ; `CheckResult` (`types.ts:15–25`) ; 8 familles, poids somme 1.00 (`scoring.ts`).
- Toolkit JSON-LD réutilisable : `checks/jsonld.ts` (`extractJsonLd`, `flatten`, `typesOf`, `byId`, `isRef`, `resolveValue`).
- Tests : vitest côté CLI (`packages/cli/test/**/*.test.ts`), `node --test` côté web (`apps/web/test/*.test.mjs`). `apps/web` n'est PAS un workspace npm racine.
- Historique : le `/compare` web synchrone a été reverté (`31966ea`) car N audits in-request dépassaient le timeout du proxy en production. La reprise DOIT passer par le pattern jobs async existant.

Décisions utilisateur (2026-07-24) :
1. Persistance **JSONL zéro-dépendance** (pas de SQLite, pas de « logs nginx seulement »).
2. Admin = **serveur local séparé** `admin.local.mjs` (127.0.0.1, tunnel SSH, zéro auth) — pas de route publique à token.

## 0. Fondation — store JSONL (`apps/web/lib/store.mjs`)

Nouveau module sans dépendance, API :

- `createStore({dataDir})` → `{append(event), readEvents({since?, kind?}), historyForDomain(domain, limit?), close()}`.
- `DATA_DIR` : env, défaut `apps/web/data/` (créé au premier append, `fs.mkdir recursive`).
- Fichier actif `events.jsonl`, une ligne JSON par audit **terminé avec succès** :
  `{ts (ISO), kind: 'audit'|'compare', domain (hostname), url, lang, score, grade, familyScores: [{family, score}], ipHash, durationMs, cwv: boolean}`.
- `ipHash` : `sha256(salt + ip)` tronqué à 16 hex. Sel : env `STATS_SALT`, sinon généré une fois (`crypto.randomBytes`) et persisté dans `DATA_DIR/salt` (mode 600). Jamais d'IP en clair sur disque.
- Écriture : `fs.appendFile` fire-and-forget depuis la fin de `executeAudit` (`server.mjs`) et depuis l'exécution compare ; toute erreur est loguée (`console.error`) et **n'affecte jamais** la réponse à l'utilisateur.
- Rotation par taille : si `events.jsonl` > `STORE_MAX_BYTES` (défaut 32 Mo), renommage en `events-YYYYMM.jsonl` (suffixe `-2`, `-3`… si collision) et nouveau fichier actif. Lecture agrégée = archives + actif.
- Lecture : parse ligne à ligne en streaming (`readline`), lignes corrompues ignorées silencieusement (comptées, exposées à l'admin comme « lignes ignorées »).
- Événements compare : chaque sous-audit d'un job compare est journalisé avec `kind:'compare'`. Les KPIs admin « audits » ne comptent que `kind:'audit'` ; le compare est compté à part.

## 1. Admin + statistiques (`apps/web/admin.local.mjs`)

- Serveur `node:http` **séparé**, lié `127.0.0.1`, port `ADMIN_PORT` (défaut 3022). Jamais proxifié par nginx. Accès : tunnel SSH (`ssh -L 3022:127.0.0.1:3022 vps`). Zéro code d'auth — la surface publique est nulle par construction.
- Lecture seule sur le store (aucune écriture). Démarre et rend des pages vides proprement si `DATA_DIR` absent.
- Pages (HTML inline, CSS inline, zéro JS, même famille visuelle que le rapport ; FR uniquement — outil privé) :
  - `GET /` : KPIs — audits total / 7 j / 30 j, nb de comparaisons, domaines uniques, visiteurs uniques (ipHash distincts), score moyen et médian ; distribution des notes A–F (barres CSS) ; top 20 domaines (nb d'audits, dernier score/grade, date) ; 50 derniers audits (date, domaine, score, grade, lang, durée) ; compteur de lignes corrompues ignorées.
  - `GET /domain/<host>` : historique complet du domaine — table datée (score, grade, Δ vs audit précédent, durée, cwv) + sparkline SVG inline des scores.
  - Tout autre chemin → 404 texte.
- `GET /healthz` → `ok` (pour un éventuel monitoring local).
- Docs README web : lancement (`node apps/web/admin.local.mjs`), exemple d'unité systemd `findable-admin.service` (avec `Environment=DATA_DIR=…`), commande tunnel SSH.

## 2. `/compare` web async (reprise de `ab1caf6` sur le pattern jobs)

- Formulaire landing restauré : ton URL + jusqu'à 2 URLs concurrentes (copies i18n en/fr reprises/adaptées de `ab1caf6` dans `lib/i18n.mjs`).
- Flux :
  1. `GET /<lang>/compare/start?url=…&c1=…&c2=…` : rate-limit (1 jeton `take(ip)` **par URL** soumise), `assertPublicUrl` sur chaque URL (main invalide → erreur ; concurrent invalide → ignoré), création d'un job `kind:'compare'` dans le job store existant (`lib/jobs.mjs` étendu : champ `kind`, `urls[]`, `progress` par site), redirection vers la page de progression.
  2. Exécution lazy au premier hit de `/compare/stream` (SSE) ou `/compare/result` — même mécanique `ensureStarted` que `/audit`. Audits **séquentiels**, `{cwv:false}` (clé de cache `#nocwv` existante), timeout unitaire `AUDIT_TIMEOUT_MS`, budget global = 3× timeout unitaire. Le job occupe **1 slot** `MAX_CONCURRENT`.
  3. Résultat : `renderCompareHtml` (import depuis `packages/cli/dist/report/compare.js`) dans le shell web + lien export (`Content-Disposition`, comme `/audit/export`).
- Cas dégradés : concurrent injoignable → ignoré + avertissement localisé dans la page résultat ; < 2 sites joignables → page « pas assez de sites » localisée ; job expiré (TTL) → page « expiré » existante.
- Journalisation store : un événement `kind:'compare'` par sous-audit réussi.
- Sécurité : identique à `/audit` (SSRF, rate-limit, concurrence, CSP). GET/HEAD uniquement, cohérent avec le serveur actuel.

## 3. Monitoring v1 — historique + diff baseline

- **Web (privé)** : l'historique par domaine vit UNIQUEMENT dans l'admin (§1). Pas de page publique d'historique (ne pas exposer qui audite quoi).
- **CLI** :
  - `--baseline <fichier audit.json>` : charge un `AuditReport` antérieur. Sortie :
    - terminal : Δ score global, Δ par famille, listes « régressions » (pass→warn/fail, warn→fail), « améliorations » (fail/warn→pass), « nouveaux checks », « checks disparus » ;
    - rapports md/html : nouvelle section « Δ vs baseline » (mêmes données), rendue seulement si `--baseline` est fourni.
  - `--fail-on-regression` (booléen) : exit code 1 si `score < baseline.score − tolérance`. Tolérance via `--regression-tolerance <n>` (entier ≥ 0, défaut 0) — deux flags séparés car `parseArgs` ne gère pas les valeurs optionnelles. L'un ou l'autre sans `--baseline` → erreur d'usage (exit 2). L'alerte de monitoring en v1, c'est ce code de sortie en CI.
  - Fichier baseline illisible / JSON invalide / pas un AuditReport → message clair, exit 2.
  - Module dédié `packages/cli/src/report/diff.ts` : `diffReports(current, baseline)` → structure typée `ReportDiff` ; rendus terminal/md/html séparés. Le diff **tolère les champs absents** (anciens audit.json sans `generatedAt`).
- **Schéma (additif)** : `AuditReport` gagne `generatedAt: string` (ISO) et `toolVersion: string` (version du package). Aucun champ existant ne change ; les renderers ignorent ces champs s'ils manquent.
- Docs README CLI : exemple de workflow CI GitHub Actions — audit → `--baseline baseline.json --fail-on-regression 2` → mise à jour de la baseline commitée.

## 4. `--entity-graph <fichier>`

- Flag CLI, une valeur, format choisi par extension : `.json`, `.dot` (Graphviz), `.mmd` (Mermaid `graph LR`). Autre extension → erreur d'usage (exit 2).
- Construction (`packages/cli/src/report/entity-graph.ts`) sur **toutes les pages échantillonnées** : passe dédiée dans `runner.ts` juste après le sampling (le HTML de chaque page est déjà fetché) ; le graphe résultant est mis à disposition des checks via le contexte, et exporté si le flag est fourni :
  - nœuds = entités JSON-LD aplaties (`flatten`) ; clé = `@id` si présent, sinon clé synthétique `<type>#<n>@<path>` ; fusion inter-pages par `@id` (union des types, pages d'apparition, premier `name` non vide) ;
  - arêtes `{from, to, property}` = toute propriété dont la valeur est une référence `{"@id":…}` (`isRef`) ou une entité imbriquée (arête vers le nœud enfant).
- Sorties : JSON `{nodes:[{id, types, name?, pages[]}], edges:[{from, to, property}], stats:{nodes, edges, danglingRefs, components}}` ; DOT digraph étiqueté ; Mermaid.
- Nouveau check `entity-graph-connectivity` (famille `structured-data`, `maxPoints: 4`) — actif même sans le flag (le graphe est construit à partir des pages échantillonnées de toute façon) :
  - **fail** : ≥1 référence pendante (`@id` référencé mais jamais défini dans l'échantillon) ;
  - **warn** : zéro entité, ou ≥2 composantes connexes alors qu'il existe ≥2 nœuds « racine » nommés (Organization/WebSite/Person) ;
  - **pass** : graphe non vide et connexe (composante unique), aucune ref pendante.
  - Messages FR/EN via `report/check-i18n.ts` + entrée catalogue (« pourquoi ça compte ») + `docUrl`. Le scoring s'adapte seul (sommes de `maxPoints`).

## Gestion d'erreurs (transverse)

- Store : append best-effort, jamais bloquant ; lecture tolérante (lignes corrompues ignorées + comptées).
- Admin : à données vides ou `DATA_DIR` manquant → pages « aucune donnée » propres, pas de crash.
- Compare : voir §2 (dégradés localisés). Baseline : voir §3 (exit 2 propre). Entity-graph : site sans JSON-LD → graphe vide, export valide avec `stats.nodes=0`, check → warn.
- Aucune nouvelle dépendance npm, ni côté web ni côté CLI (les 3 deps CLI existantes suffisent).

## Tests

- CLI (vitest) : `diffReports` (deltas, bascules, tolérance anciens schémas), parsing/validation des nouveaux flags (`--baseline`, `--fail-on-regression`, `--entity-graph` extensions), builder entity-graph sur fixtures HTML (fusion `@id` inter-pages, refs pendantes, composantes), check connectivité (pass/warn/fail), rendus DOT/Mermaid/JSON stables.
- Web (`node:test`) : store (append/read, rotation, sel + hash stable, lignes corrompues), handlers compare (rate-limit multi-jetons, SSRF, <2 sites, séquencement, journalisation), admin (KPIs exacts sur fixture `events.jsonl`, page domaine, 404, données vides).
- Non-régression : `npm test --workspaces` + `node --test apps/web/test/` verts ; `npm run build` (tsc) propre.

## Docs & finitions

- `apps/web/README.md` : DATA_DIR/STATS_SALT/ADMIN_PORT, admin + systemd + tunnel, compare async, correction du drift documenté (limites réelles : 10 concurrents, 20/min).
- `packages/cli/README.md` (ou aide `--help`) : `--baseline`, `--fail-on-regression`, `--entity-graph`, exemple CI.
- `docs/competitive-analysis-and-roadmap.md` : items §12.A, #36 web, §12.B (v1), §12.C entity-graph annotés FAIT avec date.

## Ordre d'implémentation

1. Store JSONL (fondation, bloque §1 et la journalisation de §2).
2. En parallèle ensuite : admin (§1), compare web (§2), baseline diff (§3), entity-graph (§4) — pistes indépendantes.
3. Docs + annotation du backlog en dernier.

Hors périmètre v1 (YAGNI, explicitement) : scheduler/alertes e-mail, page publique d'historique, SQLite, auth web, export PDF.
