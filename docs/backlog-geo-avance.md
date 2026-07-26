# Backlog « GEO avancé » — idées R&D (juillet 2026)

Source : `docs/research/2026-07-24-geo-avant-garde.md` (idéation) + `docs/research/2026-07-25-deep-research-citations-verifiee.md` (claims vérifiés 3-0/2-0).
Grille d'organisation : **retrieval → selection → generation** (taxonomie AgentGEO, arXiv 2603.09296, confirmée 2-0).

## Quick wins — section « GEO avancé » (à implémenter en premier)

| # | Idée | Principe | Étape | Coût |
|---|------|----------|-------|------|
| QW1 | 🕐 **Cohérence tripartite de fraîcheur** | `Last-Modified` HTTP vs `dateModified` JSON-LD vs `lastmod` sitemap : s'ils divergent, le signal de fraîcheur est ignoré (anti « fake freshness ») | retrieval | faible — les 3 sources sont déjà crawlées |
| QW2 | 🖋️ **Taux de hedging** | « peut-être / il semble / selon les cas » dans les leads — les moteurs citent les affirmations nettes | selection | faible — lexical FR/EN |
| QW3 | 🎯 **Citabilité par passage** | « unités de réponse » : affirmation directe + chiffre/date/entité + autosuffisante + < N mots | selection | moyen — heuristique AST |
| QW4 | ✂️ **Chunk-boundary hygiene** | tableaux sans en-têtes répétés, réponses FAQ séparées de leur question, listes orphelines de leur titre | generation | moyen — DOM pur |

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
| 🤖 **Agent-usability score** | actions clés faisables sans JS (formulaires, labels, schema.org Actions) | synergie #14 agentic |
| 🔁 **Boucle sameAs réelle** | résoudre Wikidata/Wikipedia, matcher libellés, lien retour | fetchs externes |
| ⚔️ **Cohérence d'entité cross-page** | variance des prix/adresses/claims entre pages échantillonnées | précision d'extraction |
| 📇 **Fact-sheet canonique** | page de faits clés machine-lisibles, datés, sourcés (extension `--emit`) | dépend de QW3 |
| 🕳️ **Negative space** | questions évidentes sans réponse par type de site (prix ? horaires ?) | taxonomie par type |
| 🌡️ **Stabilité temporelle** | re-fetch ×2 + diff du contenu principal | double le coût réseau |
| 🔏 **Provenance C2PA** | contenus signés, signal anti-slop | pari 2027 |
| 🗂️ **Matrice politiques IA** | robots.txt × ai.txt × tdmrep.json × RSL : contradictions | pile pas stabilisée |
| 🛰️ **Affordances agentiques** | tier WebMCP / NLWeb / agents.json sur tout le crawl | standards jeunes |

## Garde-fous (recherche vérifiée)

- Ne jamais promettre « +40 % » (réfuté 0-3) ; l'efficacité varie par domaine (confirmé 3-0).
- La retrouvabilité bat la réécriture stylistique (confirmé 3-0) — les checks amont restent prioritaires.
- Une part des réponses IA se fait sans fetch live ni citation (34 %/24 %, 92 % sans lien pour Gemini) : vendre la *probabilité* de citation, jamais la garantie.
