# Proposition de refonte design — landing + rapport (2026-07-26)

Périmètre : `apps/web` (landing) et `packages/cli/src/report/html.ts` (rapport, partagé
web + export). Objectif énoncé : **rendre le rapport beaucoup plus compréhensible et
user-friendly**.

> **État au 26/07/2026 (soir) — lots A, B, C, D et la landing sont implémentés et
> déployés.** Le lot E (messages dynamiques paramétrés et localisés) ne l'est pas :
> il demande de toucher les 120 checks un par un pour qu'ils renvoient une clé et
> des valeurs au lieu d'une phrase, plus ~250 entrées de catalogue en deux langues,
> plus la reprise de toutes les assertions de test qui portent sur ces messages.
> C'est le chantier que la section 1.3 classait déjà « à isoler dans son propre
> lot » ; le livrer à moitié laisserait la moitié des checks dans un format et
> l'autre dans un second. Il reste donc ouvert, et le rapport FR affiche toujours
> le `message` des checks en anglais.
>
> Détail de ce qui a été fait : verdict en langue naturelle déterministe
> (`report/axes.ts`), trois axes, un seul visuel de score, page neutre, barre
> collante, pluriel corrigé (A) ; couloirs d'effort, projection de score exacte,
> URL par item, extraits prêts à coller (`report/snippets.ts`), plus de plafond
> muet (B) ; thème sombre, ligne de check redessinée, réussis repliés (C) ;
> `CHECK_TITLES` — 120 titres EN/FR (D) ; landing en deux colonnes avec aperçu du
> livrable, formulaire unique à deux modes, CTA vert, ligne de preuve, rapport
> d'exemple réel figé.

Constat établi sur pièces : landing FR en prod (`findable.bordebat.fr/fr/`) et rapport
réel généré contre `masse-motoculture.bordebat.fr` (76/100, note C, 120 checks).

---

## 1. Le rapport

### 1.1 Ce qui ne va pas aujourd'hui (mesuré, pas ressenti)

| # | Constat | Preuve |
|---|---|---|
| R1 | **Le rapport fait 17 900 px de haut. Le tableau des 120 checks en occupe ~97 %.** Le verdict, la dataviz, les sous-scores et le plan d'action tiennent dans les 3 % du haut. | capture pleine page |
| R2 | **Le score est affiché trois fois** : pastille du hero, jauge radiale, tableau des sous-scores. | `html.ts` `hero` + `vizSection` + `subscoreSection` |
| R3 | **Deux jeux de libellés pour les mêmes 8 familles** : la jauge dit « SEO / Contenu IA / Données / Perf / A11y », le tableau dit « SEO technique / Contenu moteur de réponse / Données structurées & métadonnées / Performance & Core Web Vitals / Accessibilité ». Le lecteur croit voir deux mesures différentes. | `FAMILY_SHORT_I18N` vs `FAMILY_LABELS_I18N` |
| R4 | **Aucune navigation** dans un document de 18 000 px : pas de sommaire, pas d'ancre, pas de barre collante. | `html.ts` |
| R5 | **L'identifiant technique du check est le titre de la ligne** (`sd-entity-grounding` en monospace), et le `message` dynamique reste en anglais même en rapport FR. | `html.ts` ligne `<code>${r.id}</code>`, commentaire « dynamic per-check message stays English » |
| R6 | **Les 54 réussis pèsent visuellement autant que les 33 à corriger** : même typo, même densité, même largeur. | rendu |
| R7 | **La couleur de la note contamine toute la page.** En note C, tout le haut est ambre/olive : la sévérité n'est plus lisible parce que tout est de la même couleur. | rendu C vs A |
| R8 | **Bug de pluriel** : « 54 réussis · 33 à corriger · **1 pages** ». | `i18n.ts` `m.stats` |
| R9 | **Le plan d'action ne dit pas *où*.** « Ajoutez un fichier /llms.txt » sans l'URL concernée, et il est plafonné à 12 items avec un simple « +N autres ». | `html.ts` `CAP = 12` |
| R10 | **Aucune projection.** Le lecteur voit « −21 pts SEO » mais jamais « si vous faites ces 5 corrections rapides : 76 → 88, note B ». C'est l'information qu'il vient chercher. | absent |
| R11 | Pas de thème sombre, alors que le rapport est consulté à l'écran dans 100 % des cas web. | `:root { color-scheme: light }` |

### 1.2 La refonte proposée : trois couches, un écran chacune

Le principe directeur : **un rapport n'est pas une base de données, c'est un argumentaire.**
Aujourd'hui il livre les données puis laisse le lecteur faire l'argumentaire.

#### Couche 1 — LE VERDICT (un écran, zéro scroll)

Une seule carte, et **un seul** visuel de score (on supprime le doublon R2).

- La note et le score, en gros, sur fond **neutre** — la couleur ne sert plus qu'au statut (R7).
- Une phrase en langue naturelle, pas un adjectif : au lieu de « Correct — 13 priorité(s)
  freinent la findabilité », écrire *« Google lit votre site correctement, mais un
  assistant IA n'y trouve ni fiche d'identité structurée ni fichier d'orientation :
  il peut vous décrire, pas vous citer. »* Générée par règles à partir des familles les
  plus déficitaires — déterministe, comme tout le reste.
- **Trois tuiles au lieu de huit familles.** Les 8 familles restent le modèle de score ;
  l'affichage de tête les regroupe en trois axes qu'un client comprend sans glossaire :

  | Axe affiché | Familles agrégées | Question posée |
  |---|---|---|
  | **Trouvable** | ai-access + technical-seo | est-ce que les crawlers arrivent jusqu'à la page ? |
  | **Compréhensible** | llm-content + structured-data + on-page | est-ce qu'ils comprennent ce qu'ils lisent ? |
  | **Utilisable** | performance + accessibility + security | est-ce que la page tient la route pour un humain et pour un agent ? |

  Le détail par famille descend en couche 3, sous un `<details>`. Les 8 familles ne
  disparaissent pas : elles cessent d'être la *première* chose lue.

#### Couche 2 — LE PLAN (un écran) — c'est ici que se joue le gain

Le plan d'action devient la pièce centrale, pas la quatrième section.

- **Organisé en couloirs d'effort** (`effort.ts` fournit déjà `quick / moderate / involved`) :
  *Rapide (< 1 h)* · *Modéré (une demi-journée)* · *Chantier*. Un client arbitre sur
  l'effort, pas sur la famille.
- **Projection de score en tête de chaque couloir** (R10) : « les 6 rapides : **76 → 88 (B)** ».
  Calculable exactement — `impact` est déjà la somme des points récupérables.
- **Chaque item porte son URL** (R9) : la ligne cite le chemin concerné, pas seulement la
  consigne. Le `message` des checks contient déjà la liste d'offenders : il suffit de la
  remonter dans l'item de plan.
- **Un `<details>` « comment faire » par item**, avec le bout de code prêt à coller
  (en-tête nginx, bloc JSON-LD, ligne robots.txt). `packages/cli/src/generate/` produit
  déjà ces contenus pour `--emit` : c'est la même source, exposée au bon endroit.
- **Plus de plafond à 12 muet.** Tout est là, les items au-delà du 12ᵉ replié par défaut.

#### Couche 3 — LE DÉTAIL (replié)

- Les familles restent en `<details>` (déjà le cas en web), mais **les réussis sont
  masqués par défaut** derrière un « afficher les 54 réussis » (R6). Un rapport doit
  d'abord montrer ce qui cloche.
- **Redessin de la ligne** (R5) : le titre humain d'abord, l'identifiant technique
  rétrogradé en petit tag mono à droite, le statut en pastille colorée.
  → nécessite un champ `title` EN/FR dans `CHECK_I18N` (120 entrées, même geste que
  `why`/`fix`). C'est le plus gros morceau de rédaction du chantier, et le plus rentable :
  c'est ce que le lecteur lit en premier sur 120 lignes.
- **Traduire le `message` dynamique** (R5) : aujourd'hui un rapport FR affiche
  « no Content-Security-Policy ». Approche : les checks renvoient un message *paramétré*
  (clé + valeurs) au lieu d'une phrase, le rendu localise. Chantier réel, à isoler dans
  son propre lot.

#### Transversal

- **Barre collante** (R4) : `position: sticky` en haut, quatre ancres — Verdict · Plan ·
  Core Web Vitals · Détail — + la note en rappel. Zéro JS, donc compatible avec la CSP
  `script-src 'none'` de la landing.
- **Thème sombre** (R11) : `@media (prefers-color-scheme: dark)`, `color-scheme: light dark`.
  Les couleurs de statut actuelles (#1a7f37 / #9a6700 / #b42318) doivent être relevées en
  luminosité pour rester à 4.5:1 sur fond sombre.
- **Impression** : la couche 1 + la couche 2 forment une synthèse d'une page. Garder la
  règle actuelle « à l'impression, tout est déplié » mais forcer un saut de page après le
  plan, pour que la synthèse soit imprimable seule.
- **Correction du pluriel** (R8).

### 1.3 Découpage suggéré (du plus rentable au moins)

| Lot | Contenu | Coût | Gain |
|---|---|---|---|
| **A** | couche 1 (verdict + 3 axes, un seul visuel de score, page neutre), pluriel, barre collante | faible | énorme — c'est ce qui est lu |
| **B** | couche 2 (couloirs d'effort, projection de score, URL par item, plus de plafond) | moyen | énorme |
| **C** | thème sombre + redessin de la ligne + réussis masqués | moyen | fort |
| **D** | `title` EN/FR pour les 120 checks | rédaction lourde | fort |
| **E** | messages dynamiques paramétrés et localisés | chantier | moyen (mais dette qui grossit) |

---

## 2. La landing

### 2.1 Ce qui ne va pas

| # | Constat |
|---|---|
| L1 | **La page occupe ~640 px de large sur un écran de 1280+.** Elle se lit comme un document, pas comme un produit. Le reste de l'écran est vide. |
| L2 | **Deux formulaires concurrents** (auditer / comparer) avec deux CTA de même poids. Le visiteur doit choisir avant d'avoir compris. |
| L3 | **Le widget Turnstile est posé à droite du champ URL** et pousse le bouton « Auditer » à la ligne suivante : la ligne de formulaire est cassée, le CTA se retrouve orphelin. |
| L4 | **Le CTA principal est noir**, alors que l'accent de marque est vert. Il lit comme un bouton secondaire, voire désactivé. |
| L5 | **On ne montre jamais le livrable.** Un outil d'audit se vend par son rapport ; ici il faut lancer un audit pour savoir ce qu'on obtient. |
| L6 | **Huit puces de familles** en jargon comme première information (« Contenu pour moteurs de réponse »). |
| L7 | Pas de thème sombre. |
| L8 | Aucune preuve. Le site marque **99/100 A avec son propre moteur** — c'est l'argument le plus fort du produit et il n'est écrit nulle part. |

### 2.2 La refonte proposée

- **Hero sur deux colonnes** (L1, L5) : à gauche la promesse + le formulaire ; à droite
  **un aperçu réel du rapport** — la carte de verdict, les trois axes, deux lignes de plan
  d'action. Statique, rendu par le même code que le rapport, donc jamais en décalage avec
  le produit. Une colonne sur mobile.
- **Un seul formulaire, deux modes** (L2) : deux onglets « Un site » / « Comparer » au-dessus
  d'un unique champ. Faisable sans JS avec deux `<form>` et une bascule `:target` ou
  `<details>` — la CSP `script-src 'none'` reste intacte. Un seul CTA visible à la fois.
- **Turnstile sous le champ, pleine largeur** (L3), CTA collé au champ.
- **CTA en vert de marque** avec un état `:hover` plus foncé (L4).
- **« Voir un rapport d'exemple »** en lien secondaire sous le CTA (L5) : un rapport figé,
  vrai, indexable — excellent pour la conversion **et** pour le GEO (une page de contenu
  substantiel de plus, citable).
- **Trois axes au lieu de huit familles** (L6), cohérents avec la couche 1 du rapport ;
  les 8 familles restent, dans un `<details>` « le détail des 8 familles ».
- **Une ligne de preuve** (L8) : « Ce site obtient 99/100 (A) avec son propre moteur —
  et les deux avertissements restants sont documentés. » Vérifiable, verrouillé par un
  test de dogfooding, donc honnête.
- **Thème sombre** (L7), même bascule que le rapport.

### 2.3 Ce qu'il ne faut surtout pas casser

Contrats vérifiés par des tests existants — la refonte doit les préserver tels quels :
`action` et `name="url"` des deux formulaires, le markup du sélecteur de langue, les
`hreflang`, le `@graph` JSON-LD connecté (test `entity-graph-connectivity` en dogfooding),
le markup de liste sémantique `<ul class="ld-chips">` / `<ol class="ld-steps">`
(test `branding`/`dogfooding`), et la CSP `script-src 'none'` hors Turnstile.

---

## 3. Ordre d'exécution recommandé

1. **Rapport lot A** puis **lot B** — le rapport est le livrable, la landing n'est que la
   porte d'entrée. C'est aussi là que « beaucoup plus compréhensible » se gagne.
2. **Landing hero + formulaire unifié + CTA vert** — court, visible immédiatement.
3. **Rapport lot C**, puis D, puis E.
