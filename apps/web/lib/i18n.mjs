// WEB chrome i18n catalogue for the public audit app (SEPARATE from the report
// catalogue that lives in packages/cli/src/report/i18n.ts).
//
// OWNERSHIP (contract hardening #1): 2B is the sole creator of this file and
// delivers the COMPLETE skeleton. 2B fills `progress` and
// `error.{rateLimited,busy,timeout,unreachable}`. 2C fills `landing`,
// `selector` and `error.notFound` in place — 2C ADDS values, it never
// recreates this file.
//
// OWNERSHIP NOTE: sub-phase 2B owns `progress` and the job-lifecycle parts
// of `error` (rate-limited, busy, timeout, unreachable...). Sub-phase 2C
// owns `landing`, `selector`, and `error.notFound`. Now that both have
// landed, this file holds the union of both sets of keys under one
// `t(lang)`.
//
// Shape: Record<Lang, {
//   progress: { title, heading, lead, phases:{connect,sample,checks,cwv,score}, done, failed, noscript, retry },
//   error:    { rateLimited, busy, timeout, unreachable, notFound, missingUrl, internal,
//               captchaFailed },  // each {title,message} — captchaFailed added task 5 (#7 server-side gate)
//             { urlNotAllowed },  // {title} only — the message is the SSRF layer's own technical BlockedUrlError.message, left untranslated
//             { back },           // plain string — generic error-page back-link label
//   landing:  { title, eyebrow, h1Lead, h1Accent, h1Tail, lead, urlLabel, cta, hint,
//               familiesTitle, families:[8 strings], howTitle, steps:[{t,d} x3],
//               captchaNoscript },  // #7: Turnstile <noscript> fallback
//   selector: { ariaLabel, en, fr },
//   result:   { download },  // label for the report's download bar; the "audit another site" link reuses progress.retry
// }>

export const WEB_MESSAGES = {
  en: {
    progress: {
      title: 'Audit in progress',
      heading: 'Auditing your site',
      lead: 'This usually takes 10-30 seconds. Please keep this page open.',
      phases: {
        connect: 'Connecting to the site…',
        sample: 'Discovering pages…',
        checks: 'Running checks…',
        cwv: 'Measuring Core Web Vitals…',
        score: 'Scoring…',
      },
      done: 'Done — loading your report…',
      failed: 'The audit could not be completed.',
      noscript: 'JavaScript is disabled. Your report will load automatically in a moment.',
      retry: 'Audit another site',
    },
    error: {
      rateLimited: { title: 'Too many requests', message: 'You have run too many audits in a short time. Please wait a moment and try again.' },
      busy: { title: 'Server busy', message: 'The server is busy running other audits. Please try again in a few seconds.' },
      timeout: { title: 'Audit timed out', message: 'The audit took too long and was stopped. The target site may be slow or unresponsive.' },
      unreachable: { title: 'Site unreachable', message: 'Could not reach that site — it may be down or blocking automated requests.' },
      notFound: { title: 'Not found', message: 'No such page.' },
      missingUrl: { title: 'Missing URL', message: 'Please provide a URL to audit.' },
      urlNotAllowed: { title: 'URL not allowed' },
      internal: { title: 'Something went wrong', message: 'Something went wrong while auditing that site.' },
      reportNotReady: { title: 'Report not ready', message: 'That report is not available for download yet.' },
      captchaFailed: { title: 'Verification failed', message: 'We could not confirm you are human. Please try again.' },
      back: 'Audit another site',
    },
    landing: {
      title: 'SEO & AI findability audit, graded A–F — findable-audit',
      eyebrow: 'Classic SEO + GEO (AI findability) · open source',
      h1Lead: 'Your ',
      h1Accent: 'SEO and your AI findability',
      h1Tail: ', graded A–F.',
      lead: "Audit a website's search visibility — by classic search engines AND by AI crawlers (GPTBot, ClaudeBot, PerplexityBot…) — in a single pass, with a prioritized action plan.",
      urlLabel: 'Website URL',
      cta: 'Audit',
      hint: 'Enter a public http(s) URL. Internal, private and reserved addresses are refused.',
      familiesTitle: '8 weighted families · 112 checks',
      families: ['AI access', 'Answer-engine content', 'Structured data', 'Technical SEO', 'On-page', 'Performance / CWV', 'Accessibility', 'Security'],
      howTitle: 'How it works',
      steps: [
        { t: 'Paste a URL', d: 'a public http(s) address.' },
        { t: 'Live audit', d: 'multi-page crawl + checks, streamed in real time.' },
        { t: 'Score + plan', d: 'A–F grade, prioritized fixes, Markdown / HTML / JSON export.' },
      ],
      // #7: <noscript> fallback shown next to the Turnstile widget (only
      // rendered when Turnstile is env-gated on) — bot verification needs JS.
      captchaNoscript: 'Bot verification requires JavaScript. Please enable it to submit an audit.',
      geoTitle: 'Why GEO matters',
      geoBody: [
        'GEO (Generative Engine Optimization) is the practice of making a website findable, extractable and citable by AI assistants such as ChatGPT, Claude or Perplexity. These assistants answer questions directly, and they can only recommend sites their crawlers can reach, parse and trust. A site that blocks GPTBot, hides its content behind JavaScript or ships no structured data is invisible in AI answers — whatever its classic Google ranking.',
        'findable-audit measures both dimensions in one pass: the crawl samples several pages, runs 112 checks across 8 weighted families, then returns an A–F grade with the exact fixes to apply first. Nothing to install, no account — and the engine is open source: the same checks power the CLI you can run in CI.',
      ],
    },
    nav: {
      about: 'About',
      contact: 'Contact',
    },
    about: {
      title: 'About findable-audit — open-source SEO + GEO audit',
      description: 'What findable-audit checks and why: 112 SEO and GEO checks across 8 weighted families, how the A–F score works, and the open-source project behind it.',
      h1: 'About findable-audit',
      blocks: [
        { p: 'findable-audit is a free, open-source tool that measures how findable a website is — by classic search engines and by AI assistants such as ChatGPT, Claude and Perplexity. It answers one question: when someone searches for what you offer, can search engines and AI crawlers reach your pages, extract your content and cite you as a source?' },
        { h2: 'What it checks', p: 'Each audit samples several pages of the target site and runs 112 checks grouped into 8 weighted families: AI access (robots directives for GPTBot, ClaudeBot and friends), answer-engine content (llms.txt, extractable server-rendered copy), structured data (JSON-LD entities, Open Graph), technical SEO (canonicals, redirects, sitemaps), on-page semantics (titles, headings, internal links), performance and Core Web Vitals, accessibility, and security headers.' },
        { h2: 'How scoring works', p: 'Every check awards points and ships with a concrete, prioritized fix. Family scores are weighted into a single 0–100 score and an A–F grade, so two audits of the same site are directly comparable over time — the CLI can even fail a CI build when a deploy regresses the score.' },
        { h2: 'Open source', p: 'The engine is MIT-licensed and dependency-light. The same check catalogue powers this web app, a command-line tool and a CI gate. This site is audited with its own engine — dogfooding keeps the recommendations honest.' },
      ],
    },
    contact: {
      title: 'Contact — findable-audit support & feedback',
      description: 'How to reach the findable-audit team: report a bug, request a new check or ask a question — GitHub issues are the fastest channel for the project.',
      h1: 'Contact',
      blocks: [
        { p: 'findable-audit is developed in the open on GitHub. The fastest way to reach the team — for a bug, a question or a new-check proposal — is to open an issue on the repository; issues are read in both French and English. You do not need an account on this site: there is nothing to sign up for, and both the web app and the CLI are free to use.' },
        { h2: 'Report a bug', p: 'Include the audited URL, the grade you got and, if possible, the exported Markdown or JSON report. Audits are ephemeral: reports expire from the server a few minutes after they finish, so attach the export itself rather than a link to it.' },
        { h2: 'Security reports', p: 'For a security issue in the tool or in this site, please use the contact listed in our security.txt policy below rather than a public issue.' },
      ],
      linksHeading: 'Links',
      issuesLabel: 'Open a GitHub issue (bugs, questions, check proposals)',
      sourceLabel: 'Source code and documentation',
      securityLabel: 'Security policy (security.txt)',
    },
    selector: {
      ariaLabel: 'Language',
      en: 'English',
      fr: 'Français',
    },
    result: {
      // Punctuation is baked in (locale-dependent): EN uses a plain colon…
      download: 'Download:',
    },
    generate: {
      heading: 'Generate indexing files',
      note: 'Generic files — review before deploying, especially robots.txt.',
    },
    compare: {
      needMoreTitle: 'Not enough sites to compare',
      needMore: 'Provide your URL and at least one reachable competitor URL.',
      heading: 'Compare against competitors',
      lead: 'Audit your site next to up to two competitors — see where you lead and where you trail, family by family.',
      urlLabel: 'Your URL',
      competitorsLabel: 'Competitor URLs (comma-separated, up to 2)',
      cta: 'Compare',
      hint: 'Public http(s) URLs. Core Web Vitals are skipped in compare mode to keep it fast.',
      progressTitle: 'Comparison in progress',
      progressHeading: 'Comparing sites',
      progressSite: 'Auditing site {i} of {n}…',
      resultTitle: 'Competitive scorecard',
      skipped: '{url} could not be reached and was skipped.',
    },
  },
  fr: {
    progress: {
      title: 'Audit en cours',
      heading: 'Audit de votre site',
      lead: "Cela prend généralement 10 à 30 secondes. Gardez cette page ouverte.",
      phases: {
        connect: 'Connexion au site…',
        sample: 'Découverte des pages…',
        checks: 'Exécution des vérifications…',
        cwv: 'Mesure des Core Web Vitals…',
        score: 'Calcul du score…',
      },
      done: 'Terminé — chargement de votre rapport…',
      failed: "L'audit n'a pas pu être terminé.",
      noscript: 'JavaScript est désactivé. Votre rapport se chargera automatiquement dans un instant.',
      retry: 'Auditer un autre site',
    },
    error: {
      rateLimited: { title: 'Trop de requêtes', message: "Vous avez lancé trop d'audits en peu de temps. Patientez un instant puis réessayez." },
      busy: { title: 'Serveur occupé', message: "Le serveur exécute déjà d'autres audits. Réessayez dans quelques secondes." },
      timeout: { title: "L'audit a expiré", message: "L'audit a pris trop de temps et a été arrêté. Le site cible est peut-être lent ou ne répond pas." },
      unreachable: { title: 'Site injoignable', message: "Impossible de joindre ce site — il est peut-être hors ligne ou bloque les requêtes automatisées." },
      notFound: { title: 'Introuvable', message: "Cette page n'existe pas." },
      missingUrl: { title: 'URL manquante', message: 'Veuillez indiquer une URL à auditer.' },
      urlNotAllowed: { title: 'URL non autorisée' },
      internal: { title: 'Une erreur est survenue', message: "Une erreur est survenue lors de l'audit de ce site." },
      reportNotReady: { title: 'Rapport pas encore prêt', message: "Ce rapport n'est pas encore disponible au téléchargement." },
      captchaFailed: { title: 'Vérification échouée', message: "Nous n'avons pas pu confirmer que vous n'êtes pas un robot. Veuillez réessayer." },
      back: 'Auditer un autre site',
    },
    landing: {
      title: 'Audit SEO & findabilité IA, noté A–F — findable-audit',
      eyebrow: 'SEO classique + GEO (findabilité IA) · open source',
      h1Lead: 'Votre ',
      h1Accent: 'SEO et votre findabilité IA',
      h1Tail: ', notés A–F.',
      lead: "Auditez le référencement d'un site — par les moteurs de recherche classiques ET par les crawlers IA (GPTBot, ClaudeBot, PerplexityBot…) — en une passe, avec un plan d'action priorisé.",
      urlLabel: 'URL du site',
      cta: 'Auditer',
      hint: 'Entrez une URL http(s) publique. Les adresses internes, privées ou réservées sont refusées.',
      familiesTitle: '8 familles pondérées · 112 vérifications',
      families: ['Accès IA', 'Contenu pour moteurs de réponse', 'Données structurées', 'SEO technique', 'On-page', 'Performance / CWV', 'Accessibilité', 'Sécurité'],
      howTitle: 'Comment ça marche',
      steps: [
        { t: 'Collez une URL', d: 'publique http(s).' },
        { t: 'Test en cours', d: 'crawl multi-pages + checks, en direct.' },
        { t: 'Score + plan', d: 'note A–F, corrections priorisées, export Markdown / HTML / JSON.' },
      ],
      // #7 : repli <noscript> affiché à côté du widget Turnstile (rendu
      // uniquement quand Turnstile est activé via l'env) — la vérification
      // anti-robot nécessite JavaScript.
      captchaNoscript: 'La vérification anti-robot nécessite JavaScript. Veuillez l’activer pour lancer un audit.',
      geoTitle: 'Pourquoi le GEO compte',
      geoBody: [
        'Le GEO (Generative Engine Optimization) consiste à rendre un site trouvable, extractible et citable par les assistants IA comme ChatGPT, Claude ou Perplexity. Ces assistants répondent directement aux questions, et ne peuvent recommander que les sites que leurs crawlers atteignent, comprennent et jugent fiables. Un site qui bloque GPTBot, cache son contenu derrière du JavaScript ou n’expose aucune donnée structurée est invisible dans les réponses IA — quel que soit son classement Google classique.',
        'findable-audit mesure les deux dimensions en une seule passe : le crawl échantillonne plusieurs pages, exécute 112 vérifications réparties en 8 familles pondérées, puis rend une note A–F avec les corrections à appliquer en premier. Rien à installer, pas de compte — et le moteur est open source : les mêmes vérifications alimentent la CLI utilisable en CI.',
      ],
    },
    nav: {
      about: 'À propos',
      contact: 'Contact',
    },
    about: {
      title: 'À propos de findable-audit — audit SEO + GEO open source',
      description: 'Ce que findable-audit vérifie et pourquoi : 112 contrôles SEO et GEO en 8 familles pondérées, le fonctionnement de la note A–F et le projet open source.',
      h1: 'À propos de findable-audit',
      blocks: [
        { p: 'findable-audit est un outil gratuit et open source qui mesure la findabilité d’un site web — par les moteurs de recherche classiques et par les assistants IA comme ChatGPT, Claude ou Perplexity. Il répond à une question : quand quelqu’un cherche ce que vous proposez, les moteurs et les crawlers IA peuvent-ils atteindre vos pages, extraire votre contenu et vous citer comme source ?' },
        { h2: 'Ce qui est vérifié', p: 'Chaque audit échantillonne plusieurs pages du site cible et exécute 112 contrôles regroupés en 8 familles pondérées : accès IA (directives robots pour GPTBot, ClaudeBot et consorts), contenu pour moteurs de réponse (llms.txt, contenu extractible rendu côté serveur), données structurées (entités JSON-LD, Open Graph), SEO technique (canonicals, redirections, sitemaps), sémantique on-page (titres, intertitres, liens internes), performance et Core Web Vitals, accessibilité, et en-têtes de sécurité.' },
        { h2: 'Comment le score fonctionne', p: 'Chaque contrôle rapporte des points et vient avec une correction concrète et priorisée. Les scores par famille sont pondérés en un score unique sur 100 et une note A–F : deux audits du même site sont directement comparables dans le temps — la CLI peut même faire échouer un build CI quand un déploiement fait régresser le score.' },
        { h2: 'Open source', p: 'Le moteur est sous licence MIT, avec très peu de dépendances. Le même catalogue de contrôles alimente cette application web, un outil en ligne de commande et une gate CI. Ce site est audité avec son propre moteur — le dogfooding garde les recommandations honnêtes.' },
      ],
    },
    contact: {
      title: 'Contact — support et retours findable-audit',
      description: 'Comment joindre l’équipe findable-audit : signaler un bug, proposer un nouveau contrôle ou poser une question — les issues GitHub sont le canal le plus rapide.',
      h1: 'Contact',
      blocks: [
        { p: 'findable-audit est développé en public sur GitHub. Le moyen le plus rapide de joindre l’équipe — pour un bug, une question ou une proposition de contrôle — est d’ouvrir une issue sur le dépôt ; les issues sont lues en français comme en anglais. Aucun compte n’est nécessaire sur ce site : il n’y a rien à créer, et l’application web comme la CLI sont gratuites.' },
        { h2: 'Signaler un bug', p: 'Indiquez l’URL auditée, la note obtenue et, si possible, l’export Markdown ou JSON du rapport. Les audits sont éphémères : les rapports expirent du serveur quelques minutes après leur fin — joignez donc l’export lui-même plutôt qu’un lien.' },
        { h2: 'Signalements de sécurité', p: 'Pour un problème de sécurité dans l’outil ou sur ce site, utilisez le contact indiqué dans notre politique security.txt ci-dessous plutôt qu’une issue publique.' },
      ],
      linksHeading: 'Liens',
      issuesLabel: 'Ouvrir une issue GitHub (bugs, questions, propositions)',
      sourceLabel: 'Code source et documentation',
      securityLabel: 'Politique de sécurité (security.txt)',
    },
    selector: {
      ariaLabel: 'Langue',
      en: 'English',
      fr: 'Français',
    },
    result: {
      // …FR puts a non-breaking space before the colon (French typography).
      download: 'Télécharger :',
    },
    generate: {
      heading: 'Générer les fichiers d’indexation',
      note: 'Fichiers génériques — à relire avant de déployer, en particulier robots.txt.',
    },
    compare: {
      needMoreTitle: 'Pas assez de sites à comparer',
      needMore: 'Indiquez votre URL et au moins un concurrent joignable.',
      heading: 'Comparer à des concurrents',
      lead: 'Auditez votre site à côté de deux concurrents maximum — voyez où vous menez et où vous êtes devancé, famille par famille.',
      urlLabel: 'Votre URL',
      competitorsLabel: 'URL concurrentes (séparées par des virgules, 2 max)',
      cta: 'Comparer',
      hint: 'URL http(s) publiques. Les Core Web Vitals sont ignorés en mode comparaison pour rester rapide.',
      progressTitle: 'Comparaison en cours',
      progressHeading: 'Comparaison des sites',
      progressSite: 'Audit du site {i} sur {n}…',
      resultTitle: 'Tableau comparatif',
      skipped: '{url} n’a pas pu être joint et a été ignoré.',
    },
  },
};

/** Return the WEB chrome catalogue for `lang`, falling back to English. */
export function t(lang) {
  return WEB_MESSAGES[lang] ?? WEB_MESSAGES.en;
}
