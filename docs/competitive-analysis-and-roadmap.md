# findable-audit — Analyse concurrentielle & roadmap d'amélioration

> Document de travail interne (2026-07-21). Base pour prioriser l'évolution de l'outil.
> Source : recherche multi-agents (4 sweeps du marché SEO/GEO, juillet 2026) + vérification sur le code source. Snapshot daté — le marché GEO bouge vite (Semrush et Chrome Lighthouse ont ajouté des checks IA ces derniers mois).

## 0. ▶️ PROCHAINS LOTS À LANCER (mis à jour **2026-07-27**, après LOT 7)

**État vérifié le 2026-07-27** (le §0.bis ci-dessous est l'ancienne liste du 24/07, conservée pour l'historique — plusieurs de ses items sont livrés) :

- ✅ **LOT 3, LOT 4, LOT 5, LOT 6, refonte design, Lot E (messages FR)** — livrés. Prod redéployée le 27/07 sur `6844abd` : elle tournait un commit en retard, les constats de checks s'affichaient encore en anglais sur les rapports FR.
- ✅ **Bug CWV prod (ex-n°2)** — **non reproductible, clos**. `PSI_KEY` est bien posée en drop-in systemd sur le VPS, l'API PSI répond 200, et un audit réel avec le moteur déployé rend le dashboard CWV complet (famille performance 47/47, aucun « non mesuré »). Réserve : vérifié moteur + clé, pas un clic dans le formulaire (Turnstile bloque un POST scripté).
- ✅ **LOT 7 « Sortie publique »** (2026-07-27, spec `docs/superpowers/specs/2026-07-27-lot7-sortie-publique.md`) : badge de score `--report *.svg` (#12), `prepublishOnly` + `.github/workflows/release.yml` (publication npm sur tag, avec provenance), décomptes 113 → 120 corrigés dans `packages/cli/README.md` et `action.yml` **et** ces deux fichiers ajoutés à la table de propagation du skill `findable-new-check` (la raison pour laquelle ils rotaient), topics + homepage posés sur le dépôt GitHub.
- ✅ **`findable-audit@0.2.0` PUBLIÉ sur npm le 2026-07-27 09:08 UTC**, par `release.yml` sur le tag `v0.2.0`, **avec attestation de provenance SLSA**. Vérifié depuis un dossier vierge : `npx findable-audit@0.2.0 https://findable.bordebat.fr/` rend 99/100 A. Conséquence directe : **le plugin Claude Code redevient fonctionnel** (ses trois skills appellent `npx findable-audit`, qui répondait 404 — voir #62). Deux pièges de token traversés, consignés dans `CLAUDE.md` § *Shipping* : granular token **avec bypass 2FA** (sinon `E403`) et portée **All packages** tant que le paquet n'existe pas (sinon `E404 … is not in this registry`, qui ressemble à un paquet manquant mais est un refus de permission).
- ⏳ **Suite immédiate de la publication** : (a) **basculer sur le Trusted Publishing** (OIDC GitHub Actions) — impossible avant la première publication puisqu'il se configure dans les réglages d'un paquet existant, mais faisable **maintenant** : configurer le trusted publisher sur le paquet, retirer `NODE_AUTH_TOKEN` du workflow (la provenance devient automatique, `--provenance` inutile ; exige npm ≥ 11.5.1 et Node ≥ 22.14), puis **révoquer le token** `findable-audit-release-ci` (il expire de toute façon le 2026-08-03) ; (b) la case « publish to Marketplace » d'une release GitHub (`action.yml` a déjà son `branding`, le dépôt est éligible).
- 🔶 **LOT 8 « le web rattrape le CLI » — partiel (2026-07-27)** : ✅ **#58 graphe d'entités dessiné dans le rapport** (CLI **et** web, `renderEntityGraphSvg` dans `report/charts.ts`) — SVG inline, zéro JS client, **niveau de lecture par type d'entité** avec compteur ×N (décidé au dogfooding : 6 pages de notre propre site = 43 entités / 52 références, illisible entité par entité ; regroupé = 10 boîtes / 12 flèches) ; la CLI attache désormais le graphe dès qu'un rapport HTML est écrit, un `--report *.json` seul reste léger pour ne pas gonfler les baselines CI. ✅ **#2b tableau KPI CWV : déjà livré** (`report/cwv.ts` l.93, le backlog était périmé). ✅ **#60 sélecteur de profondeur** : `PAGE_CHOICES = [1, 3, 6]` dans le formulaire, `parsePages` clampe côté serveur (`MAX_PAGES` reste le plafond **et** le défaut — un `?pages=500` fabriqué à la main n'achète pas un crawl plus cher), et la profondeur entre dans la clé de cache (un audit 1 page ne peut plus servir un audit 6 pages). ✅ **#59 diff « apporte ta baseline »** : `POST /{lang}/audit/diff?job=<id>`, seule route non-GET du serveur — corps borné à 2 Mo (413 au-delà), même garde de forme que le `--baseline` de la CLI (400 sinon), `diffReports` + `renderHtml(..., {diff})` déjà écrits, et **la baseline collée n'est jamais stockée** (le « rien n'est conservé » de la landing reste vrai au pied de la lettre).
- ✅ **LOT 9 « fermer la boucle » (2026-07-27)** — spec `docs/superpowers/specs/2026-07-27-lot9-fermer-la-boucle.md`. **`security-txt`** (RFC 9116, famille sécurité, 2 pts, *warn* jamais *fail*) → **121 checks** ; **`--submit`** notifie IndexNow (Bing, Yandex, Seznam, Naver) avec quatre garde-fous : opt-in, `--indexnow-key` obligatoire, **le check `indexnow` doit passer** (le fichier de clé hébergé prouve la propriété — impossible de soumettre le site d'un tiers), URL échantillonnées de la seule origine auditée, et jamais bloquant. **Dogfoodé en vrai** : findable.bordebat.fr soumis, 6 URL, réponse 202. Le `fix --apply` (#11) reste hors lot, il mérite sa propre spec.
- ✅ **Référencement (2026-07-27, demande utilisateur)** : section **« Run it yourself, or in CI »** sur la landing (la CLI, l'Action et le plugin n'étaient découvrables nulle part depuis le site) ; **vitrine npm réécrite** + 26 mots-clés + `homepage` vers le site ; **CHANGELOG** ; **CONTRIBUTING**, **SECURITY.md**, modèles d'issue (bug / proposer un check) ; **releases GitHub** pour v0.2.0, v0.2.1, v0.3.0 ; **workflow `self-audit`** hebdomadaire qui audite notre propre site avec notre propre Action.
- 🐛 **Trouvé par ce self-audit, corrigé en 0.3.1** : **l'upload SARIF était rejeté par GitHub code scanning** (« SARIF URI scheme https did not match the checkout URI scheme file »). L'intégration mise en avant dans le README n'avait donc jamais posé une seule alerte. Les résultats portent désormais un pseudo-chemin relatif stable et gardent l'URL réelle dans `properties.url`. C'est l'argument du dogfooding en une ligne : la CI a trouvé ce qu'aucun test unitaire ne pouvait voir.
- 🆕 **Veille 2026-07-27** : `dageno-agents/seo-geo-audit` analysé (**§3.5**) — cadre de prompt, pas un logiciel, 164 ★ en 6 commits. Six items nouveaux en **§12.E** (#62 → #67), dont **#62** (le plugin est cassé hors dépôt tant que npm n'est pas publié) et **#63** (étiqueter mesuré / heuristique / non vérifié), les deux plus rentables.
- ▶️ **Suite proposée, par rentabilité** : **#63** étiquetage `mesuré / heuristique` (le meilleur emprunt au concurrent, et la spec est à écrire avant l'annotation des 121 checks — une mauvaise étiquette serait pire que pas d'étiquette) → **#11 `fix --apply`** (spec propre : écrire dans l'arbre de fichiers de l'utilisateur n'est pas anodin) → **#64** résumé direction → **#65** présence hors-site bornée. Côté adoption, ce qui reste demande l'identité de l'utilisateur : case Marketplace sur une release, et toute annonce publique. → LOT 9 « fermer la boucle » (#11 `fix --apply`, #61 IndexNow, `security.txt`) → LOT 10 historique public (#10 v2, **arbitrage produit sur la persistance d'abord**) → LOT 11 checks bon marché du §13 (#21, #25, #28, #23, #27) → LOT 12 GEO avancé (`docs/backlog-geo-avance.md`).

## 0.bis Archive — liste du 2026-07-24 (après LOT 1 + LOT 2 + déploiement VPS/Cloudflare + redirect www)

**Ordre validé par l'utilisateur (2026-07-24)** — même cycle que les lots précédents (spec → plan → TDD → tests → commit → push → déploiement VPS si web ; contraintes mémoire `[[findable-audit-report-ux-phase1]]` : zéro nouvelle dép, cross-platform, `process.exitCode` jamais `process.exit`, admin privé/gitignoré, SSH VPS resette → boucler) :

1. **P0 Honnêteté & positionnement** (§7 P0, docs uniquement) : corriger « zéro dépendance » (3 deps runtime pur-JS : `fast-xml-parser`, `node-html-parser`, `picocolors` ; seul `apps/web` est zéro-dép), reformuler llms.txt en « signal de valeur non prouvée », documenter le set de bots exact (nombre + liste + tiers), section « vs alternatives » au README.
2. **🐛 Bug prod : les CWV ne fonctionnent plus via le site web** (constat utilisateur 2026-07-24). Pistes : `PSI_KEY` expirée/quota, 429 keyless, régression LOT 1/2 (CSP/Turnstile ?), env VPS. Investiguer → fixer → redéployer.
3. **LOT 3 « Largeur IA »** : #13 bots 27+ (tiering citation/entraînement conservé) + découverte `.well-known/` + `ai.json` (§7 P1).
4. **LOT 4 « Adoption »** : #15 publication npm + GitHub Action + sortie JUnit (SARIF déjà livré), page GitHub soignée.
5. **UX résultats web — dataviz** (demande utilisateur 2026-07-24) : page de résultats plus compréhensible — graphs/charts (radar par famille, jauges de score, barres par check…), SVG inline maison, zéro nouvelle dép.
6. Ensuite : #16 CWV local (fallback Lighthouse sans clé PSI — lié au n°2), #14 famille agentic complète, `--fix`, #10 monitoring cron/alertes.

**Livrés :** LOT 1 (#7 Turnstile, #8 hardening, #55 generate) · LOT 2 (#19 CSR parity, #20 AI serving parity, #47 link equity ; 109→112 checks) · LOT 3 « Largeur IA » (#13 : roster 28 agents / 3 tiers + check `well-known-ai-json` ; 112→113 checks) · best-features (store JSONL, admin+stats, /compare async, baseline/diff, --entity-graph) · corrections SEO/GEO prod + déploiement + redirect www.

<details><summary>Archive — description originale LOT 1 / LOT 2 (livrés)</summary>

Deux lots validés par l'utilisateur, à lancer **l'un après l'autre**, chacun en cycle complet **brainstorm (superpowers:brainstorming) → spec → writing-plans → exécution TDD → tests → commit → push → déploiement VPS si web** (voir la procédure de déploiement + les contraintes dans la mémoire `[[findable-audit-report-ux-phase1]]` : zéro nouvelle dép, cross-platform, `process.exitCode` jamais `process.exit`, **admin reste privé/gitignoré**, SSH VPS resette → boucler `for i in 1 2 3; do ssh … && break; done`).

**LOT 1 — « Trio durcissement avant promo publique »**
- **#7 CAPTCHA** sur le formulaire d'audit : **Cloudflare Turnstile** (site déjà derrière Cloudflare), vérifié **côté serveur** avant de créer le job. ⚠️ relâcher la CSP de la landing (nonce pour le widget). Alternatives : proof-of-work sans JS, ou Bot Fight Mode + rate-limit durci. Déjà en place : rate-limit 20/min/IP + SSRF + cache.
- **#8 Revue de durcissement sécurité** `apps/web` + CLI. Acquis : SSRF, rate-limit, CSP, referrer-policy, nosniff, `PSI_KEY` env 600, **HSTS posé (2026-07-24)**. À vérifier/compléter : limites de taille de requête & timeouts, pas de fuite d'info dans les erreurs, audit des dépendances npm, ids de jobs devinables ?, logs. Possible : lancer `/security-review` sur le diff.
- **#55 Génération de fichiers d'indexation à la demande** : après un audit, produire des fichiers prêts à poser d'après ce qui a été détecté — `robots.txt` (règles par bot IA découvert + Allow/Disallow + Sitemap), `llms.txt`/`llms-full.txt` d'amorce, `.well-known/ai.json`, snippet `sitemap.xml`, stubs **JSON-LD** (Organization/WebSite/Breadcrumb/FAQ selon le type de page). **Téléchargeables** (CLI `findable generate` / `--emit`, ou bouton web « générer les fichiers »). Faisable **au crawl seul**. ⚠️ fichiers **génériques à personnaliser** (avertir : relire avant de déployer, surtout robots.txt). Tranche concrète et à fort ROI de #11.

**LOT 2 — « Différenciateurs GEO » (tous faisables au crawl seul, forte valeur)**
- **#19 Parité contenu CSR/SPA — « ce que GPTBot voit vraiment »** `H/M/✅` : par page échantillonnée, **sans exécuter le JS**, fingerprint app-shell + marqueurs de framework (mount roots vides `<div id="root">`, `#__next`, `#app`, `<app-root>`, `[data-reactroot]`, `ng-version`) + blobs d'hydratation/état ; flaguer les pages dont le contenu principal n'existe qu'après rendu client (invisible aux crawlers IA).
- **#20 Parité de service aux bots IA / cloaking** `H/M/✅` : réutiliser le fetch à UA configurable existant pour récupérer la home (+ 1-2 pages) en **3 UA** — défaut, mobile, **crawler IA réel (GPTBot/ClaudeBot)** — puis **diff** : statut HTTP, taille en octets, `<title>`, présence du contenu principal. Complète #13 (roster de bots).
- **#47 Carte d'équité de liens internes** `H/M/✅` : réutiliser l'adjacency déjà construite par `buildLinkGraph` (zéro crawl en plus). Calculer (1) **in-degree** par URL interne découverte, (2) **PageRank sample-scoped** ; signaler **pages orphelines** + **fuites d'équité**. Quasi aucun outil gratuit ne le fait.

*(Détails complets : LOT 1 = §11 items #7/#8 + §12 #55/#11 ; LOT 2 = §13 items #19/#20/#47. Après ces deux lots, prochains candidats : #13 bots 27+, #16 CWV local, #14 famille agentic complète, #10 suite monitoring cron/alertes, #15 adoption npm/API.)*

</details>

## 1. Positionnement en une phrase

**findable-audit est un audit « pré-vol » gratuit, MIT, auto-hébergeable qui note si les crawlers IA peuvent à la fois _atteindre_ ET _extraire_ ton contenu, unifié avec le SEO classique + Core Web Vitals + accessibilité + sécurité en une seule note A–F.** Il comble le trou entre les **SaaS payants de monitoring de réponses IA** (qui surveillent la _sortie_ des moteurs) et les **crawlers SEO classiques** (qui zappent la lisibilité par les IA).

## 2. La ligne de partage du marché : *auditer* vs *monitorer*

C'est le discriminateur le plus net de tout le paysage :

- **Monitorer (sortie)** : interroger ChatGPT / Perplexity / Gemini / Copilot / AI Overviews sur des prompts suivis, puis rapporter mentions, citations, position, sentiment, part de voix vs concurrents. → **SaaS payants**.
- **Auditer (entrée)** : examiner le code/config du site pour prédire « est-ce que les IA peuvent te trouver et t'extraire » — robots.txt pour bots IA, llms.txt, contenu sans-JS/SSR, données structurées. → **findable-audit**.

Les deux sont **complémentaires**, pas concurrents : on peut auditer un site qui n'a encore **aucune** présence IA à monitorer. findable-audit fait délibérément l'audit d'entrée, pas le monitoring de sortie.

## 3. Paysage concurrentiel (juillet 2026)

### 3.1 SaaS payants de monitoring de réponses IA (le plus gros cluster — job opposé)
13 outils nommés, **tous payants, aucun auto-hébergeable** : **Profound** (~$399-499+/mo), **Otterly.ai** ($29-489/mo, hybride léger), **Peec AI** ($95-495/mo, monitoring pur), **Scrunch AI** ($250/mo, audit-forward), **Goodie AI** (~$399+/mo), **Rankscale** (~€20-780/mo, vrai audit + monitoring), **Athena HQ** ($295/mo), **BrandLight** ($199-25k+/mo), **SE Ranking / SE Visible** ($99-218/mo), **Ahrefs Brand Radar** ($828-1148/mo réel), **Semrush AI Visibility Toolkit** ($99/mo/domaine), **Nightwatch** (~$138/mo), **Knowatoa** ($59-749/mo, vrai test d'accès crawler IA temps réel).
→ **Crux** : tous construits autour du monitoring. Une seconde couche (Scrunch, Rankscale, Knowatoa, Semrush AI, Otterly) **greffe** un vrai module d'audit technique, mais toujours secondaire, payant, « diagnostic only » (pas d'auto-fix), et parfois bogué (Scrunch : score 100 % tout en signalant des crawlers bloqués).

### 3.2 Auditeurs SEO/web « classiques »
| Outil | Type | Coût | Auto-héberg. | Couverture IA/GEO |
|---|---|---|---|---|
| **Screaming Frog** | crawler desktop | freemium (~$279/an) | oui | Aucun check IA scoré ; spoof UA manuel + Log File Analyser (trafic bots réel) en DIY |
| **Sitebulb** | crawler desktop/cloud | payant ($13-245/mo) | partiel | Aucun check IA natif ; sceptique publiquement sur llms.txt |
| **Ahrefs Site Audit** | SaaS cloud | payant ($129-449+/mo) | non | Aucun check IA ; étude 137K-sites concluant llms.txt = non lu |
| **Semrush Site Audit** | SaaS cloud | **freemium** | non | **⚠️ Le seul auditeur classique avec un vrai module IA gratuit** : « AI Search Health » (bots IA nommés + flag llms.txt + toggle rendu JS), inclus dans tous les plans |
| **Lighthouse / PSI** | OSS + API gratuite | gratuit (Apache-2.0) | oui | « Agentic Browsing » (Lighthouse 13.3, défaut mai 2026) : **présence** llms.txt seulement + WebMCP + arbre a11y + CLS. Pas de robots-pour-bots-IA, pas de no-JS-pour-LLM |
| **Google Search Console** | dashboard Google | gratuit | non | Monitoring d'impressions dans les surfaces IA de Google uniquement ; zéro visibilité sur GPTBot/ClaudeBot/PerplexityBot |

### 3.3 Outils OSS / auto-hébergeables (nos vrais concurrents)
| Outil | Type | GEO/IA | CWV | a11y | Sécurité | Note unifiée | Sans clé | Remarque |
|---|---|---|---|---|---|---|---|---|
| **findable-audit** (nous) | CLI + web + plugin CC (Node) | ✅ 8 familles, bots par **intention** (citation FAIL / entraînement WARN) | ✅ **terrain CrUX** + labo (PSI) | ✅ | ✅ en-têtes | ✅ **A–F pondérée** | ✅ (PSI optionnel) | — |
| **Auriti-Labs/geo-optimizer-skill** | CLI + lib + MCP + Astro (Python) | ✅ **27 bots / 3 tiers**, llms.txt, JSON-LD, JS/SSR + prompt-injection + RAG-chunk | ❌ | ❌ | ❌ (juste SSRF interne) | 0-100 (8 cat. GEO) | ⚠️ `geo citations` = clé requise | **Concurrent le plus proche** ; ~465★ ; auto-fix `geo fix --apply` ; add-on hébergé payant (GeoReady) |
| **SEOmator (@seomator/seo-audit)** | CLI + Electron + skill CC (Node) | ✅ GPTBot/ClaudeBot, llms.txt, DOM brut-vs-rendu | ⚠️ **labo Playwright only** (pas CrUX) | ✅ | ✅ | ✅ (251 règles) | oui | **Seul OSS qui met IA + CWV + a11y + sécurité ensemble** ; mais **pas** de distinction citation/entraînement, **pas** PerplexityBot, données structurées en 1 bucket générique |
| **lireking/seo-geo-audit** | 4 scripts Node (~1500 LOC) | ✅ les 4 signaux | ✅ (Playwright) | ❌ | ❌ | ❌ pas de note | quasi-zéro-dép ; PSI/GSC = clé/OAuth |
| **sitespeed.io** | CLI OSS | ❌ | ✅ (vrai navigateur) | ✅ (axe) | ✅ (coach) | — | oui | Le meilleur « santé web » OSS, mais **zéro couche SEO/GEO** |
| **Unlighthouse / Lighthouse CI** | CLI OSS | ❌ | ✅ | ✅ | ⚠️ | — | oui | SEO Lighthouse basique seulement |
| **axe-core / pa11y** | CLI OSS | ❌ | ❌ | ✅ | ❌ | — | oui | a11y pur |
| **MCP servers** (SiteAudit/seo-audit/seo-mcp) | serveur MCP | ⚠️ partiel | ✅ | ? | ✅ | — | oui | Conçus pour être pilotés par un agent, pas run standalone/CI ; pas de llms.txt ni tiering bots |

### 3.4 Micro-outils gratuits mono-usage
Des dizaines de validateurs web quasi-identiques (llms.txt-only, robots.txt-IA-only, schema-only, JS-render-only) qui servent surtout de lead-gen pour des prestas AEO. **Le plus large** : **Pixelmojo AI Crawl Checker** (robots 14 bots + llms.txt + JSON-LD + JS-render, /100) — mais **single-page**, pas de crawl multi-pages, pas de CWV/a11y/sécurité. Aucun n'est OSS/auto-hébergeable.

### 3.5 Cadres de prompt / « skills » d'agent — job différent, leçon réelle (ajouté 2026-07-27)

**`dageno-agents/seo-geo-audit`** (MIT, **164 ★ / 22 forks en 6 commits**, EN + ZH) ne contient **aucun logiciel** : un `SKILL.md`, un `agents/openai.yaml`, trois templates Markdown. C'est une grille d'audit qu'un agent IA exécute — cinq couches (technique, on-page, GEO, entité/confiance, **mentions hors-site**), trois formats de sortie par audience (Boss / Operator / Specialist, plus un template exécutif chinois), un crawl *page-capped* (presets 1 / 20 / 50 / 100), une seule clé optionnelle (`SERPAPI_API_KEY`). Rattaché à Dageno.ai, plateforme commerciale.

⚠️ **Homonyme sans lien** avec `lireking/seo-geo-audit` déjà listé en §3.3.

**Où ils nous battent** — (a) la **distribution** : 164 ★ en 6 commits, parce qu'un artefact en forme de *skill* se diffuse sans rien à installer, pendant que notre plugin Claude Code n'est mis en avant nulle part ; (b) la **couche hors-site** (LinkedIn, Reddit, YouTube, Wikipedia/Wikidata, Product Hunt, Crunchbase, presse, podcasts) que notre §13 déclare hors-scope ; (c) les **sorties par audience** ; (d) leur étiquetage `Observed` / `Assessment` / `Not verified`, qui expose au lecteur la frontière preuve/hypothèse — frontière qu'on s'impose en interne mais qu'on n'affiche pas.

**Où on les bat** — score **calculé et reproductible** (8 familles pondérées, skip explicite, invariant perfect-site = 100) contre une fourchette qualitative produite par un modèle (« Technical Health: 82-90 ») que deux exécutions peuvent contredire ; **mesure réelle** (CrUX/PSI, parsing robots.txt contre 28 agents tiérés, en-têtes, a11y, parité de service aux bots) là où un prompt ne peut qu'affirmer ; **CI-natif** (codes de sortie, SARIF, JUnit, Action, gate de régression) — leur outil ne peut pas bloquer un merge ; **aucun coût, aucune fuite** (pas de runtime d'agent, pas de clé, auto-hébergeable).

**Le piège à ne pas suivre** : leur couche hors-site est séduisante et **invérifiable au crawl seul**. Si on la fait, ce sera en `non vérifié` explicite (voir #63/#65) — sinon on trahit les garde-fous du §5 de `docs/research/2026-07-25-deep-research-citations-verifiee.md`.

## 4. Ce qui nous différencie vraiment (la *combinaison*, pas une check isolée)

1. **Tout le bundle en un seul crawl déterministe** : gratuit + OSS + auto-hébergeable + sans clé à fournir + **une note A–F pondérée sur les 8 familles**. Les 4 sweeps concluent qu'**aucun outil gratuit/OSS/auto-hébergeable ne couvre ce périmètre complet** — le cluster OSS classique (Lighthouse, sitespeed, Unlighthouse, axe) a zéro check IA ; le cluster OSS GEO (geo-optimizer, ai-seo-auditor) omet CWV/a11y/sécurité ; le seul qui ponte les deux (SEOmator) rate le CWV terrain et le tiering de bots.
2. **Accès crawler IA noté par _intention_ avec sévérité** : bloquer un fetcher de citation (OAI-SearchBot, ChatGPT-User, Perplexity-User, Claude-User, PerplexityBot) = **FAIL dur** ; bloquer un crawler d'entraînement (GPTBot, ClaudeBot, CCBot, Google-Extended) = simple **WARN**. Vérifié dans `ai-access.ts`. **Égalé nulle part** dans le panel (SEOmator ne distingue pas ; seul geo-optimizer tier des bots mais sans graduation de sévérité).
3. **CWV en données terrain CrUX réelles (p75, url puis origine)** + labo Lighthouse en un seul appel PSI, **fondu dans la même note**, sans navigateur headless, avec skip propre sans clé. Vérifié dans `psi.ts`. Le champ-CWV *dans* une note SEO+GEO combinée est inégalé.
4. **Design côté _entrée_ / pré-vol** : audite le code/config, sans compte, sans fuite de données, exécutable **avant** toute présence IA. Job inverse des SaaS monitors — le discriminateur le plus clair du marché.
5. **Un moteur, trois surfaces** orientées boucle de correction : CLI gatable en CI + **UI web auto-hébergée durcie SSRF** + plugin Claude Code (`geo-implement` / `fix-technical-seo` appliquent les fixes).

## 5. Ce qu'on partage avec d'autres (honnêteté)
Presque **chaque check pris isolément existe ailleurs** : accès robots IA (Semrush, Scrunch, Rankscale, Knowatoa, SEOmator, geo-optimizer…), llms.txt (Semrush, Lighthouse 13.3, Otterly, geo-optimizer, + des dizaines de validateurs), no-JS/SSR (SEOmator, geo-optimizer, Semrush toggle), JSON-LD (tous les validateurs schema), CWV (Lighthouse/PSI, sitespeed), a11y (axe/pa11y, Lighthouse), en-têtes sécurité (sitespeed coach, MCP servers), crawl multi-pages, gating CI. **Notre défendable = la combinaison, jamais une check unique.**

## 6. Où les concurrents sont meilleurs (nos écarts réels)

1. **Monitoring des réponses IA en direct** (mentions/citations/part de voix) — 13 SaaS le font, **nous non** (volontairement hors scope).
2. **Trafic réel des bots IA via logs** (Screaming Frog LFA, Profound Agent Analytics, BrandLight) — on **prédit** l'accès, on ne **confirme pas** une visite.
3. **CWV en vrai navigateur local** (sitespeed, SEOmator, Unlighthouse) vs notre dépendance à l'API PSI (keyless = 429).
4. **Largeur de bots nommés** : geo-optimizer 27 bots / 3 tiers ; SEOmator rate PerplexityBot. Notre set nommé est plus petit (nombre exact non documenté).
5. **Volume brut de checks** : SEOmator 251 règles, Rankscale 200+ vs nos **107**.
6. **Auto-remédiation en une commande** : geo-optimizer `geo fix --apply` génère robots/llms.txt/schema ; Prerender.io/Scrunch AXP corrigent le rendu JS. Nos fixes = recommandations + skills CC, pas une réécriture one-shot.
7. **Écosystème / données / adoption** : Semrush (239M+ prompts), Ahrefs (405M+), geo-optimizer ~465★. Notre traction est **non prouvée**.
8. **Sorties CI structurées** : geo-optimizer a une **GitHub Action + SARIF/JUnit** ; on n'a que des exit codes.

## 7. Roadmap d'amélioration (priorisée)

### P0 — Honnêteté & positionnement (rapide, à faire avant de pousser le pitch)
- [x] (fait 2026-07-24) **Corriger la revendication « zéro dépendance »** : la recherche a lu `package.json` et trouvé **3 deps runtime pur-JS** (`fast-xml-parser`, `node-html-parser`, `picocolors`) ; **seul `apps/web` est littéralement zéro-dép**. → **Vérifier**, puis reformuler partout (README, CLAUDE.md, mémoire, pitch) en : *« aucune dépendance lourde/navigateur/SDK-LLM, sans clé à fournir, audit hors-ligne sans fuite de données »*. (Toujours un argument fort, mais exact.)
- [x] (fait 2026-07-24) **Reformuler la valeur de llms.txt** : études Ahrefs 137K, SE Ranking 300K, Otterly 62K, Trakkr 37.9K → **aucun gain de citation mesuré**, ~3,2 % d'adoption, crawlers IA le zappent ; Google Search dit « zéro impact ranking ». → Dans le rapport, présenter les checks llms.txt comme **« signal de valeur non prouvée »**, poids faible, avec la nuance. Défendre l'**audit combiné**, pas llms.txt seul.
- [x] (fait 2026-07-24) **Documenter le set de bots exact** (nombre + liste + tiers) et l'assumer comme argument.
- [x] (fait 2026-07-24) **Ajouter une section « vs alternatives »** au README (reprendre le §4 + le tableau §3.3) — l'honnêteté sur les forces/faiblesses est un atout pour la candidature OSS.

### P1 — Combler les écarts réels (fort ROI)
- [ ] **Élargir la couverture des bots IA** en gardant le tiering citation/entraînement : ajouter les bots récents (applebot-extended, Amazonbot, Bytespider, Meta-ExternalAgent, Google-CloudVertexBot, cohere-ai, Diffbot, etc.). Rattrape la largeur de geo-optimizer sans perdre notre avantage (sévérité par intention).
- [ ] **Découverte `.well-known/` + `ai.json`** (ai-seo-auditor le fait) — check additif dans la famille `ai-access`/`llm-content`.
- [ ] **Sortie SARIF + JUnit + GitHub Action** pour le gating CI (parité avec geo-optimizer). Peu coûteux, gros signal « prod-ready ».
- [ ] **Fallback CWV local optionnel** (Lighthouse/headless) pour ne pas dépendre uniquement de la clé PSI (keyless 429). Alternativement : mieux documenter les heuristiques perf statiques comme filet quand PSI absent.

### P2 — Paris plus gros
- [ ] **`--fix` / auto-remédiation** : générer les stubs manquants (robots.txt AI, /llms.txt, JSON-LD Organization/Breadcrumb) en une commande — la boucle « audit → implement » du plugin CC industrialisée hors Claude Code.
- [ ] **Checks « agentic browsing » émergents** : présence WebMCP, intégrité de l'arbre d'accessibilité comme modèle-donnée machine (Lighthouse 13.3 les a), prompt-injection / RAG-chunk readiness (geo-optimizer les a).
- [ ] **Compagnon de vérification côté sortie (optionnel, garde le scope)** : ne PAS devenir un monitor SaaS, mais documenter/outiller le pairage « findable-audit (entrée) + un monitor (sortie) ». Éventuellement un mode `--verify-logs` qui parse les logs serveur pour confirmer les visites de bots IA (comble l'écart #2 sans quitter l'auto-hébergé).
- [ ] **Adoption** : publier sur npm, soigner la page GitHub, la doc, la démo en ligne (findable.bordebat.fr), viser des étoiles/retours — la traction est le vrai manque vs geo-optimizer/SEOmator.

## 8. Cibles idéales / quand NE PAS l'utiliser
**Pour** : devs/agences voulant un pré-vol gratuit, local, gatable en CI, sans fuite de données ni facturation par domaine ; environnements privacy/régulés/air-gapped ; utilisateurs Claude Code (audit → implement) ; équipes voulant **une** note unifiée SEO+GEO+CWV+a11y+sécurité ; sites neufs/pré-lancement sans budget SaaS (les monitors vont de $29 à $15-25k+/mo).
**Pas pour** : marques dont le besoin premier est de **suivre si/comment elles sont citées** dans les réponses IA et de benchmarker les concurrents → il leur faut un **monitor** (Profound/Peec/Otterly/Semrush AI Visibility), job qu'on ne fait volontairement pas.

## 9. Verdict
Hypothèse **confirmée** (les outils GEO sont massivement des SaaS payants de monitoring ; aucun gratuit/auto-hébergeable) et **affinée** (les auditeurs classiques zappent l'IA — **sauf Semrush** qui l'inclut gratuitement en cloud — et une niche OSS GEO existe déjà, menée par `geo-optimizer-skill`). Le différenciateur **durable** = la **combinaison inégalée** : gratuit + OSS + auto-hébergeable, sans fuite de données, une note A–F unique couvrant signaux GEO **et** santé web classique, avec accès IA noté par intention. Ce n'est **jamais** « personne d'autre ne vérifie l'accès IA » — plusieurs le font désormais.

## 10. Sources
- Vérif code : `packages/cli/src/checks/ai-access.ts` (grading citation/entraînement), `scoring.ts` (8 familles, somme=1.00, perfect=100), `perf/psi.ts` (CrUX terrain + Lighthouse labo, skip keyless), `packages/cli/package.json` (MIT, deps runtime).
- Semrush AI : https://www.semrush.com/kb/1626-ai-visibility-features · https://www.semrush.com/kb/1493-ai-visibility-toolkit
- Chrome Lighthouse Agentic Browsing : https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring · https://searchengineland.com/google-llms-txt-chrome-lighthouse-478246
- Étude llms.txt Ahrefs : https://ahrefs.com/blog/llmstxt-study/
- geo-optimizer-skill : https://github.com/Auriti-Labs/geo-optimizer-skill
- SEOmator : https://www.npmjs.com/package/@seomator/seo-audit · ai-seo-auditor : https://github.com/ngstcf/ai-seo-auditor
- Toolkit OSS SEO/GEO : https://www.cloudapp.dev/open-source-seo-geo-audit-toolkit · sitespeed.io : https://github.com/sitespeedio/sitespeed.io · Unlighthouse : https://unlighthouse.dev/
- Monitors : https://www.tryprofound.com/features/answer-engine-insights · https://otterly.ai/ · https://peec.ai/pricing · https://scrunch.com/pricing/ · https://rankscale.ai/ · https://knowatoa.com/features/ai-search-console
- GSC IA générative : https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
- Screaming Frog Log File Analyser (bots IA) : https://www.screamingfrog.co.uk/log-file-analyser/tutorials/monitor-ai-bots-in-the-log-file-analyser/
- Panorama outils crawler IA : https://searchengineland.com/guide/ai-crawler-tools-software

---
*Snapshot mi-2026 ; le marché évolue vite (Semrush AI Search Health et Chrome Lighthouse Agentic Browsing datent de quelques mois). Un outil blog-cité (foglift-scan) n'a pas été trouvé sur npm → écarté comme vaporware probable.*

---

## 11. Backlog — UX du rapport (retours utilisateur, 2026-07-21, testé sur findable.bordebat.fr en prod)

Observations sur le rapport HTML rendu après un audit, sur le site live :

1. **[i18n] Le rapport FR doit être 100 % en français.** Le *chrome* du rapport est traduit (Phase 2), mais les `message`/`fix` des 107 checks restent en anglais (décision Phase 1 : « checks EN d'abord »). Résultat : sur un rapport FR, le plan d'action et les tables affichent des corrections **en anglais** → incohérent. **Exigence user (2026-07-22) : aucune fuite d'anglais sur un rapport FR.**
   → **Backlog** : traduire **tout** le contenu des checks (`message` **et** `fix`, plan d'action + tables par famille) en FR. Gros chantier (107 checks × 2 langues) → catalogue i18n **par check** dans `packages/cli` (nouveau module, clé par `id` de check). **À faire dans la même passe que le nouvel item #53** (explication + conseil par check) puisqu'ils partagent le même catalogue par check. Priorité : **haute** (demande explicite user).
2. **[CWV] Les Core Web Vitals doivent être mesurés SYSTÉMATIQUEMENT, et affichés en tableau KPI.** Aujourd'hui : (a) sur le live, **CWV non mesuré** faute de `PSI_KEY` → seul l'encart « non mesuré » s'affiche ; (b) le rapport rend des **jauges radiales** (choix Phase 1), pas un tableau KPI.
   → **Backlog** : (a) **rendre la mesure CWV systématique** sur le web — poser un `PSI_KEY` Google PageSpeed (gratuit, à obtenir) dans l'env du service `findable-web` sur le VPS ; le flux web active alors `cwv:true` sur **chaque** audit (Phase 2 câble déjà `PSI_KEY` → `cwv`). Note : +jusqu'à ~45 s par audit (appel PSI), budget déjà relevé à 90 s. Envisager un cache CWV par URL pour amortir. (b) ajouter une **vue tableau KPI** des CWV (LCP/INP/CLS/TTFB + seuils bon/moyen/mauvais + terrain CrUX/labo), en plus ou à la place des jauges. Priorité : (a) rapide (dès qu'on a la clé), (b) moyenne.
3. **[UX] Boutons « télécharger » (MD/HTML/JSON) et « tester un autre site » à remonter EN HAUT du rapport** (actuellement en bas).
   → **Backlog** : barre d'actions collée en tête de la page de résultats (`apps/web` result chrome + éventuellement `renderHtml`). Priorité : rapide, fort impact.
4. **[Responsive] Le rapport est un « one-page » géant qui ne s'adapte PAS à la taille de l'écran.**
   → **Backlog** : rendre `renderHtml` (packages/cli) responsive — largeur fluide, tables larges en `overflow-x:auto`, grilles/jauges qui reflow, media queries, mobile-first (comme la nouvelle landing). Priorité : rapide/moyenne, fort impact visuel (et cohérent avec un outil qui audite justement le responsive/CWV).

**Ordre suggéré** : #3 + #4 (rapides, très visibles) → #2a `PSI_KEY` (rapide) → #2b tableau KPI (moyen) → #1 i18n des checks (gros).

> **MàJ 2026-07-21** : backlog #2(a) FAIT — `PSI_KEY` posé sur le VPS (drop-in systemd 600) → CWV mesurés à chaque audit web ; vérifié live (jauges réelles). Reste #2(b) tableau KPI, #1, #3, #4.

### Ajouts backlog (2026-07-21, suite — retours utilisateur)

5. **[CWV] Encart explicatif + conseils (bilingue) et section CWV mise à part.**
   - Ajouter un **encart simple** au dashboard CWV qui (a) **explique** en clair ce que mesure chaque métrique (LCP = vitesse d'affichage du contenu principal ; INP = réactivité aux interactions ; CLS = stabilité visuelle ; TTFB = temps de réponse serveur) et (b) **propose des améliorations** concrètes selon les résultats obtenus. **Bilingue** : FR sur rapport FR, EN sur rapport EN → nouveaux textes dans le catalogue i18n `packages/cli/src/report/i18n.ts` (pas juste le chrome).
   - **Séparer visuellement** l'analyse Core Web Vitals du reste des tests SEO/GEO : bloc/carte distincte (titre « Performance / Core Web Vitals » détaché des 8 familles). Lié à #2b (tableau KPI).
6. **[Branding] Logo findable-audit + favicon.**
   - Créer un **logo** cohérent avec l'identité « Aube verte » de la landing (dégradé vert `#3bbf6b→#1a7f37→#0f766e`, encre `#1c2230`) + une **favicon** (SVG + PNG 16/32/180). L'intégrer dans le `<head>` de `shell()` (apps/web), la landing et le rapport HTML (`renderHtml`). Aujourd'hui : ni logo ni favicon.
7. **[Sécurité — anti-bot] CAPTCHA sur le formulaire d'audit.**
   - Empêcher les **requêtes automatisées** qui abusent de `/audit` (chaque appel = crawl multi-pages + PSI = coûteux). Déjà en place : rate-limit 20/min/IP + garde SSRF + cache. Ajouter un **CAPTCHA** — **Cloudflare Turnstile** recommandé (site déjà derrière Cloudflare, léger, respecte la vie privée), vérifié **côté serveur** avant de créer le job. ⚠️ Implique de **relâcher la CSP de la landing** (nonce pour le widget). Alternatives : proof-of-work sans JS, ou Cloudflare Bot Fight Mode + rate-limit durci.
8. **[Sécurité — app] Revue de durcissement de l'application.**
   - Revue sécurité dédiée de `apps/web` (+ CLI). Acquis : SSRF-hardened, rate-limit, CSP (nonce sur page d'attente uniquement), referrer-policy, nosniff, `PSI_KEY` en env 600. À vérifier/compléter : HSTS (nginx/Cloudflare), limites de taille de requête & timeouts, pas de fuite d'info dans les erreurs, audit des dépendances npm, protection/exposition des routes async/SSE (jobs, id devinables ?), logs. Possible : lancer `/security-review` sur le diff Phase 2.

**Priorité suggérée (mise à jour globale)** : ~~#3 boutons-en-haut~~ ✅ + ~~#4 responsive~~ ✅ + ~~#6 logo/favicon~~ ✅ + ~~#5 encart CWV + séparation~~ ✅ *(LIVRÉS 2026-07-21, live)* → **#1 + #53 (rapport 100 % FR + glossaire/conseil par check — priorité user)** → #7 CAPTCHA Turnstile + #8 revue sécurité *(durcissement avant promo publique)* → #2b tableau KPI CWV.

### Ajouts backlog (2026-07-22 — retour user : rapport 100 % FR + contenu pédagogique par check)

53. **[Contenu par check] Glossaire « à quoi ça sert » + conseil de correction, pour chacun des 107 checks — bilingue.** Aujourd'hui chaque ligne du rapport montre un `id` technique, un `message` d'état et parfois un `fix`, mais **pas d'explication de la finalité** du test ni, pour tous, un conseil actionnable. Demande user (2026-07-22) : pour **chaque** check, ajouter **(a)** une **explication courte (1-2 phrases)** de ce que le test vérifie et **pourquoi c'est utile** (SEO / GEO / findabilité IA), et **(b)** un **conseil de correction** concret — le tout **bilingue FR/EN** selon la langue du rapport.
    - **Rendu** : afficher le « pourquoi » près de chaque check (tables par famille + plan d'action), pour qu'un non-expert comprenne chaque ligne sans doc externe. C'est l'équivalent, pour les 107 checks, de ce que #5 a fait pour les 4 métriques CWV.
    - **Mécanique** : étendre le **catalogue i18n par check** (le même que #1 introduit) avec un champ `why`/`purpose` par check, en plus de `message`/`fix` traduits ; réutilisable pour les guides `docs/guide*`. Champ optionnel côté type `CheckResult` (ou table `id → {why, fix}` séparée) pour rester additif.
    - **À exécuter avec #1** (même passe, même catalogue). Effort : **gros** (107 × {why, message, fix} × 2 langues) — candidat à une génération assistée (rédiger le catalogue par famille, relire), mais le contenu doit être **exact et vérifié** (pas de conseil faux). Priorité : **haute** (couplée à #1).

55. **[Remédiation] Génération de fichiers d'indexation à la demande** (retour user, 2026-07-22). Après un audit, **produire des fichiers prêts à poser**, pré-remplis d'après ce que l'audit a détecté : `robots.txt` (règles par bot IA découvert + Allow/Disallow + lien sitemap), `llms.txt` / `llms-full.txt` d'amorce, `.well-known/ai.json`, snippet de déclaration `sitemap.xml`, stubs **JSON-LD** (Organization/WebSite/Breadcrumb/FAQ selon le type de page). **Téléchargeables** (CLI `findable generate` / `--emit`, ou bouton web « générer les fichiers »). C'est une **tranche concrète et à fort ROI de #11** (auto-remédiation) : transforme l'audit en « voici les fichiers à poser » — différenciateur GEO majeur, faisable **au crawl seul** (on connaît déjà les manques). ⚠️ Fichiers **génériques à personnaliser** (avertir l'utilisateur : relire avant de déployer, surtout robots.txt). Valeur : **haute**. Effort : **moyen**.

54. **[Responsive] Tout le site web `apps/web` doit être responsive**, pas seulement le rapport (#4 = rapport CLI FAIT). Demande user (2026-07-22). Passe mobile-first sur **toutes les pages** servies par `shell()` et les autres : **landing** (hero, form, chips `.ld-chips`, étapes `.ld-steps`, `.ld-rule`), **topbar** (brand + sélecteur de langue — vérifier le wrap à 320-360px), **page « test en cours »** (barre de progression, textes), **pages d'erreur**, et la **barre download** de la page résultat (aujourd'hui `max-width:860px` inline). Vérifier `PAGE_STYLE` (padding `body` `3rem 1.5rem` trop grand sur mobile), tables/textes qui débordent, cibles tactiles ≥ 44px. Tester réellement à 320 / 375 / 768 px (idéalement via Playwright/Chrome). Cohérent avec un outil qui **audite justement le responsive/CWV** — il doit être exemplaire. Effort : **moyen**, fort impact. Priorité : **haute**.

56. ✅ **FAIT (2026-07-24). [Web/#36] Refaire la comparaison concurrentielle sur le web en ASYNC** (retour user, 2026-07-22). La v1 web (`/compare` synchrone, sans CWV) **partait en timeout** en prod (N audits séquentiels dépassent le timeout du proxy/Cloudflare) → **retirée du site** (le CLI `--compare` reste, il marche). À refaire via le **pattern async existant** (comme l'audit simple : page « test en cours » → SSE de progression → résultat), en lançant les N audits en tâche de fond (job store `lib/jobs.mjs`), puis en rendant le scorecard (`renderCompareHtml` existe déjà dans `packages/cli`). Points : borner N (2-3), garde SSRF par URL (déjà en place), afficher la progression par site, gérer les concurrents injoignables sans bloquer. Les renderers `report/compare.ts` + les libellés i18n web (retirés, à réintroduire) sont réutilisables. Effort : **moyen**. Priorité : **moyenne** (le CLI couvre le besoin en attendant).

### Parité web ↔ CLI (retour user, 2026-07-24)

> **Cadrage important** : le web fait tourner **exactement les mêmes 113 checks + le même moteur** que le CLI (`apps/web/server.mjs` importe `buildChecks()` + `runAudit()` du `packages/cli/dist` ; `const checks = buildChecks()` server.mjs:60). L'écart web↔CLI n'est **pas** dans les checks mais dans les **modes/flags CLI** et les **formats de sortie** non exposés côté web, plus des **brides volontaires** (max-pages plafonné, UA fixe, pas de flags CI). À **ne pas** porter au web : flags CI (`--fail-on-regression`, exit codes, `--sarif` reste niche), `--max-pages` illimité, `--user-agent` arbitraire (surface abus/SSRF). Ce qui vaut le coup d'être ajouté au web, par valeur décroissante :

57. **[Web/#55] Génération de fichiers d'indexation côté web** — 🔵 **EN COURS dans le LOT 1** (bouton « générer les fichiers » sur la page résultat, route `/audit/generate`, réutilise le module `packages/cli/src/generate`). Voir §0.

58. **[Web] Visualisation du graphe d'entités JSON-LD** `H/M/✅`. Le serveur **construit déjà** `entityGraph` à chaque audit (runner.ts) mais ne l'affiche pas — seul le CLI l'exporte (`--entity-graph` json/dot/mermaid). Rendre le graphe en **mermaid/SVG** dans le rapport web (nœuds = entités, arêtes = refs) : très **visuel** et différenciant GEO, coût quasi nul (données déjà présentes, renderer mermaid réutilisable de `report/entity-graph.ts`). **Meilleur candidat web post-LOT-2.** Effort : **moyen**.

59. **[Web] Diff « apporte ta baseline » (historique sans compte)** `H/M/✅`. Laisser l'utilisateur **déposer un rapport JSON précédent** (upload/collage) et afficher le **diff** (score global/par-famille, checks régressés/améliorés) via `report/diff.ts` **déjà écrit** (utilisé par le CLI `--baseline`). Amène la valeur de l'historique (#10) au web **sans persistance ni comptes** (respecte le design stateless/privacy). Bornes : taille d'upload, schéma JSON validé (garde `AuditReport`). Effort : **moyen**.

60. **[Web] Sélecteur de profondeur de crawl borné** `M/S/✅`. Exposer un `max-pages` **plafonné** (1→N, ex. N≤10) dans le formulaire au lieu de la valeur fixe, pour laisser l'utilisateur choisir un audit rapide (1 page) vs complet, sans ouvrir la porte à l'abus (borne dure côté serveur). Petit gain UX. Effort : **petit**. Priorité : **basse**. *(Téléchargement SARIF sur le web = envisageable mais niche, le public CI utilise le CLI → non priorisé.)*

### Soumission aux moteurs (retour user, 2026-07-24)

> **Roster de bots — état vérifié (`packages/cli/src/robots.ts`)** : couverture des majors OK, notée **par intention** (citation=FAIL, entraînement=WARN). Google IA = `Google-Extended` (+ AI Overviews via `Googlebot`) ; OpenAI = `GPTBot`+`OAI-SearchBot`+`ChatGPT-User` ; Bing/Copilot = `Bingbot`. Manquent des récents (`GoogleOther`, `Google-CloudVertexBot`, `Diffbot`, `YouBot`, `Timpibot`…) → **c'est le backlog #13** (élargir à 27+ en gardant le tiering). Monter #13 en priorité après LOT 1/2.

61. **[Remédiation/Soumission] Soumettre les URLs auditées aux moteurs — `--submit` / bouton web** `H/M/✅ (opt-in key)`. Aujourd'hui on a `--indexnow-key` + le check `indexnow`, mais il **vérifie seulement** que le fichier-clé est hébergé (`sitemap.ts:85-94`) — il ne **soumet pas**. Ajouter une action **opt-in** qui, avec la clé IndexNow de l'utilisateur, POST les URLs découvertes vers `api.indexnow.org` → notifie **Bing, Yandex, Seznam, Naver** (moteurs IndexNow). S'enchaîne après #55 (générer robots/sitemap → proposer de soumettre). **Google** : hors IndexNow + ping sitemap déprécié (2023) → *guidance* « soumets via Search Console » (auth GSC = bring-your-own-credentials, plus lourd, pas automatisable sans compte). **⚠️ GARDE-FOU** : action à effet de bord au nom de l'utilisateur → **opt-in, key-gated, consentement explicite, sites contrôlés par l'utilisateur uniquement** (la clé IndexNow hébergée sur le site prouve la propriété = garde-fou naturel contre la soumission de sites tiers). Effort : **moyen**. Valeur : **haute** (transforme l'audit en boucle « détecter → générer → soumettre »).

## 12. Backlog « dépasser les solutions existantes » (dérivé de l'analyse §3/§6/§7 + retours user)

> **MàJ 2026-07-24 — lot « meilleures features » livré** (branche `feat/backlog-best-features`, tests verts : 655 CLI + 127 web). FAIT dans ce lot :
> - **#9 admin + stats** (§12.A) — store JSONL zéro-dép (`apps/web/lib/store.mjs`, IP hashées, rotation) + dashboard local `admin.local.mjs` (127.0.0.1:3022, tunnel SSH, zéro auth). **PRIVÉ / hors git** (`.gitignore`), déployé main sur le VPS.
> - **#36 web** — comparaison concurrentielle **async** ré-introduite sur le pattern jobs/SSE (`/compare/start` → `/compare/stream` → `/compare/result`), corrige le timeout qui avait fait reverter la v1 synchrone.
> - **#10/#18 (v1 monitoring)** — CLI `--baseline <audit.json>` + `--fail-on-regression [--regression-tolerance n]` : diff score global/par-famille + checks régressés/améliorés (terminal + section « Change vs baseline » md/html), exit 1 en CI. Historique par domaine visible dans l'admin (privé). Schéma additif `generatedAt`/`toolVersion`. *(Reste : scheduler/alertes, courbe web publique — hors scope v1.)*
> - **#14 (amorce)** — nouvelle check `entity-graph-connectivity` (famille structured-data) + builder de graphe d'entités JSON-LD `--entity-graph <file>` (json/dot/mermaid). Passe 108 → **109 checks**.
> - **SEO/GEO self-apply** — findable dogfoode ses propres conseils : `/robots.txt` (+ bots IA), `/sitemap.xml` (hreflang), `/llms.txt`, `/.well-known/security.txt`, landing indexable avec canonical + OG + JSON-LD @graph connexe, `Permissions-Policy`. Auto-audit : **78 C → 80 B**, notre propre check `entity-graph-connectivity` passe sur nous.

### A. Admin & statistiques (retour user, 2026-07-21)
- **#9 Espace admin sécurisé + statistiques d'usage.** ✅ **FAIT (2026-07-24)** — voir l'encart ci-dessus. Dashboard **protégé (auth)** montrant : nb d'audits, IPs uniques, **domaines les plus audités**, distribution des scores/notes A–F, taux d'erreur/timeout, couverture CWV, langues FR/EN, tendance dans le temps. ⚠️ L'app web est **stateless / en mémoire** (job store + cache meurent au restart) → nécessite un **store persistant** : fichier JSON append-only ou **SQLite via `node:sqlite`** (zéro-dép, Node ≥22). **Sécurité** : auth (token/mot de passe hashé), HTTPS, idéalement **IP-restreint ou Cloudflare Access** ; ne jamais logger d'URL/données sensibles au-delà du nécessaire. Lié à #8 (durcissement). **⚠️ PRIVÉ — HORS REPO GIT** : le code de l'admin ne doit **jamais** être committé (dépôt public de candidature) ; il vit **uniquement sur le VPS** (findable.bordebat.fr), déployé/maintenu à la main — via un module séparé chargé conditionnellement + chemin **ignoré par `.gitignore`** (ex. `apps/web/admin.local.mjs` ou dossier `apps/web/private/`), et le store de stats reste local au VPS.

### B. Parité à combler (là où les concurrents nous battent, cf. §6)
- **#13 Élargir la couverture des bots IA à 27+ avec tiers (citation / entraînement / user) + découverte `.well-known/ai.json`, `security.txt`.** ✅ **FAIT (2026-07-24, LOT 3)** — roster porté à **28 agents nommés** (15 entraînement + 13 citation, sévérité par intention conservée) + nouveau check `well-known-ai-json` (112→113). Reste : `security.txt` (non couvert).
- **#11 Auto-remédiation `findable fix` / bouton « appliquer les corrections » (web).** Générer : directives robots.txt pour bots IA, `/llms.txt` d'amorce, stubs JSON-LD (Organization/Breadcrumb/FAQ…), en-têtes sécurité manquants. **Parité avec `geo fix --apply`** ; complète la boucle audit→correction (aujourd'hui : recos + skills Claude Code seulement).
- **#12 CI-native : GitHub Action + sortie SARIF/JUnit + badge de score** (« findable: B » pour READMEs/CI). Parité geo-optimizer (Action+SARIF) ; **le badge est un levier d'adoption** (comme les badges de build/coverage).
- **#16 Fallback CWV local/headless pour la CLI** (sans clé PSI) : CWV labo en vrai navigateur (à la sitespeed/SEOmator) pour les utilisateurs CLI sans `PSI_KEY`.

### C. Nouveaux différenciateurs (aller au-delà de TOUS)
- **#10 Historique & tendance des audits — LE plus gros différenciateur.** ✅ **v1 FAIT (2026-07-24)** : historique par domaine dans l'admin + diff CLI `--baseline`; reste courbe web publique + alertes/cron. Stocker les audits passés par domaine ; afficher « score C→B depuis le dernier audit », régressions par check, courbe dans le temps. **Aucun auditeur OSS ne le fait** → amène la valeur du *monitoring* du côté *audit* sans devenir un answer-monitor. Socle pour : **re-audits programmés (cron) + alertes de régression (email/webhook)**. (Réutilise le store persistant de #9.)
- **#14 Famille de checks « agentic browsing » de nouvelle génération** : présence **WebMCP**, **arbre d'accessibilité comme modèle-donnée machine**, **résistance à l'injection de prompt**, **RAG-chunk readiness**. Lighthouse 13.3 et geo-optimizer les amorcent → on peut en faire une **famille complète** et devenir la référence GEO côté agents.
- **#17 Mode comparaison / benchmark** : auditer N URLs (le tien vs concurrents) côte à côte, écart par famille + par score.
- **#18 Estimation d'effort par correction** (quick-win vs gros chantier) dans le plan d'action → plan **plus intelligent** que les listes plates des concurrents (le champ `effort` avait été différé en Phase 1).

### D. Croissance / adoption (notre vraie faiblesse honnête, cf. §6)
- **#15 API publique read-only + publication npm + page « findable vs alternatives » + doc.** Formaliser `/audit.json` (clés d'API + rate-limit + doc OpenAPI) ; **publier le paquet sur npm** ; page de comparaison sur le site (reprendre §3/§4) ; soigner la démo live. C'est le manque #1 vs geo-optimizer/SEOmator (traction non prouvée).

### E. Issus de la comparaison avec `dageno-agents/seo-geo-audit` (§3.5, ajoutés 2026-07-27)

- **#62 [Adoption] Rendre le plugin réellement installable et visible** `H/S/✅`. Le concurrent a pris **164 ★ en 6 commits** sans livrer une ligne de code : un `SKILL.md` + un manifeste d'agent, installables en un geste. Côté packaging nous sommes **mieux lotis qu'il n'y paraît** — `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` et trois skills bien cadrées (`geo-audit`, `geo-implement`, `fix-technical-seo`) existent déjà. Deux blocages, dont un bloquant sec : **(a)** ~~les trois skills lancent `npx findable-audit`, qui répond 404 tant que le paquet n'est pas publié~~ ✅ **levé le 2026-07-27** par la publication de `findable-audit@0.2.0` — le plugin fonctionne désormais hors dépôt ; **(b) il n'est annoncé nulle part** — ni dans la description GitHub, ni sur la landing, ni dans les topics. Tranche concrète : publier npm, puis rendre le plugin visible (landing + README + description) et vérifier le parcours d'installation de bout en bout depuis une machine vierge. **Meilleur rapport traction/effort du backlog**, zéro ligne de moteur. Lié à #15.
- **#63 [Honnêteté/rapport] Étiqueter chaque constat : mesuré · heuristique · non vérifié** `H/M/✅`. Le concurrent affiche `Observed` / `Assessment` / `Not verified` ; nous appliquons la même frontière **en interne** (les checks de mise en forme du contenu sont *warn max, jamais fail*, cf. `CLAUDE.md` § garde-fous) sans jamais la montrer au lecteur. Or elle est notre argument : un `hsts` est **mesuré**, un `hedging-rate` est **heuristique**. Marquer chaque check d'un `evidence: 'measured' | 'heuristic'` (dérivable de la politique de verdict déjà décidée par check) et le rendre dans le rapport + le JSON. Effet de bord utile : rend impossible de vendre une heuristique pour une mesure. Effort : moyen (120 checks à qualifier, mais mécaniquement à partir de leur politique de verdict).
- **#64 [Rapport] Résumé direction (« une page pour qui décide »)** `M/M/✅`. Eux ont trois formats par audience (Boss / Operator / Specialist). Notre refonte en trois couches couvre l'opérateur et le spécialiste ; il manque **l'écran unique** : note, phrase de verdict, trois axes, les trois actions à plus fort gain, le coût estimé. Réutilise `report/axes.ts`, `report/verdict.ts`, `report/effort.ts` — tout existe déjà. Sortie possible : `--report resume.md` ou un onglet du rapport HTML.
- **#65 [GEO] Présence hors-site, bornée et étiquetée** `M/L/🔑`. Leur cinquième couche (LinkedIn, Reddit, YouTube, Wikipedia/Wikidata, GitHub, Product Hunt, Crunchbase, presse, podcasts) est un vrai angle mort chez nous — la §13 déclare l'autorité web-scale hors-scope, ce qui reste juste, mais **vérifier que les profils déclarés existent** ne l'est pas. À construire **en extension de la boucle `sameAs` réelle** (LOT 6+ de `docs/backlog-geo-avance.md`) : résoudre les URL `sameAs` déclarées, vérifier le lien retour, et **ne jamais inventer** une présence non déclarée. Tout constat non fetché sort en **`non vérifié`** (#63). Sans cette discipline, c'est exactement le genre de couche qui fait mentir un audit.
- **#66 [UX] Presets de profondeur nommés** `L/S/✅`. Ils vendent `m=1 / 20 / 50 / 100` comme des intentions (*fast check*, *template audit*, *full site*, *deep investigation*). Nous avons `--max-pages` (illimité en CLI) et, depuis #60, trois choix sur le web. Nommer les paliers dans l'aide CLI et sur le site coûte trois lignes et rend le réglage compréhensible sans le documenter.
- **#67 [Portée] Troisième langue de rapport (ZH ?)** `M/XL/✅`. Ils publient EN + ZH, y compris un template exécutif chinois. Notre architecture i18n est prête (catalogue par check, `message-i18n.ts`, test qui interdit un gabarit non traduit) — mais une langue de plus, c'est **120 checks × (why + fix + gabarits de message)**, soit le chantier du Lot E refait. À ne lancer que sur une demande réelle, pas par symétrie concurrentielle.

### F. Suivi de positionnement « où je sors sur cette requête ? » — étudié le 2026-07-27, **non lancé**

> Demande utilisateur : *un client demande « si je tape plombier à Rennes, comment je me positionne, sur Google, Bing, et dans ChatGPT / Gemini / Claude ? »*. Reconnaissance faite, **aucune ligne de code écrite**, cadrage arrêté volontairement. Ce qui suit existe pour ne pas repayer l'enquête si la question revient.

- **#68 [Périmètre] Positions SERP + part de voix dans les réponses IA** `H/L/💰🔑`. Quatre constats qui décident du sujet :
  1. **Il n'y a plus de porte officielle gratuite côté moteurs.** La doc de la **Bing Web Search API est archivée** (`is_retired: true`, dernière mise à jour **2025-08-11**, canonique déplacée sous `/previous-versions/`), et ses conditions d'usage limitaient déjà l'API aux résultats d'une recherche déclenchée par un utilisateur — ce qui excluait le suivi de positions. Côté Google, l'API Custom Search ne rend pas la vraie SERP (ni pack local, ni AI Overview). Une position réelle passe donc par un **fournisseur SERP tiers payant** : dépendance externe et coût par requête, dans un outil dont l'argument est « sans clé, sans fuite, auto-hébergeable ».
  2. **La Search Console API est la seule source gratuite et officielle qui rende une vraie position.** `searchanalytics.query` : dimensions `query / page / country / device / searchAppearance / date / hour`, métriques `clicks / impressions / ctr / position`, `rowLimit` jusqu'à 25 000. Limites structurelles : uniquement pour un site **possédé et vérifié** par le client (OAuth), rien sur les concurrents, et aucune donnée sur les requêtes où il ne sort pas du tout — « aucune donnée » ne se distingue pas de « personne ne cherche ça ». *À vérifier avant tout chantier* : le billet `developers.google.com/search/blog/2026/06/gen-ai-performance-reports` annonce des rapports de performance pour les surfaces génératives, mais la référence de l'API n'énumère **aucune** valeur `searchAppearance` pour AI Overviews / AI Mode — il faut interroger l'API groupée par `searchAppearance` pour savoir ce qui est réellement exposé.
  3. **« Où je sors » n'existe pas dans les assistants IA.** Une réponse n'a pas de position 3. Ce qui se mesure est un **taux de mention et de citation sur N tirages de M formulations**, plus *qui est cité à ta place*. Les API officielles s'y prêtent (outil de recherche web d'Anthropic, qui rend les citations ; grounding Google Search de Gemini ; Perplexity), mais elles ne sont **pas** chatgpt.com / claude.ai : un rapport honnête doit écrire la différence, sinon il vend une mesure là où il n'y a qu'un échantillon — précisément ce qu'interdit le § *Honesty guard-rails* de `CLAUDE.md` (vendre la probabilité d'une citation, jamais une garantie).
  4. **« plombier à Rennes » est une requête locale, donc une grille, pas un nombre.** Le pack local dépend de la position GPS de celui qui cherche, pas du nom de ville dans la requête. Une « position » unique y serait fausse par construction.

- **C'est une décision produit préalable, pas un lot de plus.** Le §2 (auditer l'entrée vs monitorer la sortie) et le §7 P2 (« ne PAS devenir un monitor SaaS ») posent le monitoring de sortie comme **hors périmètre délibéré**, et le §6 le liste comme écart n°1 assumé. Y aller change l'identité du produit : ça se décide, ça ne se glisse pas.

- **Forme retenue si le sujet repart** (seul arbitrage tranché le 2026-07-27) : **diagnostic ponctuel, pas de tracker** — une commande, un rapport, zéro stockage serveur ; l'évolution passe par le JSON produit et réutilisé comme `--baseline`, avec `report/diff.ts` déjà écrit (même patron que #59, et cohérent avec le « rien n'est conservé » de la landing). **Le choix des sources à brancher n'a pas été tranché.**

### G. Dettes de calibration relevées en auditant de vrais sites (2026-07-27)

Deux constats sortis du dogfooding sur pb-ot.fr, masse-motoculture et findable.bordebat.fr.
Aucun n'est un bug : ce sont des réglages qui ne tiennent pas leur promesse, et ils ne se
corrigent pas à l'intuition — il faut mesurer sur plusieurs sites avant de bouger un seuil.

- **#69 [Cohérence] Deux checks `heuristic` peuvent `fail`.** `extractable-structure` et
  `outbound-citations` sont déclarés `evidence: 'heuristic'` et font pourtant échouer un
  audit — vérifié sur pb-ot.fr, qui perd 0/4 et 0/3 dessus. Or `.claude/skills/findable-new-check/SKILL.md`
  est explicite : « If you find yourself wanting `heuristic` **and** `fail`, re-read the
  verdict policy — that combination is what the guard-rails exist to prevent. » Soit ces deux
  checks sont en réalité `measured` (« aucune liste ni tableau » est vérifiable), soit ils
  doivent redescendre à `warn`. ⚠️ Les deux options **déplacent la note de tous les
  utilisateurs**, donc mineure et décision explicite — pas un correctif silencieux.
- **#71 [Honnêteté/scoring] `llms-txt` pèse 10 points et se déclare `measured`.** Balayage de
  12 sites réels le 2026-07-27 : `llms-txt` échoue sur **10 sites sur 12**, `llms-full-txt`
  sur 11. Ensemble ils valent **14 des 87 points** de `llm-content`, la famille la plus lourde
  (0,18). Or `CLAUDE.md` ligne 109 dit : « `llms.txt` is documented in the guide as a *signal
  of unproven value*. Keep it that way. » — et le §7 P0 de ce document exigeait un **poids
  faible**. Pire, `evidence: 'measured'` affirme que le bon état est défini **hors** du projet
  (RFC, W3C, WCAG, schema.org, un seuil publié par Google) : c'est faux pour une convention
  que Google déclare sans effet sur le classement. En l'état, le check le plus lourd de
  l'outil impose une convention que sa propre doc qualifie de non prouvée, et présente ce
  jugement comme une mesure. Deux corrections possibles : basculer en `heuristic` + `warn` max
  et redescendre le poids, ou assumer et retirer la mention « valeur non prouvée » du guide —
  mais pas les deux en même temps.
- **#72 [Scoring] « Pas de JSON-LD » est compté quatre fois.** `json-ld` (10), `json-ld-entity`
  (6), `json-ld-valid` (4) et `sd-organization` (4) échouent ensemble dès qu'un site n'a aucun
  balisage — **24 des 88 points** de `structured-data` pour une seule cause racine. Observé sur
  9 à 11 sites du balayage. Un défaut unique ne devrait pas coûter quatre fois ; les trois
  checks dérivés devraient `skip` quand `json-ld` a déjà constaté l'absence, comme n'importe
  quelle précondition manquante ailleurs dans l'outil.
- **#70 [Calibration] `internal-link-context` ne discrimine presque rien.** Son plancher est
  à **10 %** de liens internes en contenu principal (`MIN_CONTEXTUAL_SHARE = 0.1`). Le
  commentaire du code assume ce choix — une navigation répétée sur N pages écrase
  numériquement les liens rédactionnels sur *n'importe quel* site — mais la conséquence est
  qu'un site dont 90 % des liens sont du gabarit passe quand même. En pratique le check ne
  signale que les graphes sans aucun maillage rédactionnel : 3 points que presque tout le
  monde empoche. À remesurer sur une dizaine de sites réels avant de relever le plancher.

**Note stratégie** : la victoire durable n'est pas « plus de checks » (SEOmator a 251 règles) mais **la combinaison + trois angles que personne ne couvre ensemble** : (1) **historique/tendance** (#10) qui rapproche audit et monitoring, (2) **auto-remédiation** (#11) qui ferme la boucle, (3) **checks agentic/RAG** (#14) qui prennent de l'avance sur la prochaine vague GEO — le tout **gratuit, OSS, auto-hébergeable, sans fuite de données**.


## 13. Gap analysis par dimension d’audit (net-new backlog, 2026-07-21)

> **MàJ 2026-07-27 — dix items de ce §13 sont livrés, en quatre grappes parallèles.**
> #22 → `http-protocol`, `tls-version`, `cdn-edge-cache` · #24 → `rich-result-eligibility` ·
> #26 et #51 **fusionnés** → `outbound-link-health` (opt-in `--check-outbound`, seuls 404/410
> comptent) · #30 → `topical-focus` · #31 → `keyword-cannibalization` · #33 → `sd-page-entity` ·
> #48 → `anchor-target-profile` · #49 → `internal-link-context` · #50 → `internal-equity-leaks`.
> **126 → 137 checks.** HTTP/3 est explicitement **hors d'atteinte** : `Alt-Svc: h3` est une
> annonce, pas un protocole négocié, et Node 20/22 n'embarque pas de client QUIC — c'est
> rapporté, jamais noté.
>
> Deux notes de ce §13 étaient périmées et sont corrigées : `rel` **est** lu depuis le LOT 5
> (`geo-retrieval.ts`, pour `ugc`/`nofollow`/`sponsored`), et la boîte de recherche de liens
> annexes de #24 n'existe plus — Google a retiré la fonctionnalité et sa documentation le
> 29 novembre 2024, donc aucune règle n'a été encodée pour elle plutôt qu'inventée.

Analyse en éventail (1 agent expert / dimension, ancré sur les 107 checks réels) : *qu’est-ce qu’on ne fait pas, et qu’est-ce qui aurait une forte valeur ?* Tags : **valeur** (H/M/L) · **effort** (S/M/L/XL) · **faisabilité** (✅ au crawl seul · 🔑 opt-in avec clé fournie par l’utilisateur, comme `PSI_KEY` pour les CWV · 💰 index payant · ⛔ hors-scope). L’honnêteté de scope est un livrable : l’autorité de backlinks web-scale (classe Ahrefs/Majestic) reste **hors-scope** pour un outil on-site zéro-dép.

> **⭐ Priorités transverses (les vrais différenciateurs GEO) :** (a) **parité de contenu CSR/SPA — « ce que GPTBot voit vraiment »** (les crawlers IA n’exécutent pas le JS) ; (b) **parité de service aux bots IA / cloaking** (fetch en GPTBot vs navigateur, diff) ; (c) **⭐⭐ outil de positionnement concurrentiel** = scorecard tête-à-tête N URLs + **part de voix dans les réponses IA** (GPT/Claude/Perplexity te citent-ils ?) ; (d) **carte d’équité de liens internes** (PageRank interne, pages orphelines, fuites d’équité) — quasi aucun outil gratuit ne le fait.

### Technique
- **#19 Raw-HTML content-parity gap & client-side-rendering (CSR/SPA) detection — 'what GPTBot actually sees'** `H/M/✅ crawl`. Per sampled page, without executing JS (the tool never does): (a) fingerprint app-shell + framework markers — empty mount roots (<div id="root">, id="__next", id="app", <app-root>, [data-reactroot], Angular ng-version) and hydration/state b…
- **#20 AI-bot serving parity & cloaking detection (Vary / dynamic-serving diff)** `H/M/✅ crawl`. Reuse the existing configurable-UA fetch plumbing to fetch the homepage (and 1-2 sampled pages) three ways — default UA, a mobile UA, and a real AI-crawler UA (e.g. GPTBot / ClaudeBot) — then diff the responses: HTTP status, byte length, <t… *(cf. complements #13 (AI-bot roster) — that tests robots.txt poli…)*
- **#21 Non-JS crawl-path integrity: JS-only internal links & navigation** `H/S/✅ crawl`. Scan sampled pages for navigation a non-JS crawler cannot follow: <a> with no href (or href='#' / href='javascript:'), div/span used as nav via onclick or role='button', framework router-link custom elements without a real href, and content… *(cf. extends internal-linking / broken-internal-links; complement…)*
- **#22 Modern transport & delivery: HTTP/2, HTTP/3, TLS version, CDN & cache-efficiency fingerprint** `M/M/✅ crawl`. Because undici's fetch is HTTP/1.1 and hides the negotiated protocol, add one extra zero-dep probe using Node's built-in http2/tls: open an ALPN connection to the origin to detect HTTP/2 (h2 vs http/1.1) and capture the negotiated TLS versi… *(cf. extends the performance family (asset-caching, text-compress…)*
- **#23 Crawl-budget & directive-conflict hygiene (robots × sitemap × canonical × noindex × params)** `M/M/✅ crawl`. Aggregate cross-signal conflicts the tool computes the inputs for but never correlates: (a) XML-sitemap URLs that are Disallowed in robots.txt (Google can never read their noindex → contradictory indexing signals); (b) sitemap URLs that are… *(cf. extends technical-seo (sitemap-orphans, sitemap-urls-valid…)*
- **#24 Google rich-result eligibility layer (beyond schema.org structural validity)** `M/L/✅ crawl`. Overlay Google's feature-specific REQUIRED-vs-RECOMMENDED field rules on top of the existing JSON-LD structural validation, per detected type: Article, Product/merchant-listing, Recipe, Event, Breadcrumb, Video, Review-snippet, sitelinks se… *(cf. extends the structured-data family (json-ld-valid, sd-articl…)*

### Fonctionnel
- **#25 Crawlable navigation check (JS-independent link reachability)** `H/S/✅ crawl`. Pure static-HTML analysis (zero extra fetches) on the already-fetched pages: (a) in the <nav>/<header> landmark and on the homepage, count REAL crawlable <a href> links vs. non-crawlable navigation controls — <button>, <div/span onclick>, <… *(cf. #14 (agentic browsing family) — adds a no-JS-navigation reac…)*
- **#26 Broken outbound / external links (dead-citation & reference liveness)** `H/M/✅ crawl`. Extend link-liveness from same-origin to a BOUNDED, deduped-by-host sample of CROSS-ORIGIN <a href> targets (prioritising links inside main content, i.e. the citations outbound-citations already extracts). Probe each with a HEAD (ranged-GET… *(cf. extends outbound-citations (llm-content, presence-only) and…)*
- **#27 Broken subresources (images / scripts / stylesheets that 404)** `H/M/✅ crawl`. Across the sampled pages, collect referenced subresources — <img src> / <source srcset>, <script src>, <link rel=stylesheet href> — dedupe, cap (~20-30, same-origin first), and fetch (HEAD / ranged GET, reusing the per-run cache) to flag an…
- **#28 Soft-error 200 detection on real sampled pages** `M/S/✅ crawl`. Beyond the existing single synthetic soft-404 probe, scan the pages ACTUALLY sampled during the crawl for 200-status responses whose body is an error/empty shell: recognisable error markers in <title>/<h1> ('Page not found', '404', 'Error'… *(cf. extends soft-404 (technical-seo))*
- **#29 Form & interactive-endpoint sanity (contact / search / newsletter)** `M/M/✅ crawl`. Structurally validate every <form> on the sampled pages: it has a non-empty action (not '#', empty, or javascript:), a method, and at least one submit control; for SAME-ORIGIN GET forms, verify the action URL resolves (200, not 404) using t… *(cf. extends about-contact (llm-content) and sd-website-searchact…)*

### Sémantique
- **#30 Topical focus — does the body deliver on the title's promise (keyword-in-content alignment)** `H/M/✅ crawl`. MP check reusing tokenize() + mainContent(). Build the page's declared-topic token set from <title> (minus the brand suffix already split by title-pattern), <h1>, and meta description; then measure how well the main-content prose reinforces…
- **#31 Keyword cannibalization — distinct pages competing for the same intent across the crawl** `H/M/✅ crawl`. MP (needs >=2 pages), extends the existing content-uniqueness shingle/Jaccard infrastructure. content-uniqueness only flags near-DUPLICATES (body Jaccard >=0.8). This adds the softer 'twin band': pages whose <title>/<h1> token sets are near…
- **#32 RAG chunkability — can an AI cite a self-contained passage from this page** `H/L/✅ crawl`. MP. Segment each page's main content into sections by heading boundaries (headingOutline + mainContent) and score retrieval-readiness on three axes: (1) SECTION SIZE — flag 'monolithic' pages that have substantial content but zero H2/H3 (on… *(cf. #14)*
- **#33 Page-level entity clarity — schema `about` / `mentions` grounding** `M/M/✅ crawl`. Homepage + article/content pages. Reuse flatten()/typesOf()/sameAsList(). Check whether Article/WebPage/CreativeWork nodes declare the page's PRIMARY entity via schema `about` (and secondary entities via `mentions`), and whether those entit…
- **#34 Self-answering content — question titles/headings that actually answer, plus definitions** `M/M/✅ crawl`. MP. Two net-new answer-engine signals beyond the existing content-lead-answer/answer-headings. (1) SELF-ANSWERING TITLE: when <title>/<h1> is itself a question (or matches the answer-heading pattern), require a concise direct answer (~40-32…
- **#35 Optional-LLM extraction preview — what ChatGPT/Claude would actually take from the page** `H/L/🔑 opt-in`. OPT-IN, following the exact --cwv/--psi-key pattern: a --llm flag + user-provided key/endpoint (any OpenAI-compatible or Anthropic endpoint), one bounded call per run on the homepage plus one article. Send the extracted main-content chunk a…

### Concurrentiel
- **#36 Head-to-head competitive scorecard (you vs supplied competitors)** `H/M/✅ crawl`. New --compare <url1,url2,...> mode (web app: 'add a competitor', capped at 1-2 URLs for rate-limit; CLI unlimited). Reuse runAudit per URL — it already returns AuditReport{familyScores, per-check results[]} — then render three deterministic… *(cf. #17 (compare/benchmark mode across N URLs) — #17 is the raw…)*
- **#37 Schema & rich-result coverage gap matrix** `H/M/✅ crawl`. Run the existing JSON-LD parser (checks/jsonld.ts, structured-data*.ts) across you + peers and build a coverage matrix of (a) deployed schema.org @types and (b) rich-result-eligible features: FAQPage, Product offers (price/currency/availabi…
- **#38 Topic & entity coverage gap (honest on-site 'content gap')** `H/M/🔑 opt-in`. From the existing main-content extractor (checks/llm-content.ts, strips nav/header/footer) build a salient-term/entity profile per site: TF over cleaned main text (stopwords + min-length), heading terms (H1-H3), and JSON-LD entity @name/abo…
- **#39 AI share-of-answer probe (bring-your-own answer-engine key)** `H/L/🔑 opt-in`. Opt-in external capability that follows the PSI template but for an LLM/answer-engine key. Generate a small set of topic questions from the site's own entities/headings (reusing the topic-gap extraction), send each to the model, then parse…
- **#40 AI-access competitive posture (robots / llms.txt / ai.json across peers)** `M/S/✅ crawl`. For you + each peer, fetch robots.txt + llms.txt/llms-full.txt + /.well-known/ai.json and compare, reusing the existing ai-access checks and the TRAINING_BOTS/CITATION_BOTS roster: (a) which AI bots each site allows vs blocks (GPTBot, Claud… *(cf. #13 (widen AI-bot coverage to 27+ tiered + .well-known/ai.js…)*

### Off-site
- **#41 Verify sameAs profiles are live and reciprocal (not just present)** `H/M/✅ crawl`. Today sd-entity-grounding only string-matches the sameAs URLs in Organization JSON-LD (regex for a Wikipedia/Wikidata anchor) and never fetches them, so a dead LinkedIn page, a typo'd Crunchbase URL, or a profile that does not link back all… *(cf. #13)*
- **#42 Wikidata / Wikipedia entity-presence lookup (free open data, opt-in)** `H/M/✅ crawl`. An opt-in check (flag such as --entity-graph, NO API key needed — Wikidata's public API is free and keyless) that takes the Organization/Person name plus the audited domain and queries Wikidata (wbsearchentities, then the candidate entity's… *(cf. #13)*
- **#43 AI knowledge probe: what does an LLM actually know about you (optional key)** `H/M/🔑 opt-in`. The closest legitimate proxy for 'presence in AI answers'. With a user-provided LLM endpoint + key (same optional-capability ethos as PSI for CWV), send one structured prompt asking the model to describe the entity/domain and list specific…
- **#44 CommonCrawl open-corpus inclusion signal (free, opt-in)** `M/M/✅ crawl`. Opt-in check (flag, no key) that queries CommonCrawl's free CDX index API for the audited domain to answer: does the open web corpus that trains and grounds many LLMs actually contain this site, and how much of it? Report the number of capt…
- **#45 Grade outbound-citation authority (extend outbound-citations)** `M/S/✅ crawl`. outbound-citations today only asserts that at least one external non-social link exists in main content. Extend it to grade WHO you cite: classify outbound links by target-authority class — knowledge/reference (Wikipedia, .gov, .edu, DOI/Pu…
- **#46 Off-site link authority and local-citation consistency: the honest boundary** `L/S/💰 payant`. The genuinely off-site signals users will ask for — referring-domain count and backlink authority (Ahrefs/Majestic/Moz-class), Domain Rating, and third-party local-citation NAP consistency across directories (Google Business Profile, Yelp…

### Netlinking
- **#47 Internal link-equity map: in-degree distribution + sample-scoped PageRank** `H/M/✅ crawl`. Reuse the adjacency already built by buildLinkGraph (zero new crawl cost). Compute two things over the sample: (1) IN-DEGREE per discovered internal URL — how many sampled pages link to each target. Note that outLink targets already include…
- **#48 Anchor-text-to-target profile: relevance alignment + diversity per internal target** `H/M/✅ crawl`. Go beyond today's single global 'generic %'. Build, per internal target URL, the multiset of anchor texts pointing at it across the sample. Then check: (1) RELEVANCE ALIGNMENT — does the dominant anchor share meaningful (non-brand, non-stop…
- **#49 Contextual vs boilerplate internal-link classification** `M/M/✅ crawl`. The link graph currently counts every <a href> equally, including sitewide nav/header/footer. Reuse the existing main-content extractor (mainContent(), which already strips nav/header/footer/aside) to classify each internal link as CONTEXTU…
- **#50 Internal equity-leak audit: rel=nofollow + links into noindex/redirect/404 dead-ends** `M/S/✅ crawl`. rel is currently read NOWHERE in the codebase. Add a scan of internal <a> for (1) rel containing nofollow (and misapplied sponsored/ugc on internal links) — internal nofollow blocks equity flow and is almost always an accidental config or s…
- **#51 Outbound external link hygiene: broken external links + rel (sponsored/ugc)** `H/M/✅ crawl`. broken-internal-links is internal-only; external outbound links are never health-checked and outbound-citations ignores rel. Add: (1) BROKEN EXTERNAL — take the external links found in main content (outbound-citations already enumerates the…
- **#52 External authority the honest way: Common Crawl presence + Open PageRank proxy + GSC guidance** `M/M/🔑 opt-in`. Directly answer the backlink scope question instead of faking it. THREE layers: (1) HONEST BOUNDARY — state in the report that a true referring-domains/backlink profile needs an Ahrefs/Majestic-class index, and that even a 'free CommonCrawl…

**Note** : items 🔑 (clé LLM/answer-engine fournie par l’utilisateur) suivent le patron opt-in des CWV/PSI — jamais requis, jamais de clé embarquée. Recoupements assumés entre dimensions (ex. liens sortants cassés en *Fonctionnel* & *Netlinking* ; sonde de connaissance IA en *Concurrentiel* & *Off-site*) : à fusionner au moment de l’implémentation.
