# Matrice de réponses — design

> Spec de conception, 2026-07-27. Statut : **validée par l'utilisateur, plan d'implémentation à écrire.**
> Suite de la direction « A » retenue le 2026-07-27 (voir §12.F de `docs/competitive-analysis-and-roadmap.md`
> pour le sujet voisin — le suivi de positionnement — délibérément **non lancé**).

## 1. Le problème

Tout le marché audite des **pages** : le HTML est-il propre, le balisage valide, le contenu
atteignable. Personne n'audite des **réponses** : de quelle question ce contenu est-il la
réponse, et existe-t-il quelque part un passage citable qui la traite.

Le socle est déjà posé par le LOT 5. `chunkContent()` découpe en fenêtres de ~512 tokens et
`chunkSurvives()` sait dire si une fenêtre tient debout isolée. Ce qui manque est l'autre
moitié de la question : **une fenêtre, oui, mais réponse à quoi ?**

La matrice de réponses répond à ça sans clé, sans appel externe, sans IA, et de façon
reproductible : elle dérive des questions de ce que le site **déclare lui-même**, puis
vérifie, contre le corpus crawlé, si chacune trouve un passage autonome.

## 2. Décisions déjà tranchées

Arbitrées avec l'utilisateur le 2026-07-27, avant rédaction :

| Décision | Choix retenu |
|---|---|
| Ambition de génération | **Croisement des sujets déclarés + grille d'intentions figée, typée par `@type`.** Ni croisement pur (trop pauvre : un site qui déclare peu se tait précisément là où il va mal), ni expansion lexicale (fabrique de faux trous et une dette de lexique FR+EN). |
| Sortie | **Un check scoré + une section de rapport**, sur le patron déjà validé par `entity-graph-connectivity` + `--entity-graph`. |
| Langue de la grille | Celle du **site** (`html-lang` / hreflang), pas celle du rapport. Auditer un site anglais avec `--lang fr` ne doit pas produire une matrice française vide. |

## 3. Non-objectifs

Explicitement hors périmètre, et à refuser si la question revient pendant l'implémentation :

- **Prétendre que ces questions sont recherchées.** Nous n'avons aucun moyen d'observer la
  demande en crawl-only. La matrice mesure une **auto-cohérence** : le site promet un
  service et une zone, tient-il la promesse par un passage citable. Rien de plus.
- Interroger un moteur ou un assistant (c'est le §12.F, non lancé).
- Deviner des zones desservies depuis la prose (voir §5).
- Écrire un second chunker : on réutilise `checks/chunker.ts` tel quel.

## 4. Architecture

Nouveau dossier `packages/cli/src/answers/`, **pur** : il ne fetch rien, il ne travaille que
sur ce que le crawl a déjà rapporté. Même découpage que `chunker.ts` au LOT 5 — la logique
reste testable sans passer par un audit complet.

| Fichier | Rôle |
|---|---|
| `grid.ts` | La grille d'intentions figée. **Données seules**, versionnées. |
| `predicates.ts` | Un prédicat de preuve par id d'intention. Code. |
| `subjects.ts` | Extraction des sujets et des zones déclarés. |
| `matrix.ts` | Croisement, puis évaluation contre le corpus. |
| `index.ts` | API publique : `buildAnswerMatrix(ctx): AnswerMatrix`. |

Le check vit dans `checks/answer-coverage.ts`, le rendu dans `report/answers.ts`.

### Modèle de données

```ts
export type CellState = 'covered' | 'weak' | 'missing';
export type Bucket = 'local-business' | 'product' | 'article' | 'unknown';
export type IntentScope = 'chunk' | 'page';
export type IntentNature = 'structural' | 'lexical' | 'mixed';

export interface Subject { id: string; label: string; source: 'markup' | 'nav' | 'h1'; }
export interface Zone {
  id: string; label: string; kind: 'area-served' | 'locality';
  aliases: string[];   // a postal code is an alias of its town, never a zone of its own
}

/** Pure data — no functions, so the grid stays diffable and testable as a table. */
export interface IntentDef {
  id: IntentId;
  buckets: readonly Bucket[];
  zoned: boolean;           // does the generated question carry a zone?
  scope: IntentScope;       // evaluate the predicate against the chunk, or the page?
  nature: IntentNature;     // drives the evidence label shown per cell
  question: Record<Lang, string>;   // "{subject} à {zone} : quel prix ?"
}

export interface Cell {
  subject: Subject; zone?: Zone; intent: IntentId;
  question: string; state: CellState; path?: string;  // page carrying the evidence
  evidence: 'markup' | 'prose' | 'affordance' | 'none';   // what settled the cell
}
```

La grille est **pure donnée** ; les prédicats vivent à part, indexés par `id`. C'est ce qui
permet de verrouiller la grille par un test de table (comme `message-i18n.test.ts` verrouille
les gabarits) et de la relire quand elle évoluera.

## 5. Les sujets — déclarés, jamais devinés

Deux axes, tous deux tirés de ce que le site affirme.

**Services.** Par ordre de préférence : JSON-LD (`Service`, `Offer`,
`hasOfferCatalog.itemListElement[].name`, `makesOffer`, `Product.name`), puis, à défaut,
libellés de `<nav>` et `<h1>` des pages échantillonnées, filtrés par une stoplist. Chaque
sujet **conserve sa source** (`markup` / `nav` / `h1`) : c'est ce qui permettra d'étiqueter la
cellule et de dire au lecteur sur quoi on s'appuie.

**Zones.** `areaServed`, `address.addressLocality`, `postalCode`, `LocalBusiness.geo`.

> ⚠️ **Pas de détection de noms de villes dans la prose en v1.** « Nantes » dans un témoignage
> client n'est pas une zone desservie. Ce faux positif contaminerait toute une colonne de la
> matrice, et une matrice qui ment une fois n'est plus lue.

**Si aucun sujet ne sort, le check `skip`.** Un site qui ne déclare rien n'est pas puni : il
est simplement invisible, ce que les autres checks disent déjà mieux.

**Bornes de combinatoire** : au plus 12 sujets × 6 zones × 6 intentions, soit 432 cellules.
Au-delà, on tronque par ordre de source (`markup` avant `nav` avant `h1`) et **le rapport le
dit**.

### 5.bis Provenance — trois couches étiquetées, jamais mélangées

Décision du 2026-07-27, en vue du mode comparé (§15). Une question peut venir de trois
endroits, et ils n'ont pas la même valeur de preuve. La provenance est donc un champ porté
par chaque question, rendu dans le rapport, et **elle décide de ce qui compte dans la note** :

| Provenance | D'où vient la question | Compte dans la note ? |
|---|---|---|
| `declared-self` | le site audité déclare ce service / cette zone | **oui** |
| `declared-peer` | un concurrent comparé le déclare, le site audité non | `warn` seulement — c'est un angle mort, pas une faute |
| `sector` | la grille sectorielle figée, personne ne l'a déclaré | **jamais** — informatif, affiché à part |

C'est ce qui rend le mélange des trois honnête plutôt que confus. Un lecteur doit pouvoir
lire « tu ne réponds pas à ça, **et tu prétends le faire** » sans le confondre avec « tu ne
réponds pas à ça, **et deux concurrents oui** », ni avec « ton secteur traite ça en général ».
Fondre les trois en un seul pourcentage détruirait précisément l'information qui fait agir.

⚠️ La couche `sector` est une **exception documentée** au principe du §3 (« ne générer que
des questions issues de ce que les sites déclarent »). Elle ne prétend pas non plus mesurer
une demande : elle dit « des sites comme le tien traitent ce sujet », ce qui reste une
hypothèse. D'où le fait qu'elle ne pèse rien dans la note et qu'elle est bannie de tout
chiffre de synthèse.

## 6. La grille — une intention est un prédicat de preuve, pas un mot-clé

C'est le cœur du design, et ce qui le rend difficile à truquer : une intention n'est pas
satisfaite par une correspondance de chaîne, mais par un **prédicat typé**.

| Intention | Satisfaite quand… | Portée | Nature |
|---|---|---|---|
| `price` | le passage contient un montant monétaire **et** le token du sujet | chunk | lexicale |
| `hours` | le passage contient une plage horaire, **ou** la page porte `openingHoursSpecification` | chunk | mixte |
| `location` | le passage contient le token de zone (ville ou code postal) | chunk | lexicale |
| `contact` | la page porte un `tel:`/`mailto:` ou un formulaire complétable (réutilise `agent-usability`) | page | **structurelle** |
| `process` | le passage contient une liste ordonnée, ou la page porte un balisage `HowTo` | chunk | **structurelle** |
| `identity` | la page porte `about`/`Person`/un auteur avec `sameAs` vérifié (réutilise `sameas-verified`) | page | **structurelle** |

Six intentions par bucket **au maximum** en v1. Buckets : `local-business`, `product`,
`article`, `unknown`.

Les intentions structurelles sont proches du `measured` ; les lexicales sont franchement
`heuristic`. **La matrice affiche la différence par cellule plutôt que de la moyenner** — un
lecteur doit pouvoir voir que « prix couvert » repose sur une regex de montant, pas sur une
norme.

## 7. L'évaluation — trois états

Pour chaque cellule `(sujet, zone?, intention)`, on parcourt les pages échantillonnées ; pour
chacune, `chunkContent(mainContent(page).root, { targetTokens: 512 })`. Une fenêtre satisfait
la cellule si elle porte le token du sujet, porte le token de zone quand l'intention est
zonée, et satisfait le prédicat (contre la fenêtre si `scope: 'chunk'`, contre la page si
`scope: 'page'` — auquel cas seul le sujet doit apparaître sur la page).

- **`covered`** — une fenêtre satisfait tout **et** passe `chunkSurvives()`.
- **`weak`** — la preuve existe mais la fenêtre ne tient pas debout seule, ou elle est coupée
  entre deux fenêtres. **C'est l'état le plus intéressant du produit** : le contenu est là, il
  est simplement inextractible.
- **`missing`** — rien.

Le meilleur état trouvé sur l'ensemble des pages gagne, et la cellule retient le chemin de la
page qui porte la preuve.

## 8. Le check `answer-coverage` — ⛔ **ABANDONNÉ après mesure (2026-07-27)**

> **Décision renversée par les chiffres.** Le §2 retenait « un check scoré + une section de
> rapport ». Après calibration sur trois sites réels en crawl multi-pages, le check scoré est
> retiré : **la matrice est un excellent diagnostic et un mauvais indicateur de note.**
>
> **Ce qui a été mesuré** — couverture repliée par question (une intention zonée compte une
> fois, pas une fois par zone) : **pb-ot 21 %, masse-motoculture 52 %, findable 17 %.**
>
> **Pourquoi aucun seuil ne marche.** Ces chiffres sont exacts : ces sites ne publient ni
> prix ni horaires. Mais ne pas publier ses prix est un **choix commercial légitime**, pas un
> défaut technique. À tout seuil raisonnable, presque chaque site perdrait les mêmes points —
> du bruit ajouté à la note, sans pouvoir discriminant. Et l'autre axe ne sauve rien :
> `weak` vaut 0, 1 et 0 sur les trois sites, donc `covered / (covered + weak)` frôle 100 %
> partout.
>
> **Ce qu'on livre à la place** : l'artefact seul — `--answers <file>` et la section de
> rapport. Toute la valeur, zéro impact sur la note de qui que ce soit, et l'invariant
> `perfect-site = 100` reste trivialement vrai. C'est la voie que le §12.4 prévoyait déjà en
> esprit : quand la mesure ne soutient pas l'affirmation, on n'ajuste pas le seuil, on retire
> l'affirmation.
>
> **Ce qui rouvrirait le dossier** : un corpus assez large pour montrer que la couverture
> discrimine vraiment deux sites comparables — pas trois points de mesure.

<details><summary>Design d'origine du check scoré, conservé pour mémoire</summary>

Famille `llm-content`, `evidence: 'heuristic'`, `maxPoints: 4`.

| Condition | Verdict |
|---|---|
| Aucun sujet dérivable | `skip` |
| `covered / total` ≥ **0,40** *(mesuré, voir ci-dessous)* | `pass` |
| sinon | `warn`, message nommant les 3 pires cellules |
| jamais | `fail` |

Le `fail` est exclu par le § *Honesty guard-rails* de `CLAUDE.md` : les heuristiques de mise
en forme du contenu sont **warn max**. Seuls les défauts non ambigus et vérifiables peuvent
faire échouer un audit, et « ton site ne répond pas à cette question » n'en est pas un.

**Seuil calibré, pas arrondi.** Mesuré sur les trois sites du jeu doré (échantillons de deux
pages, donc plancher plutôt que moyenne) : **findable 50 %, masse-motoculture 43 %, pb-ot 6 %**.
Un seuil à 0,70 aurait fait avertir la totalité des sites réels testés — exactement le défaut
que `topical-focus` a corrigé en passant de 0,40 à 0,35 après mesure. À **0,40**, le check
sépare un site qui tient à peu près la moitié de ses promesses d'un site qui n'en tient presque
aucune.

⚠️ **À revalider sur des crawls complets avant de figer définitivement** : ces chiffres viennent
de deux pages par site, ce qui sous-estime la couverture d'un audit réel à dix pages.

**+1 check.** Le compteur de départ est celui asserté dans `test/runner.test.ts`, pas un chiffre
recopié d'un message de commit — c'est ainsi qu'une erreur de comptage s'est déjà glissée dans
cette spec. Au moment de la rédaction : 126, plus les checks des grappes de parité en vol.

</details>

## 9. Le rendu — ✅ fichier livré (0.9.0), ⏸️ section de rapport en attente

> **Le fichier est livré** : `--answers <fichier>`, `.json` ou Markdown, sur le patron exact
> de `--entity-graph`. Il porte ses deux mentions obligatoires (§10), la liste des pages
> crawlées, et l'avertissement quand le crawl s'est arrêté à sa limite.
>
> **La section intégrée au rapport HTML est volontairement différée**, et pas par manque de
> temps. L'inclure par défaut voudrait dire l'afficher à *tous* les utilisateurs — or la
> mesure du §12 montre qu'un site normal produit beaucoup de cellules `missing` (98 cellules
> et 9 % de couverture sur un site réel). Déverser ce mur dans chaque rapport referait
> exactement l'erreur que le §8 vient d'éviter : alarmer tout le monde uniformément, sans
> rien discriminer.
>
> Ce qui manque n'est pas du câblage, c'est de la **présentation** : regrouper par zone plutôt
> qu'énumérer la hiérarchie, ne montrer que les N trous les plus significatifs, et distinguer
> visuellement « tu ne réponds pas » de « tu réponds mais on ne peut pas te citer ». Une
> décision de design à prendre à froid, pas en fin de chantier. Le flag rend la fonctionnalité
> entièrement utilisable en attendant.

Section « Matrice de réponses » dans les rapports HTML et Markdown, plus un flag
`--answers <file>` (`.json` / `.md`) sur le patron exact de `--entity-graph`.

- Un tableau compact sujets × intentions, les zones en facette, cellules colorées selon les
  trois états.
- Sous le tableau, les **10** pires questions absentes, en langage clair, avec le conseil de
  correction de l'intention.
- Un badge `heuristic`, et par cellule l'indication structurelle/lexicale.

## 10. Garde-fous, en toutes lettres dans le rapport (FR **et** EN)

Deux mentions non négociables, rendues dans les deux langues :

1. **Ces questions viennent des déclarations du site, pas d'une demande observée.** Formulation
   à figer dans `report/i18n.ts`, pas à réinventer par renderer.
2. **L'échantillon utilisé**, avec un avertissement explicite si `buildLinkGraph` a découvert
   des URL internes **non visitées** dont le chemin correspond à un token de sujet. Sans ça,
   on annonce des trous qui n'en sont pas — c'est le mode de défaillance le plus probable de
   cette fonctionnalité, et le plus dommageable pour la crédibilité de l'outil.

## 11. Tests

- **Grille verrouillée** : un test parcourt `INTENT_GRID` et exige, pour chaque entrée, une
  question en `fr` **et** en `en`, un `bucket` connu, et un prédicat enregistré ; puis
  l'inverse — aucun prédicat orphelin. Même patron que `test/message-i18n.test.ts`.
- **Extraction** : `subjects.ts` sur fixtures (JSON-LD riche, JSON-LD absent + nav seule,
  aucune déclaration → zéro sujet).
- **Matrice** : corpus synthétique couvrant les trois états. Les fixtures `answers-rich/`,
  `answers-poor/`, la fixture appariée et le jeu doré sont spécifiés au **§12** — ce sont eux
  qui portent la calibration, pas un test d'exemple.
- **Invariant** : `test/fixtures/perfect-site/` reste à **100**. `pass` et `skip` sont tous
  deux acceptables et le premier run tranchera ; ce qui ne l'est pas, c'est un `fail` — si la
  fixture échoue, c'est le prédicat qu'on corrige, pas la fixture qu'on enrichit pour la
  faire passer.
- **Dogfooding** : `apps/web/test/dogfooding.test.mjs` fait tourner le vrai moteur contre
  l'app locale et assied le verdict. C'est une porte, pas un rituel : trois bugs produit réels
  ont été trouvés ainsi.

## 12. Critère de calibration — bloquant

> **Critère écarté.** Le premier critère envisagé — « `weak` doit être majoritaire sur un vrai
> site » — visait juste (l'état `weak` est le cœur du produit) mais était formulé comme une
> **cible de distribution**, ce qui le rend inutilisable : il pousse à régler les prédicats
> jusqu'à obtenir une répartition plaisante plutôt que vraie ; il ne distingue pas les deux
> réglages indépendants qui la produisent (le prédicat de preuve sépare `missing` du reste,
> `chunkSurvives()` sépare `covered` de `weak`) ; et il n'est assertable par aucun test. Un bon
> site *doit* sortir majoritairement `covered` — c'est une réussite, pas une défaillance de
> l'instrument.

Trois propriétés le remplacent. Toutes encodées en tests, toutes **bloquantes** avant de figer
les seuils du §8.

### 12.1 Séparation — le prédicat mesure-t-il quelque chose ? — ✅ LIVRÉE

Deux fixtures jumelles : `answers-rich/` (prix, horaires et zones déclarés, intertitres
descriptifs, réponses autonomes) et `answers-poor/` (**les mêmes faits**, noyés dans un bloc
sans titre, sans balisage, sans montant explicite). **Écart minimal exigé : 40 points de taux
de couverture.** En dessous, les prédicats ne discriminent pas, et aucun réglage de seuil ne
le rattrapera.

### 12.2 Discrimination `covered` / `weak` — la moitié « survie » travaille-t-elle ? — ✅ LIVRÉE

Fixture appariée : **le même fait**, écrit deux fois — une fois dans une fenêtre autonome, une
fois coupé sur une frontière de chunk avec une ouverture anaphorique. Le couple doit produire
`covered` **et** `weak`. S'il produit deux fois le même état, `chunkSurvives()` n'apporte rien
dans ce contexte et l'état `weak` est décoratif.

> **Ce que la porte a effectivement attrapé, le 2026-07-27.** À sa première exécution elle a
> rendu **75 % contre 75 %** : aucune séparation. Trois défauts de conception, corrigés parce
> que la porte les a montrés — pas les seuils, qui n'y étaient pour rien.
>
> 1. **`chunkSurvives` ne juge que le bloc de tête d'une fenêtre.** Un pavé ouvrant sur une
>    phrase propre « survivait » quelle que soit l'anaphore de la phrase portant la réponse.
>    L'extractibilité se juge désormais sur **la phrase qui porte la preuve**, avec repli sur
>    le bloc quand l'évidence s'étale légitimement (une énumération d'étapes est *une* réponse).
> 2. **Le code postal était une zone à part**, générant « Plomberie à 35000 : quel prix ? » —
>    une question que personne ne pose et que la prose nommant la ville ne peut pas satisfaire.
>    Il devient un **alias** de sa commune.
> 3. **La porte comparait des cellules réglées par le balisage**, identiques entre jumeaux par
>    construction. Elle ne mesure plus que les cellules **en prose**, d'où le champ `evidence`.

### 12.3 Vérité terrain, asymétrique — le prédicat dit-il vrai ? — ✅ LIVRÉE

> **Ce que le jeu doré a corrigé, le 2026-07-27.** Trois sites réels capturés hors ligne,
> 16 cellules étiquetées à la main **en lisant les pages**, pas en acceptant la sortie de la
> matrice. Trois défauts trouvés avant même le premier verdict :
>
> 1. **Les sujets ramassaient du bruit** — un sélecteur de langue (« English »), des libellés
>    de nav décorés (« Services▾ », « Tous les services → ») et des accroches d'H1 prises pour
>    des services (« Votre SEO et votre findabilité IA, notés A–F. »). Chacune générait une
>    ligne entière de questions absurdes. Filtrage : glyphes retirés, liens `hreflang` ignorés,
>    ponctuation de phrase et plus de cinq mots rejetés.
> 2. **`bucketOf` était trop étroit** : un site déclarant `ProfessionalService` avec adresse et
>    `areaServed` tombait en `unknown`, ce qui supprimait silencieusement toute la grille
>    commerce local. Il réutilise désormais `NAP_REQUIRED_TYPES`, le vocabulaire que les checks
>    de données structurées partagent déjà.
> 3. **Un faux `covered` avéré** : « couvrez-vous Val d'Izé pour Services ? » était couvert
>    parce que les deux tokens cohabitaient dans une fenêtre de 512 tokens, à trois cents
>    tokens d'écart, sans rien affirmer. La preuve doit désormais tenir **dans une seule
>    unité** — phrase, ou bloc quand l'évidence s'étale légitimement. À défaut, la cellule est
>    `missing`, pas `weak` : la question n'est pas mal répondue, elle n'est pas répondue.
>
> **Un cap sur les zones a été tenté puis annulé.** Réduire `MAX_ZONES` de 6 à 3 pour dégonfler
> la matrice a supprimé « Bretagne » sur un site dont les réponses vivaient précisément dans la
> zone la plus large — deux réponses vérifiées devenues de faux `missing`. Il n'existe pas de
> façon sûre de choisir trois aires parmi cinq emboîtées sans comprendre la hiérarchie. Le
> volume est un problème de présentation ; un faux `missing` est un problème de justesse.

Jeu doré de 30 à 40 cellules étiquetées à la main, sur **au moins trois sites réels couvrant au
moins deux buckets**, dont **un vrai site de services local francophone** — le cas qui motive
la fonctionnalité, et celui que notre propre site ne représente pas du tout (ni prix, ni
horaires, ni zone : il n'exercerait que deux intentions sur six). Pages capturées en fixtures,
jamais fetchées en CI : les tests restent déterministes et hors-ligne, comme le reste du dépôt.

Les deux erreurs ne sont pas symétriques, donc les tolérances ne le sont pas non plus :

| Erreur | Ce que le client vit | Tolérance |
|---|---|---|
| Faux `missing` | il ouvre sa propre page et y lit la réponse qu'on déclare absente | **zéro — bloquant** |
| Faux `covered` | on le déclare couvert alors que rien ne répond | **zéro — bloquant** |
| `weak` ↔ `covered` en désaccord | nuance sur l'extractibilité | toléré |

### 12.4 Repli décidé à l'avance

Si 12.3 ne peut pas atteindre zéro faux `missing`, on **ne déplace pas le seuil pour masquer le
problème** : on livre **sans le verdict `missing`**. La matrice ne rend alors que `covered` et
`weak`, tout le reste sortant en **`non déterminé`**. Un outil qui dit « je ne sais pas » reste
crédible ; un outil qui affirme un trou inexistant ne l'est plus.

### 12.5 Interdit

Ne jamais ajuster un prédicat pour verdir notre propre audit. C'est la règle déjà tenue pour
`sd-entity-grounding` et `sd-website-searchaction`, laissés en `warn` et verrouillés par un
test. Le dogfooding sert à **observer** la distribution et à alimenter le jeu doré — pas à
définir la cible.

## 13. Propagation et livraison

Un nouveau check déclenche la séquence complète de `.claude/skills/findable-new-check/SKILL.md` :
le compteur est recopié à la main dans **onze fichiers**, `buildChecks().length` est asserté
dans `runner.test.ts`, et `CHECK_TITLES` + `check-i18n` (why/fix) + `message-i18n` (gabarits FR)
doivent être complétés. `scoring.ts` n'a **pas** à changer : les poids sont par famille et un
check de plus ne les déplace pas.

Un nouveau check déplace les notes des utilisateurs : **bump mineur** et release npm dans la
foulée du commit, conformément au § *Shipping* de `CLAUDE.md` — proposée à l'utilisateur, le
push de tag reste soumis à son accord.

## 14. Risques

| Risque | Parade |
|---|---|
| La matrice annonce des trous dus à un échantillon trop petit | Avertissement explicite §10.2, adossé aux URL découvertes non visitées |
| Les prédicats lexicaux (prix, horaires) ne marchent qu'en anglais | Piège déjà rencontré trois fois sur ce projet : tests FR **et** EN obligatoires sur chaque prédicat lexical |
| La combinatoire explose sur un gros site | Bornes dures du §5, troncature annoncée |
| Le lecteur prend la matrice pour une étude de demande | Mention §10.1, badge `heuristic`, et vocabulaire du rapport qui parle de *promesse tenue*, jamais de *recherche* |

## 15. Mode comparé — la part de voix sans clé (palier 1 du §13 ⭐⭐)

Le §13 classe l'outil de positionnement concurrentiel ⭐⭐, sa plus haute priorité, et le
coupe en deux : le scorecard tête-à-tête N URL — **livré** (`--compare`) — et la part de voix
dans les réponses IA — **non livrée**, et instruite au §12.F de la roadmap comme coûteuse et
hors ADN.

La matrice ouvre une troisième voie, qui n'était pas dans le §13 : **croiser `--compare` et la
matrice donne une part de voix qui ne demande ni clé, ni budget, ni appel externe.** Sur un
même jeu de questions, on montre qui est *équipé* pour être cité. Le moteur existe déjà des
deux côtés ; le delta est une jointure au niveau du rapport.

**Ce que ça dit, et ce que ça ne dit pas.** Ça ne dit pas « ChatGPT cite Untel » — nous n'en
savons rien et le prétendre serait mentir. Ça dit : « sur *plombier urgence Rennes*, trois de
tes quatre concurrents ont un passage autonome qui répond, toi non. » C'est un **proxy de
capacité, pas une mesure d'audience**, et le rapport doit l'écrire ainsi.

**Le jeu de questions est commun, et étiqueté** (§5.bis) : dérivé de l'union du site audité et
des concurrents comparés, plus la couche sectorielle informative. Sans jeu commun, chaque site
serait noté sur ses propres promesses et rien ne serait comparable — c'est le piège central de
ce mode. La couche `declared-peer` est ce qui a le plus de valeur commerciale : ce sont les
questions que le client n'a jamais pensé à traiter, révélées par le fait que ses concurrents,
eux, les traitent.

**Ordre de livraison** : ce mode vient **après** que le §12 ait figé les prédicats. Comparer
avec un instrument non calibré multiplierait l'erreur par le nombre de sites au lieu de la
révéler.
