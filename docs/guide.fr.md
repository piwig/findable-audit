# Guide des checks findable-audit

findable-audit note un site sur 100 à travers **107 checks répartis en 8 familles**. Ce guide documente chaque check : ce qu'il vérifie, pourquoi c'est important pour les moteurs de recherche et de réponse IA, et comment corriger un échec.

**Familles et poids** (le sous-score d'une famille est combiné au score global selon ces poids) :

| Famille | Poids | Checks |
|---|---|---:|
| Accès crawlers IA | 0,16 | 8 |
| Contenu pour moteurs de réponse | 0,18 | 12 |
| Données structurées et métadonnées | 0,15 | 19 |
| SEO technique | 0,15 | 20 |
| On-page et contenu | 0,12 | 11 |
| Performance et Core Web Vitals | 0,10 | 19 |
| Accessibilité | 0,07 | 9 |
| Sécurité et confiance | 0,07 | 9 |

**Note (grade) :** `A` ≥ 90 · `B` ≥ 80 · `C` ≥ 70 · `D` ≥ 60 · `F` < 60.

**Statuts :** `OK` (réussi, tous les points), `!!` (avertissement, demi-points), `XX` (échec, 0 point), `--` (ignoré). **Les checks ignorés sont exclus du score** — un site n'est jamais pénalisé pour un check qui ne le concerne pas (pas de page produit, site monolingue, pas de `--cwv`, etc.). Les entrées marquées *(ignoré si …)* ne s'exécutent que si leur condition est remplie.

Les rapports HTML et Markdown s'ouvrent sur un verdict en une ligne, ajoutent un dashboard Core Web Vitals (jauges radiales, terrain vs labo) quand ils sont lancés avec `--cwv --psi-key`, et se terminent par un plan d'action priorisé — chaque recommandation en échec/avertissement ci-dessous pointe vers son entrée « En savoir plus ».

---

## Accès crawlers IA

Le verrou : si les crawlers sont bloqués ou la page en `noindex`, rien d'autre ne compte.

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

### `snippet-preview-directives` (4 pts)
**Vérifie :** Aucune page ne pose `nosnippet`, `max-snippet:0`, `max-image-preview:none` ou `max-video-preview:0` (avertissement si simplement absent ; `max-image-preview:large` compte positivement).
**Pourquoi :** Ces directives affament les aperçus (snippets et vignettes) que les moteurs de réponse affichent.
**Corriger :** Posez `max-image-preview:large, max-snippet:-1, max-video-preview:-1` ; retirez tout `nosnippet` égaré.

---

## Contenu pour moteurs de réponse

Le cœur du GEO : la réponse est-elle réellement extractible, datée, signée et citable.

### `llms-txt` (10 pts)
**Vérifie :** `/llms.txt` (text/plain) a un titre H1 + une ligne de résumé + ≥1 section `##` + ≥5 liens descriptifs absolus de même origine (avertissement si H1 seul ou moins de 5 liens ; échec si absent/HTML).
**Pourquoi :** `llms.txt` donne aux modèles une carte de votre site, sélective et économe en tokens, pour répondre avec précision plutôt qu'en devinant depuis le HTML brut.
**Corriger :** Structurez-le en `# Site`, un résumé d'une ligne, puis des blocs `## Section` de `- [Titre](https://url-absolue) : note`.

### `llms-full-txt` (4 pts)
**Vérifie :** `/llms-full.txt` (text/plain) contient un vrai corps — environ ≥2000 mots avec plusieurs titres (avertissement sous 500 ; échec si absent/HTML).
**Pourquoi :** Si `llms.txt` est la carte, `llms-full.txt` est le territoire : votre texte intégral dans un fichier qu'un modèle ingère en une requête.
**Corriger :** Concaténez le texte intégral des pages sous des titres au moment du build.

### `content-without-js` (6 pts)
**Vérifie :** Chaque page échantillonnée a ≥200 caractères de texte visible statique (sans JS) après suppression de script/style/noscript (avertissement si une minorité est maigre ; échec si la plupart sont vides).
**Pourquoi :** Les crawlers IA n'exécutent pas JavaScript ; une page rendue côté client est une coquille vide pour eux.
**Corriger :** Rendez le contenu principal côté serveur ou en statique (Astro, Hugo, export statique Next, SSR).

### `content-depth` (5 pts)
**Vérifie :** Le nombre de mots du contenu principal atteint un seuil par type — Article/Blog ≥300 mots, autres pages de contenu ≥150, habillage retiré (avertissement si une minorité est sous le seuil ; échec si la plupart sont maigres).
**Pourquoi :** Une page trop maigre offre rarement assez de matière pour qu'un assistant en extraie une réponse fiable.
**Corriger :** Étoffez ou regroupez les pages maigres avec du contenu substantiel.

### `content-lead-answer` (5 pts)
**Vérifie :** Le premier paragraphe substantiel après le H1 est une réponse/définition concise et autoportante (~40–320 caractères) ou un bloc TL;DR explicite (avertissement si enfoui/trop long ; échec si de longues pages ouvrent sur du remplissage/de la navigation).
**Pourquoi :** Les moteurs de réponse citent le chapô ; une phrase d'ouverture directe est bien plus susceptible d'être reprise telle quelle.
**Corriger :** Ouvrez chaque page par une réponse directe d'1–2 phrases ou un bloc TL;DR / points clés.

### `answer-headings` (4 pts)
**Vérifie :** *(ignoré pour les pages courtes)* Les longues pages de contenu portent ≥1 H2/H3 en forme de question ou descriptif (commence par quoi/comment/pourquoi/quand/meilleur/vs ou finit par `?`) ; avertit si tous génériques.
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
**Vérifie :** *(ignoré s'il n'y a pas de contenu en forme de FAQ)* JSON-LD FAQPage/QAPage (≥2 Question → acceptedAnswer non vide) et/ou un bloc Q&R sur la page (avertissement si la FAQ visible n'a pas de schéma).
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

### `broken-internal-links` (8 pts)
**Vérifie :** Jusqu'à 30 cibles `<a>` distinctes de même origine sur l'échantillon résolvent en dessous de 400 (avertissement ≥80 % ok ; échec en dessous). Les points `/cdn-cgi/` de Cloudflare sont ignorés.
**Pourquoi :** Les liens internes cassés gaspillent le budget de crawl et brisent le chemin qu'un assistant suit pour vérifier une citation.
**Corriger :** Corrigez ou supprimez les liens renvoyant 400+.

### `www-consolidation` (5 pts)
**Vérifie :** Les variantes www et apex (sans suivi de redirection) — exactement une sert 200 et l'autre 301 vers elle (avertissement sur 302 ; échec si les deux vivent ou boucle de redirection).
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
</content>
