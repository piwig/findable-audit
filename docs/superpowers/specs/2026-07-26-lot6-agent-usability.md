# LOT 6 — `agent-usability` (backlog « GEO avancé », 1ʳᵉ entrée)

Statut : spec → implémentation. Compte de checks **119 → 120**.

## Pourquoi celui-là d'abord

`docs/backlog-geo-avance.md` §« LOT 6+ » liste `agent-usability` en tête : *« actions clés
faisables sans JS (formulaires, labels, schema.org Actions) »*. C'est le seul item du lot
qui soit **crawl-only** (zéro fetch réseau supplémentaire, zéro dépendance à un standard
non stabilisé) tout en couvrant la question que les autres checks ne posent pas :

> les checks existants mesurent si un moteur peut **lire** le site.
> Celui-ci mesure si un agent peut **agir** dessus.

Les autres items du lot sont écartés pour ce tour : `boucle sameAs réelle` et
`stabilité temporelle` doublent le coût réseau, `matrice politiques IA` dépend d'une pile
(ai.txt / tdmrep / RSL) encore instable, `cohérence d'entité cross-page` recoupe
largement `nap-consistency` + `sd-consistency` déjà livrés, `negative space` demande une
taxonomie par type de site, `C2PA` est un pari 2027.

## Ce que le check vérifie

Famille `llm-content`, **4 points**, id `agent-usability`.

Deux dimensions, sur les pages échantillonnées.

### D1 — Les formulaires sont-ils soumettables sans JS ? (active s'il y a ≥1 `<form>`)

Par formulaire, du plus dur au plus doux :

| Constat | Verdict | Raison |
|---|---|---|
| un contrôle de soumission est `disabled` | **fail** | impasse pour tout le monde, agent comme visiteur |
| aucun contrôle de soumission | **fail** | rien à soumettre sans gestionnaire JS |
| `action` en `javascript:` ou `#` | **warn** | soumission réservée au JS |
| des contrôles nommables sans `name` | **warn** | ces champs ne partent jamais dans la requête |

`action` **absent** n'est pas pénalisé : en HTML, un formulaire sans `action` poste sur
l'URL courante — c'est valide et fonctionnel. Pénaliser l'absence serait un faux positif.

### D2 — Existe-t-il un chemin de contact lisible par machine ? (toujours active)

Au moins un parmi : `mailto:`, `tel:`, un `<form>` dont l'`action` n'est pas en
`javascript:`, ou un nœud JSON-LD portant `email` / `telephone` / `contactPoint` (ou de
type `ContactPoint`). Sinon **warn** : l'agent sait quoi dire du site, mais pas comment
le joindre.

## Assemblage

`skip` si aucune page atteignable. Sinon : `fail` si une page a un formulaire en fail ;
`warn` si un formulaire en warn ou D2 non satisfaite ; `pass` sinon. Le détail par page
passe par `rollupBySeverity` (format d'offenders partagé, §7).

## Invariants à ne pas casser

- **perfect-site = 100** : la fixture a `tel:` + `mailto:` + `potentialAction` et **aucun**
  `<form>` → D1 inactive, D2 satisfaite → `pass`. Intact.
- **`llm-good`** (homepage seule, ni formulaire ni mailto/tel) → `warn`, pas `skip` : la
  liste de skips de `runner.test.ts` reste inchangée, seul le compte 119 → 120 bouge.
- **Dogfooding `apps/web`** : les deux formulaires de la landing ont `method` + `action` +
  `<button type="submit">` et des champs nommés → D1 pass ; l'`action` non-JS satisfait
  D2 → `pass`. Aucun verdict à assouplir.

## Gates de test

1. `packages/cli/test/runner.test.ts` : compte `119` → `120`.
2. `CHECK_I18N` (`report/check-i18n.ts`) : `why` **et** `fix` en EN + FR — obligatoire.
3. `docs/guide.md` + `docs/guide.fr.md` : une entrée chacun.
4. Compteurs de doc : README (×3) + en-tête des deux guides.
5. `packages/cli/test/checks/agentic.test.ts` : unitaires `classifyForm` +
   `hasMachineContactPath` + les 4 verdicts du check.
