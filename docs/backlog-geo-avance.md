# Backlog « GEO avancé » — idées R&D (juillet 2026)

Source : `docs/research/2026-07-24-geo-avant-garde.md` (idéation) + `docs/research/2026-07-25-deep-research-citations-verifiee.md` (claims vérifiés 3-0/2-0).
Grille d'organisation : **retrieval → selection → generation** (taxonomie AgentGEO, arXiv 2603.09296, confirmée 2-0).

## Quick wins — section « GEO avancé » ✅ livrés (constaté dans le code le 2026-07-31)

| # | Idée | Principe | Étape | Livré comme |
|---|------|----------|-------|-------------|
| QW1 | 🕐 **Cohérence tripartite de fraîcheur** | `Last-Modified` HTTP vs `dateModified` JSON-LD vs `lastmod` sitemap : s'ils divergent, le signal de fraîcheur est ignoré (anti « fake freshness ») | retrieval | `freshness-coherence` |
| QW2 | 🖋️ **Taux de hedging** | « peut-être / il semble / selon les cas » dans les leads — les moteurs citent les affirmations nettes | selection | `hedging-rate` (advisory, warn max) |
| QW3 | 🎯 **Citabilité par passage** | « unités de réponse » : affirmation directe + chiffre/date/entité + autosuffisante + < N mots | selection | `answer-units` (advisory, warn max) |
| QW4 | ✂️ **Chunk-boundary hygiene** | tableaux sans en-têtes répétés, réponses FAQ séparées de leur question, listes orphelines de leur titre | generation | `chunk-boundary` (advisory, warn max) |

## LOT 5 — socle chunker partagé ✅ livré (2026-07-26, 117 → 119)

Spec : `docs/superpowers/specs/2026-07-26-lot5-chunker.md`.

| Idée | Livré comme | Note |
|------|-------------|------|
| 🧪 **RAG twin / retrieval-sim** | `chunk-retrieval-sim` (4 pts, llm-content) | chunker ~512 tokens dans `checks/chunker.ts` (pur, sans ctx) ; part des fenêtres qui survivent à l'extraction isolée, ancrage compté sur le fil d'intertitres |
| 🔁 **Self-containment anaphorique** | *fusionné* dans `chunk-retrieval-sim` | comme prévu par ce backlog : le test d'ouverture sans renvoi arrière est la moitié du verdict |
| 🧼 **Injection-hygiene** | `injection-hygiene` (3 pts, llm-content) | texte masqué **en ligne** uniquement (pas de CSS récupéré → pas de faux positif `.sr-only`), échec réservé au texte masqué porteur d'instructions modèle, liens UGC sans `rel="ugc"` |

## LOT 6+ (standards à laisser mûrir / coût réseau)

| Idée | Principe | Pourquoi attendre |
|------|----------|-------------------|
| 🤖 **Agent-usability score** | actions clés faisables sans JS (formulaires, labels, schema.org Actions) | ✅ livré — `agent-usability` (`checks/agentic.ts`) |
| 🔁 **Boucle sameAs réelle** | résoudre Wikidata/Wikipedia, matcher libellés, lien retour | ✅ livré — `sameas-verified` |
| ⚔️ **Cohérence d'entité cross-page** | variance des prix/adresses/claims entre pages échantillonnées | précision d'extraction |
| 📇 **Fact-sheet canonique** | page de faits clés machine-lisibles, datés, sourcés (extension `--emit`) | dépend de QW3 |
| 🕳️ **Negative space** | questions évidentes sans réponse par type de site (prix ? horaires ?) | taxonomie par type |
| 🌡️ **Stabilité temporelle** | re-fetch ×2 + diff du contenu principal | double le coût réseau |
| 🔏 **Provenance C2PA** | contenus signés, signal anti-slop | pari 2027 |
| 🗂️ **Matrice politiques IA** | robots.txt × ai.txt × tdmrep.json × RSL : contradictions | pile pas stabilisée |
| 🛰️ **Affordances agentiques** | tier WebMCP / NLWeb / agents.json sur tout le crawl | standards jeunes |

## Ajouts 2026-08-01 — restitution & vérification d'accès (veille SearXNG + signaux internes)

Source : session automatique du 2026-08-01 (recherches SearXNG : guides llms.txt 2026 — seoscore.tools, airanklab.com, limy.ai, pressonify.ai « 11 AI crawlers » ; checklists d'audit IA — loudpixel.ai). Priorisé par ratio impact/effort. Aucun recouvrement avec les lots ci-dessus (qui portent sur de nouveaux *checks de contenu* ; ici : validation d'artefacts existants + ergonomie de restitution).

| # | Idée | Principe | Impact/Effort |
|---|------|----------|---------------|
| A1 | ✅ 🧾 **Lint d'un llms.txt existant** — livré 2026-08-01 (check `llms-txt-lint`, commit `e94a041`) | on sait *générer* un squelette (`--emit`), mais pas *valider* un llms.txt déjà en place : format (H1 unique, blockquote, sections H2, liens Markdown), liens qui résolvent (pas de 404), cohérence avec le sitemap et le contenu réel. Les guides 2026 en font un standard d'audit à part entière | fort / faible |
| A2 | 🚪 **Accès effectif des crawlers IA** | au-delà de robots.txt (`ai-access`) : requêter le site avec les User-Agents des crawlers IA majeurs (GPTBot, ClaudeBot, PerplexityBot…) et comparer les codes/contenus obtenus, pour détecter les blocages CDN/WAF (Cloudflare & co) invisibles dans robots.txt | fort / moyen |
| A3 | ✅ 🥇 **« Top 3 corrections » en tête de rapport** — livré 2026-08-01 (payoff = points pondérés ÷ effort par famille, terminal + HTML, commit `f8f90f3`) | trier les échecs par points récupérables ÷ effort estimé et les afficher en tête (terminal + HTML) ; différenciant vs les audits « liste plate » | moyen / faible |
| A4 | 📈 **Sparkline de score dans le rapport HTML** — ✅ livré le 2026-08-01 (section « Score dans le temps » : sparklines SVG inline global + par famille dès 2 runs, i18n EN/FR, 15 tests) | `--history` stocke déjà la série ; l'afficher (tendance du score global + par axe) dans le HTML | moyen / faible |
| A5 | 💬 **Commentaire de PR via l'action GitHub** | `action.yml` existe ; publier le diff vs `--baseline` (checks gagnés/perdus, delta de score) en commentaire de PR, comme les outils CI comparables | moyen / moyen |

## Garde-fous (recherche vérifiée)

- Ne jamais promettre « +40 % » (réfuté 0-3) ; l'efficacité varie par domaine (confirmé 3-0).
- La retrouvabilité bat la réécriture stylistique (confirmé 3-0) — les checks amont restent prioritaires.
- Une part des réponses IA se fait sans fetch live ni citation (34 %/24 %, 92 % sans lien pour Gemini) : vendre la *probabilité* de citation, jamais la garantie.

## Ajouts 2026-08-01 — 2e session (hygiène de dépôt + veille SearXNG audit technique)

Sources : signaux internes (fichiers de travail à la racine du dépôt, chantier local non commité `packages/cli/src/report/history.ts` — probable A4 en cours) ; SearXNG local (seomix.fr audit technique, lafabriquedunet.fr alternatives Screaming Frog : sitemaps/canonical/pagination, oplia.fr preuve sociale). Sans doublon avec A1-A5.

| # | Idée | Principe | Impact/Effort |
|---|------|----------|---------------|
| A6 | ✅ 2026-08-02 **Nettoyer la racine du dépôt** | déplacer/ignorer les fichiers de travail (`extract_lantern.js`, `final_quotes.js`, `pull_strings.js`, `quote_windows.js`, `lantern_*.txt`, `audit-prod.json`/`.err`, `findable.bordebat.fr-baseline.json`) vers `examples/` ou `.gitignore` ; dette qui pollue clones et recherches | moyen / faible |
| A7 | 🗺️ **Croisement sitemap.xml vs crawl** | lire `sitemap.xml` (découverte via robots.txt) et comparer aux pages atteintes par liens internes : pages orphelines et pages crawlé-mais-absentes-du-sitemap ; check standard des crawlers type Screaming Frog, borné par `--max-pages` | fort / moyen |
| A8 | ⭐ **Check preuve sociale structurée** | détecter la présence d'avis/notes balisés (`AggregateRating`, `Review` JSON-LD) sur les pages clés des sites locaux ; argument de vente direct pour la prospection PB OpenTech (les fiches + avis convertissent) | moyen / faible |
| A9 | 📌 **Terminer et committer le chantier sparkline (A4)** — ✅ livré le 2026-08-01 (chantier finalisé, 15 tests ajoutés `test/report/history.test.ts`, suite 1335 PASS, commité/poussé) | `history.ts` + modifs `html.ts`/`i18n.ts`/`index.ts` existent en local non commité : finaliser, tester, committer — sinon risque de perte et de dérive avec `origin/main` | fort / faible |

## Ajouts 2026-08-02 (session automatique — signaux internes + veille SearXNG)

Signaux internes : 1573 tests verts (1335 CLI + 238 web) mais les 238 tests web ne tournent jamais en CI (`apps` absent des workspaces racine) ; le catalogue i18n compte **138 checks** alors que README/guides annoncent 137 (`llms-txt-lint` non documenté) ; CHANGELOG figé à 0.10.0 malgré 3 features livrées depuis (e94a041, f8f90f3, 700b14a) ; CLI muet pendant un crawl (callback `onProgress` de `runner.ts:89` utilisé uniquement par le web) et messages de succès émis sur stderr (`index.ts:352,371,388` — d'où le faux `audit-prod.err`). Sources externes : comparatifs GEO 2026 (seranking.com, vegavid.com, webconversion.fr — les suites GEO vendent le suivi multi-moteurs IA + audit sémantique), abondance.com « Query fan-out : 102 000 requêtes analysées », docs.github.com (upload SARIF), github.com/topics/seo-audit (le concurrent CLI de référence affiche « 108 rules across 12 categories » — notre différenciation = 138 checks, à condition que la doc soit exacte). Sans doublon avec A2/A5/A6/A7/A8 ni LOT 6+.

| # | Idée | Principe | Impact/Effort |
|---|------|----------|---------------|
| A10 | ✅ 2026-08-02 **Progression CLI + flux de sortie propres** | brancher `onProgress` (déjà exposé par `runner.ts:89`) sur un affichage « page 3/10 » côté CLI ; basculer les messages de succès sur stdout (ou `--quiet`) et ajouter `--no-color`/respect de `NO_COLOR` — un audit de 15-30 s totalement muet et un stderr non vide en succès sont les deux plus gros irritants d'usage | fort / faible |
| A11 | ✅ 2026-08-02 📦 **Release 0.11.0 + docs des checks exactes** | bump version, section CHANGELOG pour les 3 features post-0.10.0, réaligner 137→138 partout (README ×2, guide.md, guide.fr.md), documenter `llms-txt-lint` dans les deux guides, et ajouter un test qui verrouille « nombre de checks == nombre de sections du guide » (sur le modèle du test des flags) | fort / faible |
| A12 | ✅ 2026-08-02 **CI complète : tests web + build dist** | ajouter `apps` aux workspaces (ou script `test:web` appelé par la CI) pour exécuter les 238 tests web, et garantir un build du `dist` CLI avant le démarrage du serveur web (9 imports de `apps/web/server.mjs` pointent vers `../../packages/cli/dist/`) — aujourd'hui un dist périmé casse le web sans qu'aucun test ne le voie | fort / faible |
| A13 | 🌀 **Check « couverture query fan-out »** | évaluer si une page répond aux sous-questions que les moteurs IA génèrent autour de la requête principale (variantes comparatives, prix, « pour qui », localisation) — l'analyse abondance.com de 102 000 requêtes montre que ChatGPT décompose systématiquement ; complète `answer-units`/`chunk-retrieval-sim` sans les recouvrir | fort / moyen |
| A14 | 🏗️ **Découpage `apps/web/server.mjs` + montée node-html-parser** | 2085 lignes (routage + vues + SSE + admin + OG-image) alors que le pattern d'extraction existe déjà dans `apps/web/lib/` (12 modules) ; planifier la montée `node-html-parser` 6.1.13 → 9.0.1 (dépendance runtime du parsing, 3 majeures de retard) | moyen / moyen |

## Ajouts 2026-08-02 (3e session automatique — recherche d'améliorations)

Signaux internes : A10/A11/A12 livrés aujourd'hui (0.11.0, CI web, CLI progress) ; le CLI ne sait se comparer qu'à son propre passé (`--baseline`/`--history`), jamais à un tiers ; le rapport HTML reste un rapport d'expert, inutilisable tel quel en prospection TPE ; tous les checks sont statiques (aucune mesure du crawl IA réel). Sources externes (SearXNG) : les suites GEO 2026 vendent le benchmark concurrentiel multi-sites (seopital.co, stafe.fr) ; theweblead.fr — l'audit gratuit est l'accroche n°1 en agence ; shine.fr/plateya.fr — le référencement local est le levier décisif des artisans. Sans doublon avec A13/A14 ni LOT 6+ (la « cohérence d'entité cross-page » reste distincte de A18).

| # | Idée | Principe | Impact/Effort |
|---|------|----------|---------------|
| A15 | ⚔️ **Mode benchmark concurrentiel** | `findable-audit compare <url> <concurrent1> [concurrent2]` : même jeu de checks sur chaque site, tableau d'écarts par axe + « ce que le concurrent fait et pas vous » — le comparatif multi-sites est l'argument central des suites GEO 2026, et le runner sait déjà tout faire, il manque l'orchestration et le rendu | fort / moyen |
| A16 | 📄 **Rapport prospect one-page white-label** | flag `--report prospect` : une page HTML imprimable (score, 3 forces, 3 corrections chiffrées en € /jours, zéro jargon, logo personnalisable) — transforme l'outil en machine à leads pour pb-opentech et pour tout indépendant ; l'audit gratuit est l'accroche n°1 de la prospection TPE | fort / faible |
| A17 | 🤖 **Analyse des logs serveur : crawl IA réel** | sous-commande `logs <access.log>` : fréquence et pages visitées par GPTBot/ClaudeBot/PerplexityBot/Google-Extended, croisées avec robots.txt et le sitemap — répond à « les IA me lisent-elles vraiment ? », seule mesure factuelle que les checks statiques ne peuvent pas donner | fort / moyen |
| A18 | 📍 **Checks « profil local » (cible TPE/artisans)** | présence et complétude de `LocalBusiness` (NAP, horaires, `geo`, zone d'intervention, lien `hasMap`/GBP dans `sameAs`) + page contact actionnable sans JS — l'axe décisif pour la clientèle visée, aujourd'hui sous-couvert ; distinct de la variance cross-page du LOT 6+ | moyen / faible |

## Ajouts 2026-08-03 (session automatique — signaux internes + veille SearXNG)

| # | Idée | Principe | Impact/Effort |
|---|------|----------|---------------|
| A19 | ✅ 2026-08-03 (livré : check `ai-crawler-reachability`, 139 checks, tests verts) 🚪 **Vérification d'accès crawlers IA en conditions réelles** | requêtes HTTP effectives sur les pages clés avec les User-Agent GPTBot/ClaudeBot/PerplexityBot/Google-Extended et comparaison des statuts/contenus avec la requête « navigateur » — les WAF/CDN bloquent souvent les bots IA silencieusement alors que robots.txt les autorise ; complète les checks statiques (robots.txt, llms.txt) par la seule preuve empirique, distinct de A17 (qui lit les logs, ici on teste activement) | fort / faible |
| A20 | ✅ 2026-08-03 (livré : `action.yml` composite testée, doc README ; publication npm volontairement exclue en session auto) 📦 **Distribution : paquet npm + GitHub Action officielle** | publier le CLI sur npm et fournir une action `findable-audit-action` prête à l'emploi (audit sur PR, `--baseline` + `--fail-on-regression` déjà en place) — les outils d'audit 2026 gagnent leur adoption dans les pipelines CI (modèle Lighthouse CI) ; l'effort est quasi nul, le moteur existe, il manque l'emballage | moyen / faible |
| A21 | 🗣️ **Couche de recommandations rédigées (LLM local) dans le rapport** | après le scoring factuel, passer les échecs au LLM local pour générer des recommandations priorisées en langage client (quoi, pourquoi, gain estimé), à la manière des audits « AI-grounded » type ai-website-audit-cli — nourrit directement le one-page prospect (A16) sans dénaturer le cœur déterministe ; les métriques restent la source de vérité, le LLM ne fait que rédiger | moyen / moyen |

## Ajouts 2026-08-06 (session automatique — signaux internes + veille SearXNG)

Signaux internes : la comparaison temporelle existe (`--baseline`/`--history`/`--fail-on-regression`) mais reste passive — aucun mode planifié ni alerte ; le CLI lint `llms.txt` (139 checks) mais ne sait pas le produire ; les données d'audit meurent dans leur JSON au lieu de nourrir vigie-seo. Sources externes (SearXNG) : visibletoai.dev (audit « AI readability », couple `llms.txt`/`llms-full.txt`), gen-optima.com et evertune.ai (les plateformes GEO 2026 vendent le monitoring continu avec alertes, pas l'audit ponctuel), geochecker.com.tr (concurrent gratuit GEO Checker : positionnement mono-scan, notre différenciation = suivi). Sans doublon avec A1-A21.

| # | Idée | Principe | Impact/Effort |
|---|------|----------|---------------|
| A22 | ✅ 2026-08-06 **Génération `llms.txt`/`llms-full.txt` depuis le crawl** — livré : sous-commande `findable generate llms-txt <url> [--out <dir>]` (crawl seul, pas d'audit ni de rapport), fichiers construits depuis les vraies pages, doc README + USAGE, 4 tests CLI | sous-commande `generate llms-txt` : produire un couple `llms.txt` (index) / `llms-full.txt` (contenu) cohérent avec le sitemap et les pages auditées — on passe du diagnostic (`llms-txt-lint`) à la remédiation en un geste ; forte valeur perçue, le crawl a déjà toutes les données | fort / faible |
| A23 | ⏰ **Mode monitor : audit planifié + alertes** | `findable-audit monitor <url>` : ré-audit périodique, diff vs baseline (mécanique `--fail-on-regression` déjà en place) et notification (webhook/e-mail/fichier) en cas de régression — les suites GEO 2026 se vendent sur le monitoring continu, pas le scan ponctuel ; c'est l'emballage qui manque, pas le moteur | fort / moyen |
| A24 | 🌉 **Pont findable-audit → vigie-seo** | export normalisé des scores par axe vers la base vigie-seo pour historiser l'audit multi-sites dans le dashboard existant (courbes, alertes, rapport client V25) — évite de re-développer une UI de suivi côté findable-audit et soude la gamme produit | moyen / moyen |

## Ajouts 2026-08-07 (session automatique — signaux internes + veille SearXNG)
- A25 — ◐ 2026-08-08 (partiel : warn dédié Google-Extended livré le 2026-08-07 ; traduction FR i18n du message livrée le 2026-08-08, tests verts ; reste : exiger les données structurées recommandées par le guide) Aligner le scoring sur le guide officiel Google « AI features » (developers.google.com/search/docs/appearance/ai-features) : vérifier qu'aucun blocage involontaire de Google-Extended n'empêche l'éligibilité AI Overviews, et exiger les données structurées qu'il recommande. | Impact fort / effort moyen
- A26 — Check « citabilité ChatGPT » : fraîcheur des dates, auteur identifiable, statistiques sourçables — critères de sélection des sources documentés en 2026 (referencement-llm.com). | Impact moyen / effort moyen
- A27 — ✅ 2026-08-07 Commande generate : remplacer les placeholders TODO du llms.txt généré par du contenu dérivé du crawl (titres/descriptions réels) — generate.test.ts:158 accepte encore /todo|paste/, signe de sortie inachevée. | Impact fort / effort faible
- A28 — Benchmark sectoriel anonymisé : agréger les scores des audits stockés côté web (store) pour afficher un percentile « votre site vs sites comparables » dans le rapport. | Impact moyen / effort moyen
- A29 — ✅ 2026-08-07 Élargir SOCIAL_RE (packages/cli/src/checks/llm-content.ts:392) : bsky.app, discord.gg/.com, whatsapp.com, twitch.tv manquent — faux signaux possibles sur les liens sociaux. | Impact faible / effort faible

## Ajouts 2026-08-07 (session automatique, 2e passe — signaux internes + veille SearXNG)

- A30 — ✅ 2026-08-07 Avertissement Cloudflare 15/09/2026 dans `ai-access` : Cloudflare bloquera par défaut les crawlers IA à partir du 15 septembre 2026 (blog.cloudflare.com, nooki.fr). Détecter si le site audité est servi par Cloudflare (en-têtes `cf-ray`/`server`) et, le cas échéant, émettre un avertissement daté + recommandation de vérifier AI Crawl Control. Impact : fort (échéance imminente touchant beaucoup de sites). Effort : faible. Priorité : haute.
- A31 — ✅ 2026-08-07 Check cohérence NAP / entité locale : comparer nom, adresse et téléphone entre JSON-LD `LocalBusiness`, footer et page contact. La dissonance NAP est identifiée comme signal négatif SEO local + GEO (noiise.com 12/2025, oplia.fr 07/2026). S'appuie sur les checks structured-data existants ; complète A26 (citabilité) pour la cible artisans/TPE. Impact : fort sur la cible. Effort : moyen.
- A32 — ✅ 2026-08-07 Résumé exécutif + « top 5 quick wins » triés impact/effort en tête de rapport (CLI et HTML) : tri déterministe des échecs par sévérité × coût de correction estimé par check — distinct de A21 (recommandations LLM). Les audits GEO commerciaux (ex. detekia.fr, 9 étapes + checklist priorisée) vendent d'abord cette hiérarchisation. Impact : moyen-fort (lisibilité client). Effort : faible.

## Ajouts 2026-08-08 (session automatique — signaux internes + veille SearXNG)

| # | Idée | Principe | Impact / Effort |
|---|---|---|---|
| A33 | ✅ 2026-08-08 (livré : warn « signal non contraignant » dans ai-access.ts, i18n FR incluse, commit 304e2f7, tests verts) **Nuance « Content Signals » dans le check Cloudflare** | Google ignore les directives Content Signals ajoutées au robots.txt (John Mueller, relayé positionzero.net 07/07/2026) ; compléter le check cloudflare-ai-defaults (A30) : ne pas présenter Content Signals comme une protection effective, message dédié « signal non contraignant » | Impact : conseil exact, évite un faux sentiment de contrôle chez le client. Effort : faible |
| A34 | ✅ 2026-08-09 (livré : pondération réduite du check llms-content + phrase de transparence FR/EN dans le README généré, commit dbd767f, 238 tests verts) **Messaging honnête sur llms.txt** | adoption contestée en 2026 (« no AI system currently uses llms.txt », débat relayé ellevate.fr 28/04/2026 ; limites détaillées developr.fr 06/05/2026) : repositionner le check + la génération comme « coût quasi nul, bénéfice incertain », pondération réduite dans le score et phrase de transparence dans le rapport | Impact : crédibilité de l'outil face à un client informé. Effort : faible |
| A35 | 📅 **Mode audit récurrent + rapport de tendance** | pratique AEO 2026 : « geler et rejouer » l'audit à intervalle fixe (ailabsaudit.com) ; réutiliser --baseline/--history existants pour produire un rapport de tendance (delta score, checks régressés/gagnés) prêt à envoyer au client + doc d'ordonnancement | Impact : transforme l'audit one-shot en suivi vendable en récurrence. Effort : moyen |

## Ajouts 2026-08-09 (session automatique — recherche d'améliorations)

Signaux internes : aucun TODO/FIXME dans `packages/` ; `report/axes.ts` n'expose aucun axe confiance/autorité alors que les signaux (auteur/dates A26, `sameas-verified`, liens sortants) sont déjà mesurés ; la sortie de rapport reste technique, inutilisable telle quelle en prospection TPE. Sources externes (SearXNG) : genee.tech (audit GEO gratuit comme outil commercial), e-cybercom.fr 11/04/2026 (« le balisage Schema.org est la traduction machine-readable de votre E-E-A-T »), edikka.com 16/06/2026 (site agent-ready), universalcommerceprotocol.fr (catalogue lisible par agents), yvarn.fr 13/05/2026 (12 leviers GEO). Sans doublon : benchmark concurrentiel = A15, citabilité/auteur/dates = A26, NAP local = A31/A18, formulaires agent = LOT 6 (`agentic.ts`), FAQ/chunks = QW4 + `llm-content.ts`, tendance = A35.

| # | Idée | Principe | Impact/Effort |
|---|------|----------|---------------|
| A36 | 📄 **Sortie « one-pager » commerciale (FR, non technique)** | `--format onepager` : 1 page (score global, 5 actions prioritaires en langage client, bénéfice attendu) prête à joindre à une prospection écrite — pratique 2026 des agences (« audit gratuit » genee.tech) ; synergie directe avec P33/P35 de pb-opentech | fort / moyen |
| A37 ✅ 2026-08-09 | 🎓 **Axe de lecture E-E-A-T agrégé dans le rapport** | regrouper les signaux déjà calculés (auteur identifiable, fraîcheur des dates, `sameAs` vérifiés, sources sortantes) en un axe « confiance/autorité » avec recommandations — aujourd'hui absent de `report/axes.ts` alors que tout est mesuré ; e-cybercom 11/04/2026 | moyen / faible |
| A38 ✅ 2026-08-09 | 🛰️ **Veille + check optionnel des standards d'actionnabilité agent** | détecter `agents.json` / signaux UCP derrière un flag expérimental, en warning purement informatif (philosophie du repo : « no unstable standard » en check noté) — universalcommerceprotocol.fr, edikka.com | faible / faible |

## Ajouts 2026-08-09 (session automatique — veille externe)
- [x] A39 (fait 2026-08-09 - docs/research/2026-08-09-benchmark-checkers-2026.md ; aucun manque identifie) — Benchmark de couverture vs checkers gratuits 2026 : Siftly Crawler Audit (7 zones : HTTPS, robots, headers, meta, sitemap, SSR, structured data), PageForge AI Search Readiness, Search Engine Land AI Agent Readiness Checker, Apify AI Readiness Auditor. Matrice checks couverts/absents chez nous -> prioriser les manques + alimenter l'argumentaire « pourquoi payer un audit complet ». Aucun de ces noms n'apparait dans le backlog actuel. | Impact moyen / effort faible
- [x] A40 (fait 2026-08-09 - check `pay-per-crawl` dans packages/cli/src/checks/ai-access.ts, i18n fr/en, 6 tests) — (R&D, opportuniste) Check « monetisation IA » : detecter la config pay-per-crawl (Cloudflare micro-paiements bots, en-tetes 402 Payment Required) et signaler l'opportunite/le risque (bloque les citations si active par defaut). Signal emergent veille 09/08 : metadonnees 402 pressenties dans llms.txt en 2026. | Impact faible / effort faible

## Ajouts 2026-08-10 (session automatique — recherche d'améliorations)
- [2026-08-10] **Séparer `test` du build dans le monorepo** — le script racine `test` enchaîne `npm run build --workspaces` avant chaque exécution : boucle de dev lente et CI plus coûteuse. Ajouter `test:fast` (tests seuls) et ne rebuilder que si dist absent. Impact moyen / effort faible.
- [2026-08-10] **Score agrégé par gabarit de page** — en mode crawl multi-pages, regrouper les URLs par template (accueil / fiche / article) et produire un score pondéré par gabarit, façon unlighthouse (unlighthouse.dev), plutôt qu'une seule liste plate par URL. Impact moyen / effort moyen.
- [2026-08-10] **Audit comparatif de domaines tiers** — réutiliser la mécanique --baseline/--compare pour auditer 1-2 concurrents d'un client et sortir un delta de findabilité chiffré ; argument commercial direct pour la prospection TPE-PME. Impact fort / effort moyen.

## Ajouts 2026-08-15 (session automatique — recherche d'améliorations)
- [2026-08-15] **Lentille « answer-readiness » par page** — scorer la citabilité des réponses elles-mêmes : bloc réponse autonome (question → réponse directe 40-60 mots), statistiques datées, FAQ balisée ; les outils AEO 2026 (comparatif HubSpot 07/2026) mesurent cela au-delà des prérequis techniques. Vérifier le recouvrement avec la lentille E-E-A-T (A37) avant d'implémenter. Impact fort / effort moyen.
- [2026-08-15] **Mode `--logs` : analyse de logs serveur crawlers IA** — parser un access.log fourni par le client : part de hits GPTBot / ClaudeBot / PerplexityBot / Google-Extended, vérification reverse-DNS anti-faux-bots, delta avec ce que robots.txt autorise ; les hits crawlers IA n'apparaissent pas dans les analytics JS, seule l'analyse de logs prouve « les IA me lisent ». Différenciant vs checkers gratuits (aucun ne le fait, cf. matrice A39). Impact fort / effort moyen.
- [2026-08-15] **Export one-pager « top 5 actions »** — synthèse décision d'une page (HTML/PDF) priorisée impact/effort à partir des 142 checks, format vendable TPE ; les outils GEO commerciaux 2026 vendent la recommandation actionnable, pas la liste exhaustive. Impact fort / effort faible-moyen.
- [2026-08-15] **Plan de distribution : figurer dans les comparatifs d'outils GEO 2026** — vigie-seo mesure un indice de visibilité 0 et 0 citation IA pour findable-audit ; préparer un dossier de soumission aux listicles FR (Digitiz, Plateya, Facilitateur Numérique, Google AIO SEO…) + page « alternatives » s'appuyant sur la matrice benchmark A39 déjà rédigée. Impact fort / effort faible.

## Ajouts 2026-08-15 (session automatique, 2e passe — croisement signaux internes + veille SearXNG)
- A41 [2026-08-15] **Vue « score par moteur »** — matrice checks × moteurs (ChatGPT/GPTBot, Claude/ClaudeBot, Perplexity, Gemini/Google-Extended) : chaque check n'impacte pas les mêmes moteurs ; métadonnée `engines[]` par check + sous-scores par moteur dans le rapport. Tous les comparatifs GEO 2026 (seo.fr, aioseo.fr 14/07/2026, tool-advisor.fr 30/07/2026) segmentent par moteur. Impact fort / effort moyen.
- A42 [2026-08-15] **Check « contenu visible sans JavaScript »** — comparer le texte utile du HTML brut à celui du DOM rendu : la plupart des crawlers LLM n'exécutent pas le JS ; alerter si une part significative du contenu n'apparaît qu'après rendu client. Aucune couverture actuelle (0 mention JS/SSR côté checks llm-content). Impact fort / effort moyen (le crawler fait déjà le fetch brut ; ajouter une passe DOM optionnelle).
- A43 [2026-08-15] **Profils sectoriels de scoring (`--profile local|ecommerce|docs`)** — pondérations prédéfinies par cas d'usage : un site vitrine d'artisan local (LocalBusiness, NAP, GBP) n'a pas les priorités d'une doc SaaS (llms-full.txt, ancres stables) ; ajuste poids et seuils sans toucher aux checks. Impact moyen / effort moyen.

## Ajouts session automatique 2026-08-16 (phase recherche-ameliorations)

- A44 [2026-08-16] **`findable recheck` ciblé post-correction** — re-exécuter uniquement les checks en échec du dernier rapport (lecture du `--baseline`, option `--checks id1,id2`) pour une boucle corrective rapide chez le client, sans repayer un audit complet (crawl + 139 checks). Complète `--fail-on-regression` (A?) et le futur mode monitor (A23) sans les recouvrir. Impact moyen / effort faible-moyen.
- A45 [2026-08-16] **Profil sectoriel SaaS B2B (extension de A43)** — A43 prévoit `--profile local|ecommerce|docs` ; les audits GEO B2B SaaS 2026 (score-geo.fr) pondèrent `SoftwareApplication` en JSON-LD, la transparence pricing et le contenu comparateur. Ajouter `--profile saas` avec ces pondérations. Impact moyen / effort faible (une fois A43 livré).
- A46 [2026-08-16] **Doc de positionnement face aux suites GEO 2026** — Semrush a absorbé AI Visibility Toolkit dans Semrush One (digitiz.fr 28/07/2026) ; mentionlab.ai distingue explicitement « technical GEO audit » (plus profond, schema, SSR) du monitoring de mentions. Rédiger un tableau honnête README/site « audit technique profond (findable-audit) vs monitoring de visibilité (Profound, Semrush One, vigie-seo pour la mesure locale) » + quand utiliser quoi. Impact moyen (commercial) / effort faible.
- A47 [2026-08-16] **Couverture query fan-out au niveau site (extension de A13)** — A13 évalue par page ; les comparatifs 2026 jugent les outils sur « Prompt Volumes » et query fan-out (aioseo.fr 14/07/2026). Générer depuis le crawl la liste des questions probables du domaine, puis lister les « questions sans page/chunk de réponse » (gap analysis multi-pages) dans le rapport. Impact fort / effort moyen.
