# Deep research vérifiée — mécanique de citation des moteurs génératifs (juillet 2026)

> Synthèse finale du harnais de recherche parallèle (3 passes, vérification adversariale 3 votants/claim).
> Statuts : ✅ confirmé (≥2 votes pour, 0 ou 1 contre) · ❌ réfuté (≥2 contre) · 🟡 non vérifié (infra, pas contenu).
> Fichier compagnon : `2026-07-24-geo-avant-garde.md` (idéation LOT 5, rédigé avant ces verdicts — les statuts ci-dessous font foi).

## 1. Claims CONFIRMÉS

### Mécanique des crawlers / fetchers
1. ✅ **3-0** — PerplexityBot est le crawler d'*indexation* de Perplexity (surfacer et lier des sites dans les résultats) ; il ne collecte pas de contenu pour l'entraînement de modèles. — docs.perplexity.ai/docs/resources/perplexity-crawlers
2. ✅ **3-0** — Perplexity-User (fetch déclenché par l'utilisateur) **ignore généralement robots.txt** : robots.txt n'est pas un contrôle effectif contre les fetchs à la demande. Distinction auditable index-time vs query-time. — docs.perplexity.ai (même page)

### Efficacité des tactiques GEO
3. ✅ **3-0** — L'efficacité des optimisations de contenu pour la visibilité générative **varie selon le domaine** ; pas de recette universelle. — arXiv 2311.09735 (papier GEO, KDD 2024)
4. ✅ **3-0** — La plupart des méthodes C-SEO (réécritures de contenu pour plaire aux LLM) sont **largement inefficaces et souvent contre-productives** sur le ranking/citation. — arXiv 2506.11097 (C-SEO Bench, NeurIPS D&B 2025)
5. ✅ **3-0** — Le **SEO traditionnel (améliorer le rank de retrieval** pour entrer plus haut dans le contexte du LLM) est **significativement plus efficace** que les réécritures C-SEO/GEO. — arXiv 2506.11097

### Comportement réel des moteurs (LMArena Search Arena, n=13 929, mars-avril 2025)
6. ✅ **3-0** — **34 % des réponses Gemini et 24 % des GPT-4o** « search » sont générées **sans aucun fetch live** (15,6 % global). — arXiv 2508.00838
7. ✅ **3-0** — Gemini ne fournit **aucune citation cliquable dans 92 % des réponses** (vs 25 % GPT-4o). — arXiv 2508.00838
8. ✅ **3-0** — Perplexity Sonar **visite ~10 pages pertinentes par requête mais n'en cite que 3-4** (gap d'attribution médian : 5 URLs). — arXiv 2508.00838

### Diagnostic par étape
9. ✅ **2-0** — Première **taxonomie des échecs de citation par étape du pipeline : retrieval → selection → generation** ; la perte de citation se diagnostique à une étape précise. — arXiv 2603.09296 (AgentGEO)
10. ✅ **2-0** — AgentGEO (diagnostic du mode d'échec + réparations ciblées) : **> +40 % relatif de taux de citation en ne modifiant que 5 % du contenu**, vs 25 % pour les réécritures uniformes. — arXiv 2603.09296

## 2. Claims RÉFUTÉS

1. ❌ **0-3** — « Le framework GEO augmente la visibilité jusqu'à +40 % » comme effet général reproductible : réfuté. C'est un maximum relatif sur une métrique précise (Position-Adjusted Word Count) dans une configuration particulière — pas un gain généralisable. — arXiv 2311.09735
2. ❌ **1-2** — « Un fetch Perplexity-User produit une citation vers la page » : le pipeline direct fetch→citation n'est pas documenté ainsi.
3. ❌ **1-2** — « Les évals GEO mesurent l'influence sur la réponse, pas la citation réelle » : formulation trop forte, rejetée par les vérificateurs.

## 3. Claims NON VÉRIFIÉS (plausibles, sources réelles, vérification interrompue)

- FeatGEO : la citation est pilotée par des propriétés *document-level* (structure, linguistique) plutôt que des micro-édits lexicaux ; sélection par citation ≠ retrieval rankée. — arXiv 2604.19113
- Vercel × MERJ (avr. 2024) : Googlebot rend le JS à ~100 % sur pages indexables ; l'étude ne couvre PAS les crawlers IA (follow-up déc. 2024 : eux ne rendent majoritairement pas le JS).
- Docs OpenAI (rév. 9 déc. 2025) : robots.txt appliqué à OAI-SearchBot et GPTBot seulement ; ChatGPT-User exempté ; coordination de crawl OAI-SearchBot/GPTBot. — ppc.land
- Divergence des sources AI Overviews vs SERP classique ; stats Ahrefs Brand Radar ; tracking Profound (30 M citations) ; « evidence extractable » comme levier.
- llms.txt : quasi aucun requester observé dans les logs serveur ; étude OtterlyAI 90 j sans effet mesuré.

## 4. Implications produit (findable-audit)

1. **Notre thèse centrale est validée par le meilleur niveau de preuve disponible** : l'amont (retrouvabilité, accès, extraction) domine les retouches stylistiques (claims 4-5, 3-0). L'audit crawl-first attaque le bon levier ; les générateurs de « contenu GEO » attaquent le mauvais.
2. **Le tiering du roster par intention est conforté et doit être affiné** (LOT 3) : la paire PerplexityBot (index, respecte robots) / Perplexity-User (fetch live, ignore robots) prouve que « bloquer » et « être cité » se jouent à des moments différents — à documenter dans la section roster.
3. **La grille retrieval → selection → generation** (claim 9) devient notre colonne vertébrale d'organisation des checks GEO — alignée avec la reco LOT 5 (`retrieval-sim`, `citability`, `injection-hygiene`, `freshness-integrity`).
4. **Honnêteté marketing** : ne jamais citer « +40 % GEO » comme promesse (réfuté 0-3) ; le README P0 « signaux non prouvés » est la bonne posture — l'étendre au discours sur llms.txt et les tactiques de réécriture.
5. **Réalisme sur l'impact** : une part importante des réponses IA se fait sans fetch live et sans citation (claims 6-7) — l'audit doit vendre la *probabilité* de citation, pas sa garantie.

## 5. Méthode & coût (note interne)

3 passes du harnais (106 agents : fetchers + 3 vérificateurs/claim + synthèse), interrompues par les limites de session ; ~2,9 M tokens consommés au total. Verdict : le fan-out parallèle massif est **interdit** désormais sur ce compte — la synthèse finale a été rédigée en session directe à partir des verdicts déjà acquis (10 ✅ / 3 ❌), les 🟡 restants étant jugés secondaires et non bloquants.
