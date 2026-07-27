# LOT 9 — « Fermer la boucle » (spec, 2026-07-27)

L'outil détecte, et depuis `--emit` il génère. Il ne **soumet** rien, et il ne vérifie pas
le seul fichier `.well-known/` que le LOT 3 avait laissé de côté. Ce lot ferme les deux.

Périmètre validé par l'utilisateur (2026-07-27, y compris l'accord explicite sur IndexNow).

## Contraintes héritées (CLAUDE.md)

- Zéro nouvelle dépendance runtime · cross-platform strict · `process.exitCode`, jamais
  `process.exit` · `buildChecks().length` est la seule source du décompte, à propager dans
  **onze** fichiers (skill `findable-new-check`) · sujets de commit français sans accents.
- Politique de verdict : un défaut vérifiable peut `fail` ; une heuristique de contenu est
  `warn` au maximum ; une précondition absente `skip`.
- **Publier sur npm fait partie de la livraison** (CLAUDE.md § *Shipping*) : ce lot ajoute
  un check et un flag → version **mineure**.

## A. Check `security-txt` (famille `security`, 2 pts) — 120 → 121

RFC 9116. Une adresse de signalement lisible par machine est un signal de sérieux que les
moteurs et les chercheurs en sécurité utilisent, et c'est le dernier `.well-known/` du
backlog #13 (« Reste : `security.txt` (non couvert) »).

| Situation | Verdict | Pourquoi |
|---|---|---|
| `/.well-known/security.txt` 200, champ `Contact:` présent, `Expires:` dans le futur | `pass` | conforme et vivant |
| 200 avec `Contact:` mais `Expires:` absent | `warn` | RFC 9116 l'exige, mais le fichier remplit sa fonction |
| 200 avec `Contact:` et `Expires:` **dépassé** | `warn` | un fichier périmé dit « personne ne maintient ça » |
| 200 sans `Contact:` | `warn` | le seul champ obligatoire manque : le fichier ne sert à rien |
| 200 mais pas du texte (shell HTML d'une SPA) | `warn` | même piège que `well-known-ai-json` |
| absent / non-200 | `warn` | bonne pratique, pas un défaut de findabilité → **jamais `fail`** |

Un seul `ctx.fetch('/.well-known/security.txt')`, aucun crawl supplémentaire. Le parsing
reste littéral (champs `Nom: valeur`, commentaires `#`), sans dépendance.

## B. `--submit` — soumission IndexNow (#61)

Transforme l'audit en boucle **détecter → générer → soumettre**. IndexNow notifie **Bing,
Yandex, Seznam, Naver** (Google n'y participe pas ; le guide continue de renvoyer vers la
Search Console, sans promettre autre chose).

**Garde-fous, non négociables** — c'est la première action de l'outil qui écrit chez un
tiers au nom de l'utilisateur :

1. **Opt-in explicite** : rien ne part sans `--submit` sur la ligne de commande.
2. **Preuve de propriété** : `--submit` exige `--indexnow-key`, **et** que le check
   `indexnow` soit `pass` sur ce run — c'est-à-dire que `/<clé>.txt` soit réellement
   hébergé sur le site audité. On ne peut donc pas soumettre le site d'un tiers.
3. **Rien depuis le web** : `apps/web` n'expose pas et n'exposera pas cette action.
4. **Périmètre borné** : uniquement les URL **effectivement échantillonnées** pendant
   l'audit (`report.sampledPages`), donc au plus `--max-pages`, toutes de l'origine
   auditée. Aucune URL devinée, aucune URL externe.
5. **Aucun secret dans les rapports** : la clé n'apparaît ni en JSON, ni en HTML, ni en MD.
6. **Jamais bloquant** : un échec réseau ou un refus du service s'affiche et laisse le code
   de sortie de l'audit inchangé — une soumission ratée n'est pas un audit raté.

Endpoint : `POST https://api.indexnow.org/indexnow`, corps
`{ host, key, keyLocation, urlList }`. Le module `submit/indexnow.ts` reste **pur et
testable** : un constructeur de charge utile sans effet, et une fonction de soumission qui
reçoit son `fetch` en paramètre.

## C. Ce que ce lot ne fait pas

- Pas de `fix --apply` (#11) : `--emit` couvre déjà la génération, et écrire dans l'arbre
  de fichiers de l'utilisateur mérite sa propre spec et son propre lot.
- Pas de soumission Google : hors IndexNow, le ping sitemap est déprécié depuis 2023 ; la
  seule voie honnête est la Search Console, et elle demande une authentification
  utilisateur qu'on refuse de porter.
- Pas d'étiquetage `mesuré / heuristique` (#63) : bonne idée, lot suivant.

## Checklist d'intégration

1. `checks/security.ts` : `securityTxt` + barrel + `buildChecks()`.
2. `report/check-i18n.ts` : entrée `why`/`fix` bilingue.
3. Tests unitaires du check (tous les verdicts, y compris `skip` implicite via erreur).
4. `runner.test.ts` : `toHaveLength(121)` ; le fixture `perfect-site` doit rester à 100.
5. `submit/indexnow.ts` + tests (charge utile, garde de propriété, échec réseau).
6. `index.ts` : flag `--submit`, validation, exécution après le rapport, jamais bloquante.
7. Propagation du décompte 120 → 121 dans les **onze** fichiers du skill.
8. Docs : README (EN), `docs/guide.md`, `docs/guide.fr.md`, plugin skill.
9. `npm run build --workspaces && npm test --workspaces` + `cd apps/web && node --test`.
10. Dogfooding contre l'app locale, puis release **0.3.0** (nouveau check + nouveau flag).
