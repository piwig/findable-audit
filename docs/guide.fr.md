# Guide des checks findable-audit

findable-audit note un site sur 100 à travers **121 checks répartis en 8 familles**.

**Mesuré ou heuristique.** Chaque check déclare ce sur quoi repose son verdict. Un check **mesuré** évalue par rapport à quelque chose d'extérieur au projet — une RFC, une spec W3C/WHATWG, WCAG, schema.org, ou un seuil publié par Google : deux personnes lisant la même réponse sont d'accord. Un check **heuristique** évalue par rapport à une barre que *nous* avons choisie — un nombre de mots, un lexique, un ratio, l'idée qu'un texte « répond directement » : on peut raisonnablement en discuter, et la recherche vérifiée dit que l'effet varie selon les sites. Les rapports marquent les heuristiques pour que vous les pondériez en conséquence, et le JSON porte `evidence` sur chaque résultat. Sur les 121 checks, **94 sont mesurés et 27 heuristiques**. Ce guide documente chaque check : ce qu'il vérifie, pourquoi c'est important pour les moteurs de recherche et de réponse IA, et comment corriger un échec.

**Familles et poids** (le sous-score d'une famille est combiné au score global selon ces poids) :

| Famille | Poids | Checks |
|---|---|---:|
| Accès crawlers IA | 0,16 | 9 |
| Contenu pour moteurs de réponse | 0,18 | 21 |
| Données structurées et métadonnées | 0,15 | 20 |
| SEO technique | 0,15 | 22 |
| On-page et contenu | 0,12 | 11 |
| Performance et Core Web Vitals | 0,10 | 19 |
| Accessibilité | 0,07 | 9 |
| Sécurité et confiance | 0,07 | 10 |

**Note (grade) :** `A` ≥ 90 · `B` ≥ 80 · `C` ≥ 70 · `D` ≥ 60 · `F` < 60.

**Statuts :** `OK` (réussi, tous les points), `!!` (avertissement, demi-points), `XX` (échec, 0 point), `--` (ignoré). **Les checks ignorés sont exclus du score** — un site n'est jamais pénalisé pour un check qui ne le concerne pas (pas de page produit, site monolingue, pas de `--cwv`, etc.). Les entrées marquées *(ignoré si …)* ne s'exécutent que si leur condition est remplie.

Les rapports HTML et Markdown s'ouvrent sur un verdict en une ligne et incluent un plan d'action priorisé (gains les plus importants d'abord, avec des liens « En savoir plus ») — en haut du rapport HTML, vers la fin en Markdown. Avec `--cwv --psi-key <clé>`, les Core Web Vitals s'ajoutent : un dashboard à jauges radiales dans le rapport HTML et un tableau de métriques en Markdown (terrain/CrUX vs labo/Lighthouse).

---

## Accès crawlers IA

Le verrou : si les crawlers sont bloqués ou la page en `noindex`, rien d'autre ne compte.

Le jeu de bots exact (28 agents IA + les crawlers de recherche, défini dans `packages/cli/src/robots.ts`) est hiérarchisé par *intention*, et le tier détermine la sévérité du constat :

- **Fetchers de citation (13)** — OAI-SearchBot, ChatGPT-User, Perplexity-User, Claude-User, Claude-SearchBot, PerplexityBot, DuckAssistBot, MistralAI-User, Meta-ExternalFetcher, YouBot, iAskBot, LinerBot, Google-CloudVertexBot : les bloquer vous fait disparaître des réponses IA en direct → **échec**.
- **Crawlers d'entraînement (15)** — GPTBot, Google-Extended, ClaudeBot, anthropic-ai, CCBot, Applebot-Extended, Amazonbot, Bytespider, PanguBot, cohere-ai, cohere-training-data-crawler, meta-externalagent, Diffbot, Timpibot, omgilibot : les bloquer est un choix de politique légitime, pas une rupture d'accès → **avertissement**.
- **Crawlers de recherche (2 + joker)** — Googlebot, Bingbot, `*` : les bloquer vous retire de la recherche classique → **échec** (check dédié `search-crawlers-allowed`).

Nuance utile (d'après la doc Perplexity) : PerplexityBot est le crawler *d'indexation* — il respecte robots.txt et ne nourrit pas l'entraînement — tandis que Perplexity-User est le fetcher *au moment de la question*, qui ignore généralement robots.txt. Bloquer les agents `-User` dans robots.txt est surtout déclaratif ; c'est le blocage des crawlers d'index qui change réellement la visibilité dans les moteurs de réponse.

### `homepage-ok` (6 pts)
**Vérifie :** L'URL racine renvoie un HTTP 200 en HTML.
**Pourquoi :** Si la page d'accueil renvoie une erreur, redirige vers un login ou exige JavaScript pour produire du HTML, les crawlers n'ont rien à indexer et les assistants rien à citer.
**Corriger :** Servez une page HTML en 200 à `/` sans exiger JavaScript ; vérifiez l'hébergement, les redirections et toute couche anti-bot.

### `robots-exists` (4 pts)
**Vérifie :** `/robots.txt` répond en 200 avec `text/plain` (avertissement si repli HTML ou absent).
**Pourquoi :** robots.txt est le premier fichier demandé par tout crawler ; sans lui, aucune politique de crawl explicite ni annonce de sitemap.
**Corriger :** Servez un robots.txt statique `text/plain` avec un groupe `User-agent` et une ligne `Sitemap:`.

### `robots-wellformed` (4 pts)
**Vérifie :** robots.txt se parse proprement — sous ~500 Ko, uniquement des directives connues, pas d'`Allow`/`Disallow` avant le premier `User-agent`, pas une page d'erreur HTML.
**Pourquoi :** Un robots.txt malformé est interprété de façon imprévisible selon les crawlers, modifiant en silence ce qu'ils vont chercher.
**Corriger :** Émettez un groupe `User-agent` valide plus `Sitemap:` ; ne renvoyez jamais de HTML pour robots.txt.

### `search-crawlers-allowed` (6 pts)
**Vérifie :** robots.txt ne fait pas `Disallow: /` pour Googlebot, Bingbot ou `*` (RFC 9309, correspondance la plus longue).
**Pourquoi :** Un disallow global sur ces agents vous sort de la recherche classique, sur laquelle la plupart des réponses IA s'appuient encore.
**Corriger :** Supprimez tout `Disallow: /` global ; limitez les disallow aux chemins panier/recherche/admin.

### `ai-crawlers-allowed` (12 pts)
**Vérifie :** Aucun crawler IA n'est bloqué — bots d'entraînement (GPTBot, Google-Extended, ClaudeBot, CCBot, Applebot-Extended, Amazonbot, Bytespider, cohere-ai, meta-externalagent) et, plus critique, récupérateurs de citation (OAI-SearchBot, ChatGPT-User, Perplexity-User, Claude-User, PerplexityBot). Échec si un récupérateur de citation est bloqué ; avertissement si seuls des bots d'entraînement le sont.
**Pourquoi :** Le check au poids le plus élevé — si un récupérateur de citation est interdit, cet assistant ne peut ni lire ni citer votre site.
**Corriger :** Ne faites jamais `Disallow: /` sur un récupérateur de citation ; ne bloquez les bots d'entraînement que si c'est une politique volontaire.

### `robots-directives` (4 pts)
**Vérifie :** L'en-tête `X-Robots-Tag` et la balise `<meta name="robots">` de l'accueil sont exempts de `noindex`/`noai` (avertissement si présents).
**Pourquoi :** Une directive `noindex`/`noai` sur l'accueil dit aux crawlers de recherche et IA d'ignorer entièrement la page.
**Corriger :** Retirez `noindex`/`noai` de l'en-tête et de la balise, sauf exclusion volontaire.

### `meta-robots-noindex` (6 pts)
**Vérifie :** Aucune page échantillonnée ne porte `noindex`/`none` en meta robots ou `X-Robots-Tag` (échec sur la moindre) ; avertit sur `nofollow` seul ou un conflit en-tête↔meta.
**Pourquoi :** Une page en noindex est invisible pour les moteurs comme pour les crawlers IA — le contenu voulu trouvable disparaît en silence.
**Corriger :** Retirez `noindex`/`none` des pages qui doivent être découvrables ; ne le gardez que sur les pages réellement privées, exclues du sitemap.

### `ai-serving-parity` (8 pts)
**Vérifie :** Recharge l'accueil (plus jusqu'à deux pages échantillonnées) sous les identités GPTBot, ClaudeBot et un navigateur mobile, en comparant le code HTTP, la taille du corps, le `<title>` et le contenu principal à la récupération par défaut. Échec sur un 403/451/5xx ou un contenu principal absent pour un user-agent IA ; avertissement sur une divergence plus douce (titre différent, écart de taille >30 %, différence propre au mobile). Ignoré sans la capacité de récupération par UA ou si l'accueil est injoignable.
**Pourquoi :** Si un CDN/WAF remet aux crawlers IA un document bloqué, redirigé ou allégé, votre contenu n'atteint jamais les assistants susceptibles de vous citer — alors même qu'un navigateur voit la page normalement. Un 403 envoyé à GPTBot peut relever d'une gestion de robots délibérée : le libellé reste descriptif, sans accusation.
**Corriger :** Faites en sorte que GPTBot et ClaudeBot reçoivent le même document qu'un navigateur ; passez en revue toute règle de gestion de robots qui bloque ou réécrit les requêtes des crawlers IA.

### `snippet-preview-directives` (4 pts)
**Vérifie :** Aucune page ne pose `nosnippet`, `max-snippet:0`, `max-image-preview:none` ou `max-video-preview:0` (avertissement si simplement absent ; `max-image-preview:large` compte positivement).
**Pourquoi :** Ces directives affament les aperçus (snippets et vignettes) que les moteurs de réponse affichent.
**Corriger :** Posez `max-image-preview:large, max-snippet:-1, max-video-preview:-1` ; retirez tout `nosnippet` égaré.

---

## Contenu pour moteurs de réponse

Le cœur du GEO : la réponse est-elle réellement extractible, datée, signée et citable.

### `llms-txt` (10 pts)
**Vérifie :** `/llms.txt` (text/plain) a un titre H1 + une ligne de résumé + ≥1 section `##` + ≥5 liens descriptifs absolus de même origine (avertissement si H1 seul ou moins de 5 liens ; échec si absent/HTML).
**Pourquoi :** `llms.txt` donne aux modèles une carte de votre site, sélective et économe en tokens, pour répondre avec précision plutôt qu'en devinant depuis le HTML brut. Nuance honnête : traitez-le comme un **signal à la valeur non prouvée** — les grandes études 2025–26 (Ahrefs 137K sites, SE Ranking 300K, Otterly 62K, Trakkr 37,9K) ne mesurent **aucun gain de citation**, l'adoption est d'environ 3,2 %, et Google annonce un impact nul sur le classement. Le check reste un pari peu coûteux à faible poids ; la valeur vient de l'ensemble combiné des contrôles, pas de ce seul fichier.
**Corriger :** Structurez-le en `# Site`, un résumé d'une ligne, puis des blocs `## Section` de `- [Titre](https://url-absolue) : note`.

### `llms-full-txt` (4 pts)
**Vérifie :** `/llms-full.txt` (text/plain) contient un vrai corps — environ ≥2000 mots avec plusieurs titres (avertissement sous 500 ; échec si absent/HTML).
**Pourquoi :** Si `llms.txt` est la carte, `llms-full.txt` est le territoire : votre texte intégral dans un fichier qu'un modèle ingère en une requête. Même nuance de valeur non prouvée que `llms.txt` — aucun gain de citation mesuré dans les grandes études 2025–26 — d'où son faible poids.
**Corriger :** Concaténez le texte intégral des pages sous des titres au moment du build.

### `content-without-js` (6 pts)
**Vérifie :** Chaque page échantillonnée a ≥200 caractères de texte visible statique (sans JS) après suppression de script/style/noscript (avertissement si une minorité est maigre ; échec si la plupart sont vides).
**Pourquoi :** Les crawlers IA n'exécutent pas JavaScript ; une page rendue côté client est une coquille vide pour eux.
**Corriger :** Rendez le contenu principal côté serveur ou en statique (Astro, Hugo, export statique Next, SSR).

### `csr-content-parity` (4 pts)
**Vérifie :** Signale les pages échantillonnées dont l'unique point de montage (`#root`, `#__next`, `#app`, `<app-root>`, `[data-reactroot]`, `[ng-version]`…) est vide dans le HTML brut *et* qui embarquent quasiment aucun texte rendu côté serveur (avertissement pour une minorité ; échec si la plupart). Un rendu SSR/SSG authentique portant aussi du balisage d'hydratation — dont `data-server-rendered="true"` — passe.
**Pourquoi :** Un contenu qui n'apparaît qu'après l'hydratation côté client est invisible pour les crawlers IA, qui n'exécutent généralement pas JavaScript : un point de montage vide se lit comme une page blanche. Complète `content-without-js` en désignant la coquille SPA comme cause.
**Corriger :** Rendez le HTML initial côté serveur (SSR/SSG) pour `#root`/`#__next`/`#app` et les points de montage similaires, afin que le contenu principal soit présent avant toute exécution de JavaScript.

### `content-depth` (5 pts)
**Vérifie :** Le nombre de mots du contenu principal atteint un seuil par type — Article/Blog ≥300 mots, autres pages de contenu ≥150, habillage retiré (avertissement si une minorité est sous le seuil ; échec si la plupart sont maigres).
**Pourquoi :** Une page trop maigre offre rarement assez de matière pour qu'un assistant en extraie une réponse fiable.
**Corriger :** Étoffez ou regroupez les pages maigres avec du contenu substantiel.

### `content-lead-answer` (5 pts)
**Vérifie :** Le premier paragraphe substantiel après le H1 est une réponse/définition concise et autoportante (~40–320 caractères) ou un bloc TL;DR explicite (avertissement si enfoui/trop long ; échec si de longues pages ouvrent sur du remplissage/de la navigation).
**Pourquoi :** Les moteurs de réponse citent le chapô ; une phrase d'ouverture directe est bien plus susceptible d'être reprise telle quelle.
**Corriger :** Ouvrez chaque page par une réponse directe d'1–2 phrases ou un bloc TL;DR / points clés.

### `answer-headings` (4 pts)
**Vérifie :** *(ignoré pour les pages courtes)* Les longues pages de contenu portent ≥1 H2/H3 en forme de question ou descriptif — finit par `?`, ou commence par un interrogatif **français** (quel/comment/pourquoi/quand/où/combien/…) ou anglais (what/how/why/when/…), ou un ouvreur de liste (meilleur, best/top/vs) ; avertit si tous génériques.
**Pourquoi :** Des sous-titres en forme de question collent aux requêtes des utilisateurs et à la façon dont les assistants découpent le contenu.
**Corriger :** Formulez les sous-titres comme les questions que se posent les lecteurs.

### `extractable-structure` (4 pts)
**Vérifie :** Le contenu comporte un `<ul>/<ol>` (hors nav/footer) ou un `<table>` de données avec `<th>` dans `<main>/<article>` (avertissement si rare ; échec sur de longues pages tout en prose).
**Pourquoi :** Listes et tableaux sont les structures que les assistants extraient le plus fiablement (étapes, comparaisons, specs).
**Corriger :** Décomposez comparaisons, étapes et specs en puces et tableaux.

### `content-freshness` (5 pts)
**Vérifie :** *(ignoré s'il n'y a pas de pages de type article)* Les pages de contenu exposent une date lisible par machine (`<time datetime>`, `article:*_time` ou JSON-LD datePublished/dateModified) et récente — réussite si la plus fraîche ≤12 mois, avertissement 12–24 mois ou une seule des deux dates, échec si aucune ou >24 mois.
**Pourquoi :** Les assistants préfèrent et citent le contenu récent et daté ; une page non datée ou vieillie est dévaluée.
**Corriger :** Émettez datePublished + dateModified en ISO-8601 et une date visible, et gardez-les honnêtes.

### `content-author-eeat` (5 pts)
**Vérifie :** *(ignoré s'il n'y en a pas)* Les pages Article/BlogPosting ont un auteur `Person` nommé en JSON-LD **et** une signature visible (avertissement si une seule ; échec si aucune).
**Pourquoi :** Les signaux E-E-A-T — un auteur réel et attribuable — augmentent la confiance qu'un moteur de réponse accorde au contenu.
**Corriger :** Ajoutez une signature visible liée à une bio, plus `author:{@type:Person,name,url,jobTitle}` en JSON-LD.

### `outbound-citations` (3 pts)
**Vérifie :** Le contenu principal lie vers des domaines distincts, non sociaux et non auto-référents (avertissement si très peu à l'échelle du site ; échec sur du long contenu ne citant rien).
**Pourquoi :** Les citations sortantes vers des sources primaires sont un signal de crédibilité que les assistants pèsent.
**Corriger :** Citez des sources primaires/autoritatives avec de vrais liens sortants.

### `content-uniqueness` (3 pts)
**Vérifie :** Le texte principal normalisé est comparé deux à deux sur l'échantillon (avertissement sur un groupe de quasi-doublons ; échec sur plusieurs).
**Pourquoi :** Des corps quasi identiques diluent la pertinence et peuvent faire filtrer les pages comme du remplissage.
**Corriger :** Donnez à chaque URL un contenu unique, ou canonicalisez les doublons.

### `about-contact` (3 pts)
**Vérifie :** Les pages À propos + Contact sont accessibles et exposent ≥1 moyen de contact (tél/email/ContactPoint) — avertissement si l'une manque, échec si les deux.
**Pourquoi :** Ces pages sont des signaux de confiance et d'entité essentiels que les assistants utilisent pour ancrer et recommander une entreprise.
**Corriger :** Publiez des `/about` et `/contact` liés ; ajoutez un ContactPoint au JSON-LD Organization.

### `well-known-ai-json` (1 pt)
**Vérifie :** `/.well-known/ai.json` répond 200 avec un manifeste JSON de type **objet**. Fichier absent, JSON invalide (typiquement une coquille SPA qui répond 200), ou racine non-objet produisent un avertissement — jamais un échec, car la convention est encore émergente.
**Pourquoi :** `/.well-known/ai.json` est une convention émergente de découverte IA : un petit manifeste indiquant aux agents ce qu'est le site et comment interagir avec lui (nom, description, contact, politiques). Pondération consultative (1 pt) car non encore standardisée.
**Corriger :** Publiez un petit objet JSON à `/.well-known/ai.json` (nom, description, contact, politiques) — et vérifiez que le fallback SPA ne répond pas 200 HTML sur ce chemin.

### `freshness-coherence` (4 pts)
**Vérifie :** Recoupe les trois signaux de fraîcheur qu'une page peut émettre — l'en-tête HTTP `Last-Modified`, le `dateModified` JSON-LD (ou `article:modified_time`) et le `<lastmod>` du sitemap. Avertit lorsqu'ils se contredisent de plus de 24 h ; échoue uniquement sur une date *future*. Ignore une page comptant moins de deux des trois sources.
**Pourquoi :** Quand les signaux de fraîcheur d'un site divergent — ou annoncent une date dans le futur — les moteurs cessent de leur faire confiance. Un déploiement qui rend simplement `Last-Modified` plus récent que les dates annoncées est bénin et n'est pas signalé.
**Corriger :** Alignez l'en-tête HTTP `Last-Modified`, le `dateModified` JSON-LD et le `<lastmod>` du sitemap sur la vraie date de dernière modification, jamais dans le futur.

### `hedging-rate` (3 pts)
**Vérifie :** Sur les pages substantielles (≥150 mots), compte les formules évasives (*peut-être, il semble, maybe, it seems*…) dans les deux premiers paragraphes ; avertit (n'échoue jamais) à partir de deux. Une seule formule évasive dans le chapô est tolérée.
**Pourquoi :** Les moteurs génératifs citent de préférence les affirmations nettes et assumées : un chapô évasif réduit donc les chances d'être cité. L'effet varie selon le domaine — c'est une heuristique consultative, pas une garantie.
**Corriger :** Commencez par une affirmation nette et assumée et déplacez les nuances prudentes sous le chapô.

### `answer-units` (4 pts)
**Vérifie :** Sur les pages piliers (≥300 mots), recherche au moins une « unité de réponse » : un bloc court (8 à 40 mots) portant un chiffre, une date ou une entité nommée, qui commence de façon autosuffisante (sans anaphore ni connecteur) et sans formule évasive. Avertit (n'échoue jamais) si une page pilier n'en contient aucune.
**Pourquoi :** Les unités de réponse sont les passages qu'un moteur génératif peut reprendre et citer tels quels. Une page longue sans énoncé autosuffisant et ancré sur un fait ne lui offre rien de propre à citer.
**Corriger :** Ajoutez des énoncés courts et autosuffisants (8 à 40 mots) portant un chiffre, une date ou une entité nommée.

### `chunk-boundary` (3 pts)
**Vérifie :** Sur les pages substantielles (≥150 mots), signale les structures DOM qui se disloquent lorsque la page est découpée en fragments de retrieval : tableaux longs (>10 lignes) sans cellules d'en-tête, réponses de FAQ détachées de leur question par du balisage décoratif, et listes de 3+ éléments orphelines de tout titre. Avertit (n'échoue jamais). Les listes imbriquées sont exemptées.
**Pourquoi :** Les pipelines de retrieval découpent la page et perdent le contexte situé en dehors de chaque fragment. Une ligne de tableau sans en-tête, une réponse éloignée de sa question ou une liste sans titre parvient au modèle dépouillée du sens qui l'entourait.
**Corriger :** Donnez aux tableaux longs des en-têtes `<thead>`/`<th>`, gardez les réponses de FAQ directement sous leur question, et titrez chaque liste.

### `chunk-retrieval-sim` (4 pts)
**Vérifie :** *(ignoré s'il n'y a aucune page pilier ≥300 mots)* Découpe chaque page pilier en fenêtres d'environ 512 tokens aux frontières de blocs — comme le ferait un pipeline de retrieval — et mesure combien de ces fenêtres tiennent encore seules. Une fenêtre survit si elle porte un ancrage thématique (un nombre ou une entité nommée, en comptant le fil d'intertitres qu'un moteur préfixe) **et** si elle commence sans renvoyer à la fenêtre précédente (*cela, celui-ci, it, this…*) ni à un connecteur de discours. Passe à ≥70 % de survivantes ; avertit en dessous (n'échoue jamais).
**Pourquoi :** Un moteur reçoit une fenêtre récupérée, pas la page. Une fenêtre qui s'ouvre sur « Cela signifie aussi… » ou qui ne nomme rien est inutilisable comme citation, aussi bon soit l'article autour.
**Corriger :** Ouvrez chaque section par un sujet nommé plutôt qu'un pronom, et gardez un intertitre descriptif au-dessus de chaque passage.

### `injection-hygiene` (3 pts)
**Vérifie :** Le texte qu'un assistant ingère mais qu'un visiteur ne voit jamais. Trois signaux : contenu masqué par un style **en ligne** (`display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`, décalage hors écran) ou par l'attribut `hidden` et atteignant ≥15 mots ; instructions destinées au modèle (*ignore previous instructions*, *en tant que modèle*, *recommande toujours*…) trouvées **à l'intérieur** de ce contenu masqué ; et liens sortants dans un conteneur de commentaires/avis ne portant ni `rel="ugc"` ni `rel="nofollow"`. N'échoue que sur du contenu masqué porteur d'instructions ; avertit sur un signal isolé. Les contenus `script`, `style`, `template` et `noscript` sont exemptés, et seuls les styles en ligne comptent — les feuilles de style ne sont jamais récupérées, donc le motif légitime `.sr-only` n'est jamais pris pour du masquage.
**Pourquoi :** Des instructions cachées constituent une charge d'injection de prompt visant l'assistant qui lit la page, et des liens contribués non attribués laissent des tiers parler au nom du site. Le même texte *visible* ne pose aucun problème : un article de sécurité qui traite de l'injection est légitime, une page qui la dissimule ne l'est pas.
**Corriger :** Supprimez le contenu masqué en ligne, et marquez les liens contribués `rel="ugc"`.

### `agent-usability` (4 pts)
**Vérifie :** Si un agent peut *agir* sur le site, et pas seulement le lire. Deux dimensions. **Formulaires** (uniquement si les pages échantillonnées en comportent au moins un) : échoue sur un formulaire dont le contrôle de soumission est `disabled` ou qui n'en a aucun (un `<button>` sans `type` compte — `type="button"`/`"reset"` non) ; avertit sur une `action` en `javascript:…` ou `#`, et sur les champs nommables (`input`/`select`/`textarea`) sans `name`. Une `action` **absente** n'est pas pénalisée : en HTML, un tel formulaire poste sur l'URL courante. **Chemin de contact** (toujours) : au moins un moyen lisible par machine de joindre un humain — un lien `mailto:`/`tel:`, un formulaire à l'`action` non-JavaScript, ou `email`/`telephone`/`contactPoint` (ou un nœud `ContactPoint`) dans le JSON-LD ; avertit s'il n'y en a aucun.
**Pourquoi :** Tous les autres checks demandent si un moteur peut lire la page. Celui-ci demande si un assistant qui agit pour un visiteur peut aller au bout : demander un devis, envoyer un message, joindre quelqu'un. Un agent ne peut pas exécuter vos gestionnaires de clic — un formulaire qui ne se soumet qu'en JavaScript, ou dont le bouton est désactivé en attendant une « V1 », est une impasse pour lui exactement comme pour un visiteur sans JS.
**Corriger :** Donnez à chaque formulaire un vrai bouton de soumission jamais désactivé, une `action` non-JavaScript et un `name` sur chaque champ, et exposez un `mailto:`, un `tel:` ou un `contactPoint` JSON-LD.

---

## Données structurées et métadonnées

Identité lisible par machine et éligibilité aux résultats enrichis.

### `json-ld` (10 pts)
**Vérifie :** L'accueil comporte ≥1 bloc `application/ld+json` (échec si aucun).
**Pourquoi :** JSON-LD est la description lisible par machine sur laquelle les moteurs de réponse s'appuient pour extraire des faits sans deviner depuis la prose.
**Corriger :** Ajoutez un bloc JSON-LD décrivant l'activité ou le contenu.

### `json-ld-valid` (4 pts)
**Vérifie :** Chaque bloc JSON-LD se parse et chaque nœud racine a un `@context` schema.org plus un `@type` non vide (échec sur la moindre erreur de parsing ou `@type` manquant).
**Pourquoi :** Une seule erreur de syntaxe rend tout le bloc invisible pour chaque parseur.
**Corriger :** Corrigez virgules finales/guillemets non échappés ; posez `@context` + un `@type` explicite.

### `json-ld-entity` (6 pts)
**Vérifie :** L'accueil déclare une entité principale substantielle (sous-type LocalBusiness / Organization / Article / WebSite), avec NAP présent si LocalBusiness (avertissement si NAP incomplet ; échec si uniquement des enveloppes WebPage/BreadcrumbList).
**Pourquoi :** Un `@type` principal générique ou absent ne dit rien d'exploitable sur ce que représente la page.
**Corriger :** Balisez la chose réelle que la page décrit, pas juste une enveloppe WebPage.

### `schema-coverage` (5 pts)
**Vérifie :** *(ignoré si <2 pages échantillonnées)* Part des pages échantillonnées portant du JSON-LD valide — réussite ≥50 %, avertissement >0 %, échec si seulement l'accueil.
**Pourquoi :** Les données structurées sur les pages internes aident les assistants à comprendre et citer tout le site, pas seulement sa vitrine.
**Corriger :** Émettez du JSON-LD adapté depuis chaque template.

### `sd-organization` (4 pts)
**Vérifie :** Un nœud Organization/LocalBusiness avec name + url + logo absolu https + ≥1 `sameAs` (avertissement si sameAs absent/vide ou logo relatif ; échec si pas d'Organization).
**Pourquoi :** Un nœud Organization complet est l'ancre de l'identité de votre marque dans le knowledge graph.
**Corriger :** Ajoutez name/url/logo-carré/sameAs au `@graph` de l'accueil.

### `sd-entity-grounding` (4 pts)
**Vérifie :** `sameAs` a ≥2 URL de profils absolues, avec bonus pour une ancre wikipedia.org ou wikidata.org (avertissement si une seule ou pas d'ancre KG ; échec si pas de sameAs).
**Pourquoi :** Lier des profils autoritatifs ancre votre entité pour que les assistants la désambiguïsent et lui fassent confiance.
**Corriger :** Listez vos URL officielles LinkedIn/GitHub/Wikipedia/Wikidata dans `sameAs`.

### `sd-localbusiness` (3 pts)
**Vérifie :** *(ignoré si pas de LocalBusiness)* `PostalAddress` structurée (rue/localité/code postal/pays) + téléphone + `geo` + horaires (avertissement si adresse en chaîne brute ou geo/horaires manquants ; échec si pas d'adresse structurée).
**Pourquoi :** Un NAP + geo + horaires complets et structurés permet à un assistant de vous recommander avec des coordonnées exactes et vérifiables.
**Corriger :** Utilisez PostalAddress + GeoCoordinates + openingHoursSpecification structurés.

### `sd-article` (4 pts)
**Vérifie :** *(ignoré si pas d'Article/News/BlogPosting)* headline ≤110 caractères + author(name) + datePublished (ISO) ; recommande dateModified/image/publisher.logo (avertissement si auteur en chaîne brute ou recommandés manquants ; échec si pas de headline ou date illisible).
**Pourquoi :** Un balisage Article complet alimente les résultats enrichis d'articles et fournit des métadonnées propres à citer.
**Corriger :** Ajoutez headline/author/datePublished, plus dateModified/image/publisher.logo.

### `sd-product` (4 pts)
**Vérifie :** *(ignoré si pas de Product)* name + image + `offers` avec price numérique + priceCurrency ISO-4217 + availability ; bonus brand/aggregateRating/gtin/mpn (avertissement si champs bonus manquants ; échec si price/currency manquants ou note hors plage).
**Pourquoi :** Le balisage Product alimente les résultats enrichis marchands et permet aux assistants d'achat d'afficher prix et disponibilité exacts.
**Corriger :** Ajoutez offers(price/priceCurrency/availability) + brand + gtin/mpn ; ne balisez jamais des notes non affichées.

### `sd-faq` (4 pts)
**Vérifie :** *(ignoré s'il n'y a pas de contenu en forme de FAQ)* JSON-LD FAQPage/QAPage (≥2 Question → acceptedAnswer non vide) et/ou un bloc Q&R sur la page — paires `<details>/<summary>`, ou intertitres en forme de question (français comme anglais) suivis d'un paragraphe de réponse (avertissement si la FAQ visible n'a pas de schéma).
**Pourquoi :** Le balisage FAQ est parmi les structures les plus directement citables pour les assistants de question-réponse.
**Corriger :** Balisez les FAQ en FAQPage → Question → acceptedAnswer.Text.

### `sd-breadcrumb` (3 pts)
**Vérifie :** *(ignoré si accueil seul)* Les pages internes exposent un `BreadcrumbList` (ListItem ordonnés, position contiguë depuis 1) ou un fil d'Ariane visible (avertissement sur positions/URL cassées).
**Pourquoi :** Le fil d'Ariane transmet la hiérarchie que les assistants utilisent pour situer une page.
**Corriger :** Émettez un BreadcrumbList avec position/name/item ordonnés.

### `sd-website-searchaction` (2 pts)
**Vérifie :** *(ignoré si pas de nœud WebSite)* Un nœud WebSite avec un `potentialAction` SearchAction dont la cible contient `{search_term_string}` (avertissement si WebSite sans SearchAction).
**Pourquoi :** Il active la barre de recherche des sitelinks dans les résultats.
**Corriger :** Ajoutez une cible SearchAction `?q={search_term_string}` avec `required name=search_term_string`.

### `sd-video` (2 pts)
**Vérifie :** *(ignoré sauf si `<video>`/embed YouTube ou VideoObject présent)* VideoObject avec name + description + thumbnailUrl absolue + uploadDate ISO ; bonus contentUrl/embedUrl/duration (échec si vidéo présente mais VideoObject absent/incomplet).
**Pourquoi :** Le balisage VideoObject rend la vidéo éligible aux résultats enrichis vidéo et aux surfaces des assistants.
**Corriger :** Ajoutez VideoObject(name/description/thumbnailUrl/uploadDate).

### `sd-special-types` (3 pts)
**Vérifie :** *(ignoré sauf si présents)* Champs requis de HowTo / Event / Recipe bien formés (ex. Event exige name + startDate ISO + location) ; échec sur tout champ requis manquant.
**Pourquoi :** Ces types ne débloquent leurs résultats enrichis que si les champs requis sont complets et valides.
**Corriger :** Remplissez les champs requis du type déclaré, avec dates ISO et Place structuré.

### `sd-graph-integrity` (3 pts)
**Vérifie :** *(ignoré sauf si `@id` utilisé)* Chaque référence `{"@id":…}` résout vers un nœud du graphe de la page (avertissement sur entités dupliquées ; échec sur une référence pendante).
**Pourquoi :** Une référence `@id` pendante casse le graphe d'entités que les assistants tentent d'assembler.
**Corriger :** Utilisez un seul `@graph` avec un `@id` stable par entité et référencez par `@id`.

### `sd-consistency` (3 pts)
**Vérifie :** Les valeurs clés du JSON-LD (name/headline, prix, ratingValue) ont une chaîne correspondante dans le corps visible (**avertissement seul** — jamais d'échec dur).
**Pourquoi :** Baliser du contenu non visible sur la page risque une pénalité pour données structurées trompeuses.
**Corriger :** Ne balisez que le contenu réellement affiché.

### `nap-consistency` (3 pts)
**Vérifie :** *(ignoré si pas de NAP)* Un téléphone (et une adresse) normalisé apparaît de façon cohérente dans les pieds de page échantillonnés et correspond au NAP JSON-LD (avertissement sur divergence mineure ; échec sur conflits).
**Pourquoi :** Des coordonnées incohérentes érodent la confiance nécessaire pour qu'un assistant recommande une entreprise.
**Corriger :** Restituez un NAP canonique unique depuis une source unique et faites-le correspondre au JSON-LD.

### `entity-graph-connectivity` (4 pts)
**Vérifie :** Construit le graphe d'entités JSON-LD à travers les pages échantillonnées et vérifie sa cohérence — chaque référence `@id` résout vers un nœud défini, et les entités racines nommées (Organization/WebSite/Person/LocalBusiness) sont reliées en un seul graphe connexe (avertissement si aucune entité JSON-LD n'existe, ou si les entités racines forment plusieurs groupes déconnectés ; échec sur toute référence `@id` pendante).
**Pourquoi :** Un graphe d'entités propre et connecté permet aux moteurs d'IA de comprendre qui vous êtes et de relier vos pages, votre marque et vos auteurs.
**Corriger :** Utilisez un seul `@graph` avec un `@id` stable par entité, définissez chaque `@id` référencé, et reliez Organization ↔ WebSite (et Person/LocalBusiness) par `@id`.

### `open-graph` (5 pts)
**Vérifie :** Les balises OG de base sont non vides — og:title, og:description, og:image (absolue https), og:type, og:url ; bonus og:site_name/og:locale (avertissement si bonus manquants ; échec si og:image ou og:title manque).
**Pourquoi :** Open Graph est le format d'aperçu de fait des messageries et de plus en plus des citations IA ; sans lui, des liens nus.
**Corriger :** Ajoutez le jeu OG complet avec og:image absolue et ≥1200×630.

### `twitter-card` (2 pts)
**Vérifie :** Une `twitter:card` de type connu (summary/summary_large_image) ; title/description/image en direct ou via repli OG (avertissement sur type générique ; échec si ni carte ni repli OG image).
**Pourquoi :** Elle contrôle le rendu des liens sur X/Twitter et d'autres intégrateurs.
**Corriger :** Ajoutez `twitter:card` (summary_large_image) ou appuyez-vous sur un jeu OG complet.

---

## SEO technique

Hygiène de crawlabilité et d'indexation.

### `canonical` (5 pts)
**Vérifie :** Chaque page échantillonnée a exactement un `rel=canonical`, absolu + même origine + https, auto-référent pour les pages autonomes (un en-tête HTTP `Link: rel=canonical` compte) ; échec si absent, multiple ou tout pointe vers `/`.
**Pourquoi :** Sans canonique correcte, un contenu accessible via plusieurs URL divise son autorité et sème le doute chez les crawlers.
**Corriger :** Posez une canonique absolue et auto-référente par page.

### `canonical-resolves` (4 pts)
**Vérifie :** Chaque canonique déclarée renvoie 200 sans saut de redirection et n'est pas en noindex (avertissement sur une canonique qui redirige ; échec sur 4xx/5xx ou noindex).
**Pourquoi :** Une canonique pointant vers une URL cassée ou en noindex dit aux crawlers de consolider vers une page qui ne peut pas ranker.
**Corriger :** Ne pointez les canoniques que vers des URL vivantes, indexables et sans redirection.

### `sitemap` (10 pts)
**Vérifie :** Un sitemap est découvert (robots `Sitemap:` / `/sitemap.xml` / `-index` / `_index`), en XML valide avec `urlset|sitemapindex` et ≥1 `<loc>` (avertissement si valide mais non référencé ; échec si aucun/invalide).
**Pourquoi :** Le sitemap est le moyen de découvrir les pages au-delà de l'accueil et d'apprendre ce qui a changé.
**Corriger :** Générez sitemap.xml et référencez-le dans robots.txt.

### `sitemap-lastmod` (4 pts)
**Vérifie :** Une part des entrées `<url>` porte un `<lastmod>` W3C/ISO valide, aucun daté dans le futur, valeurs variées (avertissement si absent/uniforme ; échec si tout futur/incohérent).
**Pourquoi :** Des lastmod honnêtes par URL aident les crawlers à prioriser les recrawls.
**Corriger :** Émettez de vrais lastmod par URL, pas la date de build.

### `sitemap-urls-valid` (4 pts)
**Vérifie :** Les URL échantillonnées du sitemap renvoient 200 même origine https, auto-canoniques, non noindex, sans saut de redirection (avertissement sur une minorité ; échec sur redirections/404/noindex/non-canonique).
**Pourquoi :** Un sitemap listant des URL non indexables gaspille le budget de crawl et signale une faible qualité.
**Corriger :** Ne listez que des URL finales, indexables et auto-canoniques.

### `sitemap-index-limits` (2 pts)
**Vérifie :** *(ignoré sauf `<sitemapindex>`)* Chaque `<loc>` enfant est récupérable, en XML valide, même origine, et sous 50 000 URL / ~50 Mo (échec sur un enfant surdimensionné ou injoignable).
**Pourquoi :** Des sitemaps enfants trop gros ou cassés sont silencieusement abandonnés par les crawlers.
**Corriger :** Découpez en enfants ≤50 000 URL sous un seul index.

### `sitemap-orphans` (3 pts)
**Vérifie :** Recoupe les URL du sitemap avec les liens internes de même origine de l'échantillon (avertissement sur divergence — URL de sitemap jamais liées, ou pages liées absentes du sitemap).
**Pourquoi :** Des pages dans le sitemap mais jamais liées (ou l'inverse) envoient des signaux de découvrabilité contradictoires.
**Corriger :** Assurez-vous que les pages clés sont à la fois liées en interne et dans le sitemap.

### `internal-linking` (4 pts)
**Vérifie :** Chaque page de contenu échantillonnée a ≥1 lien interne sortant, profondeur de clics BFS depuis l'accueil ≤3, aucune page non-accueil non référencée (avertissement sur pages isolées/profondes).
**Pourquoi :** Des pages peu profondes et bien liées sont mieux crawlées et se transmettent de l'autorité.
**Corriger :** Ajoutez des liens internes contextuels via des pages pivots ; gardez les pages clés à ≤3 clics.

### `link-equity-map` (3 pts)
**Vérifie :** Sur le graphe de liens internes de l'échantillon, calcule le degré entrant de chaque page et un PageRank limité à l'échantillon (amortissement 0,85, 20 itérations fixes, déterministe), nomme les pages les mieux classées avec leur part et signale les pages orphelines (aucun lien entrant depuis d'autres pages échantillonnées) et en impasse (aucun lien interne sortant). Ignoré en dessous de 3 pages échantillonnées.
**Pourquoi :** Là où `internal-linking` signale la profondeur et le sous-maillage sous forme de booléens, ce contrôle cartographie la *répartition* réelle du jus de lien — révélant quelles pages accaparent l'autorité et lesquelles en sont privées.
**Corriger :** Reliez chaque page depuis au moins une autre page et donnez à chaque page au moins un lien interne sortant, pour que le jus de lien circule dans tout le site au lieu de se concentrer sur quelques pages.

### `crawlable-nav` (4 pts)
**Vérifie :** La part des ancres de navigation qui nécessitent JavaScript — ancres sans `href`, `href="#"` ou `href="javascript:…"` — sur les pages échantillonnées. Les fragments internes `#section` et les ancres-cibles sans `href` sont ignorés ; garde-fou par ratio (avertissement >20 %, échec >50 % de liens dépendant du JS).
**Pourquoi :** La plupart des crawlers de moteurs de réponse IA (GPTBot, ClaudeBot, PerplexityBot, CCBot) et le premier passage de Google n'exécutent pas JavaScript : les liens en JS-only sont des impasses et les pages derrière restent introuvables.
**Corriger :** Utilisez de vrais liens `<a href="/chemin">` pour la navigation, afin que les crawlers sans JavaScript atteignent chaque page.

### `broken-internal-links` (8 pts)
**Vérifie :** Jusqu'à 30 cibles `<a>` distinctes de même origine sur l'échantillon résolvent en dessous de 400 (avertissement ≥80 % ok ; échec en dessous). Les points `/cdn-cgi/` de Cloudflare sont ignorés.
**Pourquoi :** Les liens internes cassés gaspillent le budget de crawl et brisent le chemin qu'un assistant suit pour vérifier une citation.
**Corriger :** Corrigez ou supprimez les liens renvoyant 400+.

### `www-consolidation` (5 pts)
**Vérifie :** Les variantes www et apex — exactement une *atterrit* en 200 sur son propre hôte et l'autre y renvoie en 301 (avertissement sur 302 ; échec si les deux vivent, si elles se renvoient l'une à l'autre, ou si une chaîne boucle). Une redirection de chemin sur le même hôte (`/` → `/fr/`) compte toujours comme « sert le site » : seul un saut qui quitte l'hôte est un signal de consolidation.
**Pourquoi :** Deux hôtes vivants dupliquent chaque URL et divisent les signaux de classement.
**Corriger :** 301 l'hôte non canonique vers celui choisi.

### `trailing-slash` (4 pts)
**Vérifie :** Pour les chemins échantillonnés, la variante à slash inversé (sans suivi) 301 vers la forme canonique plutôt que deux 200 (avertissement sur 302 ; échec sur doublons deux-200).
**Pourquoi :** `/page` et `/page/` renvoyant tous deux 200 créent des URL en double.
**Corriger :** Imposez une convention avec un 301.

### `redirect-chains` (4 pts)
**Vérifie :** Suivi manuel depuis l'accueil + URL échantillonnées — aucune chaîne de plus d'1 saut, pas de boucle, les déplacements permanents utilisent 301/308 et non 302/307 (avertissement sur un mauvais type ; échec sur chaînes/boucles).
**Pourquoi :** Les chaînes de redirection gaspillent le budget de crawl et perdent un peu d'autorité à chaque saut.
**Corriger :** Réduisez à un seul 301 vers l'URL finale.

### `soft-404` (6 pts)
**Vérifie :** Un chemin inexistant aléatoire renvoie 404/410, pas 200 ni une redirection vers l'accueil (échec sur un soft-404 en 200 ou un 301→accueil).
**Pourquoi :** Les soft-404 laissent des URL parasites entrer dans l'index et masquent les pages réellement manquantes.
**Corriger :** Faites renvoyer un vrai statut 404/410 aux routes manquantes.

### `custom-404` (2 pts)
**Vérifie :** Le corps de la 404 offre un retour — navigation, liens internes ou recherche (avertissement sur une erreur nue/brute).
**Pourquoi :** Une 404 en cul-de-sac perd les utilisateurs et les crawlers qui pourraient sinon rebondir.
**Corriger :** Renvoyez une 404 personnalisée (avec statut 404) incluant navigation et lien d'accueil.

### `url-structure` (3 pts)
**Vérifie :** Les URL et cibles de liens échantillonnées font ≤~115 caractères, minuscules, séparées par des tirets, peu profondes, sans paramètres de session/tracking (avertissement sur une minorité ; échec sur des ID de session/paramètres généralisés dans la forme canonique).
**Pourquoi :** Des URL propres, stables et lisibles sont plus faciles à crawler, citer et partager.
**Corriger :** Utilisez des slugs courts, minuscules, à tirets, et retirez les paramètres de tracking.

### `pagination-canonical` (2 pts)
**Vérifie :** *(ignoré sauf si pagination détectée)* Les pages paginées sont auto-canoniques et indexables, non canonicalisées vers la page 1 (échec si pointées vers la page 1).
**Pourquoi :** Canonicaliser la page 2+ vers la page 1 cache leur contenu de l'index.
**Corriger :** Auto-référencez chaque page paginée et gardez-la indexable.

### `hreflang` (3 pts)
**Vérifie :** *(ignoré si monolingue)* Les alternates hreflang déclarés renvoient 200 et se réciproquent (échec sur alternates cassés ou non réciproques).
**Pourquoi :** Les moteurs et systèmes IA n'accordent leur confiance au hreflang que si les alternates sont accessibles et se référencent mutuellement.
**Corriger :** Assurez-vous que chaque alternate renvoie 200 et référence en retour.

### `hreflang-x-default` (3 pts)
**Vérifie :** *(ignoré si monolingue)* Un alternate `x-default` existe, chaque valeur hreflang est un BCP-47 valide, un hreflang auto-référent est présent, hrefs absolus (avertissement si x-default/auto manquant ; échec sur codes invalides).
**Pourquoi :** Un jeu hreflang complet avec x-default est ce qui oriente les utilisateurs vers la bonne variante linguistique.
**Corriger :** Ajoutez x-default + un hreflang auto-référent, codes BCP-47 valides et URL absolues.

### `meta-refresh` (2 pts)
**Vérifie :** Aucune page échantillonnée n'utilise `<meta http-equiv="refresh">` comme redirection (échec sur la moindre).
**Pourquoi :** Les redirections meta-refresh sont une classe de redirection cachée et non cacheable que les crawlers gèrent mal.
**Corriger :** Remplacez-les par un 301 serveur.

### `indexnow` (4 pts)
**Vérifie :** *(ignoré sauf `--indexnow-key`)* `/<clé>.txt` renvoie exactement la clé (échec si absent/non concordant).
**Pourquoi :** IndexNow pousse instantanément les URL modifiées vers les moteurs participants ; le fichier de clé prouve la propriété du domaine.
**Corriger :** Publiez `<clé>.txt` à la racine contenant exactement la clé.

---

## On-page et contenu

Titres, en-têtes, meta et correction du `<head>`.

### `title-description` (8 pts)
**Vérifie :** L'accueil a un `<title>` (10–70 caractères) et une meta description (50–160) ; avertissement hors plage, échec si l'un manque.
**Pourquoi :** Ces deux balises sont le snippet par défaut sur chaque surface de recherche et un résumé compressé que lisent les moteurs de réponse.
**Corriger :** Ajoutez un title de 10–70 caractères et une description de 50–160 ; soyez précis et factuel.

### `meta-per-page` (5 pts)
**Vérifie :** Chaque page échantillonnée a un `<title>` et une meta description dans la plage (avertissement sur une minorité ; échec si beaucoup manquent ou sont trop longs).
**Pourquoi :** Chaque page — pas seulement l'accueil — a besoin de ses propres métadonnées de snippet pour ranker et être citée distinctement.
**Corriger :** Donnez à chaque page un title + description uniques dans la plage.

### `unique-titles` (5 pts)
**Vérifie :** *(ignoré si <2 pages)* Les titres et descriptions sont uniques sur l'échantillon ; les doublons baissent le score proportionnellement.
**Pourquoi :** Des titres/descriptions dupliqués rendent les résultats et citations indistinguables et diluent la pertinence.
**Corriger :** Donnez à chaque page un titre et une description distincts et descriptifs.

### `title-pattern` (3 pts)
**Vérifie :** Le title de l'accueil n'est pas que la marque et comporte un segment de marque après un séparateur (`| - – — ·`), marque non en tête (avertissement si marque en premier ou pas de séparateur).
**Pourquoi :** Un title sujet-en-premier fait ressortir le thème avant la marque dans les résultats tronqués.
**Corriger :** Formatez en `Thème principal — Marque`.

### `title-h1-alignment` (2 pts)
**Vérifie :** Le `<title>` et le `<h1>` de l'accueil partagent des mots significatifs après retrait des mots vides/de la marque (avertissement sur un recouvrement quasi nul).
**Pourquoi :** Un title et un H1 sur des thèmes divergents diluent le sujet perçu de la page.
**Corriger :** Gardez le H1 et le title sur le même sujet.

### `headings-outline` (5 pts)
**Vérifie :** Exactement un `<h1>` non vide par page et aucun niveau d'en-tête sauté en descendant (avertissement si majoritairement conforme ; échec sur zéro/plusieurs H1 ou sauts répétés).
**Pourquoi :** Une hiérarchie d'en-têtes propre est la façon dont les assistants découpent une page en sections extractibles.
**Corriger :** Utilisez un H1 énonçant le sujet et imbriquez H2/H3 sans sauter de niveau.

### `anchor-text` (3 pts)
**Vérifie :** Le texte d'ancre interne est descriptif — moins de 10 % générique/vide (« cliquez ici », « en savoir plus », URL nue, image sans alt) (avertissement au-dessus de 10 % ; échec si la plupart sont non descriptifs).
**Pourquoi :** Des ancres descriptives disent aux crawlers et assistants de quoi parle la destination.
**Corriger :** Nommez la destination dans le texte d'ancre.

### `charset` (3 pts)
**Vérifie :** L'UTF-8 est déclaré dans les 1024 premiers octets du `<head>` (`<meta charset>` / http-equiv) et/ou l'en-tête Content-Type (avertissement sur un charset ancien ; échec si aucun).
**Pourquoi :** Un charset non déclaré ou erroné peut corrompre le texte pour les parseurs.
**Corriger :** Ajoutez `<meta charset="utf-8">` en premier dans `<head>`.

### `favicon` (2 pts)
**Vérifie :** Un `rel=icon`/`shortcut icon` (ou `/favicon.ico`) plus un `apple-touch-icon` ; bonus `theme-color` (avertissement si favicon seul ; échec si aucun).
**Pourquoi :** Favicons et icônes tactiles apparaissent près de votre marque dans les résultats, onglets et cartes de partage.
**Corriger :** Ajoutez `rel=icon` + `apple-touch-icon` (et éventuellement `theme-color`).

### `content-readability` (2 pts)
**Vérifie :** Score de lisibilité Flesch / longueur moyenne des phrases du texte principal de l'accueil (**avertissement seul** sur un mur de texte).
**Pourquoi :** Un texte dense et difficile est plus dur à exploiter, pour les personnes comme pour les modèles.
**Corriger :** Fractionnez les phrases et paragraphes trop longs.

### `figure-caption` (2 pts)
**Vérifie :** *(ignoré si pas d'images de contenu)* Les images explicatives de contenu sont dans un `<figure>` avec `<figcaption>` (**avertissement seul**).
**Pourquoi :** Les légendes donnent aux images un contexte textuel que les assistants peuvent lire et citer.
**Corriger :** Enveloppez les images explicatives dans `<figure>`/`<figcaption>`.

---

## Performance et Core Web Vitals

Les heuristiques statiques s'exécutent toujours ; les Core Web Vitals terrain/labo sont optionnels via `--cwv --psi-key`. Sans clé, les checks CWV sont ignorés et la famille est notée sur les seules heuristiques statiques.

### `html-weight` (3 pts)
**Vérifie :** Les octets bruts du document HTML — réussite ≤100 Ko, avertissement ≤250 Ko, échec >250 Ko.
**Pourquoi :** Un document HTML lourd ralentit le premier rendu et gonfle le coût de crawl.
**Corriger :** Externalisez les gros blocs inline et paginez les pages énormes.

### `render-blocking-js` (4 pts)
**Vérifie :** `<script src>` externes dans `<head>` sans async/defer/module — réussite 0, avertissement 1–2, échec ≥3.
**Pourquoi :** Les scripts en tête bloquent le rendu, retardant le LCP et l'interactivité.
**Corriger :** Ajoutez defer/async ou déplacez les scripts en fin de `<body>`.

### `render-blocking-css` (3 pts)
**Vérifie :** `<link rel=stylesheet>` externes dans `<head>` sans report media/preload — réussite ≤2, avertissement 3–4, échec ≥5.
**Pourquoi :** Chaque feuille de style bloquante est un aller-retour avant que la page puisse s'afficher.
**Corriger :** Inlinez le CSS critique, reportez le reste et réduisez les requêtes.

### `img-dimensions` (4 pts)
**Vérifie :** `<img>` avec width+height explicites ou aspect-ratio CSS — réussite ≥90 %, avertissement 70–89 %, échec <70 %.
**Pourquoi :** Les images sans espace réservé provoquent des décalages de mise en page (CLS).
**Corriger :** Posez width/height intrinsèques (ou aspect-ratio) sur les images.

### `img-lazy-loading` (2 pts)
**Vérifie :** Les images sous la ligne de flottaison portent `loading=lazy` tandis que le hero reste eager (**avertissement seul** sur beaucoup d'images hors écran en eager ou une image probablement LCP en lazy).
**Pourquoi :** Le lazy-loading hors écran économise de la bande passante ; le lazy sur le hero retarde le LCP.
**Corriger :** Ajoutez `loading=lazy` sous la flottaison et gardez l'image LCP en eager.

### `img-next-gen` (2 pts)
**Vérifie :** Les images matricielles sont servies/proposées en WebP/AVIF — réussite ≥50 % (**avertissement seul** sur une forte part de jpg/png bruts).
**Pourquoi :** Les formats modernes réduisent nettement le poids des images et accélèrent le chargement.
**Corriger :** Servez de l'AVIF/WebP avec `<picture>` + srcset.

### `resource-hints` (2 pts)
**Vérifie :** `preconnect`/`dns-prefetch` pour les origines tierces critiques et `preload` pour l'image LCP/la police clé (**avertissement seul** si absents).
**Pourquoi :** Les hints laissent le navigateur ouvrir les connexions et récupérer les ressources critiques plus tôt.
**Corriger :** Preconnect les hôtes critiques et preload l'image hero/la police.

### `dom-size` (2 pts)
**Vérifie :** Nombre total de nœuds éléments et profondeur d'imbrication max — réussite ≤800 éléments, avertissement ≤1400 ou profondeur >32, échec >1400.
**Pourquoi :** Un gros DOM ralentit le style, la mise en page et les interactions.
**Corriger :** Simplifiez le balisage et virtualisez les longues listes.

### `text-compression` (3 pts)
**Vérifie :** Le `Content-Encoding` de la réponse HTML est br/zstd/gzip (échec si absent sur text/html).
**Pourquoi :** Du HTML non compressé gaspille la bande passante et ralentit la livraison.
**Corriger :** Activez Brotli/gzip pour le texte au niveau serveur ou CDN.

### `asset-caching` (2 pts)
**Vérifie :** Un asset statique échantillonné porte `Cache-Control` max-age / ETag (**avertissement seul** si absent).
**Pourquoi :** Un cache longue durée sur les assets hashés accélère les visites répétées.
**Corriger :** Envoyez `Cache-Control: public, max-age=31536000, immutable` sur les assets hashés.

### `inline-head-volume` (2 pts)
**Vérifie :** Volume en octets des `<style>`+`<script>` inline dans `<head>` — réussite ≤14 Ko (**avertissement seul** >50 Ko).
**Pourquoi :** Un `<head>` inline surchargé retarde le premier rendu qu'il était censé accélérer.
**Corriger :** Ne gardez inline que le CSS critique minimal et externalisez le reste.

### `lighthouse-perf` (5 pts)
**Vérifie :** *(ignoré sans PSI)* Score de performance Lighthouse (mobile) — réussite ≥0,90, avertissement 0,50–0,89, échec <0,50.
**Pourquoi :** Un score labo unique résume la performance synthétique de la page.
**Corriger :** Agissez sur les principales opportunités PSI — ressources bloquantes, JS inutilisé, images.

### `cwv-lcp` (6 pts)
**Vérifie :** *(ignoré sans données)* LCP p75 terrain (repli labo) — réussite ≤2500 ms, avertissement 2500–4000, échec >4000.
**Pourquoi :** Le LCP est la métrique de chargement phare et un signal de classement confirmé.
**Corriger :** Preload l'image/police LCP et retirez les ressources bloquantes en amont.

### `cwv-cls` (4 pts)
**Vérifie :** *(ignoré sans données)* CLS p75 terrain — réussite ≤0,10, avertissement 0,10–0,25, échec >0,25.
**Pourquoi :** Le décalage de mise en page est une expérience désagréable et un signal de classement.
**Corriger :** Posez des dimensions sur médias/pubs et réservez l'espace des bannières injectées.

### `cwv-inp` (4 pts)
**Vérifie :** *(ignoré si absent)* INP p75 terrain — réussite ≤200 ms, avertissement 200–500, échec >500 (faible trafic → ignoré, jamais d'échec).
**Pourquoi :** L'INP mesure la réactivité réelle aux interactions et est un Core Web Vital.
**Corriger :** Fractionnez les longues tâches JS et reportez les scripts tiers.

### `cwv-assessment` (4 pts)
**Vérifie :** *(ignoré sans données terrain)* La `overall_category` CrUX — réussite FAST, avertissement AVERAGE, échec SLOW.
**Pourquoi :** C'est le verdict réussite/échec de Google sur l'expérience terrain de la page.
**Corriger :** Corrigez en premier celui de LCP/CLS/INP qui est le pire.

### `cwv-ttfb` (3 pts)
**Vérifie :** TTFB p75 terrain (repli labo temps de réponse serveur) — réussite ≤800 ms, avertissement 800–1800, échec >1800.
**Pourquoi :** Un TTFB lent retarde tout ce qui vient après.
**Corriger :** Ajoutez du cache en périphérie/CDN et activez keep-alive/HTTP2.

### `lab-tbt` (3 pts)
**Vérifie :** *(ignoré sans PSI)* Total Blocking Time labo (proxy de l'INP) — réussite <200 ms, avertissement 200–600, échec >600.
**Pourquoi :** Le TBT approxime combien de temps le thread principal est bloqué au chargement.
**Corriger :** Réduisez/reportez le JS, code-splittez et coupez les tags tiers.

### `lab-fcp` (3 pts)
**Vérifie :** *(ignoré sans PSI)* FCP labo (et LCP) en l'absence de données terrain — réussite FCP ≤1800 ms & LCP labo ≤2500 ms.
**Pourquoi :** Sans données réelles, les temps de rendu labo sont le meilleur proxy disponible.
**Corriger :** Raccourcissez la chaîne de requêtes critique et éliminez le CSS/JS bloquant.

---

## Accessibilité

Une sémantique qui sert aussi de signal d'extraction.

### `html-lang` (4 pts)
**Vérifie :** Le `<html lang>` de chaque page échantillonnée est présent et un BCP-47 valide, cohérent avec le hreflang auto-référent sur les sites multilingues (avertissement si malformé ; échec si absent).
**Pourquoi :** L'attribut lang dit aux technologies d'assistance et aux crawlers dans quelle langue interpréter.
**Corriger :** Ajoutez `<html lang="…">` avec un code BCP-47 valide.

### `images-alt` (4 pts)
**Vérifie :** Part des `<img>` avec un attribut `alt` (`alt=""` ok pour le décoratif) — réussite ≥90 %, avertissement 60–89 %, échec <60 %.
**Pourquoi :** Le texte alternatif est ce qui permet aux lecteurs d'écran et aux LLM de comprendre les images ; son absence perd ce contenu.
**Corriger :** Ajoutez un alt descriptif (et `alt=""` pour les images décoratives).

### `alt-descriptive` (3 pts)
**Vérifie :** Les alts non vides sont réellement descriptifs — pas un nom de fichier ni un placeholder « image »/« photo » (réussite ≥90 % descriptifs ; avertissement 70–90 % ; échec en dessous).
**Pourquoi :** Un alt en nom de fichier ou placeholder ne transmet rien à un lecteur ou un modèle.
**Corriger :** Remplacez les alts en nom de fichier/placeholder par une vraie description.

### `landmarks` (4 pts)
**Vérifie :** Un unique `<main>` (ou `<article>` pour les billets) plus ≥2 de header/nav/footer (ou rôles ARIA) (avertissement sur main seul ; échec sur soupe de div).
**Pourquoi :** Les repères permettent aux technologies d'assistance et aux extracteurs de trouver le contenu principal face à l'habillage.
**Corriger :** Enveloppez le contenu dans `<main>` et utilisez header/nav/footer.

### `form-labels` (3 pts)
**Vérifie :** *(ignoré si pas de formulaires)* Chaque input/select/textarea a un nom accessible (label/aria-label/aria-labelledby/title) — réussite 100 %, avertissement 1–2, échec >2 ou >20 %.
**Pourquoi :** Des contrôles non étiquetés sont inutilisables pour les utilisateurs de lecteurs d'écran.
**Corriger :** Associez chaque champ à un label ou un `aria-label`.

### `link-text` (3 pts)
**Vérifie :** Les liens ont un nom accessible (texte / aria-label / title / alt de l'image enfant) ; pas de liens vides ou en icône seule sans nom (avertissement sur quelques-uns ; échec sur plusieurs).
**Pourquoi :** Un lien sans nom est annoncé « lien » sans aucun contexte de destination.
**Corriger :** Donnez un nom accessible aux liens en icône/image.

### `viewport` (5 pts)
**Vérifie :** Une balise `<meta name="viewport">` est présente (échec si absente).
**Pourquoi :** La balise viewport marque une page adaptée au mobile ; les moteurs indexent mobile-first.
**Corriger :** Ajoutez `<meta name="viewport" content="width=device-width, initial-scale=1">`.

### `viewport-zoom` (3 pts)
**Vérifie :** Le viewport ne désactive pas le zoom — pas de `user-scalable=no`, `maximum-scale` ≥2 ou non défini (avertissement sur maximum-scale 1–2 ; échec sur user-scalable=no ou ≤1).
**Pourquoi :** Désactiver le zoom échoue au WCAG 1.4.4 et exclut les utilisateurs malvoyants.
**Corriger :** Retirez `user-scalable=no` et tout `maximum-scale` faible.

### `iframe-title` (2 pts)
**Vérifie :** *(ignoré si pas d'iframes)* Chaque `<iframe>` a un title/aria-label non vide (avertissement si certains manquent ; échec sur plusieurs sans titre).
**Pourquoi :** Un iframe sans titre est annoncé sans aucune description de son contenu.
**Corriger :** Ajoutez un `title` à chaque iframe.

---

## Sécurité et confiance

Posture de confiance : HTTPS de bout en bout, en-têtes de sécurité, pas de contenu mixte.

### `https` (5 pts)
**Vérifie :** *(ignoré pour les hôtes locaux/privés)* Le schéma de l'URL finale est https (échec sur http).
**Pourquoi :** HTTPS est un signal de confiance de base ; les crawlers rétrogradent les sites en HTTP simple et les navigateurs en détournent les visiteurs.
**Corriger :** Servez tout en HTTPS.

### `redirect-hygiene` (4 pts)
**Vérifie :** *(ignoré en local)* La variante `http://` redirige en 301 vers https, pas seulement en atterrissant sur https (avertissement sur un 302 ou pas de redirection ; échec si servi en http).
**Pourquoi :** Sans un 301 HTTP→HTTPS propre, les liens historiques atterrissent sur une URL non canonique ou non sécurisée.
**Corriger :** 301 tout http→https.

### `mixed-content` (4 pts)
**Vérifie :** *(ignoré si non https)* Aucune sous-ressource (script/link/img/iframe/media) n'utilise `http://` (avertissement sur passif seul ; échec sur contenu mixte actif).
**Pourquoi :** Le contenu mixte est bloqué ou rétrogradé par les navigateurs et sape la garantie HTTPS.
**Corriger :** Utilisez https:// (ou protocole-relatif) pour toutes les sous-ressources.

### `hsts` (4 pts)
**Vérifie :** *(ignoré en local)* `Strict-Transport-Security` avec `max-age` ≥ 180 jours ; bonus includeSubDomains/preload (avertissement si plus court ; échec si absent en https).
**Pourquoi :** HSTS force les navigateurs à utiliser HTTPS, fermant la fenêtre de rétrogradation à la première requête.
**Corriger :** Envoyez `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

### `x-content-type-options` (3 pts)
**Vérifie :** `X-Content-Type-Options: nosniff` (échec si absent/autre).
**Pourquoi :** Sans nosniff, les navigateurs peuvent renifler le MIME des réponses vers un type exploitable.
**Corriger :** Ajoutez `X-Content-Type-Options: nosniff`.

### `csp` (3 pts)
**Vérifie :** Un en-tête ou meta `Content-Security-Policy` (avertissement s'il utilise `unsafe-inline`/`*` pour les scripts ; échec si aucun).
**Pourquoi :** Une CSP est la principale défense contre les scripts injectés (XSS).
**Corriger :** Ajoutez une CSP restreignant les sources script/style/connect.

### `clickjacking` (3 pts)
**Vérifie :** `X-Frame-Options` DENY/SAMEORIGIN **ou** CSP `frame-ancestors` (pas `*`) (échec si aucun).
**Pourquoi :** Sans cela, vos pages peuvent être encadrées pour des attaques de clickjacking.
**Corriger :** Ajoutez `X-Frame-Options: SAMEORIGIN` ou `frame-ancestors 'self'`.

### `referrer-policy` (2 pts)
**Vérifie :** Un `Referrer-Policy` avec une valeur non fuyante (avertissement sur un `unsafe-url` fuyant ; échec si absent).
**Pourquoi :** Une politique de referrer fuyante expose les URL complètes (et leurs paramètres) à des tiers.
**Corriger :** Envoyez `Referrer-Policy: strict-origin-when-cross-origin`.

### `permissions-policy` (2 pts)
**Vérifie :** Un `Permissions-Policy` (ou l'ancien Feature-Policy) est présent (échec si absent).
**Pourquoi :** Il restreint les fonctionnalités navigateur puissantes (caméra, micro, géolocalisation) que la page et ses cadres peuvent utiliser.
**Corriger :** Ajoutez `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

---

### `security-txt` (2 pts)
**Vérifie :** `/.well-known/security.txt` (RFC 9116) existe, est servi en texte (et non en shell HTML d'une SPA), porte le champ obligatoire `Contact:` et une date `Expires:` encore dans le futur. Dans tous les autres cas : avertissement — jamais d'échec.
**Pourquoi :** C'est l'adresse lisible par machine qu'un chercheur en sécurité (ou un scanner automatique) utilise pour vous joindre. Un fichier absent, sans contact ou périmé se lit comme un site laissé à l'abandon ; c'est aussi le dernier fichier de découverte `/.well-known/` aux côtés de `robots.txt`, `llms.txt` et `ai.json`.
**Corriger :** Publiez `/.well-known/security.txt` avec au minimum `Contact:` (une adresse mailto: ou https: qui aboutit) et `Expires:` une date ISO-8601 dans le futur — puis renouvelez-la avant l'échéance.

## Générer des fichiers d'indexation

Corriger plusieurs des checks ci-dessus (`llms-txt`, `llms-full-txt`, `robots-wellformed`, `ai-crawlers-allowed`, ou l'absence de balisage `Organization` / `WebSite` / `BreadcrumbList` / `FAQPage`) commence par avoir *quelque chose* à publier. `findable-audit` peut générer un jeu de fichiers de départ directement à partir de l'audit qu'il vient d'exécuter :

```bash
npx findable-audit https://your-site.com --emit ./out
```

Cela écrit `robots.txt`, `llms.txt`, `llms-full.txt`, `.well-known/ai.json`, `sitemap.xml`, `jsonld-stubs.json`, et un `GENERATED-README.md` dans `./out`, construits à partir des pages effectivement échantillonnées pendant l'audit. `--emit` fonctionne en complément de `--report`/`--no-report` (options indépendantes) et respecte `--lang` pour le texte généré.

Ces mêmes six fichiers (hors `GENERATED-README.md`) sont aussi téléchargeables un par un depuis la page de résultat du site web, sous **« Générer les fichiers d'indexation »** — régénérés à la volée à partir du rapport en mémoire ; rien n'est écrit sur disque côté serveur.

⚠️ **Ce sont des ébauches génériques, pas du contenu fini — relisez chaque fichier avant de le déployer, surtout `robots.txt`.** Il autorise par défaut tous les crawlers IA, avec une ligne `Disallow: /` commentée sous chacun, pour qu'exclure un bot de l'entraînement ou de la citation soit une modification délibérée et visible. `jsonld-stubs.json` ne fournit une ébauche que pour les types schema.org absents du graphe d'entités déjà présent sur le site (`Organization`, `WebSite`, `BreadcrumbList`, `FAQPage`) et est destiné à être fusionné dans votre JSON-LD réel, pas publié tel quel.

Le formulaire d'audit et de comparaison du site web peut optionnellement se placer derrière un CAPTCHA Cloudflare Turnstile (activé via variables d'environnement, désactivé sinon) — voir le [README principal](../README.md#cloudflare-turnstile-optional-captcha) pour la configuration.

---

## Utiliser en CI

L'audit est conçu comme un gate CI — le code de sortie vaut `0` au-dessus de `--min-score`, `1` en dessous (ou en cas de régression), `2` si le site est injoignable.

- **GitHub Actions** — la racine du dépôt fournit une [`action.yml`](../action.yml) composite : `uses: piwig/findable-audit@main` avec `url` et `min-score`, puis envoyez le `findable-audit.sarif` émis vers le code scanning. Un exemple complet (gate de régression avec baseline + upload SARIF + artefact JUnit) se trouve dans [`.github/workflows/findable-gate.yml`](../.github/workflows/findable-gate.yml).
- **GitLab CI / Jenkins** — écrivez un rapport JUnit avec `--report findable.junit.xml` (l'extension choisit le format ; un `<testcase>` par check, fail → `<failure>`, warn/skip → `<skipped>`) et déclarez-le comme artefact JUnit pour que les échecs apparaissent dans l'onglet tests.
- **Gate de régression** — committez une baseline `--report *.json`, puis lancez avec `--baseline <fichier> --fail-on-regression [--regression-tolerance <n>]` pour n'échouer que si le score baisse.
- **Graphe d'entités** — chaque rapport HTML dessine le graphe d'entités JSON-LD : une boîte par **type** d'entité (avec un compteur ×N), une flèche par référence, survolables pour le détail. `--entity-graph <fichier>` exporte le même graphe entité par entité, sans plafond, en `.json` / `.dot` / `.mmd`.
- **Synthèse d'une page** — `--summary <fichier>.html` (ou `.md`) écrit la version destinée à qui décide plutôt qu'à qui corrige : score, verdict, les trois axes, les trois actions au plus fort gain avec leur coût, et le score que ces trois-là atteindraient. Assemblée à partir des mêmes chiffres que le rapport complet : les deux ne peuvent pas se contredire.
- **Badge de score** — `--report <fichier>.svg` écrit un badge de statut autonome (aucun script, aucun service de badge tiers ; l'hôte audité et la date de l'audit sont dans son `<title>`). Committez-le et pointez-y votre README ; régénérez-le dans le job qui fait tourner le gate.
</content>
