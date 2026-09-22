# SEO/GEO — choix du 22 septembre 2026

Objectif : améliorer les diagnostics Findable et leur usage, harmoniser l'interface avec PB OpenTech, appliquer les corrections vérifiables sur pb-ot.fr. Les modifications locales antérieures restent conservées. Ce document ne constitue pas une publication npm ou un déploiement.

## Sources examinées

Les publications publiques ont été lues le 22 septembre, y compris le tweet cité par Aurélien Bardon. Leurs résultats commerciaux et comparatifs de modèles sont déclaratifs, non reproduits.

- [DanielK](https://x.com/danielkbuilds/status/2100938823391711246) : contrôler les contenus au regard des recommandations Google avant publication. Application : contrôles éditoriaux et techniques, pas une garantie d'indexation.
- [Aurélien Bardon](https://x.com/aurelienbardon/status/2101094639503810616), citant [borja](https://x.com/borjafat/status/2101018783976722479) : suggestions de liens internes avec ancre pertinente et abstention. Application : examiner les possibilités réelles de maillage ; ne pas insérer massivement des liens.
- [Shann](https://x.com/shannholmberg/status/2100979911825789393) : confronter un contenu aux questions et sujets attendus. Application : preuves et couverture de questions explicites dans l'échantillon ; aucune prédiction de classement.
- [Ira Bodnar](https://x.com/irabukht/status/2101090579127951694) : données de recherche, citations et écarts de contenu. Les gains de vitesse/coût ne sont pas validés ici.
- [Deno](https://x.com/denohawari/status/2101296504812220575) : exports Search Console et suivi de mentions. Le kit nécessite des interactions sociales ; il n'a pas été obtenu. Aucun accès Search Console ou mesure de citation n'est simulé.
- [Charles Floate](https://x.com/charles_seo/status/2101254605460095252) : expérience individuelle de visibilité via une plateforme Google. Ce récit ne justifie ni une stratégie de pages parasites ni une promesse de citation.

Les [recommandations officielles Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) confortent le contenu utile, l'accès au crawl et la qualité technique. Elles ne demandent ni fichier llms.txt, ni découpage artificiel, ni balisage spécial pour les fonctionnalités IA. Les [robots OpenAI](https://developers.openai.com/api/docs/bots) distinguent recherche et entraînement : leur accès ne se confond pas avec une preuve de citation. Les [dates sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) doivent refléter des modifications significatives réelles.

## Implémentation retenue

- Corriger les défauts reproduits du lot existant avant toute nouvelle interprétation.
- Ajouter aux réponses détectées leurs extraits justificatifs et leur provenance, sans toucher au score.
- Confronter les questions métier fournies au corpus : rapprochement lexical explicite, réponse trouvée/à vérifier/absente de l'échantillon.
- Exposer la taille et les limites de l'échantillon.
- Proposer jusqu'à vingt liens internes à partir d'ancres réellement présentes, vers des pages échantillonnées indexables du même site ; abstention en cas de lien existant, d'ambiguïté ou de texte caché. Chaque proposition conserve son extrait et demande une revue humaine.
- Rapports lisibles : séparer constat mesuré et conseil heuristique, conserver toutes les preuves et les exports.
- Reprendre la palette Aube de PB dans interface, marque, rapports et comparaisons ; conserver les couleurs de statut.
- Simplifier les formulaires, l'import et la conservation temporaire du résultat ; maintenir SSRF, CSP, bornes et bilinguisme.

## Vérification

Tests unitaires discriminants, builds, suites CLI/web dans leurs workspaces, fixture parfaite à 100, contrôle d'échappement des extraits et imports, recette navigateur aux largeurs 320/390/829/1440. Distinguer réussite locale, observations du site public et effet sur classement/citations, non mesuré.

Résultat intégré du 22/09 : build réussi, 1 584 tests CLI et 268 tests web réussis. La revue indépendante a révélé une configuration serveur qui conservait encore les rapports trois minutes ; le correctif et son test portent sur l'instance réelle, avec trente minutes après terminaison et trois minutes pour un job inachevé.

Les affirmations Cloudflare et accessibilité ont été corrigées après lecture de leurs documentations officielles : les en-têtes d'un fournisseur ne révèlent pas les réglages du compte, et une taille d'entreprise ne suffit pas à établir une obligation RGAA. Le rapport Search Console IA existe bien dans la [documentation officielle Google](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports) ; aucune donnée du compte PB n'a été consultée ici.

## Livraison préparée

Version mineure 0.12.0 alignée dans le paquet CLI, le plugin et le lockfile. `npm pack --dry-run --json` réussi : 191 fichiers, uniquement le paquet publiable. Pierig a autorisé la publication Git/VPS après revue le 22/09, en réponse à la demande incluant npm 0.12.0. Le workflow de release utilise désormais la commande racine `npm run build` : l'ancienne commande échouait sur le workspace web dépourvu de build. L'authentification reste OIDC. La réussite du push, du déploiement et de npm doit être constatée séparément.
