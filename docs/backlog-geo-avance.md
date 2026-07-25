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

## LOT 5 recommandé (socle chunker partagé)

| Idée | Principe | Note |
|------|----------|------|
| 🧪 **RAG twin / retrieval-sim** | chunker ~512 tokens + score d'autosuffisance par chunk (pronoms sans antécédent, entité absente) | LE moonshot crawl-only |
| 🧼 **Injection-hygiene** | texte caché, impératifs machine, UGC non délimité | la propreté devient facteur de citation |
| 🔁 **Self-containment anaphorique** | ratio de phrases qui ne survivent pas à l'extraction isolée | fusionne avec retrieval-sim |

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
