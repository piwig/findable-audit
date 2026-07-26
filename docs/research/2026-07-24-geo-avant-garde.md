# GEO avant-garde — Recherche & idéation (LOT 5 candidat)

> **Date** : 2026-07-24 (maj 2026-07-25 : intrants du harnais parallèle recoupés, §1.9) · **Statut** : recherche / idéation — aucun engagement d'implémentation
> **Périmètre** : findable-audit (CLI MIT, 112 checks, crawl-only, zéro-dépendance, sans SDK LLM).
> **Rappel de positionnement** : on audite l'**ENTRÉE** (atteignabilité + extractibilité par les IA).
> Le monitoring de **SORTIE** (citations dans les réponses IA) reste hors-scope (Otterly, Peec, etc.).

---

## Phase 1 — État de l'art (juillet 2026)

### 1.1 Littérature académique GEO

- **Papier fondateur « GEO »** (Aggarwal et al., KDD 2024, arXiv:2311.09735) : GEO-bench (10 000 requêtes).
  Le fameux « +40 % de visibilité » vient de la *Quotation Addition* (Position-Adjusted Word Count 19,3 → 27,2,
  ~+41 % relatif) — mais **conditionné à être déjà dans le contexte top-5**. Le keyword stuffing *réduit* la métrique.
- **AutoGEO** (Wu, Zhong, Kim, Xiong — ICLR 2026, code : https://github.com/cxcscmu/AutoGEO) : extraction
  automatique des « préférences de contenu » des moteurs génératifs + réécriture ; +35,99 % sur les métriques GEO.
  Benchmarks publiés : Researchy-GEO, E-commerce (déc. 2025).
- **AgenticGEO** (arXiv:2603.20213) : système agentique auto-évolutif, dépasse AutoGEO (25,48 vs 23,71 sur
  Qwen2.5-32B). Autres benchmarks du paysage : C-SEO Bench, CC-GSEO-Bench, SAGEO Arena
  (récap : https://thegeocommunity.com/benchmarks/).
- **Survey critique 2023–2026** (Martinez, arXiv:2607.14035, consulté le 2026-07-24) — la source la plus
  structurante pour nous :
  - GEO = pipeline **stochastique et partiellement observable** : activation → crawl/index → retrieval →
    reranking → citation → proéminence → absorption → fidélité → comportement. Il propose un **vecteur de
    visibilité** (7 dimensions) plutôt qu'un score unique.
  - **SAGEO Arena** (171 003 documents, 2 700 requêtes) : l'optimisation « body-only » **réduit** la présence
    top-20 au retrieval de ~9 %, le top-10 post-reranking de 16 %, la citation finale de 6 %. Autrement dit :
    ce qui aide une fois injecté dans le contexte peut **nuire à la récupérabilité en amont**.
  - Leviers robustes : pertinence topique, position dans le contexte. Modérés : preuves extractibles
    (stats, définitions, prix, dates), structure, fraîcheur. Faibles/négatifs : heuristiques génériques
    (C-SEO Bench : 3 combinaisons méthode×domaine positives sur 54).
  - Faible chevauchement entre moteurs (Jaccard 0,11–0,18 Google organique/AIO/Gemini) et forte instabilité
    (9–28 % de décisions changent même à température zéro) → auditer l'entrée (déterministe) est plus sain
    que monitorer la sortie (bruitée). **Validation directe de notre positionnement produit.**
  - Manipulation adverse documentée (préférence d'un produit fictif 34 % → 59,4 %) → la « séparation
    contenu/instruction » devient un test normatif proposé par le survey.

### 1.2 Protocoles agentiques (la grande nouveauté 2026)

- **WebMCP** (W3C Web Machine Learning CG ; draft publié le 2026-02-10 ; origin trial Chrome 149→156) :
  le site expose des *tools* JSON-schema via `navigator.modelContext` (API déclarative sur les `<form>` +
  API impérative `registerTool`). Co-édité Microsoft/Google, issu du prototype MCP-B (Alex Nahas).
  État juillet 2026 : expérimental, quasi aucune adoption, mais **Lighthouse 13.3 (2026-05-07) a ajouté une
  catégorie « Agentic Browsing »** avec 3 familles d'audits : validation WebMCP, accessibilité agent-centrique
  (names/labels, arbre a11y, visibilité), stabilité/découvrabilité (CLS + présence llms.txt). Scoring en
  ratio de passes, pas 0–100. Sources : https://www.spronta.com/blog/state-of-webmcp-july-2026/ ,
  https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring ,
  https://www.debugbear.com/blog/lighthouse-agentic-browsing . Dan Petrovic : « the biggest shift in
  technical SEO since structured data ».
- **NLWeb** (Microsoft, Build 2025 ; https://en.wikipedia.org/wiki/NLWeb) : tout site devient conversationnel ;
  chaque instance est un serveur MCP (`/ask`, `/mcp`), s'appuie sur Schema.org/RSS/sitemaps. Adoption timide
  (TripAdvisor cité) ; problème d'œuf et de poule ; à surveiller à Build 2026.
- **ACP — Agentic Commerce Protocol** (OpenAI + Stripe, Apache 2.0,
  https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) : checkout agent-ready ; « Buy it in
  ChatGPT » lancé le 2026-02-16 (Etsy live, 1M+ marchands Shopify annoncés) ; implémentable en REST ou MCP.
- Empilement conceptuel : **MCP** (agent↔infra), **A2A** (agent↔agent), **WebMCP** (agent↔site dans le
  navigateur), **ACP** (agent↔achat).

### 1.3 Découverte & politique machine-lisible (.well-known et cie)

- **llms.txt en 2026** : adoption large en volume mais **aucun moteur majeur ne confirme le consommer**
  (Google s'en distancie publiquement). Études citant ~10 % d'adoption sur les gros sites ; débat
  hype vs réalité (https://ai.aeo.press/the-state-of-llms-txt-in-2026 ,
  https://www.getpassionfruit.com/blog/should-i-create-an-llms.txt-file-google-s-2026-guidance-explained).
  Lighthouse 13.3 en vérifie néanmoins la présence → standard « cheap à servir, coûteux à ignorer ».
- **Prolifération de fichiers de politique IA** : draft IETF **ai.txt**
  (https://datatracker.ietf.org/doc/draft-car-ai-txt-wellknown/00/ — « A Declaration File for AI Usage
  Preferences, Licensing, and Policy »), `/.well-known/ai-policy.json`, `/.well-known/agent-permissions.json`,
  `/.well-known/tdmrep.json` (TDM Reservation Protocol, W3C), **RSL** (Really Simple Licensing / Human Consent
  Standard, lancé mai 2026, ~1 500 éditeurs — https://www.venable.com/insights/publications/2026/06/a-new-framework-for-ai-permissions-in).
  **Personne n'audite la cohérence entre ces couches** (robots.txt vs ai.txt vs meta vs headers).

### 1.4 Identité, économie et comportement des crawlers IA

- **Web Bot Auth** (IETF WG 2026 ; RFC 9421 HTTP Message Signatures, clés Ed25519, header `Signature-Agent`,
  annuaire JWKS) : soutenu par Cloudflare, Amazon, Akamai, OpenAI ; adopté par Visa TAP et Mastercard Agent
  Pay ; support AWS WAF/Vercel/Shopify/Akamai. De facto standard.
  (https://stellagent.ai/insights/web-bot-auth-cloudflare-ietf , https://blog.cloudflare.com/signed-agents/)
- **Pay-per-crawl Cloudflare** : HTTP **402 Payment Required** + en-têtes de paiement signés, minimum 0,01 $
  par récupération (https://blog.cloudflare.com/introducing-pay-per-crawl/).
- **Chiffres Radar (2026-06-03)** : 57,5 % du trafic HTML est automatisé ; 51,8 % du trafic bots vérifiés va
  à l'entraînement ; **2,6 % seulement des requêtes de crawlers IA amènent un humain sur une page**.
- **Rendering JS : toujours non.** Au 2026-06, aucun crawler IA majeur n'exécute le JS (exception : Gemini via
  l'infra Googlebot). GPTBot *télécharge* du JS dans ~11,5 % des requêtes sans l'exécuter, ClaudeBot ~23,84 %.
  Nouveau bot : **Claude-SearchBot** (début 2026). AI-search = 26,7 % du trafic bots vérifiés (mai 2026).
  (https://searchoptimo.com/blog/do-ai-crawlers-render-javascript ,
  https://www.digitalapplied.com/blog/ai-crawler-bot-traffic-statistics-2026-data-reference)
  → conforte nos checks parité CSR/SPA existants ; ouvre la question 402/challenge pages.

### 1.5 Fraîcheur, provenance, entités

- **IndexNow** : 60 M+ de sites, 5 Mds de soumissions/jour ; en février 2026, **22 % des URLs cliquées sur
  Bing provenaient de soumissions IndexNow** ; pipeline Bing → Copilot ; Google toujours absent.
  (https://www.searchbloom.com/ai-search-optimization/inclusion/indexnow/)
- **Fraîcheur** : les moteurs IA sur-pondèrent la récence ; incohérences `dateModified` (JSON-LD) vs
  `<lastmod>` (sitemap) vs header `Last-Modified` vs date visible = signal de défiance ; « fake freshness »
  (bump de date sans changement substantiel) est activement discuté comme spam signal.
- **C2PA** : v2.3 (début 2026, vidéo live) ; OpenAI ajoute des métadonnées C2PA + SynthID (mai 2026) ;
  **Google déploie la vérification Content Credentials dans Gemini, Search et Chrome** ; EU AI Act en
  enforcement 2026 → provenance = signal de confiance montant.
  (https://contentauthenticity.org/blog/the-state-of-content-authenticity-in-2026)
- **Entités** : corrélation mentions de marque ↔ citations AI Overviews **0,664** contre **0,218** pour les
  backlinks (Semrush 2025). Wikidata QID = identifiant canonique ; `sameAs` = pont vérifiable ; ChatGPT
  sur-pondère Wikipedia/Wikidata, Perplexity sur-pondère Reddit + récence.
  (https://www.digitalapplied.com/blog/entity-seo-knowledge-graph-optimization-guide-2026)

### 1.6 Chunking / RAG-friendliness (le socle du LOT 5 proposé)

- Le chunk est **la plus petite unité que le retrieval peut retourner** ; un fait coupé en deux chunks est
  irrécupérable. Le choix de chunking fait varier le recall jusqu'à ~9 % ; dégradation nette au-delà de
  ~2 500 tokens ; requêtes factuelles optimales à 64–256 tokens, analytiques à 512–1024.
  (https://www.digitalapplied.com/blog/rag-chunking-strategies-2026-retrieval-quality-playbook ,
  https://www.firecrawl.dev/blog/best-chunking-strategies-rag)
- Chunking récursif : 85–90 % de recall à 400 tokens ; sémantique : 91–92 %. Late chunking (Jina) généralisé.
- L'évaluation a basculé de « bon chunk récupéré » à « **bon span cité** » → la notion d'« answer unit »
  (réponse isolée, autosuffisante, en tête de section) devient opérationnelle côté contenu.
- Aucun outil d'audit ne **simule** aujourd'hui ce pipeline côté site. C'est un trou béant.

### 1.7 Sécurité & injection comme signal GEO

- L'injection indirecte via contenu web est « le XSS de l'ère des agents »
  (https://www.helpnetsecurity.com/2026/07/17/xss-web-agent-prompt-injection/) ; +340 % YoY (OWASP 2026).
- Défense émergente côté agent : **frontières de confiance dans l'arbre de la page** (modèle Biba ; succès
  d'attaque 85,5 % → 0,7 % sur WebArena) — les agents apprennent à *pruner* les zones basse-confiance
  (UGC, reviews) et le texte suspect. Conséquence GEO : un site « propre » (pas de texte caché, UGC bien
  délimité, pas d'impératifs adressés aux machines) sera **moins élagué et plus cité**.
  → « injection hygiene » = signal de confiance auditable, personne ne le vend comme un check GEO.

### 1.8 Concurrence outillage (juillet 2026)

| Outil | Nature | Couverture | Trou exploitable |
|---|---|---|---|
| **Lighthouse 13.3 Agentic Browsing** | OSS Google | WebMCP (3 audits), a11y agent, CLS, llms.txt | Superficiel, pass/fail, pas de crawl multi-pages |
| **geo-optimizer-skill** (Auriti-Labs) | OSS MIT, CLI/Python/MCP | 47 méthodes « research-backed », 8 catégories, fixes générés | Fait aussi du monitoring de sortie (citations) ; pas de simulation retrieval ; dépendances Python |
| **SEOmator GEO Audit** | SaaS gratuit | citabilité, E-E-A-T, schema, accès crawlers | Boîte noire, mono-page, pas CI |
| **ai-seo-auditor** (ngstcf) | OSS Python | audits GEO/AEO basiques | Peu maintenu |
| **AI Rank Lab, GetCito…** | Web gratuits | scores agrégés | Pas auditables, pas déterministes |

Personne ne fait : simulation locale de retrieval, score de citabilité par passage déterministe, cohérence
multi-couches des politiques IA, hygiène anti-injection, cohérence des signaux de fraîcheur, empreinte
d'entité vérifiée par crawl. **Le terrain « entrée, déterministe, CI-able » reste à nous.**

### 1.9 Intrants du harnais de recherche parallèle (claims sourcés — statut de vérification)

> Reçus le 2026-07-25 d'un harnais parallèle dont l'étape de vérification a échoué (cause infra).
> Recoupement rapide effectué sur les abstracts arXiv le 2026-07-25 ; statut par claim ci-dessous.

| Claim | Source | Statut (recoupement 2026-07-25) |
|---|---|---|
| GEO fondateur : ~+40 % **max relatif** sur PAWC (19,3→27,2) via quotes/stats ; keyword stuffing nuit | arXiv:2311.09735 (KDD 2024) | ✅ **Vérifié** — concorde avec le survey critique (§1.1) |
| C-SEO Bench : réécritures GEO génériques inefficaces voire négatives (3/54 configs positives) ; retrouvabilité SEO classique (+2,77 positions) ≫ retouches de contenu (+0,36) | « C-SEO Bench: Does Conversational SEO Work? » — https://arxiv.org/abs/2506.11097 (NeurIPS D&B 2025) | 🟡 **Partiellement vérifié** — l'abstract confirme le qualitatif (méthodes « largely ineffective », effet souvent négatif, « traditional SEO … significantly more effective », jeu à somme nulle sous adoption) ; 3/54 déjà corroboré par le survey (§1.1) ; +2,77 / +0,36 **à confirmer dans le PDF** |
| 34 % des réponses Gemini / 24 % GPT-4o **sans aucun fetch live** ; Gemini sans citation cliquable dans 92 % des cas ; Perplexity Sonar lit ~10 pages, en cite 3–4 ; efficacité de citation 0,19–0,45 | « The Attribution Crisis in LLM Search Results » (Strauss, Yang, O'Reilly et al., ~14 000 logs LMArena) — https://arxiv.org/abs/2508.00838 | ✅ **Vérifié** (abstract) — tous les chiffres confirmés ; ~3 sites pertinents non cités par réponse type |
| AgentGEO : taxonomie des échecs de citation **retrieval → selection → generation** ; réparations ciblées par mode d'échec : +40 % relatif en ne modifiant que 5 % du contenu ; règles génériques nuisent au long-tail | arXiv:2603.09296 (« Diagnosing and Repairing Citation Failures in GEO ») | 🟡 **Non vérifié** (chiffres) — papier réel, déjà repéré en §sources ; taxonomie cohérente avec le pipeline du survey (§1.1) ; +40 %/5 % à recouper |
| FeatGEO : ce sont des propriétés **de page** interprétables (structurelles/linguistiques) qui pilotent la citation, pas des micro-édits lexicaux | « Think Before Writing » (Liu & Xu) — https://arxiv.org/abs/2604.19113 | ✅ **Vérifié** (abstract) — « more strongly influenced by document-level content properties than by isolated lexical edits » |
| Googlebot rend le JS intégralement ; les crawlers IA majoritairement non (follow-up déc. 2024) | Vercel/MERJ | ✅ **Cohérent** avec §1.4 (multi-sources 2026) |
| llms.txt : quasi aucun requester dans les logs serveur ; étude OtterlyAI 90 j sans effet mesuré | logs serveur / OtterlyAI | 🟡 **Cohérent mais non recoupé** (chiffres OtterlyAI non retrouvés) — aligné avec §1.3 |

**Portée produit** : 2508.00838 quantifie l'entonnoir *lu → cité* (« attribution gap ») → maximiser la
sélectionnabilité de chaque page lue est le bon levier d'entrée. C-SEO Bench et FeatGEO confortent
frontalement notre thèse : **auditer des propriétés de page déterministes (entrée) > réécritures
stylistiques (sortie)**. La taxonomie AgentGEO fournit la grille de classement utilisée en §3.0.

---

## Phase 2 — Idéation (20 idées originales)

Notation Phase 3 incluse en tableau §3.1. Légende faisabilité : ✅ crawl-only, ✅ zéro-dép, ✅ déterministe.

### A. Le pari central : la page vue comme corpus RAG

**I1. `retrieval-sim` — Simulateur de retrieval local (« RAG fitness »)**
Chunker chaque page comme un pipeline RAG réel (découpe heading-aware ~256/512 tokens, approximation de
tokenisation déterministe), puis scorer chaque chunk sans LLM : autosuffisance (le chunk survit-il hors
contexte ?), densité de faits, dilution par boilerplate, ancrage au titre/H2. Sortie : score de « retrieval
fitness » par page + liste des chunks morts. Fondé sur §1.6 (le chunk est l'unité de citation) et §1.1
(SAGEO : l'amont retrieval domine). *Personne ne le fait.*

**I2. `citability` — Score de citabilité par passage (« citation surface »)**
Détection déterministe des spans quotables : statistiques (nombre+unité+source à proximité), définitions
(« X est … » en tête de section), phrases < 30 mots autosuffisantes, citations attribuées. Directement dérivé
des leviers *robustes/modérés* du papier GEO et du survey (quotation addition ~+41 % PAWC ; preuves
extractibles). Mesuré côté entrée = notre ADN.

**I3. « Self-containment » anaphorique**
Sous-métrique de I1 isolable : ratio de phrases non-autosuffisantes par chunk (pronoms sans antécédent
interne, « comme vu plus haut », « ce dernier », références de figure). Un chunk récupéré seul doit se
comprendre seul.

**I4. « Answer units » lint**
Chaque H2/H3 interrogatif doit avoir sa réponse dans les ~64–256 premiers tokens de la section (fenêtre
optimale factuelle, §1.6) ; cohérence stricte JSON-LD FAQPage/HowTo ↔ texte visible (mismatch = signal spam).

**I5. « Chunk collision » inter-pages**
Shingling (n-grammes hashés) pour détecter le boilerplate répété inter-pages qui pollue les embeddings et
fait remonter la mauvaise page ; complète le graphe d'équité de liens existant côté « équité d'embedding ».

**I6. Cannibalisation de réponse**
Détecter plusieurs pages répondant à la même question (H1/title quasi-dupliqués, réponses similaires) :
elles divisent la probabilité de citation entre elles. Croisable avec I5.

**I7. « Self-retrieval consistency »**
Générer des questions depuis les H2 du site (transformation déterministe), puis vérifier via un BM25 maison
que la *bonne* page du site gagne. Le site répond-il à ses propres questions ? Zéro LLM, zéro réseau.

### B. Extractibilité & structure

**I8. Parité de chunk / contenu enfermé**
Contenu critique (prix, specs, FAQ) enfermé dans `<details>` fermés, tabs JS, accordions, tables paginées,
`aria-hidden`, images de tableaux : visible pour l'humain, éclaté ou perdu pour l'extracteur. Complète la
parité CSR existante au niveau *intra-page*.

**I9. Extractibilité des tableaux**
`<table>` sémantique vs div-tables/images ; en-têtes `<th>` présents ; les pipelines RAG linéarisent mal les
div-tables (§1.6).

**I10. Budget de tokens / ratio signal-boilerplate**
Approximation de tokens (déterministe) : part du contenu utile vs nav+footer+bannières dans le HTML servi aux
bots. La dilution de contexte est un facteur mesuré de perte de recall.

**I11. Ancres de citation stables + text-fragments**
Chaque H2/H3 a un `id` stable ; premières phrases de section uniques dans le site (les moteurs citent via
`#:~:text=` — une phrase d'ouverture dupliquée casse le deep-link de citation).

### C. Confiance, politique, provenance

**I12. `injection-hygiene` — Hygiène anti-injection comme signal de confiance**
Scanner le HTML servi aux bots : texte caché (font-size:0, off-screen, white-on-white, `aria-hidden` avec
texte impératif), commentaires HTML contenant des instructions, impératifs adressés aux machines (« ignore
previous… »), UGC non délimité par frontières claires (§1.7 : les agents pruneront les zones douteuses).
Angle inédit : l'hygiène devient un facteur de *citabilité*, pas seulement de sécurité. Synergie avec nos
checks sécurité existants.

**I13. Cohérence multi-couches des politiques IA**
Matrice robots.txt × ai.txt (draft IETF) × ai-policy.json × tdmrep.json × RSL × meta robots × headers :
détecter les contradictions (ex. GPTBot autorisé dans robots.txt mais interdit par tdmrep.json). Personne ne
vérifie la cohérence de cette pile qui prolifère (§1.3). Extension naturelle de nos checks bots tiérés.

**I14. Web Bot Auth / 402 readiness**
Le site (ou son CDN) sert-il des challenge pages aux UA de bots IA ? Renvoie-t-il des 402 pay-per-crawl ?
La politique est-elle cohérente avec robots.txt ? Étend le check cloaking existant vers l'économie du crawl
(§1.4). Détection passive, sans signature réelle (pas de clés à gérer).

**I15. Provenance C2PA / Content Credentials**
Détecter les métadonnées C2PA (JUMBF) dans les images servies, cohérence avec les labels « AI-generated »
(EU AI Act) ; signal de confiance montant côté Google/Gemini (§1.5). Parsing binaire léger faisable zéro-dép.

**I16. Fact-sheet canonique d'entité**
Présence d'une page « fact sheet » machine-lisible : les ~10 faits clés de l'entité (fondation, siège, prix,
dirigeants) réunis, JSON-LD complet, cohérents avec llms.txt et le footer. Les moteurs adorent les pages
« about » denses ; check de présence + cohérence interne.

**I17. Empreinte d'entité cross-source**
Depuis le `sameAs` JSON-LD : les cibles répondent-elles 200 ? Le QID Wikidata pointé a-t-il un label
compatible avec le nom du site (API publique Wikidata, sans clé) ? Nom/description identiques sur toutes les
pages ? Corrélation mentions ≫ backlinks (§1.5) → la cohérence d'identité devient le levier n°1.
(Option `--offline` : uniquement les checks internes.)

**I18. Désambiguïsation locale**
Le nom de marque est-il accompagné d'un contexte discriminant (secteur, lieu) dans les ~200 premiers tokens
des pages clés ? Homonymie non traitée = entité diluée dans le knowledge graph.

### D. Fraîcheur & affordances

**I19. `freshness-integrity` — Intégrité des signaux de fraîcheur**
Cohérence quadruple : `dateModified` JSON-LD vs `<lastmod>` sitemap vs header `Last-Modified` vs date
visible dans le texte. Détection du « fake freshness » (dates incohérentes entre couches) + présence d'une
clé IndexNow (fichier de vérification à la racine). Les moteurs IA sur-pondèrent la récence mais commencent
à pénaliser les bumps mensongers (§1.5).

**I20. Audit d'affordances agentiques**
Détection tiérée : WebMCP (`navigator.modelContext` dans les bundles ; `<form>` annotés déclarativement),
NLWeb (`/ask`, `/mcp`), ACP (endpoints checkout), `agents.json`/`.well-known` divers. Ne pas *valider* les
specs mouvantes (c'est le rôle de Lighthouse) mais donner un **tier d'agent-readiness** multi-protocoles sur
tout le site crawlé — là où Lighthouse est mono-page et mono-protocole.

---

## Phase 3 — Filtre produit

### 3.0 Grille de classement — pipeline retrieval → selection → generation

La taxonomie d'AgentGEO (arXiv:2603.09296, §1.9) épouse notre thèse « atteindre → extraire → citer » :

| Étape (AgentGEO) | Notre axe | Question | Idées couvertes |
|---|---|---|---|
| **Retrieval** | atteindre | la page est-elle récupérée ? | I1, I5, I6, I7, I10, I13, I14, I19 |
| **Selection** | extraire | le passage est-il sélectionné dans le contexte ? | I1, I3, I4, I8, I9, I11, I12 |
| **Generation** | citer | le moteur cite-t-il la source ? | I2, I11, I12, I15, I16, I17, I18, I20 |

Le LOT 5 proposé (§3.3) couvre les trois étapes : retrieval (I1, I19), selection (I1/I3, I12),
generation (I2, I12) — cohérent avec le constat SAGEO/C-SEO Bench que l'amont domine, tout en gardant
une surface de citation mesurable en aval.

### 3.1 Notation (Valeur / Effort / Faisabilité / Différenciation, sur 5 — effort : 5 = très lourd)

| # | Idée | Val. | Eff. | Faisabilité (crawl-only / 0-dép / déterministe) | Diff. | Classe |
|---|---|---|---|---|---|---|
| I1 | Simulateur retrieval local | 5 | 4 | ✅ / ✅ / ✅ | 5 | **Moonshot faisable** |
| I2 | Citabilité par passage | 5 | 3 | ✅ / ✅ / ✅ | 5 | **Différenciateur** |
| I3 | Self-containment anaphorique | 4 | 2 | ✅ / ✅ / ✅ (heuristiques FR/EN) | 4 | Différenciateur (sous-partie I1) |
| I4 | Answer units lint | 4 | 2 | ✅ / ✅ / ✅ | 3 | Quick-win |
| I5 | Chunk collision | 3 | 2 | ✅ / ✅ / ✅ | 4 | Quick-win |
| I6 | Cannibalisation de réponse | 3 | 2 | ✅ / ✅ / ✅ | 3 | Quick-win |
| I7 | Self-retrieval consistency | 4 | 4 | ✅ / ✅ / ✅ (BM25 maison) | 5 | Moonshot |
| I8 | Parité de chunk (contenu enfermé) | 4 | 2 | ✅ / ✅ / ✅ | 4 | **Quick-win fort** |
| I9 | Extractibilité tableaux | 3 | 1 | ✅ / ✅ / ✅ | 3 | Quick-win |
| I10 | Ratio signal/boilerplate | 3 | 2 | ✅ / ✅ / ✅ | 3 | Quick-win |
| I11 | Ancres + text-fragments | 3 | 1 | ✅ / ✅ / ✅ | 4 | Quick-win |
| I12 | Injection hygiene | 5 | 2 | ✅ / ✅ / ✅ | 5 | **Différenciateur** |
| I13 | Cohérence politiques IA | 4 | 3 | ✅ / ✅ / ✅ | 5 | Différenciateur |
| I14 | Web Bot Auth / 402 readiness | 3 | 3 | ✅ / ✅ / ⚠️ (dépend du CDN, résultats variables) | 4 | Différenciateur |
| I15 | Provenance C2PA | 3 | 4 | ✅ / ⚠️ (parsing JUMBF maison) / ✅ | 4 | Moonshot |
| I16 | Fact-sheet canonique | 3 | 2 | ✅ / ✅ / ✅ | 3 | Quick-win |
| I17 | Empreinte entité cross-source | 4 | 3 | ⚠️ (requêtes sortantes sameAs/Wikidata, sans clé) / ✅ / ✅ | 4 | Différenciateur |
| I18 | Désambiguïsation locale | 3 | 2 | ✅ / ✅ / ⚠️ (heuristiques NER-lite) | 3 | Quick-win |
| I19 | Intégrité fraîcheur | 4 | 2 | ✅ / ✅ / ✅ | 4 | **Quick-win fort** |
| I20 | Affordances agentiques | 4 | 3 | ✅ / ✅ / ✅ (détection, pas validation) | 4 | Différenciateur |

### 3.2 Synthèse par classe

- **Quick-wins** : I4, I5, I6, I8, I9, I10, I11, I16, I19 (I8 et I19 en tête).
- **Différenciateurs** : I2, I3, I12, I13, I14, I17, I20.
- **Moonshots** : I1 (faisable, socle des autres), I7, I15.

### 3.3 Proposition — « LOT 5 : GEO avant-garde »

Thème unificateur : **« Ta page est un corpus RAG et une surface de confiance »**. 4 items, un seul socle
technique nouveau (le chunker), le reste réutilise le crawler et l'AST HTML existants.

1. **`retrieval-sim`** (I1 + I3 + I10) — le chunker RAG local + retrieval fitness par page, avec
   self-containment et dilution boilerplate comme sous-scores. *Le* différenciateur absolu : validé par la
   recherche (SAGEO : l'amont domine ; C-SEO Bench : la retrouvabilité bat les retouches de contenu, §1.9 ;
   FeatGEO : les propriétés de page interprétables pilotent la citation, §1.9), impossible à copier vite,
   100 % crawl-only/zéro-dép/déterministe.
2. **`citability`** (I2 + I4) — score de citabilité par passage + answer-units lint. Réutilise le chunker
   de (1) ; transforme le papier GEO en checks d'entrée déterministes.
3. **`injection-hygiene`** (I12) — texte caché, instructions impératives, UGC non délimité. Nouveau récit
   produit : « la propreté est un facteur de citation » ; synergie directe avec les checks sécurité existants.
4. **`freshness-integrity`** (I19) — cohérence dateModified/lastmod/Last-Modified/date visible + IndexNow
   readiness. Le quick-win du lot : livrable tôt, visible immédiatement dans les rapports.

**Écartés du lot (candidats LOT 6)** : I20 (affordances agentiques — attendre la stabilisation WebMCP
post-origin-trial fin 2026, Lighthouse occupe le terrain médiatique), I13 (cohérence politiques IA — fort,
mais la pile ai.txt/RSL bouge encore trop vite), I17 (empreinte d'entité — nécessite de trancher la question
des requêtes sortantes hors du domaine crawlé), I7 (self-retrieval — extension naturelle du chunker en v2).

---

## Sources principales (consultées le 2026-07-24)

- Survey critique GEO 2023–2026 : https://arxiv.org/html/2607.14035v1
- Papier GEO (Aggarwal et al., KDD 2024) : arXiv:2311.09735 · GEO-bench
- AutoGEO (ICLR 2026) : https://github.com/cxcscmu/AutoGEO · AgenticGEO : arXiv:2603.20213
- AgentGEO / citation failures : arXiv:2603.09296 · Benchmarks : https://thegeocommunity.com/benchmarks/
- C-SEO Bench (NeurIPS D&B 2025) : https://arxiv.org/abs/2506.11097 · « The Attribution Crisis in LLM
  Search Results » : https://arxiv.org/abs/2508.00838 · FeatGEO : https://arxiv.org/abs/2604.19113
- WebMCP : https://www.spronta.com/blog/state-of-webmcp-july-2026/ ·
  https://www.webfuse.com/blog/what-is-webmcp-the-practical-guide-to-the-web-model-context-protocol ·
  https://locomotive.agency/blog/webmcp-ai-agents-website-functions/
- Lighthouse 13.3 Agentic Browsing : https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring ·
  https://www.debugbear.com/blog/lighthouse-agentic-browsing ·
  https://www.semrush.com/blog/google-adds-agentic-browsing-category-to-lighthouse/
- NLWeb : https://en.wikipedia.org/wiki/NLWeb · https://letsdatascience.com/news/microsoft-launches-nlweb-to-enable-agentic-websites-cc2a67ee
- ACP : https://github.com/agentic-commerce-protocol/agentic-commerce-protocol ·
  https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce · https://openai.com/index/buy-it-in-chatgpt/
- llms.txt 2026 : https://ai.aeo.press/the-state-of-llms-txt-in-2026 ·
  https://www.getpassionfruit.com/blog/should-i-create-an-llms.txt-file-google-s-2026-guidance-explained
- ai.txt / politiques : https://datatracker.ietf.org/doc/draft-car-ai-txt-wellknown/00/ ·
  https://www.venable.com/insights/publications/2026/06/a-new-framework-for-ai-permissions-in
- Web Bot Auth / pay-per-crawl : https://blog.cloudflare.com/signed-agents/ ·
  https://blog.cloudflare.com/introducing-pay-per-crawl/ · https://stellagent.ai/insights/web-bot-auth-cloudflare-ietf ·
  https://developers.cloudflare.com/bots/concepts/bot/verified-bots/
- Crawlers & JS : https://searchoptimo.com/blog/do-ai-crawlers-render-javascript ·
  https://www.asklantern.com/blogs/ai-crawlers-do-not-render-javascript ·
  https://www.digitalapplied.com/blog/ai-crawler-bot-traffic-statistics-2026-data-reference ·
  https://www.anagram.ai/blog/ai-crawlers-explained-gptbot-claudebot-perplexitybot-and-how-to-let-them-in-2026
- IndexNow : https://www.searchbloom.com/ai-search-optimization/inclusion/indexnow/ ·
  https://pressonify.ai/blog/indexnow-instant-indexing-press-releases-2026
- C2PA : https://contentauthenticity.org/blog/the-state-of-content-authenticity-in-2026 ·
  https://www.eyesift.com/faq/c2pa-content-credentials-2026-cryptographic-provenance-adoption/
- Entités : https://www.digitalapplied.com/blog/entity-seo-knowledge-graph-optimization-guide-2026 ·
  https://www.frase.io/blog/entity-optimization-for-geo · https://vegavid.com/blog/wikidata-entity-linking-ai-overviews
- Chunking/RAG : https://www.digitalapplied.com/blog/rag-chunking-strategies-2026-retrieval-quality-playbook ·
  https://www.firecrawl.dev/blog/best-chunking-strategies-rag · https://futureagi.com/blog/advanced-chunking-techniques-for-rag/
- Injection : https://www.helpnetsecurity.com/2026/07/17/xss-web-agent-prompt-injection/ ·
  https://www.zscaler.com/blogs/security-research/indirect-prompt-injection-web-content-targets-ai-agents ·
  https://www.sysdig.com/learn-cloud-native/prompt-injection
- Concurrents : https://github.com/Auriti-Labs/geo-optimizer-skill · https://seomator.com/geo-audit-tool ·
  https://github.com/ngstcf/ai-seo-auditor · https://www.airanklab.com/seo-aeo-geo-audit-tool
