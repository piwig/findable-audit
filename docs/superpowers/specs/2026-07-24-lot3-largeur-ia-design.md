# LOT 3 « Largeur IA » — design : roster 28 agents IA + découverte `.well-known/ai.json`

> Réfs : `docs/competitive-analysis-and-roadmap.md` §0 item 3, §7 P1, item #13.
> Périmètre : (A) élargir le roster de bots IA de 14 → 28 en conservant strictement le
> tiering par **intention** ; (B) un check additif de découverte `/.well-known/ai.json`.
> Hors périmètre : poids des familles (inchangés), `security.txt` (famille security,
> autre lot), validation de schéma d'ai.json (aucun standard figé), push/deploy/VPS.

## A. Roster #13 — 14 → 28 agents IA nommés, tiering par intention conservé

### Constat

`packages/cli/src/robots.ts` : 5 citation-time (fail si bloqué) / 9 training-time
(warn) / recherche `Googlebot, Bingbot, *` (fail, check séparé). geo-optimizer nomme
27 bots sur 3 tiers ; notre argument différenciant (README « The exact bot roster »)
est la **sévérité par intention**, pas le volume. Cible : ≥ 27 agents IA nommés,
sans diluer cet argument.

### Nouvelle composition

**CITATION_BOTS (13)** — fetchers à la demande / index de réponse ; bloquer = disparaître
des réponses IA en direct → **fail** :

| Agent | Statut | Intention |
|---|---|---|
| OAI-SearchBot | existant | index de recherche ChatGPT |
| ChatGPT-User | existant | fetch live à la demande de l'utilisateur |
| Perplexity-User | existant | fetch live Perplexity |
| Claude-User | existant | fetch live Claude |
| Claude-SearchBot | **nouveau** | index de recherche Anthropic (symétrique d'OAI-SearchBot) |
| PerplexityBot | existant | index du moteur de réponse Perplexity |
| DuckAssistBot | **nouveau** | réponses IA DuckDuckGo (DuckAssist) |
| MistralAI-User | **nouveau** | fetch live Le Chat (Mistral) |
| Meta-ExternalFetcher | **nouveau** | fetch de lien à la demande, Meta AI |
| YouBot | **nouveau** | moteur de réponse You.com |
| iAskBot | **nouveau** | moteur de réponse iAsk.ai |
| LinerBot | **nouveau** | assistant de recherche Liner (citations sourcées) |
| Google-CloudVertexBot | **nouveau** | grounding Vertex AI Search / agents clients |

**TRAINING_BOTS (15)** — collecte pour l'entraînement de futurs modèles ; bloquer =
choix de politique légitime → **warn** :

| Agent | Statut | Intention |
|---|---|---|
| GPTBot, Google-Extended, ClaudeBot, CCBot, Applebot-Extended, Amazonbot, Bytespider, cohere-ai, meta-externalagent | existants (9) | inchangés |
| anthropic-ai | **nouveau** | UA d'entraînement Anthropic legacy, encore honoré dans les robots.txt |
| cohere-training-data-crawler | **nouveau** | crawler d'entraînement Cohere actuel (complète `cohere-ai`) |
| Diffbot | **nouveau** | extraction/knowledge-graph revendu pour datasets IA |
| Timpibot | **nouveau** | collecte d'index/données Timpi |
| omgilibot | **nouveau** | Omgili/Webz.io — données revendues pour entraînement LLM |
| PanguBot | **nouveau** | entraînement Huawei Pangu |

**SEARCH_BOTS : inchangé** (`Googlebot, Bingbot, *`).

Total : **28 agents IA nommés** (13 + 15) + recherche → dépasse les 27 de geo-optimizer
tout en gardant le tiering honnête.

### Omissions délibérées (honnêteté du tiering, cf. commit c2fbbd1)

- **PetalBot** : crawler du moteur de recherche Petal (Huawei) — par intention c'est un
  bot *recherche* régional ; le mettre en training serait un faux étiquetage, le mettre
  en search rendrait son blocage (choix courant et délibéré) un fail. Omis.
- **FacebookBot** : remplacé par `meta-externalagent` — doublon historique.
- **Applebot** (non-Extended) : bot de recherche (Siri/Spotlight) ; le tier search reste
  volontairement minimal (mainstream), hors périmètre de ce lot.

### Comportement (inchangé, invariants)

- `ai-crawlers-allowed` : citation bloqué → fail ; training seul bloqué → warn.
- Le message *fix* du fail ne liste plus les 5 citation-time en dur (13 désormais) :
  citer 3 exemples + « any citation-time fetcher », renvoyer au README/roster.
- `--emit` (`generateRobotsTxt`, `generateAiJson`) consomme les rosters par import —
  aucune modification, les tests generate existants restent verts.
- Invariants testés : `AI_BOTS.length ≥ 27` ; aucun doublon ; `CITATION_BOTS ∩
  TRAINING_BOTS = ∅` ; `AI_BOTS = TRAINING_BOTS ∪ CITATION_BOTS` ; matching produit
  par `agentToken` (insensible casse / `/version`) valable pour les nouveaux noms.

## B. Nouveau check `well-known-ai-json` (découverte `.well-known/`)

### Motivation

ai-seo-auditor couvre déjà ai.json ; notre `--emit` **génère** `.well-known/ai.json`
depuis f4df32d mais rien ne l'**audite** (asymétrie émettre/mesurer). Check additif
de la famille `llm-content` (fichier de découverte de contenu, comme `llms.txt`).

### Design

- id `well-known-ai-json`, famille `llm-content`, `maxPoints: 3` (fichier émergent —
  moins que `llms-txt` (10) et que `llms-full-txt` (4)… non : aligné sur les checks
  de découverte secondaires à 3 pts).
- 1 fetch : `ctx.fetch('/.well-known/ai.json')` (déduplication par le cache du crawler).

| Situation | Verdict | Message (esprit) |
|---|---|---|
| 200 + `JSON.parse` → objet | pass | `/.well-known/ai.json found and valid JSON` |
| 200 + parse OK mais pas un objet | warn | `not a JSON object` |
| 200 + parse KO (dont fallback SPA HTML) | warn | `not valid JSON (SPA fallback?)` + content-type |
| autre statut / pas de réponse | warn | `missing (emerging AI-access manifest)` |

- **Jamais fail** : convention émergente — l'absence ne doit pas peser comme un
  `llms.txt` manquant ; check purement additif (mission : « additif », pas de
  changement de poids de famille).
- Fix : publier un manifeste (nom, description, contact, politique d'accès bots) ;
  `findable-audit --emit` en génère un point de départ.
- Pas de sonde `/ai.json` racine (aucune traction) ni validation de champs.

## C. Intégration (112 → 113 checks, llm-content 13 → 14)

1. `packages/cli/src/checks/llm-content.ts` : le check ; `checks/index.ts` : import +
   enregistrement après `llmsFullTxt`.
2. `packages/cli/test/fixtures/perfect-site/.well-known/ai.json` : objet JSON valide
   (forme de `generateAiJson`) — l'e2e perfect-site doit rester à 100.
3. `runner.test.ts` : `toHaveLength(112)` → 113.
4. `report/check-i18n.ts` : entrée bilingue `"well-known-ai-json"` (why + fix) —
   gate : `check-i18n.test.ts` exige la couverture de chaque check.
5. Décomptes 112 → 113 : `README.md` (l.11, 85, 310), `docs/guide.md` +
   `docs/guide.fr.md` (l.3 + nouvelle section de check EN/FR), `plugin/skills/geo-audit/SKILL.md`
   (l.8 + familles l.89 : llm-content 13 → 14), `apps/web/lib/i18n.mjs` (toutes occurrences),
   `apps/web/server.mjs` (l.261), `packages/cli/src/index.ts` (aide l.34),
   `packages/cli/src/report/i18n.ts` (commentaire l.12).
6. `README.md` § « The exact bot roster » : 14 → 28, tableaux des 3 tiers mis à jour,
   reformuler la phrase geo-optimizer (on égale+dépasse le volume **et** on garde la
   sévérité par intention) ; tableau famille : llm-content 13 → 14 + mention ai.json.
7. Roadmap : cocher §7 P1 « Découverte .well-known/ + ai.json », note MàJ LOT 3.

## D. Plan de test (RED d'abord)

- `test/checks/ai-access.test.ts` : invariants roster (≥27, doublons, disjonction,
  union) ; `DuckAssistBot` bloqué → fail (nouveau citation) ; `Diffbot` +
  `PanguBot` bloqués seuls → warn (nouveaux training) ; fix du fail ne casse pas.
- `test/checks/llm-content.test.ts` : 4 verdicts du tableau B via `stubCtx` +
  pass sur fixture `perfect-site`.
- Gates : `npx tsc --noEmit`, `npx vitest run` (CLI), `npm run build`,
  tests apps/web (`node --test` fichiers explicites), e2e perfect-site = 100.
