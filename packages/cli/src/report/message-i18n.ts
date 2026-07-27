// Localized catalogue for the per-check dynamic `message` (backlog #1, "lot E").
//
// A check writes its message once, in English, through the `t` tag in types.ts. The tag
// keeps the seam between wording and values, so a result arrives here with
// `messageTemplate` ("{0} of {1} images...") and `messageParams` ([3, 12]). This file
// holds the French wording for each template; `localizeMessage` refills it.
//
// Anything without an entry falls back to the English `message`, so a template added by a
// new check degrades to English rather than breaking the report. `npm run check:messages`
// (scripts/check-message-coverage.mjs) reports the templates still missing a translation.
//
// Technical tokens stay untranslated on purpose — robots.txt, JSON-LD, hreflang, HSTS, CSP,
// header names and WCAG references are the words a reader will search for in a spec.
import type { CheckResult, MsgParam } from '../types.js';
import type { Lang } from './i18n.js';

/** English template → French wording. Keys are the exact `messageTemplate` values. */
export const CHECK_MESSAGES_FR: Record<string, string> = {
  // #65 — verification des profils sameAs
  "profile verification is opt-in (run with --verify-profiles)": "la vérification des profils est optionnelle (lancez avec --verify-profiles)",
  "no sameAs profile declared (see sd-entity-grounding)": "aucun profil sameAs déclaré (voir sd-entity-grounding)",
  "could not read any of the {0} declared profile(s) — all unverifiable (platform refused)": "aucun des {0} profil(s) déclaré(s) n'a pu être lu — tous invérifiables (plateforme refusée)",
  "{0} of {1} readable profile(s) link back to the site{2}": "{0} profil(s) lisible(s) sur {1} renvoient vers le site{2}",
  "only {0} of {1} readable profile(s) link back{2}": "seulement {0} profil(s) lisible(s) sur {1} renvoient un lien{2}",
  "no link back from {0} readable profile(s){1}": "aucun lien retour depuis {0} profil(s) lisible(s){1}",
  // LOT 10 — checks issus du fan-out d agents (subresources, js-only, soft-error, conflits d indexation)
  "no subresources on sampled pages": "aucune sous-ressource sur les pages échantillonnées",
  "no same-origin subresources ({0} third-party only)": "aucune sous-ressource de même origine ({0} tierce(s) uniquement)",
  "{0} same-origin subresource(s) resolve": "{0} sous-ressource(s) de même origine aboutissent",
  "broken subresources: {0}": "sous-ressources cassées : {0}",
  "{0} page(s) inspected; every internal destination is a real <a href>": "{0} page(s) inspectée(s) ; chaque destination interne est un vrai <a href>",
  "{0} scripted destination(s), all also exposed as a real <a href>": "{0} destination(s) pilotée(s) par script, toutes également exposées en <a href> réel",
  "{0} internal URL(s) reachable only by running JavaScript: {1}": "{0} URL interne(s) accessible(s) uniquement en exécutant JavaScript : {1}",
  "no sampled page and no same-origin sitemap URL to correlate": "aucune page échantillonnée et aucune URL de sitemap de même origine à recouper",
  "nothing left to correlate: no Disallow rule in robots.txt, and no sitemap-plus-page overlap to cross-check": "plus rien à recouper : aucune règle Disallow dans le robots.txt, et aucun recoupement entre le sitemap et les pages échantillonnées",
  "robots.txt Disallow contradicts an indexing directive: {0}": "un Disallow du robots.txt contredit une directive d’indexation : {0}",
  "noindex page(s) listed in the sitemap: {0}": "page(s) en noindex listée(s) dans le sitemap : {0}",
  "indexing directives agree across {0} sitemap URL(s) and {1} sampled page(s)": "les directives d’indexation concordent sur {0} URL de sitemap et {1} page(s) échantillonnée(s)",
  "no 200 HTML page in the sample": "aucune page HTML en 200 dans l’échantillon",
  "error page served with HTTP 200: {0}": "page d’erreur servie en HTTP 200 : {0}",
  "page served with HTTP 200 has almost no content: {0}": "page servie en HTTP 200 quasiment sans contenu : {0}",
  "{0} sampled page(s) return 200 with real content": "{0} page(s) échantillonnée(s) renvoient 200 avec un vrai contenu",
  // LOT 9 — security-txt (RFC 9116)
  "no /.well-known/security.txt (RFC 9116 vulnerability-reporting address)": "pas de /.well-known/security.txt (adresse de signalement de failles, RFC 9116)",
  "/.well-known/security.txt answers 200 but is not a text file (HTML app shell?)": "/.well-known/security.txt répond 200 mais n'est pas un fichier texte (shell HTML d'une SPA ?)",
  "/.well-known/security.txt has no Contact field (the only required one)": "/.well-known/security.txt n'a pas de champ Contact (le seul obligatoire)",
  "security.txt has a Contact but no Expires field (required by RFC 9116)": "security.txt a un Contact mais pas de champ Expires (exigé par la RFC 9116)",
  "security.txt Expires is not a readable date ({0})": "la date Expires de security.txt est illisible ({0})",
  "security.txt expired on {0}": "security.txt a expiré le {0}",
  "security.txt published, contact and expiry valid ({0})": "security.txt publié, contact et date de validité corrects ({0})",
  '{0} @id-linked entities, no dangling references': '{0} entités liées par @id, aucune référence orpheline',
  '{0} child sitemap(s) valid and within limits': '{0} sitemap(s) enfant(s) valides et dans les limites',
  '{0} crawlable link(s); navigation works without JavaScript': '{0} lien(s) explorable(s) ; la navigation fonctionne sans JavaScript',
  '{0} declared canonical(s) resolve 200 and are indexable': '{0} canonique(s) déclarée(s) répondent 200 et sont indexables',
  '{0} entities, {1} links, no dangling references ({2} component(s))': '{0} entités, {1} liens, aucune référence orpheline ({2} composante(s))',
  '{0} found but NAP incomplete (missing: {1})': '{0} trouvé mais NAP incomplet (manque : {1})',
  '{0} host {1}s to the {2} host': "l'hôte {0} fait un {1} vers l'hôte {2}",
  '{0} host serves the site; {1} host not live': "l'hôte {0} sert le site ; l'hôte {1} n'est pas actif",
  '{0} hreflang alternate(s) reachable and reciprocal': '{0} alternative(s) hreflang accessibles et réciproques',
  '{0} internal link(s) resolve': '{0} lien(s) interne(s) aboutissent',
  '{0} JSON-LD block(s) all valid (parse + @context + @type)': '{0} bloc(s) JSON-LD tous valides (analyse + @context + @type)',
  '{0} JSON-LD value(s) confirmed visible on the page': '{0} valeur(s) JSON-LD confirmées visibles sur la page',
  '{0} liftable answer unit(s) across {1} pillar page(s)': '{0} unité(s) de réponse citables sur {1} page(s) pilier(s)',
  '{0} link(s) without an accessible name on: {1}': '{0} lien(s) sans nom accessible sur : {1}',
  '{0} missing required fields ({1})': '{0} sans champs obligatoires ({1})',
  '{0} paginated page(s) self-canonical': '{0} page(s) paginée(s) avec canonique auto-référente',
  '{0} sameAs profile(s) but no Wikipedia/Wikidata anchor': '{0} profil(s) sameAs mais aucun ancrage Wikipédia/Wikidata',
  '{0} sameAs profile(s) incl. a knowledge-graph anchor': '{0} profil(s) sameAs dont un ancrage de graphe de connaissances',
  '{0} sampled page(s) linked and shallow': '{0} page(s) échantillonnée(s) liées et peu profondes',
  '{0} sampled sitemap URL(s) are clean and indexable': '{0} URL de sitemap échantillonnées sont propres et indexables',
  '{0} sampled URL(s) are clean and readable': '{0} URL échantillonnées sont propres et lisibles',
  '{0} special type(s) fully marked up': '{0} type(s) particulier(s) entièrement balisés',
  '{0} valid JSON-LD block(s)': '{0} bloc(s) JSON-LD valides',
  '{0}; contact reachable on {1}/{2} page(s)': '{0} ; contact joignable sur {1}/{2} page(s)',
  '{0}/{1} ~{2}-token chunk(s) survive isolated retrieval ({3}%)': '{0}/{1} fragment(s) d’environ {2} tokens restent exploitables isolément ({3} %)',
  '{0}/{1} below-fold images lazy-loaded, hero eager': '{0}/{1} images sous la ligne de flottaison en chargement différé, visuel principal en chargement immédiat',
  '{0}/{1} content image(s) have a figure/figcaption': '{0}/{1} image(s) de contenu ont un figure/figcaption',
  '{0}/{1} content image(s) wrapped in figure/figcaption': '{0}/{1} image(s) de contenu encadrées par figure/figcaption',
  '{0}/{1} entries have valid, varied <lastmod>': '{0}/{1} entrées ont un <lastmod> valide et varié',
  '{0}/{1} form control(s) without an accessible name': '{0}/{1} champ(s) de formulaire sans nom accessible',
  '{0}/{1} iframe(s) untitled': '{0}/{1} iframe(s) sans titre',
  '{0}/{1} navigation links need JavaScript (href="#"/javascript:/no href) — non-JS crawlers (GPTBot, ClaudeBot) can\'t follow them':
    '{0}/{1} liens de navigation exigent JavaScript (href="#"/javascript:/sans href) — les robots sans JS (GPTBot, ClaudeBot) ne peuvent pas les suivre',
  '{0}/{1} non-empty alts are descriptive ({2}%)': '{0}/{1} textes alternatifs non vides sont descriptifs ({2} %)',
  '{0}/{1} off-screen images not lazy-loaded': '{0}/{1} images hors écran sans chargement différé',
  '{0}% generic internal anchor text ({1}/{2})': '{0} % de textes de liens internes génériques ({1}/{2})',
  '/.well-known/ai.json answers 200 but is not valid JSON (SPA fallback shell?)':
    '/.well-known/ai.json répond 200 mais n’est pas du JSON valide (coquille de repli d’une SPA ?)',
  '/.well-known/ai.json is valid JSON but not an object': '/.well-known/ai.json est du JSON valide mais n’est pas un objet',
  '/.well-known/ai.json serves a JSON object manifest': '/.well-known/ai.json sert un manifeste JSON sous forme d’objet',
  '404 page is a dead end (no links, nav, or search)': 'la page 404 est une impasse (ni liens, ni navigation, ni recherche)',
  '404 page offers a way back (links/nav/search)': 'la page 404 offre une porte de sortie (liens/navigation/recherche)',
  'About and Contact reachable with a contact method': 'pages À propos et Contact accessibles, avec un moyen de contact',
  'About/Contact incomplete (missing: {0})': 'À propos/Contact incomplet (manque : {0})',
  'About/Contact pages not found': 'pages À propos/Contact introuvables',
  'active mixed content on: {0}': 'contenu mixte actif sur : {0}',
  'AI crawlers blocked: {0}': 'robots d’IA bloqués : {0}',
  'all {0} form control(s) have an accessible name': 'les {0} champ(s) de formulaire ont un nom accessible',
  'all {0} iframe(s) have a title': 'les {0} iframe(s) ont un titre',
  'all {0} link(s) have an accessible name': 'les {0} lien(s) ont un nom accessible',
  'all AI crawlers (training + citation-time) allowed': 'tous les robots d’IA (entraînement + citation en direct) sont autorisés',
  'Article markup complete on all sampled article pages': 'balisage Article complet sur toutes les pages d’article échantillonnées',
  'Article markup incomplete on: {0}': 'balisage Article incomplet sur : {0}',
  'blocking robots directive found: {0}': 'directive robots bloquante trouvée : {0}',
  'both www and apex serve 200 (duplicate hosts)': 'www et le domaine racine répondent tous deux 200 (hôtes en double)',
  'breadcrumbs present on all interior pages': 'fil d’Ariane présent sur toutes les pages internes',
  'broken internal links: {0}': 'liens internes cassés : {0}',
  'broken or non-reciprocal hreflang alternates: {0}': 'alternatives hreflang cassées ou non réciproques : {0}',
  'caching headers present on {0}': 'en-têtes de cache présents sur {0}',
  'canonical missing or non-self on: {0}': 'canonique absente ou non auto-référente sur : {0}',
  'canonical target broken/noindexed: {0}': 'cible de la canonique cassée ou en noindex : {0}',
  'canonical target redirects: {0}': 'la cible de la canonique redirige : {0}',
  'chunk-boundary hazards on: {0}': 'frontières de fragments à risque sur : {0}',
  'chunk-safe structure on {0} page(s)': 'structure compatible avec le découpage en fragments sur {0} page(s)',
  'chunks that cannot stand alone on: {0}': 'fragments qui ne tiennent pas seuls sur : {0}',
  "Content-Security-Policy allows 'unsafe-inline' or * in script sources":
    "Content-Security-Policy autorise 'unsafe-inline' ou * dans les sources de scripts",
  'Content-Security-Policy present': 'Content-Security-Policy présent',
  'core entities are not linked ({0} disconnected identity clusters)':
    'les entités principales ne sont pas reliées ({0} grappes d’identité déconnectées)',
  'CSP frame-ancestors restricts framing': 'la directive CSP frame-ancestors limite l’intégration en cadre',
  'CSR-only content (empty mount root, no server-rendered text) on: {0}':
    'contenu rendu uniquement côté client (racine de montage vide, aucun texte rendu par le serveur) sur : {0}',
  'dangling @id reference: {0}': 'référence @id orpheline : {0}',
  'dangling @id reference(s): {0}': 'référence(s) @id orpheline(s) : {0}',
  'dense/hard-to-read main content (grade ~{0})': 'contenu principal dense et difficile à lire (niveau ~{0})',
  'direct-answer lead on {0} page(s)': 'chapô répondant directement sur {0} page(s)',
  'direct, hedge-free leads on {0} page(s)': 'chapôs directs et sans formule évasive sur {0} page(s)',
  'duplicated @id: {0}': '@id en double : {0}',
  'duplicated <title>/description on: {0}': '<title>/description en double sur : {0}',
  'every sampled page canonicalizes to the homepage': 'toutes les pages échantillonnées pointent leur canonique vers la page d’accueil',
  'every sitemap <lastmod> is future-dated': 'tous les <lastmod> du sitemap sont datés dans le futur',
  'FAQ content backed by FAQPage/QAPage schema': 'contenu de FAQ appuyé par un schéma FAQPage/QAPage',
  'FAQ present without FAQPage schema on: {0}{1}': 'FAQ présente sans schéma FAQPage sur : {0}{1}',
  'favicon and apple-touch-icon present': 'favicon et apple-touch-icon présents',
  'favicon present but no apple-touch-icon': 'favicon présent mais pas d’apple-touch-icon',
  'fewer than 2 freshness sources per page (Last-Modified header, dateModified, sitemap lastmod)':
    'moins de 2 sources de fraîcheur par page (en-tête Last-Modified, dateModified, lastmod du sitemap)',
  'fewer than 2 sampled pages': 'moins de 2 pages échantillonnées',
  'fewer than 2 sampled pages (homepage JSON-LD is covered by the json-ld check)':
    'moins de 2 pages échantillonnées (le JSON-LD de l’accueil est couvert par le contrôle json-ld)',
  'fewer than 3 sampled pages — link-equity distribution is not meaningful':
    'moins de 3 pages échantillonnées — la répartition du jus de liens n’a pas de sens',
  'forms an agent cannot submit on: {0}': 'formulaires qu’un agent ne peut pas soumettre sur : {0}',
  'fresh, dated content on {0} article page(s)': 'contenu récent et daté sur {0} page(s) d’article',
  'freshness signals coherent (24h tolerance) on {0} page(s)': 'signaux de fraîcheur cohérents (tolérance 24 h) sur {0} page(s)',
  'freshness signals diverge on: {0}': 'les signaux de fraîcheur divergent sur : {0}',
  'generic anchor text ({0}%)': 'textes de liens génériques ({0} %)',
  'heading outline broken on: {0}': 'hiérarchie des titres rompue sur : {0}',
  'heading outline clean on {0} page(s)': 'hiérarchie des titres correcte sur {0} page(s)',
  'hedged (evasive) lead on: {0}': 'chapô évasif sur : {0}',
  'hero image is eager; no below-fold images to assess':
    'le visuel principal est en chargement immédiat ; aucune image sous la ligne de flottaison à évaluer',
  'homepage not reachable': 'page d’accueil inaccessible',
  'homepage responds 200': 'la page d’accueil répond 200',
  'homepage returned {0}': 'la page d’accueil a renvoyé {0}',
  'homepage-only sample': 'échantillon limité à la page d’accueil',
  'hreflang set complete on {0} page(s)': 'jeu hreflang complet sur {0} page(s)',
  'hreflang set incomplete: {0}': 'jeu hreflang incomplet : {0}',
  'HSTS max-age={0} is below 180 days': 'HSTS max-age={0} est inférieur à 180 jours',
  'HSTS max-age={0}{1}': 'HSTS max-age={0}{1}',
  'html lang malformed on: {0}': 'attribut lang du html mal formé sur : {0}',
  'html lang missing/invalid on: {0}': 'attribut lang du html absent ou invalide sur : {0}',
  'HTML not compressed': 'HTML non compressé',
  'HTML served with Content-Encoding: {0}': 'HTML servi avec Content-Encoding : {0}',
  'http:// 301-redirects to https://': 'http:// redirige en 301 vers https://',
  'http:// is not 301-redirected to https://': 'http:// n’est pas redirigé en 301 vers https://',
  'http:// redirects to https:// with a {0} (should be 301)': 'http:// redirige vers https:// avec un {0} (301 attendu)',
  'http:// version unreachable (nothing listens on port 80)': 'version http:// inaccessible (rien n’écoute sur le port 80)',
  'incomplete landmarks (main only / no main) on: {0}': 'repères incomplets (main seul / pas de main) sur : {0}',
  'inconsistent NAP across pages: {0}': 'NAP incohérent d’une page à l’autre : {0}',
  'IndexNow key file /{0}.txt missing or mismatched': 'fichier de clé IndexNow /{0}.txt absent ou non concordant',
  'IndexNow key file verified': 'fichier de clé IndexNow vérifié',
  'ingestion hygiene issues on: {0}': 'problèmes d’hygiène d’ingestion sur : {0}',
  'invalid hreflang code(s): {0}': 'code(s) hreflang invalide(s) : {0}',
  'invalid JSON-LD block ({0})': 'bloc JSON-LD invalide ({0})',
  'invalid JSON-LD block (parse error: {0})': 'bloc JSON-LD invalide (erreur d’analyse : {0})',
  'JSON-LD may describe hidden content (unmatched: {0})': 'le JSON-LD décrit peut-être du contenu masqué (sans correspondance : {0})',
  'large DOM ({0} nodes)': 'DOM volumineux ({0} nœuds)',
  'legacy charset declared ({0})': 'charset obsolète déclaré ({0})',
  'length out of range (title: {0}, description: {1})': 'longueur hors plage (titre : {0}, description : {1})',
  'link equity well-distributed across {0} page(s) — top: {1}': 'jus de liens bien réparti sur {0} page(s) — en tête : {1}',
  'lists/tables in main content on {0} substantial page(s)': 'listes/tableaux dans le contenu principal sur {0} page(s) substantielle(s)',
  'llms-full.txt has {0} words under {1} headings': 'llms-full.txt contient {0} mots répartis sous {1} titres',
  'llms-full.txt is thin ({0} words, {1} heading(s))': 'llms-full.txt est trop maigre ({0} mots, {1} titre(s))',
  'llms-full.txt missing': 'llms-full.txt absent',
  'llms-full.txt served with content-type "{0}" (SPA fallback?)':
    'llms-full.txt servi avec le content-type « {0} » (repli de SPA ?)',
  'llms.txt found but has no markdown H1 title': 'llms.txt trouvé mais sans titre H1 markdown',
  'llms.txt missing': 'llms.txt absent',
  'llms.txt served with content-type "{0}" (SPA fallback?)': 'llms.txt servi avec le content-type « {0} » (repli de SPA ?)',
  'llms.txt structured (summary + section + {0} descriptive links)': 'llms.txt structuré (résumé + section + {0} liens descriptifs)',
  'llms.txt thin ({0})': 'llms.txt trop maigre ({0})',
  'local host — HSTS check skipped': 'hôte local — contrôle HSTS ignoré',
  'local host — HTTPS check skipped': 'hôte local — contrôle HTTPS ignoré',
  'local host — redirect check skipped': 'hôte local — contrôle des redirections ignoré',
  'local/IP host — redirect-chains check skipped': 'hôte local/IP — contrôle des chaînes de redirection ignoré',
  'local/IP host — trailing-slash check skipped': 'hôte local/IP — contrôle du slash final ignoré',
  'local/IP host has no www variant': 'un hôte local/IP n’a pas de variante www',
  'LocalBusiness NAP + geo + opening hours complete': 'LocalBusiness : NAP, coordonnées géographiques et horaires complets',
  'LocalBusiness NAP/geo/hours incomplete ({0})': 'LocalBusiness : NAP/géo/horaires incomplets ({0})',
  'LocalBusiness NAP/geo/hours incomplete (no structured address)':
    'LocalBusiness : NAP/géo/horaires incomplets (aucune adresse structurée)',
  'LocalBusiness NAP/geo/hours incomplete (no telephone)': 'LocalBusiness : NAP/géo/horaires incomplets (aucun téléphone)',
  'main content above the word threshold on {0} page(s)': 'contenu principal au-dessus du seuil de mots sur {0} page(s)',
  'main content reads at approximately grade {0}': 'le contenu principal se lit à un niveau d’environ {0}',
  'meta-refresh redirect on: {0}': 'redirection meta-refresh sur : {0}',
  'missing {0}': 'il manque {0}',
  'missing route 301s to the homepage (soft-404)': 'une route inexistante redirige en 301 vers l’accueil (soft-404)',
  'missing route returns {0}': 'une route inexistante renvoie {0}',
  'missing route returns {0} (expected 404/410)': 'une route inexistante renvoie {0} (404/410 attendu)',
  'missing route returns 200 (soft-404)': 'une route inexistante renvoie 200 (soft-404)',
  'missing-route probe was unreachable': 'la sonde de route inexistante n’a pas abouti',
  'missing/stale content date on: {0}': 'date de contenu absente ou périmée sur : {0}',
  'mobile viewport set': 'viewport mobile défini',
  'named author + byline on {0} article page(s)': 'auteur nommé et signature visible sur {0} page(s) d’article',
  'NAP consistent across sampled pages': 'NAP cohérent sur les pages échantillonnées',
  'near-duplicate content: {0}': 'contenu quasi dupliqué : {0}',
  'neither www nor apex host is reachable': 'ni l’hôte www ni le domaine racine ne sont accessibles',
  'no @id used in JSON-LD on the homepage': 'aucun @id utilisé dans le JSON-LD de la page d’accueil',
  'no /.well-known/ai.json manifest (emerging AI-discovery convention)':
    'aucun manifeste /.well-known/ai.json (convention émergente de découverte par les IA)',
  'no <img> elements on sampled pages': 'aucun élément <img> sur les pages échantillonnées',
  'no <sitemapindex> (single urlset sitemap)': 'aucun <sitemapindex> (sitemap unique de type urlset)',
  'no <title>': 'aucun <title>',
  'no article-type pages to attribute': 'aucune page de type article à attribuer',
  'no article-type pages to date': 'aucune page de type article à dater',
  'no Article/NewsArticle/BlogPosting page in the sample':
    'aucune page Article/NewsArticle/BlogPosting dans l’échantillon',
  'no author (E-E-A-T) on: {0}': 'aucun auteur (E-E-A-T) sur : {0}',
  'no blocking robots directives (X-Robots-Tag / meta robots)':
    'aucune directive robots bloquante (X-Robots-Tag / meta robots)',
  'no breadcrumbs on interior pages: {0}{1}': 'aucun fil d’Ariane sur les pages internes : {0}{1}',
  'no caching headers on assets (sampled {0})': 'aucun en-tête de cache sur les ressources (échantillon : {0})',
  'no canonical declared on any sampled page': 'aucune canonique déclarée sur les pages échantillonnées',
  'no charset declared': 'aucun charset déclaré',
  'no chunkable content on the pillar pages': 'aucun contenu découpable en fragments sur les pages piliers',
  'no clickjacking protection (X-Frame-Options / frame-ancestors)':
    'aucune protection anti-clickjacking (X-Frame-Options / frame-ancestors)',
  'no CLS field data in PSI response': 'aucune donnée terrain CLS dans la réponse PSI',
  'no Content-Security-Policy': 'aucun Content-Security-Policy',
  'no crawlable <a href> links found — navigation may be JS-only':
    'aucun lien <a href> explorable — la navigation est peut-être réservée au JavaScript',
  'no cross-origin resources requiring a preconnect hint':
    'aucune ressource tierce nécessitant une directive preconnect',
  'no CrUX overall assessment (no field data)': 'aucune évaluation globale CrUX (pas de données terrain)',
  'no direct-answer lead on: {0}': 'aucun chapô répondant directement sur : {0}',
  'no explanatory content images on sampled pages':
    'aucune image de contenu explicative sur les pages échantillonnées',
  'no FAQ-shaped content in the sample': 'aucun contenu en forme de FAQ dans l’échantillon',
  'no favicon or apple-touch-icon': 'ni favicon ni apple-touch-icon',
  'no hidden text or unattributed UGC across {0} page(s)':
    'aucun texte masqué ni contenu tiers non attribué sur {0} page(s)',
  'no HowTo/Event/Recipe on the homepage': 'aucun HowTo/Event/Recipe sur la page d’accueil',
  'no hreflang annotations (single-language site)': 'aucune annotation hreflang (site monolingue)',
  'no iframes on sampled pages': 'aucune iframe sur les pages échantillonnées',
  'no images to assess': 'aucune image à évaluer',
  'no IndexNow key provided (use --indexnow-key to enable)':
    'aucune clé IndexNow fournie (utilisez --indexnow-key pour activer le contrôle)',
  'no INP field data in PSI response (low-traffic URL)':
    'aucune donnée terrain INP dans la réponse PSI (URL à faible trafic)',
  'no internal links on sampled pages': 'aucun lien interne sur les pages échantillonnées',
  'no JSON-LD block found': 'aucun bloc JSON-LD trouvé',
  'no JSON-LD entities found across sampled pages': 'aucune entité JSON-LD sur les pages échantillonnées',
  'no lab First Contentful Paint in PSI response': 'aucun First Contentful Paint de laboratoire dans la réponse PSI',
  'no labelable form controls on sampled pages':
    'aucun champ de formulaire étiquetable sur les pages échantillonnées',
  'no LCP data (field or lab) in PSI response': 'aucune donnée LCP (terrain ou laboratoire) dans la réponse PSI',
  'no liftable answer unit on: {0}': 'aucune unité de réponse citable sur : {0}',
  'no Lighthouse performance score in PSI response': 'aucun score de performance Lighthouse dans la réponse PSI',
  'no links to evaluate on sampled pages': 'aucun lien à évaluer sur les pages échantillonnées',
  'no lists/tables in main content on: {0}': 'aucune liste ni tableau dans le contenu principal sur : {0}',
  'no LocalBusiness entity on the homepage': 'aucune entité LocalBusiness sur la page d’accueil',
  'no LocalBusiness/Organization/Article entity': 'aucune entité LocalBusiness/Organization/Article',
  'no long content pages to evaluate': 'aucune page de contenu long à évaluer',
  'no machine-readable contact path (no mailto:/tel:, no submittable form, no JSON-LD contact)':
    'aucun moyen de contact lisible par machine (ni mailto:/tel:, ni formulaire soumettable, ni contact JSON-LD)',
  'no meta-refresh redirects on {0} sampled page(s)': 'aucune redirection meta-refresh sur {0} page(s) échantillonnée(s)',
  'no mixed content across {0} sampled page(s)': 'aucun contenu mixte sur {0} page(s) échantillonnée(s)',
  'no name/headline/price/rating values to verify': 'aucune valeur name/headline/price/rating à vérifier',
  'no NAP (phone/address) to check': 'aucun NAP (téléphone/adresse) à contrôler',
  'no near-duplicate bodies across {0} pages': 'aucun corps de page quasi dupliqué sur {0} pages',
  'no noindex on {0} sampled page(s)': 'aucun noindex sur {0} page(s) échantillonnée(s)',
  'no non-empty alt text to assess': 'aucun texte alternatif non vide à évaluer',
  'no non-root paths to test': 'aucun chemin hors racine à tester',
  'no Organization/LocalBusiness entity found': 'aucune entité Organization/LocalBusiness trouvée',
  'no outbound citations on: {0}': 'aucune citation sortante sur : {0}',
  'no page reachable': 'aucune page accessible',
  'no pages sampled': 'aucune page échantillonnée',
  'no pagination detected (single page series)': 'aucune pagination détectée (série d’une seule page)',
  'no per-UA fetch capability (fetchWithUA)': 'pas de récupération par user-agent disponible (fetchWithUA)',
  'no Permissions-Policy header': 'aucun en-tête Permissions-Policy',
  'no pillar pages (>=300 words) to chunk': 'aucune page pilier (≥300 mots) à découper en fragments',
  'no Product page in the sample': 'aucune page Product dans l’échantillon',
  'no pillar pages (>=300 words) to evaluate': 'aucune page pilier (≥300 mots) à évaluer',
  'no preconnect/dns-prefetch hint for: {0}': 'aucune directive preconnect/dns-prefetch pour : {0}',
  'no preview directives set on: {0}': 'aucune directive d’aperçu définie sur : {0}',
  'no question-style subheadings on: {0}': 'aucun intertitre formulé en question sur : {0}',
  'no raster <img> elements to assess': 'aucun élément <img> matriciel à évaluer',
  'no redirect chains across {0} URL(s)': 'aucune chaîne de redirection sur {0} URL',
  'no Referrer-Policy header': 'aucun en-tête Referrer-Policy',
  'no render-blocking head scripts on {0} page(s)':
    'aucun script bloquant le rendu dans le <head> sur {0} page(s)',
  'no same-origin CSS/JS asset to sample': 'aucune ressource CSS/JS de même origine à échantillonner',
  'no same-origin sitemap URLs to cross-reference': 'aucune URL de sitemap de même origine à recouper',
  'no sampled pages to build an entity graph from':
    'aucune page échantillonnée pour construire un graphe d’entités',
  'no semantic landmarks on: {0}': 'aucun repère sémantique sur : {0}',
  'no sitemap discovered': 'aucun sitemap découvert',
  'no sitemap found (robots.txt Sitemap lines, /sitemap.xml, /sitemap-index.xml, /sitemap_index.xml)':
    'aucun sitemap trouvé (lignes Sitemap du robots.txt, /sitemap.xml, /sitemap-index.xml, /sitemap_index.xml)',
  'no Strict-Transport-Security header': 'aucun en-tête Strict-Transport-Security',
  'no substantial pages (>=150 words) to evaluate': 'aucune page substantielle (≥150 mots) à évaluer',
  'no substantial pages to evaluate': 'aucune page substantielle à évaluer',
  'no Total Blocking Time in PSI response': 'aucun Total Blocking Time dans la réponse PSI',
  'no TTFB data (field or lab) in PSI response': 'aucune donnée TTFB (terrain ou laboratoire) dans la réponse PSI',
  'no Twitter Card and no Open Graph fallback': 'ni Twitter Card ni repli Open Graph',
  'no twitter:card, but a complete Open Graph fallback covers card rendering':
    'pas de twitter:card, mais un repli Open Graph complet assure le rendu de la carte',
  'no usable robots.txt — AI crawlers allowed by default':
    'aucun robots.txt exploitable — les robots d’IA sont autorisés par défaut',
  'no usable robots.txt — search crawlers allowed by default':
    'aucun robots.txt exploitable — les robots de recherche sont autorisés par défaut',
  'no valid JSON-LD found': 'aucun JSON-LD valide trouvé',
  'no video content on the homepage': 'aucun contenu vidéo sur la page d’accueil',
  'no viewport meta restricting zoom': 'aucune balise meta viewport ne restreint le zoom',
  'no viewport meta tag': 'aucune balise meta viewport',
  'no WebSite entity on the homepage': 'aucune entité WebSite sur la page d’accueil',
  'no-follow fetch unavailable': 'récupération sans suivi de redirection indisponible',
  'nofollow found on: {0}': 'nofollow trouvé sur : {0}',
  'noindex found on: {0}': 'noindex trouvé sur : {0}',
  'non-canonical host uses a {0} (should be 301)': 'l’hôte non canonique utilise un {0} (301 attendu)',
  'non-descriptive alt text ({0}% descriptive)': 'textes alternatifs peu descriptifs ({0} % descriptifs)',
  'not enough main text to assess readability': 'pas assez de texte principal pour évaluer la lisibilité',
  'not served over HTTPS': 'non servi en HTTPS',
  'only 1 sameAs profile URL': 'une seule URL de profil sameAs',
  'Open Graph complete (core set + site_name + locale)': 'Open Graph complet (jeu de base + site_name + locale)',
  'Open Graph incomplete (missing: {0})': 'Open Graph incomplet (manque : {0})',
  'Open Graph missing: {0}': 'Open Graph absent : {0}',
  'Organization entity complete: {0}': 'entité Organization complète : {0}',
  'Organization entity incomplete (missing: {0})': 'entité Organization incomplète (manque : {0})',
  'orphan/dead-end page(s): {0} — top: {1}': 'page(s) orpheline(s) ou en impasse : {0} — en tête : {1}',
  'orphan/deep pages: {0}': 'pages orphelines ou trop profondes : {0}',
  'outbound citations on {0} substantial page(s)': 'citations sortantes sur {0} page(s) substantielle(s)',
  'page is not served over HTTPS': 'la page n’est pas servie en HTTPS',
  'pagination canonicalized to page 1: {0}': 'pagination canonicalisée vers la page 1 : {0}',
  'passive mixed content (images/media) on: {0}': 'contenu mixte passif (images/médias) sur : {0}',
  'Permissions-Policy present': 'Permissions-Policy présent',
  'poor URL structure: {0}': 'structure d’URL déficiente : {0}',
  'preconnect/dns-prefetch present for {0} third-party origin(s)':
    'preconnect/dns-prefetch présent pour {0} origine(s) tierce(s)',
  'preview directives set on {0} sampled page(s)': 'directives d’aperçu définies sur {0} page(s) échantillonnée(s)',
  'preview-limiting directive on: {0}': 'directive limitant l’aperçu sur : {0}',
  'Product offer incomplete on: {0}': 'offre Product incomplète sur : {0}',
  'Product offer markup complete on all sampled product pages':
    'balisage d’offre Product complet sur toutes les pages produit échantillonnées',
  'question-style subheadings on {0} long page(s)': 'intertitres formulés en question sur {0} page(s) longue(s)',
  'redirect chain/loop: {0}': 'chaîne ou boucle de redirection : {0}',
  'Referrer-Policy has no recognized value ({0})': 'Referrer-Policy n’a aucune valeur reconnue ({0})',
  'Referrer-Policy is leaky (unsafe-url)': 'Referrer-Policy laisse fuiter l’URL (unsafe-url)',
  'Referrer-Policy: {0}': 'Referrer-Policy : {0}',
  'relevant entity found: {0}': 'entité pertinente trouvée : {0}',
  'render-blocking head scripts on: {0}': 'scripts bloquant le rendu dans le <head> sur : {0}',
  'robots.txt found': 'robots.txt trouvé',
  'robots.txt is well-formed': 'robots.txt bien formé',
  'robots.txt malformed ({0})': 'robots.txt mal formé ({0})',
  'robots.txt missing (crawling allowed by default)': 'robots.txt absent (exploration autorisée par défaut)',
  'robots.txt not found (see robots-exists)': 'robots.txt introuvable (voir robots-exists)',
  'robots.txt served with content-type "{0}" (SPA fallback?)':
    'robots.txt servi avec le content-type « {0} » (repli de SPA ?)',
  'same document served across {0} AI/mobile UA probe(s)':
    'le même document est servi sur {0} sonde(s) de user-agent IA/mobile',
  'sampled asset not reachable ({0})': 'ressource échantillonnée inaccessible ({0})',
  'search crawlers (Googlebot, Bingbot, *) allowed': 'robots de recherche (Googlebot, Bingbot, *) autorisés',
  'search crawlers blocked: {0}': 'robots de recherche bloqués : {0}',
  'SearchAction present but incomplete (target/query-input)':
    'SearchAction présent mais incomplet (target/query-input)',
  'self-referential canonical on {0} sampled page(s)':
    'canonique auto-référente sur {0} page(s) échantillonnée(s)',
  'semantic landmarks on {0} sampled page(s)': 'repères sémantiques sur {0} page(s) échantillonnée(s)',
  'served over HTTPS': 'servi en HTTPS',
  'server-rendered main content on {0} sampled page(s), no empty CSR mount roots':
    'contenu principal rendu par le serveur sur {0} page(s) échantillonnée(s), aucune racine de montage client vide',
  'serving diverges by User-Agent: {0}': 'le service diverge selon le User-Agent : {0}',
  'single-language site (no hreflang annotations)': 'site monolingue (aucune annotation hreflang)',
  'sitemap <lastmod> weak ({0})': '<lastmod> du sitemap peu fiable ({0})',
  'sitemap and internal links agree on {0} URL(s)': 'le sitemap et les liens internes concordent sur {0} URL',
  'sitemap has no <url> entries (index or empty)': 'le sitemap n’a aucune entrée <url> (index ou vide)',
  'sitemap has no <url> entries to cross-reference': 'le sitemap n’a aucune entrée <url> à recouper',
  'sitemap index child invalid/oversize: {0}': 'sitemap enfant invalide ou hors limites : {0}',
  'sitemap index lists no children': 'l’index de sitemap ne liste aucun enfant',
  'sitemap is not valid XML': 'le sitemap n’est pas du XML valide',
  'sitemap lists non-indexable URLs: {0}': 'le sitemap liste des URL non indexables : {0}',
  'sitemap XML has no <urlset>/<sitemapindex> root or no <loc> entry':
    'le XML du sitemap n’a ni racine <urlset>/<sitemapindex> ni entrée <loc>',
  'sitemap/internal-link divergence ({0})': 'divergence entre le sitemap et les liens internes ({0})',
  'slash-toggled variants of {0} path(s) do not duplicate':
    'les variantes avec et sans slash de {0} chemin(s) ne créent pas de doublon',
  'static text ≥200 chars on {0} sampled page(s)':
    'texte statique d’au moins 200 caractères sur {0} page(s) échantillonnée(s)',
  'static text too thin on: {0}': 'texte statique trop maigre sur : {0}',
  'temporary redirect where permanent expected: {0}':
    'redirection temporaire là où une redirection permanente est attendue : {0}',
  'the likely-LCP image (first on the page) is lazy-loaded':
    'l’image probablement LCP (la première de la page) est en chargement différé',
  'thin content on: {0}': 'contenu trop maigre sur : {0}',
  'title and description in range on {0} page(s)': 'titre et description dans les bonnes plages sur {0} page(s)',
  'title and H1 share {0} meaningful token(s)': 'le titre et le H1 partagent {0} terme(s) significatif(s)',
  'title and H1 topics diverge (no shared meaningful tokens)':
    'les sujets du titre et du H1 divergent (aucun terme significatif commun)',
  'title and meta description look good': 'titre et meta description corrects',
  'title has no separator to distinguish topic from brand':
    'le titre n’a aucun séparateur pour distinguer le sujet de la marque',
  'title is topic-first with a brand suffix': 'le titre commence par le sujet et se termine par la marque',
  'title looks brand-first, not front-loaded with the topic':
    'le titre semble commencer par la marque plutôt que par le sujet',
  'title/description out of range on: {0}': 'titre/description hors plage sur : {0}',
  'titles and descriptions unique across {0} pages': 'titres et descriptions uniques sur {0} pages',
  'trailing-slash duplicates (both 200): {0}': 'doublons liés au slash final (les deux répondent 200) : {0}',
  'trailing-slash variant uses a temporary redirect: {0}':
    'la variante avec slash final utilise une redirection temporaire : {0}',
  'Twitter Card missing title/description/absolute image':
    'Twitter Card sans titre, description ou image absolue',
  'twitter:card has a non-standard type ({0})': 'twitter:card a un type non standard ({0})',
  'twitter:card={0} complete': 'twitter:card={0} complet',
  'UTF-8 charset declared': 'charset UTF-8 déclaré',
  'valid <html lang> on {0} sampled page(s)': '<html lang> valide sur {0} page(s) échantillonnée(s)',
  'valid sitemap but not referenced in robots.txt': 'sitemap valide mais non référencé dans le robots.txt',
  'valid sitemap, referenced in robots.txt': 'sitemap valide et référencé dans le robots.txt',
  'video present without VideoObject markup': 'vidéo présente sans balisage VideoObject',
  'video without complete VideoObject (missing: {0})': 'vidéo sans VideoObject complet (manque : {0})',
  'VideoObject complete': 'VideoObject complet',
  'VideoObject missing recommended {0}': 'VideoObject sans le champ recommandé {0}',
  'viewport allows pinch-zoom': 'le viewport autorise le zoom par pincement',
  'weak entity grounding (sameAs)': 'ancrage d’entité faible (sameAs)',
  'WebSite present but no SearchAction (no sitelinks searchbox)':
    'WebSite présent mais sans SearchAction (pas de champ de recherche dans les sitelinks)',
  'WebSite SearchAction (sitelinks searchbox) valid':
    'SearchAction de WebSite (champ de recherche des sitelinks) valide',
  'www and apex redirect to each other (loop)': 'www et le domaine racine se redirigent mutuellement (boucle)',
  'www/apex not consolidated (no clean 200 + 301 pair)':
    'www et domaine racine non consolidés (pas de paire propre 200 + 301)',
  'www/apex redirect chain or loop between hosts ({0})':
    'chaîne ou boucle de redirection entre les hôtes www et racine ({0})',
  'X-Content-Type-Options: nosniff': 'X-Content-Type-Options : nosniff',
  'X-Frame-Options: {0}': 'X-Frame-Options : {0}',
  'X-Robots-Tag header and meta robots disagree on: {0}':
    'l’en-tête X-Robots-Tag et la balise meta robots se contredisent sur : {0}',
  'zoom disabled (maximum-scale={0}) — fails WCAG 1.4.4':
    'zoom désactivé (maximum-scale={0}) — non conforme à WCAG 1.4.4',
  'zoom disabled (user-scalable=no) — fails WCAG 1.4.4':
    'zoom désactivé (user-scalable=no) — non conforme à WCAG 1.4.4',
  'zoom limited (maximum-scale={0})': 'zoom limité (maximum-scale={0})',
};

/** Refill a template's `{0}`, `{1}`, … slots with the values the check captured. */
function fill(template: string, params: MsgParam[]): string {
  return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
    const value = params[Number(index)];
    return value === undefined && !(Number(index) in params) ? whole : String(value);
  });
}

/**
 * The check's message in `lang`.
 *
 * Falls back to the English `message` whenever the result carries no template or the
 * template has no translation — a missing entry costs one English line, never a crash
 * and never an empty cell.
 */
export function localizeMessage(result: CheckResult, lang: Lang): string {
  if (lang === 'en') return result.message;
  const template = result.messageTemplate;
  if (!template) return result.message;
  const translated = CHECK_MESSAGES_FR[template];
  if (!translated) return result.message;
  return fill(translated, result.messageParams ?? []);
}
