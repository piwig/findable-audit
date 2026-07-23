# Backlog Best Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter les 4 features validées de la spec `docs/superpowers/specs/2026-07-24-backlog-best-features-design.md` (store JSONL, admin local, /compare web async, baseline diff, --entity-graph) puis appliquer les bonnes pratiques SEO/GEO à findable lui-même et au repo.

**Architecture:** Deux flux parallèles sans chevauchement de fichiers — flux WEB (`apps/web`, tasks 1–6) et flux CLI (`packages/cli`, tasks 7–11) — puis une phase d'intégration (task 12 SEO/GEO self-apply, task 13 docs+push) sur main.

**Tech Stack:** Node natif (`node:http`, `node:test`) côté web — zéro dépendance npm ; TypeScript strict NodeNext + vitest côté CLI (deps existantes uniquement : fast-xml-parser, node-html-parser, picocolors).

## Global Constraints

- AUCUNE nouvelle dépendance npm, ni web ni CLI.
- `apps/web` reste 100 % `.mjs` sans build ; `packages/cli` build `tsc` → `dist/` consommé par le web.
- Tests web : `node --test apps/web/test/` ; tests CLI : `cd packages/cli && npx vitest run`. Les suites existantes DOIVENT rester vertes.
- Jamais de `process.exit()` dans le chemin de sortie CLI (crash libuv Windows) — uniquement `process.exitCode`.
- Jamais d'IP en clair sur disque : uniquement `sha256(salt+ip)` tronqué 16 hex.
- i18n web : toute nouvelle string dans `WEB_MESSAGES` en **en ET fr** (`apps/web/lib/i18n.mjs`).
- Checks CLI : messages EN dans le code, FR via `report/check-i18n.ts`.
- Un commit par étape verte (message conventionnel `feat:`/`fix:`/`docs:`/`test:`).
- Lire la spec avant de commencer : `docs/superpowers/specs/2026-07-24-backlog-best-features-design.md`.

---

## FLUX WEB (tasks 1–6, séquentielles)

### Task 1: Store JSONL — `apps/web/lib/store.mjs`

**Files:**
- Create: `apps/web/lib/store.mjs`
- Test: `apps/web/test/store.test.mjs`

**Interfaces (Produces):**
```js
createStore({ dataDir, maxBytes = 32*1024*1024 })
// -> { append(event): Promise<void> /* ne rejette JAMAIS */,
//      readEvents(): Promise<{ events: object[], ignored: number }>,
//      dataDir }
loadOrCreateSalt(dataDir): Promise<string>  // env STATS_SALT prioritaire; sinon DATA_DIR/salt (créé, hex 32)
ipHasher(salt): (ip: string) => string      // sha256(salt+ip) hex.slice(0,16)
eventFromReport(report, { kind, lang, ipHash, durationMs, cwv, now = new Date() })
// -> { ts: now.toISOString(), kind, domain: new URL(report.url).hostname, url: report.url,
//      lang, score: report.score, grade: report.grade,
//      familyScores: report.familyScores.map(f => ({ family: f.family, score: f.score })),
//      ipHash, durationMs, cwv: Boolean(cwv) }
```

- [ ] **Step 1: Écrire les tests** (`apps/web/test/store.test.mjs`, `node:test` + `assert/strict`, tmp dir via `fs.mkdtemp(os.tmpdir())`, cleanup `test.after`) :
  - append crée `DATA_DIR` + `events.jsonl`, une ligne JSON parsable par event.
  - `readEvents()` relit N events dans l'ordre ; une ligne corrompue insérée à la main → `ignored: 1`, les autres lues.
  - rotation : `createStore({ dataDir, maxBytes: 200 })`, appends jusqu'à dépassement → un fichier `events-YYYYMM.jsonl` apparaît, `events.jsonl` recommence, `readEvents()` agrège archives+actif.
  - `append` sur un dataDir en lecture seule (ou chemin invalide, ex. fichier à la place du dossier) ne rejette pas (`await` sans throw).
  - `ipHasher('s')('1.2.3.4')` : 16 hex, stable, ≠ pour IP ≠, ≠ selon sel.
  - `loadOrCreateSalt` : crée le fichier, relit la même valeur ; `STATS_SALT=abc` (set/unset dans le test) → retourne `abc` sans fichier.
  - `eventFromReport` : mappe exactement les champs listés ci-dessus (fixture report minimal `{url:'https://ex.com/', score: 72, grade:'C', familyScores:[{family:'ai-access', score: 80, weight:.2, earned:8, max:10}]}`).
- [ ] **Step 2:** `node --test apps/web/test/store.test.mjs` → FAIL (module absent).
- [ ] **Step 3: Implémenter `store.mjs`.** Points d'implémentation : `fs/promises` ; append = `mkdir(recursive)` lazy + `stat` (taille) → si `size + line.length > maxBytes` → `rename` vers `events-<YYYYMM>.jsonl` (si existe, suffixe `-2`, `-3`, …) → `appendFile(active, JSON.stringify(event)+'\n')` ; tout le corps de `append` dans try/catch → `console.error('[store]', err.message)` et resolve. `readEvents` = liste `events*.jsonl` triés (archives d'abord, actif en dernier), lecture `readFile` + split `\n`, `JSON.parse` par ligne, catch → `ignored++`. Sérialiser les appends concurrents via une chaîne de promesses interne (`queue = queue.then(doAppend)`) pour éviter l'entrelacement.
- [ ] **Step 4:** `node --test apps/web/test/store.test.mjs` → PASS.
- [ ] **Step 5:** `git add apps/web/lib/store.mjs apps/web/test/store.test.mjs && git commit -m "feat(web): JSONL event store (append-only, rotation, hashed IPs)"`

### Task 2: Journalisation dans `server.mjs`

**Files:**
- Modify: `apps/web/server.mjs` (anchors : `executeAudit` ~l.364, handler sync `/audit.json` ~l.634–667, `handleAuditStart` ~l.572, constantes env ~l.36–46)
- Modify: `apps/web/lib/jobs.mjs` (`create()` l.23–38)
- Test: existants verts + `apps/web/test/store-wiring.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`createStore`, `loadOrCreateSalt`, `ipHasher`, `eventFromReport`).
- Produces: `jobs.create({ url, lang, kind = 'audit', urls = null, ipHash = null })` — champs additionnels stockés sur le job (contrat existant inchangé par ailleurs). `server.mjs` exporte en plus `store` (pour les tests).

- [ ] **Step 1:** Test `store-wiring.test.mjs` : lancer le serveur avec `DATA_DIR` = tmp (env posée avant import, PORT distinct ex. 31104), `fetch(base + '/en/audit?url=…')` vers une cible locale injoignable N'écrit rien ; puis simuler un audit réussi : le plus simple hermétique = exporter `store` et `recordAuditEvent(report, {kind, lang, ipHash, durationMs})` depuis `server.mjs` et tester que `recordAuditEvent` → 1 ligne dans le tmp DATA_DIR. Vérifier aussi que le module se charge sans `DATA_DIR` (défaut `apps/web/data/` NON créé tant qu'aucun append).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implémenter : en tête de `server.mjs`, init lazy `const store = createStore({ dataDir: process.env.DATA_DIR ?? new URL('./data/', import.meta.url).pathname })` + salt/hasher (`await loadOrCreateSalt(store.dataDir)` au premier usage, mémoïsé). `handleAuditStart` : calculer `ipHash = hashIp(clientIp(req))` et le passer à `jobs.create`. Dans `executeAudit` : chronométrer `runAudit`, et après `jobs.finish(...)` → `store.append(eventFromReport(report, { kind:'audit', lang: job.lang, ipHash: job.ipHash, durationMs, cwv: Boolean(report.psi) }))` (fire-and-forget, pas de `await` bloquant le flux). Même chose dans le chemin sync `/audit.json` (~l.667) avec `ipHash = hashIp(clientIp(req))`. `jobs.mjs` : `create` accepte/stocke `kind`, `urls`, `ipHash`.
- [ ] **Step 4:** `node --test apps/web/test/` → tout PASS (aucune régression).
- [ ] **Step 5:** `git commit -am "feat(web): journalize completed audits to the JSONL store"`

### Task 3: Agrégats — `apps/web/lib/stats.mjs`

**Files:**
- Create: `apps/web/lib/stats.mjs`
- Test: `apps/web/test/stats.test.mjs`

**Interfaces (Produces):**
```js
computeStats(events, now = new Date())
// -> { totalAudits, audits7d, audits30d, compares, uniqueDomains, uniqueVisitors,
//      avgScore, medianScore,            // sur kind:'audit' uniquement ; null si 0 audit
//      gradeDist: { A, B, C, D, F },     // comptes, kind:'audit'
//      topDomains: [{ domain, count, lastScore, lastGrade, lastTs }],  // max 20, tri count desc puis lastTs desc
//      recent: [...events kind:'audit' les 50 plus récents, tri ts desc] }
domainHistory(events, domain)
// -> [{ ts, score, grade, delta /* score - précédent, null pour le 1er */, durationMs, cwv, lang }] tri ts ASC, kinds confondus
```

- [ ] **Step 1: Tests** sur fixtures en mémoire (events synthétiques datés relatifs à un `now` fixe) : fenêtres 7j/30j (bornes : `ts >= now-7j`), médiane paire/impaire, gradeDist, top20 (21 domaines → 20), recent (60 audits → 50, plus récent en premier), compares comptés à part et EXCLUS de avgScore/gradeDist/recent, `domainHistory` deltas (`[70, 75, 73]` → `[null, +5, -2]`), events vides → zéros/null propres.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implémenter (pur, sans I/O). **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat(web): pure stats aggregation for the admin dashboard"`

### Task 4: Admin local — `apps/web/admin.local.mjs`

**Files:**
- Create: `apps/web/admin.local.mjs`
- Test: `apps/web/test/admin.test.mjs`

**Interfaces:**
- Consumes: Tasks 1+3 (`createStore().readEvents`, `computeStats`, `domainHistory`).
- Produces: serveur HTTP `127.0.0.1:${ADMIN_PORT ?? 3022}` ; exporte `server` (pattern de `server.mjs` pour les tests). Routes : `GET /` (dashboard FR), `GET /domain/<host>`, `GET /healthz` → `ok`, reste → 404 texte.

- [ ] **Step 1: Tests** : env `DATA_DIR`=tmp avec fixture `events.jsonl` écrite à la main (8 events, 2 domaines, 1 compare, 1 ligne corrompue), `ADMIN_PORT=31105` ; assert : `/healthz` → 200 `ok` ; `/` → 200, contient le nombre total d'audits, `lang="fr"`, les 2 domaines, la mention de la ligne ignorée ; `/domain/exemple.com` → 200, contient les scores et un `<svg` (sparkline) ; `/domain/inconnu.tld` → 200 « aucun audit » ; `/nimporte` → 404. Aussi : DATA_DIR inexistant → `/` 200 « aucune donnée ».
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter : lecture `readEvents()` par requête ; pages HTML inline (CSS inline sobre — reprendre la palette du rapport : fond clair, accent vert `#1a7f37`-ish, tables `border-collapse`), zéro JS ; sparkline = `<svg>` polyline points normalisés min/max ; échapper le HTML (`escapeHtml` locale) pour domain/url. GET/HEAD only (405 sinon). AUCUNE écriture store.
- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat(web): local-only admin dashboard (stats + domain history)"`

### Task 5: Jobs compare — extension `lib/jobs.mjs`

**Files:**
- Modify: `apps/web/lib/jobs.mjs`
- Test: `apps/web/test/jobs.test.mjs` (existant ? sinon créer) — ajouter les cas.

**Interfaces (Produces):** `create({ url, lang, kind:'compare', urls: [main, c1, c2], ipHash })` ; le job garde `reports: []` (rempli par le serveur) ; `finish(id, { report, html, reports })` accepte et stocke `reports` optionnel. Contrat existant intact (audit simple inchangé).

- [ ] **Step 1:** Tests : create compare → job porte `kind`, `urls`, `reports: []` ; `finish` avec `reports` les stocke ; un job audit classique a `kind:'audit'` par défaut. **Step 2:** FAIL. **Step 3:** Implémenter (additif minimal). **Step 4:** PASS + suite web verte.
- [ ] **Step 5:** `git commit -m "feat(web): job store supports compare jobs"`

### Task 6: Routes /compare async + formulaire + i18n

**Files:**
- Modify: `apps/web/server.mjs` (dispatch ~l.699–831 ; s'inspirer de `handleAuditStart`/`handleStream`/`handleExport`), `apps/web/lib/i18n.mjs`
- Test: `apps/web/test/compare.test.mjs`

**Interfaces:**
- Consumes: Task 5 (jobs kind compare), Task 2 (`store`, `hashIp`), existants : `auditUrl(url, {cwv:false})` (~l.302, clé cache `#nocwv`), `assertPublicUrl`, rate-limiter (`take`), `renderCompareHtml` importé de `../../packages/cli/dist/report/compare.js` (signature `(reports: AuditReport[], now?, lang?)`).
- Produces: routes `GET /<lang>/compare/start?url=&compare=`, `/<lang>/compare?job=`, `/compare/stream?job=`, `/compare/result?job=`, `/compare/export?job=` ; formulaire landing `action="/<lang>/compare/start"`, champs `url` + `compare` (concurrents séparés par virgules, max 2 retenus).

- [ ] **Step 1: Récupérer la base revertée** : `git show ab1caf6 -- apps/web/lib/i18n.mjs` et `git show ab1caf6 -- apps/web/server.mjs` — RÉUTILISER les strings i18n (`compare.{needMoreTitle,needMore,heading,lead,urlLabel,competitorsLabel,cta,hint}`) et le HTML du formulaire landing, en changeant l'action vers `/compare/start`. Ajouter les clés nouvelles : `compare.progressTitle`, `compare.progressSite` (« Audit du site {i}/{n}… »), `compare.resultTitle`, `compare.skipped` (« {url} injoignable — ignoré »), en en+fr.
- [ ] **Step 2: Tests** (reprendre `git show ab1caf6 -- apps/web/test/compare.test.mjs` et adapter, PORT 31106) : formulaire présent en/fr avec `action="/en/compare/start"` ; `/fr/compare/start` sans url → 400 localisé ; `/fr/compare/start?url=<invalide>` → 400 ; clés i18n présentes/traduites (l'ancienne assertion + les nouvelles clés) ; `/en/compare?job=inexistant` → page expirée/404 localisée. (Le flux multi-audits réseau reste hors tests hermétiques, comme avant.)
- [ ] **Step 3:** FAIL. **Step 4: Implémenter** : `handleCompareStart` : rate-limit `take(ip)` PAR URL soumise (1+N), parse `compare` → split virgule → max 2, `assertPublicUrl` sur main (échec → 400) et chaque concurrent (échec → ignoré, mémorisé dans `job.skipped`), `jobs.create({kind:'compare', urls, ipHash, lang})`, 302 → `/<lang>/compare?job=<id>`. Page progression = variante de la page audit (SSE `/compare/stream`). `executeCompare(job)` : séquentiel, pour chaque URL `auditUrl(u, {cwv:false})` sous `withTimeout(AUDIT_TIMEOUT_MS)` en try/catch (échec → `job.skipped.push(u)`), `jobs.setProgress` `{site:i, total, phase}` relayé en SSE ; < 2 reports OK → `jobs.fail(id,'needMore', …)` → page localisée `needMoreTitle/needMore` ; sinon `jobs.finish(id, { reports, html: shellWrap(renderCompareHtml(reports, new Date(), job.lang)) + avertissements skipped })` + un event store `kind:'compare'` PAR report réussi. Budget global : `withTimeout(3 * AUDIT_TIMEOUT_MS)` autour du tout. Le job occupe 1 slot `running` (même mécanique `ensureStarted`). `/compare/export` : comme `handleExport` (attachment HTML).
- [ ] **Step 5:** `node --test apps/web/test/` → PASS. **Step 6:** `git commit -am "feat(web): async competitive comparison — /compare via the job pattern (#36 web, redo of 31966ea)"`

---

## FLUX CLI (tasks 7–11, séquentielles)

### Task 7: Diff — `packages/cli/src/report/diff.ts`

**Files:**
- Create: `packages/cli/src/report/diff.ts`
- Test: `packages/cli/test/diff.test.ts`

**Interfaces (Produces):**
```ts
export interface CheckTransition { id: string; family: Family; from: CheckStatus | 'absent'; to: CheckStatus | 'absent'; message: string }
export interface FamilyDelta { family: Family; baseline: number | null; current: number | null; delta: number | null }
export interface ReportDiff {
  baselineScore: number; currentScore: number; scoreDelta: number;
  familyDeltas: FamilyDelta[];
  regressions: CheckTransition[];   // sévérité to > from (pass=0, warn=1, fail=2)
  improvements: CheckTransition[];  // sévérité to < from
  added: string[]; removed: string[];  // ids présents d'un seul côté (status 'skip' = absent)
  baselineGeneratedAt?: string;
}
export function diffReports(current: AuditReport, baseline: AuditReport): ReportDiff
export function renderDiffTerminal(d: ReportDiff, lang?: Lang): string
export function renderDiffMarkdown(d: ReportDiff, lang?: Lang): string
export function renderDiffHtmlSection(d: ReportDiff, lang?: Lang): string  // <section>…</section> autonome, styles inline compatibles html.ts
```
Règles : jointure par `id` ; un check `skip` compte comme absent (ni régression ni amélioration) ; `message` = message CÔTÉ CURRENT (ou baseline si disparu) ; familles jointes par nom, `null` si absente d'un côté ; tolérant aux baselines anciennes (pas de `generatedAt`, familles manquantes).

- [ ] **Step 1: Tests vitest** : fixtures de deux `AuditReport` minimaux → scoreDelta signé ; pass→fail dans regressions, fail→pass dans improvements, warn→fail régression ; skip→pass = added seulement ; check retiré → removed ; famille nouvelle → `baseline: null` ; rendus : terminal contient `Δ` et le delta signé (`+`/`-`), markdown contient un tableau `| Famille |`, htmlSection est un `<section>` sans `<html>`. FR et EN produisent des libellés différents.
- [ ] **Step 2:** `npx vitest run test/diff.test.ts` → FAIL. **Step 3:** Implémenter (pur). Libellés localisés inline dans le module (petit dictionnaire local en/fr, pattern des autres renderers — voir `report/compare.ts` pour le style). **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat(cli): report diff engine + terminal/md/html renderers"`

### Task 8: Flags baseline + schéma additif

**Files:**
- Modify: `packages/cli/src/index.ts` (parseCliArgs l.40–60, USAGE l.15, sortie l.156–196), `packages/cli/src/runner.ts` (interface l.21–34 + return l.112), `packages/cli/src/report/markdown.ts`, `packages/cli/src/report/html.ts` (signature opts existante `{collapsed?}` → + `diff?`)
- Test: `packages/cli/test/baseline.test.ts` (+ tests existants verts)

**Interfaces:**
- Consumes: Task 7 (`diffReports`, renderers).
- Produces: `AuditReport.generatedAt?: string` (ISO, posé par le runner), `AuditReport.toolVersion?: string` (posé par index.ts depuis package.json) ; flags `--baseline <file>`, `--fail-on-regression` (boolean), `--regression-tolerance <n>` (défaut '0') ; `renderMarkdown(report, now, lang, { diff? })`, `renderHtml(report, now, lang, { collapsed?, diff? })`.

- [ ] **Step 1: Tests** : `runAudit` (sur fixture locale existante des tests runner, ou mock Crawler minimal) → `generatedAt` ISO parsable. `diffReports` tolère un baseline sans `generatedAt`. Rendus md/html avec `{diff}` contiennent la section « vs baseline » ; sans `diff` → inchangés (snapshot court).
- [ ] **Step 2:** FAIL. **Step 3: Implémenter** : runner ajoute `generatedAt: new Date().toISOString()` ; index.ts pose `report.toolVersion = createRequire(import.meta.url)('../package.json').version` (mécanique déjà utilisée pour `--version` l.73) ; index.ts : nouvelles options parseArgs, validations (fichier lisible + `JSON.parse` + garde-fou `typeof j.score === 'number' && Array.isArray(j.results)` sinon message clair exit 2 ; `--fail-on-regression`/`--regression-tolerance` sans `--baseline` → exit 2 ; tolérance entier ≥ 0) ; après l'audit : `const diff = baseline ? diffReports(report, baseline) : undefined` ; terminal : imprimer `renderDiffTerminal` après le rapport ; md/html : passer `{diff}` ; exit : `process.exitCode = reportWriteFailed ? 2 : (diff && values['fail-on-regression'] && report.score < baseline.score - tol) ? 1 : report.score >= minScore ? 0 : 1`. USAGE mis à jour.
- [ ] **Step 4:** `npx vitest run` → PASS. **Step 5:** `git commit -am "feat(cli): --baseline diff + --fail-on-regression CI gate"`

### Task 9: Entity graph — `packages/cli/src/report/entity-graph.ts`

**Files:**
- Create: `packages/cli/src/report/entity-graph.ts`
- Test: `packages/cli/test/entity-graph.test.ts`

**Interfaces (Produces):**
```ts
export interface EntityNode { id: string; types: string[]; name?: string; pages: string[]; synthetic: boolean }
export interface EntityEdge { from: string; to: string; property: string }
export interface EntityGraph { nodes: EntityNode[]; edges: EntityEdge[];
  stats: { nodes: number; edges: number; danglingRefs: number; components: number } }
export function buildEntityGraph(pages: { path: string; html: string }[]): EntityGraph
export function renderEntityGraphJson(g: EntityGraph): string      // JSON.stringify 2-space
export function renderEntityGraphDot(g: EntityGraph): string       // digraph, labels "name\n(types)", arêtes label=property, dangling en style=dashed
export function renderEntityGraphMermaid(g: EntityGraph): string   // graph LR, ids sanitisés n0..nN, labels échappés
```
Construction : par page, `extractJsonLd` + `flatten` (`checks/jsonld.ts`) ; id = `@id` sinon synthétique `<TypePrimaire>#<n>@<path>` ; récursion sur les propriétés (hors clés `@…`) : valeur `isRef` → arête vers l'`@id` cible ; objet imbriqué avec `@type`/`@id` → nœud enfant + arête (récursif, tableaux inclus) ; fusion inter-pages par id (union types+pages, premier `name`) ; réfs pendantes = nœud `{types: [], synthetic: true}` compté dans `danglingRefs` ; `components` = composantes connexes NON-dirigées sur les nœuds non pendants.

- [ ] **Step 1: Tests** : fixture 2 pages HTML avec JSON-LD — page A : `Organization {@id:"#org", name}` + `WebSite {@id:"#site", publisher:{"@id":"#org"}}` ; page B : `WebSite {@id:"#site"}` (fusion) + `Article {author: {objet Person imbriqué sans @id}}` + une ref pendante `{"@id":"#ghost"}`. Asserts : fusion `#site` (pages: [a,b]) ; nœud synthétique Person + arête `author` ; danglingRefs=1 ; components=2 ; DOT contient `digraph` + `dashed` ; Mermaid contient `graph LR` sans caractères non échappés ; JSON round-trip. Page sans JSON-LD → graphe vide stats zéro.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS. **Step 5:** `git commit -m "feat(cli): JSON-LD entity graph builder + JSON/DOT/Mermaid exports"`

### Task 10: Check `entity-graph-connectivity` + passe runner

**Files:**
- Create: `packages/cli/src/checks/entity-graph.ts`
- Modify: `packages/cli/src/checks/index.ts` (buildChecks l.44–68 : enregistrer le check), `packages/cli/src/types.ts` (CrawlContext : `entityGraph?: EntityGraph`), `packages/cli/src/runner.ts` (après le sampling l.82–83 : `crawler.entityGraph = buildEntityGraph(...)` ; `AuditReport.entityGraph?: EntityGraph` posé seulement si `opts.includeEntityGraph`), `packages/cli/src/report/check-i18n.ts` (entrée FR du nouveau check, suivre le pattern des entrées existantes)
- Test: `packages/cli/test/entity-graph-check.test.ts`

**Interfaces:**
- Consumes: Task 9 (`buildEntityGraph`, `EntityGraph`).
- Produces: check `{ id: 'entity-graph-connectivity', family: 'structured-data', maxPoints: 4 }` ; `AuditOptions.includeEntityGraph?: boolean`.

Logique du check : `const g = ctx.entityGraph ?? (ctx.sample ? buildEntityGraph(ctx.sample.pages.map(p => ({ path: new URL(p.finalUrl).pathname, html: p.body }))) : null)` ; `null` → skip (« no sampled pages ») ; `danglingRefs > 0` → fail (lister jusqu'à 3 ids pendants) ; `nodes === 0` → warn (« no JSON-LD entities found across sampled pages ») ; `components >= 2` ET ≥ 2 nœuds nommés de types racine (Organization/WebSite/Person/LocalBusiness) → warn (« entity graph is split into N disconnected components ») ; sinon pass. Messages EN + `fix` concrets (« link entities with @id references… »), FR via check-i18n.

- [ ] **Step 1: Tests** : contexte fabriqué `{ sample: { pages: [FetchedResource fixture] } }` → pass/warn/fail selon fixtures (reprendre celles de Task 9) ; check absent de sample → skip ; vérifier que `buildChecks()` inclut le check et que le total structured-data augmente sans casser les tests de scoring existants (les adapter si un test compte les checks — chercher `108` dans les tests et copies CÔTÉ packages/cli UNIQUEMENT : USAGE l.25, tests. La copie landing `apps/web/lib/i18n.mjs` est mise à jour en Task 13, PAS ici — les deux flux doivent rester disjoints).
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter + entrée check-i18n FR + copies « 108 checks » → nombre réel. **Step 4:** `npx vitest run` PASS. **Step 5:** `git commit -am "feat(cli): entity-graph connectivity check (structured-data)"`

### Task 11: Flag `--entity-graph <file>`

**Files:**
- Modify: `packages/cli/src/index.ts` (options + USAGE + écriture fichier l.176–191)
- Test: `packages/cli/test/entity-graph-flag.test.ts` (validation d'extension, unité sur le choix de renderer)

**Interfaces:** Consumes Task 9 renderers + Task 10 (`includeEntityGraph`). Produces : `--entity-graph <file>` (`.json`|`.dot`|`.mmd`, sinon erreur exit 2), écrit via `writeFileSync` (même gestion d'erreur que les rapports : flag `reportWriteFailed`).

- [ ] **Step 1:** Tests sur la fonction de dispatch extension→renderer (l'extraire en `pickEntityGraphRenderer(file)` exportée depuis `report/entity-graph.ts` pour la tester sans lancer le CLI). `.json/.dot/.mmd` → bon renderer ; `.txt` → null (le CLI fera exit 2).
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter : option parseArgs `'entity-graph': { type: 'string' }` ; validation extension avant l'audit ; `auditOpts.includeEntityGraph = Boolean(values['entity-graph'])` ; après l'audit : `writeFileSync(file, renderer(report.entityGraph))`. USAGE + aide. **Step 4:** `npx vitest run` PASS + `npm run build` propre. **Step 5:** `git commit -am "feat(cli): --entity-graph export (json/dot/mermaid)"`

---

## INTÉGRATION (sur main, après merge des deux flux)

### Task 12: SEO/GEO sur findable lui-même + vitrine repo

**Files:**
- Modify: `apps/web/server.mjs` (shell() ~l.172–197 : meta/OG/JSON-LD ; dispatch : nouvelles routes statiques), `apps/web/lib/i18n.mjs` (meta descriptions localisées)
- Create: routes servies en dur dans server.mjs : `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/.well-known/security.txt`
- Modify: `README.md` (racine)
- Test: `apps/web/test/seo.test.mjs`

Contenu exigé :
- `shell()` : `<meta name="description">` localisée, `<link rel="canonical">` (PUBLIC_ORIGIN env, défaut `https://findable.bordebat.fr`), OG (`og:title/description/type/url/locale` + `og:locale:alternate`), `twitter:card=summary`. JSON-LD sur la landing UNIQUEMENT : `@graph` connexe — `Organization {@id: <origin>#org}`, `WebSite {@id: <origin>#website, publisher → #org}`, `WebApplication {@id: <origin>#app, provider → #org, offers gratuit}` (dogfooding : le graphe doit passer notre propre check `entity-graph-connectivity`).
- `/robots.txt` : allow all + `Sitemap:` absolu ; commentaire listant les bots IA explicitement bienvenus. `/sitemap.xml` : `/en/` et `/fr/` avec hreflang. `/llms.txt` : markdown court décrivant l'outil + liens. `/.well-known/security.txt` : `Contact: https://github.com/piwig/findable-audit/issues`, `Expires` +1 an, `Preferred-Languages: fr, en`.
- README racine : pitch une ligne, badges shields statiques (license, node version), features (dont les 4 nouvelles), quickstart CLI + web, exemple CI `--baseline`/`--fail-on-regression`, `--entity-graph`, lien admin/README web. Pas de contenu inventé (pas de fausse URL de démo).

- [ ] **Step 1:** Tests : `/robots.txt` 200 text/plain contient `Sitemap:` ; `/sitemap.xml` 200 XML contient `/en/` et `/fr/` ; `/llms.txt` 200 text/plain ; `/.well-known/security.txt` 200 contient `Contact:` ; landing contient `application/ld+json`, `og:title`, canonical ; le JSON-LD de la landing parsé par `buildEntityGraph` → `danglingRefs === 0 && components === 1`.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS. **Step 5: Dogfood** : `node packages/cli/dist/index.js http://127.0.0.1:<port> --no-report` avant/après → le score doit monter ; noter les deux scores dans le message de commit. **Step 6:** `git commit -am "feat(web+repo): apply our own SEO/GEO best practices (dogfooding)"`

### Task 13: Docs, drift, backlog, push

**Files:**
- Modify: `apps/web/README.md` (DATA_DIR/STATS_SALT/ADMIN_PORT/PUBLIC_ORIGIN, admin + systemd `findable-admin.service` + tunnel SSH, compare async, correction du drift : 10 concurrents / 20 par min), `packages/cli/README.md` si présent sinon aide USAGE seule, `docs/competitive-analysis-and-roadmap.md` (annoter FAIT + date : §12.A admin, #36 web compare, §12.B v1 diff/baseline, §12.C entity-graph)

- [ ] **Step 1:** Écrire les docs. **Step 2:** Suite complète : `npm test --workspaces && node --test apps/web/test/ && npm run build` → tout vert. **Step 3:** `git add -A && git commit -m "docs: admin/compare/baseline/entity-graph + backlog marked done"`. **Step 4:** `git push` (autorisé explicitement par l'utilisateur le 2026-07-24).
