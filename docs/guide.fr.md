# Guide des checks findable-audit

findable-audit note un site sur 100 à travers 15 checks répartis en 4 familles. Ce guide explique, pour chaque check : ce qu'il vérifie, pourquoi c'est important pour les moteurs de réponse IA, et comment corriger un échec.

Statuts : `OK` (réussi, tous les points), `!!` (avertissement, points partiels), `XX` (échec, 0 point), `--` (ignoré, non comptabilisé mais aucun point gagné).

## Accès crawlers IA

### `robots-exists` (4 pts)

**Ce qu'il vérifie :** `/robots.txt` répond avec un HTTP 200.

**Pourquoi c'est important :** robots.txt est le premier fichier que tout crawler — classique ou IA — demande. Sans lui, vous n'avez aucune politique de crawl explicite, et vous ne pouvez ni référencer votre sitemap ni exprimer vos permissions pour les crawlers IA.

**Comment corriger :** Créez un fichier robots.txt à la racine du site. Une version minimale permissive tient en deux lignes : `User-agent: *` et `Allow: /`, plus une ligne `Sitemap:` pointant vers votre sitemap.

### `ai-crawlers-allowed` (12 pts)

**Ce qu'il vérifie :** Aucun des grands crawlers IA — GPTBot (ChatGPT), ClaudeBot (Claude), PerplexityBot (Perplexity), Google-Extended (Gemini) — n'est bloqué par robots.txt.

**Pourquoi c'est important :** C'est le check au poids le plus élevé. Si un crawler IA est interdit, cet assistant ne peut tout simplement pas lire votre site, et rien d'autre dans cet audit ne peut compenser. Beaucoup de templates CMS et de snippets de « durcissement SEO » bloquent ces bots par défaut sans que le propriétaire s'en rende compte.

**Comment corriger :** Supprimez les règles `Disallow: /` visant ces user-agents dans robots.txt. Vérifiez à la fois les groupes dédiés type `User-agent: GPTBot` et les groupes génériques `User-agent: *` ; un disallow global bloque aussi les crawlers IA.

### `homepage-ok` (6 pts)

**Ce qu'il vérifie :** L'URL racine répond avec un HTTP 200.

**Pourquoi c'est important :** Si la page d'accueil renvoie une erreur, redirige vers un login, ou exige JavaScript pour produire le moindre HTML, les crawlers n'ont rien à indexer et les assistants IA n'ont rien à citer.

**Comment corriger :** Assurez-vous que l'URL racine sert une page HTML en 200 sans nécessiter JavaScript. Vérifiez la configuration d'hébergement, les chaînes de redirection, et toute couche anti-bot qui pourrait servir des erreurs aux clients non-navigateurs.

## Contenu pour LLM

### `llms-txt` (10 pts)

**Ce qu'il vérifie :** `/llms.txt` existe (échec s'il manque) et commence par un titre H1 markdown (avertissement s'il n'est pas structuré).

**Pourquoi c'est important :** `llms.txt` est une convention émergente qui donne aux modèles de langage une carte de votre site, sélective et économe en tokens : ce qu'il est, et quelles pages comptent. Les assistants qui la supportent répondent bien plus précisément qu'en crawlant du HTML brut.

**Comment corriger :** Ajoutez un fichier `/llms.txt` : un titre H1, un résumé d'une ligne, puis une liste markdown des pages clés. Commencez-le par `# Nom du site` suivi d'une courte description, puis liez chaque page importante avec une note d'une ligne.

### `llms-full-txt` (4 pts)

**Ce qu'il vérifie :** `/llms-full.txt` répond avec un HTTP 200.

**Pourquoi c'est important :** Si `llms.txt` est la carte, `llms-full.txt` est le territoire : le texte intégral de vos pages clés dans un seul fichier brut. Un modèle peut l'ingérer en une requête, sans le bruit de balisage du HTML.

**Comment corriger :** Ajoutez un `/llms-full.txt` contenant le texte intégral de vos pages clés. La plupart des générateurs de sites statiques peuvent concaténer le contenu des pages en un fichier au moment du build.

### `content-without-js` (6 pts)

**Ce qu'il vérifie :** Le HTML de la page d'accueil contient au moins 200 caractères de texte visible après suppression des balises `script`, `style` et `noscript` — c'est-à-dire du vrai contenu sans exécuter JavaScript.

**Pourquoi c'est important :** Les crawlers IA n'exécutent pas JavaScript. Une page rendue côté client, riche dans un navigateur, est une coquille vide pour GPTBot ou ClaudeBot : votre contenu n'entre jamais dans leur index.

**Comment corriger :** Rendez votre contenu principal côté serveur. Utilisez la génération statique (Astro, Hugo, export statique Next) ou le SSR pour que le texte significatif soit présent dans la réponse HTML initiale.

## Données structurées

### `json-ld` (10 pts)

**Ce qu'il vérifie :** La page d'accueil contient au moins un bloc `<script type="application/ld+json">` qui se parse comme du JSON valide.

**Pourquoi c'est important :** JSON-LD est la description lisible par machine de qui vous êtes et de ce que vous proposez. Les moteurs de réponse s'y appuient pour extraire des faits (nom, type, offres) sans les deviner depuis la prose, ce qui rend les citations plus exactes.

**Comment corriger :** Ajoutez un bloc `<script type="application/ld+json">` décrivant votre activité ou votre contenu. Validez le JSON — une seule erreur de syntaxe rend tout le bloc invisible pour les parseurs.

### `json-ld-entity` (6 pts)

**Ce qu'il vérifie :** Le JSON-LD déclare un type d'entité pertinent (sous-type de LocalBusiness, Organization, Article, Store, Restaurant ou WebSite). Pour les types « business », il avertit aussi si le NAP (nom, adresse, téléphone) est incomplet.

**Pourquoi c'est important :** Un `@type` générique ou absent ne dit rien d'exploitable aux assistants. Pour un commerce local, un NAP cohérent est ce qui permet à un assistant de vous recommander avec des coordonnées correctes et vérifiables.

**Comment corriger :** Déclarez un `@type` pertinent (sous-type de LocalBusiness, Organization ou Article). Si vous êtes un commerce, ajoutez `name`, `address` et `telephone` pour que les assistants IA citent votre établissement de façon cohérente.

### `sitemap` (10 pts)

**Ce qu'il vérifie :** `/sitemap.xml` existe, est du XML valide, et est référencé par une ligne `Sitemap:` dans robots.txt (avertissement s'il n'est pas référencé).

**Pourquoi c'est important :** Le sitemap est le moyen pour les crawlers de découvrir les pages au-delà de l'accueil, et d'apprendre ce qui a changé. Le référencer dans robots.txt est ce qui le rend découvrable.

**Comment corriger :** Générez un sitemap.xml et référencez-le dans robots.txt avec une ligne comme `Sitemap: https://votre-site/sitemap.xml`. Si le fichier existe mais est invalide, régénérez le sitemap avec l'intégration de votre framework (ex. `@astrojs/sitemap`, `next-sitemap`, l'intégré de Hugo) plutôt que de l'écrire à la main.

### `indexnow` (4 pts)

**Ce qu'il vérifie :** Quand vous passez `--indexnow-key <clé>`, le fichier `/<clé>.txt` existe à la racine du site et contient exactement la clé. Ignoré sans le flag.

**Pourquoi c'est important :** IndexNow permet de pousser instantanément les URL modifiées vers les moteurs participants (Bing, et à travers lui plusieurs piles de réponse IA) au lieu d'attendre un recrawl. Le fichier de clé prouve que vous possédez le domaine.

**Comment corriger :** Publiez un fichier texte nommé `<clé>.txt` à la racine du site contenant exactement la clé, puis pingez `https://api.indexnow.org/indexnow?url=<page>&key=<clé>` quand des pages changent.

## Fondamentaux SEO

### `title-description` (8 pts)

**Ce qu'il vérifie :** La page d'accueil a à la fois un `<title>` et une meta description ; avertit si les longueurs sortent de 10-70 caractères (title) ou 50-160 caractères (description).

**Pourquoi c'est important :** Ces deux balises constituent le snippet par défaut sur toutes les surfaces de recherche, et les moteurs de réponse les utilisent comme résumé compressé de la page pour juger la pertinence.

**Comment corriger :** Ajoutez un `<title>` (10-70 caractères) et une meta description (50-160 caractères). Visez une phrase précise et factuelle plutôt qu'une liste de mots-clés.

### `canonical` (5 pts)

**Ce qu'il vérifie :** La page d'accueil déclare un `<link rel="canonical">`.

**Pourquoi c'est important :** Sans URL canonique, un même contenu accessible via plusieurs URL (`http`/`https`, avec/sans `www`, slash final) divise son autorité et laisse les crawlers hésiter sur la version à citer.

**Comment corriger :** Ajoutez `<link rel="canonical" href="...">` sur chaque page, pointant vers l'unique URL absolue préférée de cette page.

### `open-graph` (5 pts)

**Ce qu'il vérifie :** La page d'accueil possède les balises meta `og:title` et `og:description`.

**Pourquoi c'est important :** Open Graph est le format d'aperçu de fait. Les aperçus de liens dans les messageries — et de plus en plus dans les citations des assistants IA — se construisent à partir de ces balises ; sans elles, les liens sont nus et peu cliquables.

**Comment corriger :** Ajoutez les balises meta Open Graph pour que les liens partagés et les aperçus IA s'affichent correctement : au minimum `og:title` et `og:description`, idéalement aussi `og:image` et `og:url`.

### `https` (5 pts)

**Ce qu'il vérifie :** Le site est servi en HTTPS. Ignoré pour `localhost` / `127.0.0.1`.

**Pourquoi c'est important :** HTTPS est un signal de confiance de base ; les crawlers rétrogradent ou refusent les sites en HTTP simple, et les navigateurs en détournent les visiteurs.

**Comment corriger :** Servez le site en HTTPS. Tous les hébergeurs grand public (Netlify, Vercel, Cloudflare Pages, GitHub Pages) provisionnent les certificats automatiquement ; activez aussi la redirection HTTP→HTTPS.

### `viewport` (5 pts)

**Ce qu'il vérifie :** La page d'accueil possède une balise `<meta name="viewport">`.

**Pourquoi c'est important :** La balise viewport est le marqueur d'une page adaptée au mobile. Les moteurs indexent mobile-first, et son absence signale un site non maintenu.

**Comment corriger :** Ajoutez `<meta name="viewport" content="width=device-width, initial-scale=1">` dans le `<head>` de chaque page.

### `broken-internal-links` (8 pts)

**Ce qu'il vérifie :** Chaque lien `<a href>` de même origine sur les pages échantillonnées répond avec un statut inférieur à 400. Les points d'accès d'infrastructure sous `/cdn-cgi/` (injectés par Cloudflare, ex. protection email) sont ignorés — ce ne sont pas des pages de contenu.

**Pourquoi c'est important :** Des liens internes cassés gaspillent le budget de crawl et brisent le chemin qu'un assistant suit pour vérifier ou approfondir une citation.

**Comment corriger :** Corrigez ou supprimez les liens renvoyant 400 ou plus, pour que les crawlers n'atterrissent pas sur des impasses.
