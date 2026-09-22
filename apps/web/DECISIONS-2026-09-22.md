# Interface Findable — 22 septembre 2026

## Décisions du lot local

- Identité Aube PB OpenTech sur accueil, pages publiques, attente et actions des rapports : fonds clairs, encre violette, spectre rose/violet/bleu/cyan. Le spectre profond porte le texte blanc ; vert/ambre/rouge restent les couleurs de résultat.
- Bricolage Grotesque et Geist sont servies localement sous `/fonts/`. Sources : paquets Fontsource déjà présents dans le projet PB OpenTech ; variantes latin normales variables, licences OFL jointes. Aucune dépendance runtime ajoutée.
- La loupe Findable est conservée ; signature « par PB OpenTech ». Favicon, OG et icône mobile suivent les mêmes couleurs.
- L’aperçu utilise uniquement `fixtures/example-report.json`, avec date, version et statut archivé explicites. Les nombres inventés, gains hypothétiques et promesses de citations ont été retirés. Le nombre de contrôles actuels vient de `buildChecks()`.
- Les formulaires acceptent un domaine nu. La comparaison expose deux champs distincts ; les anciennes URL API à virgules continuent de fonctionner.
- L’import historique accepte un fichier JSON ou un collage, sur la même route POST. Le fichier choisi est prioritaire. Analyse du multipart après la limite existante de 2 Mo, aucune écriture du fichier, noms dupliqués refusés ; les données passent ensuite par la validation de rapport existante.
- Les jobs en cours expirent toujours au bout de 3 minutes. Un rapport terminé dispose de 30 minutes depuis sa fin ; le plafond de 500 jobs et l’éviction des plus anciens restent appliqués. L’interface annonce donc une disponibilité « jusqu’à » 30 minutes.
- Progression avec valeur ARIA et statut annoncé ; focus perceptible, cibles et mouvement réduit. Les réponses et preuves du moteur sont activées avec `includeAnswerMatrix`.
- La mise en page du rapport CLI relève du lot du coordinateur. Le chrome web ajoute seulement les actions et les polices locales ; les exports autonomes conservent les ressources définies par le moteur.

## Contrôles locaux

Cycle discriminant rouge/vert : aperçu dérivé du fixture, saisie de domaine nu, concurrence séparée, import JSON réel en multipart et expiration depuis la fin. Cas parser supplémentaires : UTF-8, fichier vide, nom de fichier non fiable, champs dupliqués et multipart incomplet.

Le 22 septembre, `npm run build --workspace packages/cli` puis `node --test` dans `apps/web` : **267 tests passés, 0 échec** lors du premier passage complet après corrections. Les exécutions utilisent un `DATA_DIR` temporaire isolé ; aucun dossier de données privé n’a été lu.

Les contrôles de dogfooding ont signalé puis vérifié les corrections réelles suivantes : ancre de marque séparée de la signature, description FR raccourcie, CSS inline compacté, sources nommées et dates de modification cohérentes entre sitemap et JSON-LD. Les gardes existants sont conservés.

Revue indépendante : correction de l'instance réelle du serveur qui écrasait le TTL de trente minutes avec l'ancien délai de trois minutes. Un test d'intégration vérifie désormais les deux bornes. Suite finale intégrée : **268 tests passés**, build CLI 0.12.0 réussi.

Recette coordinateur : accueil mobile et bureau, largeurs 320/390/829/1440 sans débordement constaté sur les gabarits examinés, saisie d'un domaine nu, audit réel pb-ot.fr, preuves et filtres mesuré/heuristique, import d'un ancien JSON et affichage « Évolution vs référence ». Exports HTML/Markdown/JSON récupérés. La présence des règles reduced motion est testée, mais le réglage du système n'a pas été modifié pour simuler cette préférence. Cette recette n'est pas un audit exhaustif d'accessibilité. Aucun commit, push ou déploiement effectué.
