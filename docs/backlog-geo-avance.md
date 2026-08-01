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
| A4 | 📈 **Sparkline de score dans le rapport HTML** | `--history` stocke déjà la série ; l'afficher (tendance du score global + par axe) dans le HTML | moyen / faible |
| A5 | 💬 **Commentaire de PR via l'action GitHub** | `action.yml` existe ; publier le diff vs `--baseline` (checks gagnés/perdus, delta de score) en commentaire de PR, comme les outils CI comparables | moyen / moyen |

## Garde-fous (recherche vérifiée)

- Ne jamais promettre « +40 % » (réfuté 0-3) ; l'efficacité varie par domaine (confirmé 3-0).
- La retrouvabilité bat la réécriture stylistique (confirmé 3-0) — les checks amont restent prioritaires.
- Une part des réponses IA se fait sans fetch live ni citation (34 %/24 %, 92 % sans lien pour Gemini) : vendre la *probabilité* de citation, jamais la garantie.
