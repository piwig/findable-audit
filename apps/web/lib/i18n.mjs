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
//               captchaNoscript,   // #7: Turnstile <noscript> fallback
//               sourcesTitle, sources:[{label,url} x4] },  // outbound crawler-doc citations
//   about:    { title, description, h1, blocks:[{h2?,p}],
//               familiesHeading, families:[8 strings],   // rendered as a real <ul>
//               faqHeading, faq:[{q,a} x4],              // mirrored into FAQPage JSON-LD
//               sourcesHeading, sources:[{label,url} x3] },
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
      // Two modes, one form (L2): the tabs are <a href="#…"> + :target, so the
      // landing keeps `script-src 'none'`.
      modeSingle: 'One site',
      modeCompare: 'Compare',
      // Three axes lead instead of eight jargon families (L6). The families are
      // still there, one disclosure below.
      axesTitle: 'What a report answers',
      axes: [
        { n: 'Reachable', q: 'do crawlers get to the page at all?' },
        { n: 'Understood', q: 'do they understand what they read?' },
        { n: 'Usable', q: 'does the page hold up, for a human and for an agent?' },
      ],
      // L5: show the deliverable instead of describing it.
      previewTitle: 'What you get',
      previewVerdict: 'Crawlers reach your pages, but an AI assistant finds no structured identity: it can describe you, it cannot cite you.',
      previewPlanTitle: 'Action plan · quick wins',
      previewPlan: [
        { f: 'AI access', t: 'The /llms.txt orientation file', p: '+10 pts' },
        { f: 'Data', t: 'Identity grounded by sameAs links', p: '+2 pts' },
      ],
      exampleLink: 'See a full example report',
      // L8: the strongest argument the product has, and it was written nowhere.
      // The number is asserted against the live engine by a dogfooding test.
      proof: 'This site scores 99/100 (A) against its own engine — and the two remaining warnings are documented rather than hidden.',
      familiesTitle: '8 weighted families · 120 checks',
      familiesDetails: 'The detail of the 8 scoring families',
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
        'findable-audit measures both dimensions in one pass: the crawl samples several pages, runs 120 checks across 8 weighted families, then returns an A–F grade with the exact fixes to apply first. Nothing to install, no account — and the engine is open source: the same checks power the CLI you can run in CI.',
      ],
      // Outbound citations to the crawler operators' own documentation: these are
      // the primary sources behind the AI-access family, and they are what our own
      // `outbound-citations` check asks every audited page to provide.
      sourcesTitle: 'Crawler documentation',
      sources: [
        { label: 'OpenAI — GPTBot, OAI-SearchBot and ChatGPT-User', url: 'https://developers.openai.com/api/docs/bots' },
        { label: 'Anthropic — ClaudeBot and how site owners can block it', url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
        { label: 'Perplexity — PerplexityBot and Perplexity-User', url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
        { label: 'Google Search Central — introduction to robots.txt', url: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro' },
      ],
    },
    nav: {
      about: 'About',
      contact: 'Contact',
    },
    about: {
      title: 'About findable-audit — open-source SEO + GEO audit',
      description: 'What findable-audit checks and why: 120 SEO and GEO checks across 8 weighted families, how the A–F score works, and the open-source project behind it.',
      h1: 'About findable-audit',
      // The FIRST paragraph is deliberately a short, self-contained answer
      // (40–320 chars): that is exactly what our own `content-lead-answer`
      // check rewards, and what an answer engine lifts as a definition.
      blocks: [
        { p: 'findable-audit is a free, open-source tool that measures how findable a website is — by classic search engines and by AI assistants such as ChatGPT, Claude and Perplexity.' },
        { p: 'It answers one question: when someone searches for what you offer, can search engines and AI crawlers reach your pages, extract your content and cite you as a source?' },
        { h2: 'What it checks', p: 'Each audit samples several pages of the target site and runs 120 checks grouped into 8 weighted families: AI access (robots directives for GPTBot, ClaudeBot and friends), answer-engine content (llms.txt, extractable server-rendered copy), structured data (JSON-LD entities, Open Graph), technical SEO (canonicals, redirects, sitemaps), on-page semantics (titles, headings, internal links), performance and Core Web Vitals, accessibility, and security headers.' },
        { h2: 'How scoring works', p: 'Every check awards points and ships with a concrete, prioritized fix. Family scores are weighted into a single 0–100 score and an A–F grade, so two audits of the same site are directly comparable over time — the CLI can even fail a CI build when a deploy regresses the score.' },
        { h2: 'Open source', p: 'The engine is MIT-licensed and dependency-light. The same check catalogue powers this web app, a command-line tool and a CI gate. This site is audited with its own engine — dogfooding keeps the recommendations honest.' },
      ],
      // Rendered as a real <ul>: a list is what `extractable-structure` asks for,
      // and each item is a self-contained "answer unit" (short, with a number in it).
      familiesHeading: 'The 8 weighted families',
      families: [
        'AI access (weight 16%): robots.txt directives and edge rules for GPTBot, ClaudeBot, PerplexityBot and 25 other AI agents.',
        'Answer-engine content (18%): llms.txt, server-rendered copy, direct-answer leads, extractable lists and tables.',
        'Structured data (15%): JSON-LD entities, Open Graph, FAQPage and Article markup, entity grounding through sameAs.',
        'Technical SEO (15%): canonicals, redirects, sitemaps, hreflang, host consolidation and pagination.',
        'On-page (12%): titles, meta descriptions, heading hierarchy, image alt text and internal linking.',
        'Performance and Core Web Vitals (10%): LCP, CLS, INP and TTFB, measured through PageSpeed Insights when an API key is supplied.',
        'Accessibility (7%): landmarks, form labels, iframe titles, descriptive alt text and heading order.',
        'Security and trust (7%): HTTPS, HSTS, Content-Security-Policy, X-Content-Type-Options and Referrer-Policy.',
      ],
      faqHeading: 'Frequently asked questions',
      faq: [
        {
          q: 'Is findable-audit free?',
          a: 'Yes. The web app and the command-line tool are both free and MIT-licensed, and no account is needed to run an audit.',
        },
        {
          q: 'How is GEO different from SEO?',
          a: 'SEO optimizes for ranked links on a results page. GEO optimizes for being reached, extracted and cited inside an AI answer. findable-audit scores both in one pass, because a single crawl answers both questions.',
        },
        {
          q: 'What do you keep about the sites I audit?',
          a: 'The report itself is ephemeral and expires from the server a few minutes after the audit ends. One minimal usage record per audit is kept: the URL and its domain, the score, the grade, the eight family sub-scores, a timestamp and a salted hash of the IP address. Page contents and findings are never stored.',
        },
        {
          q: 'Can I run findable-audit in continuous integration?',
          a: 'Yes. The CLI stores a baseline report and, with --fail-on-regression, exits non-zero when a deploy lowers the score. A composite GitHub Action and JUnit XML output ship with the repository.',
        },
      ],
      // Outbound citations to the peer-reviewed work the tool's priorities rest on.
      sourcesHeading: 'Research this tool builds on',
      sources: [
        { label: 'GEO: Generative Engine Optimization (KDD 2024) — arXiv 2311.09735', url: 'https://arxiv.org/abs/2311.09735' },
        { label: 'C-SEO Bench: content rewriting is largely ineffective — arXiv 2506.11097', url: 'https://arxiv.org/abs/2506.11097' },
        { label: 'Search Arena: how often answer engines fetch and cite — arXiv 2508.00838', url: 'https://arxiv.org/abs/2508.00838' },
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
      // Deux modes, un seul formulaire (L2) : les onglets sont des <a href="#…">
      // + :target, la landing garde donc sa CSP `script-src 'none'`.
      modeSingle: 'Un site',
      modeCompare: 'Comparer',
      // Trois axes en tête plutôt que huit familles en jargon (L6). Les familles
      // restent, un cran plus bas.
      axesTitle: 'Ce qu’un rapport répond',
      axes: [
        { n: 'Trouvable', q: 'les robots arrivent-ils seulement jusqu’à la page ?' },
        { n: 'Compréhensible', q: 'comprennent-ils ce qu’ils lisent ?' },
        { n: 'Utilisable', q: 'la page tient-elle la route, pour un humain et pour un agent ?' },
      ],
      // L5 : montrer le livrable au lieu de le décrire.
      previewTitle: 'Ce que vous obtenez',
      previewVerdict: 'Les robots atteignent vos pages, mais un assistant IA n’y trouve pas de fiche d’identité structurée : il peut vous décrire, pas vous citer.',
      previewPlanTitle: 'Plan d’action · rapide',
      previewPlan: [
        { f: 'Accès IA', t: 'Le fichier d’orientation /llms.txt', p: '+10 pts' },
        { f: 'Données', t: 'Identité ancrée par des liens sameAs', p: '+2 pts' },
      ],
      exampleLink: 'Voir un rapport d’exemple complet',
      // L8 : l'argument le plus fort du produit, écrit nulle part jusqu'ici.
      // Le chiffre est vérifié contre le moteur réel par un test de dogfooding.
      proof: 'Ce site obtient 99/100 (A) avec son propre moteur — et les deux avertissements restants sont documentés plutôt que masqués.',
      familiesTitle: '8 familles pondérées · 120 vérifications',
      familiesDetails: 'Le détail des 8 familles de score',
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
        'findable-audit mesure les deux dimensions en une seule passe : le crawl échantillonne plusieurs pages, exécute 120 vérifications réparties en 8 familles pondérées, puis rend une note A–F avec les corrections à appliquer en premier. Rien à installer, pas de compte — et le moteur est open source : les mêmes vérifications alimentent la CLI utilisable en CI.',
      ],
      // Citations sortantes vers la documentation des opérateurs de crawlers :
      // ce sont les sources primaires de la famille « accès IA », et c'est
      // exactement ce que notre check `outbound-citations` demande à toute page.
      sourcesTitle: 'Documentation des crawlers',
      sources: [
        { label: 'OpenAI — GPTBot, OAI-SearchBot et ChatGPT-User', url: 'https://developers.openai.com/api/docs/bots' },
        { label: 'Anthropic — ClaudeBot et comment le bloquer', url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
        { label: 'Perplexity — PerplexityBot et Perplexity-User', url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
        { label: 'Google Search Central — introduction à robots.txt', url: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro' },
      ],
    },
    nav: {
      about: 'À propos',
      contact: 'Contact',
    },
    about: {
      title: 'À propos de findable-audit — audit SEO + GEO open source',
      description: 'Ce que findable-audit vérifie et pourquoi : 120 contrôles SEO et GEO en 8 familles pondérées, le fonctionnement de la note A–F et le projet open source.',
      h1: 'À propos de findable-audit',
      // Le PREMIER paragraphe est volontairement une réponse courte et
      // autoportante (40–320 caractères) : c'est exactement ce que récompense
      // notre check `content-lead-answer`, et ce qu'un moteur de réponse extrait.
      blocks: [
        { p: 'findable-audit est un outil gratuit et open source qui mesure la findabilité d’un site web — par les moteurs de recherche classiques et par les assistants IA comme ChatGPT, Claude ou Perplexity.' },
        { p: 'Il répond à une question : quand quelqu’un cherche ce que vous proposez, les moteurs et les crawlers IA peuvent-ils atteindre vos pages, extraire votre contenu et vous citer comme source ?' },
        { h2: 'Ce qui est vérifié', p: 'Chaque audit échantillonne plusieurs pages du site cible et exécute 120 contrôles regroupés en 8 familles pondérées : accès IA (directives robots pour GPTBot, ClaudeBot et consorts), contenu pour moteurs de réponse (llms.txt, contenu extractible rendu côté serveur), données structurées (entités JSON-LD, Open Graph), SEO technique (canonicals, redirections, sitemaps), sémantique on-page (titres, intertitres, liens internes), performance et Core Web Vitals, accessibilité, et en-têtes de sécurité.' },
        { h2: 'Comment le score fonctionne', p: 'Chaque contrôle rapporte des points et vient avec une correction concrète et priorisée. Les scores par famille sont pondérés en un score unique sur 100 et une note A–F : deux audits du même site sont directement comparables dans le temps — la CLI peut même faire échouer un build CI quand un déploiement fait régresser le score.' },
        { h2: 'Open source', p: 'Le moteur est sous licence MIT, avec très peu de dépendances. Le même catalogue de contrôles alimente cette application web, un outil en ligne de commande et une gate CI. Ce site est audité avec son propre moteur — le dogfooding garde les recommandations honnêtes.' },
      ],
      // Rendu en vraie <ul> : c'est ce que demande `extractable-structure`, et
      // chaque item est une « unité de réponse » autoportante (courte, chiffrée).
      familiesHeading: 'Les 8 familles pondérées',
      families: [
        'Accès IA (poids 16 %) : directives robots.txt et règles edge pour GPTBot, ClaudeBot, PerplexityBot et 25 autres agents IA.',
        'Contenu pour moteurs de réponse (18 %) : llms.txt, contenu rendu côté serveur, chapô en réponse directe, listes et tableaux extractibles.',
        'Données structurées (15 %) : entités JSON-LD, Open Graph, balisage FAQPage et Article, ancrage d’entité via sameAs.',
        'SEO technique (15 %) : canonicals, redirections, sitemaps, hreflang, consolidation d’hôte et pagination.',
        'On-page (12 %) : titres, méta-descriptions, hiérarchie des intertitres, textes alternatifs et maillage interne.',
        'Performance et Core Web Vitals (10 %) : LCP, CLS, INP et TTFB, mesurés via PageSpeed Insights lorsqu’une clé API est fournie.',
        'Accessibilité (7 %) : points de repère, étiquettes de formulaire, titres d’iframe, alternatives textuelles et ordre des titres.',
        'Sécurité et confiance (7 %) : HTTPS, HSTS, Content-Security-Policy, X-Content-Type-Options et Referrer-Policy.',
      ],
      faqHeading: 'Questions fréquentes',
      faq: [
        {
          q: 'findable-audit est-il gratuit ?',
          a: 'Oui. L’application web et l’outil en ligne de commande sont gratuits et sous licence MIT, et aucun compte n’est nécessaire pour lancer un audit.',
        },
        {
          q: 'Quelle différence entre le GEO et le SEO ?',
          a: 'Le SEO optimise le classement de liens sur une page de résultats. Le GEO optimise le fait d’être atteint, extrait et cité à l’intérieur d’une réponse IA. findable-audit note les deux en une passe, parce qu’un seul crawl répond aux deux questions.',
        },
        {
          q: 'Que conservez-vous des sites que j’audite ?',
          a: 'Le rapport lui-même est éphémère et expire du serveur quelques minutes après la fin de l’audit. Un enregistrement d’usage minimal est conservé par audit : l’URL et son domaine, le score, la note, les huit sous-scores par famille, un horodatage et une empreinte salée de l’adresse IP. Le contenu des pages et les résultats détaillés ne sont jamais stockés.',
        },
        {
          q: 'Puis-je utiliser findable-audit en intégration continue ?',
          a: 'Oui. La CLI enregistre un rapport de référence et, avec --fail-on-regression, sort en code non nul quand un déploiement fait baisser le score. Une action GitHub composite et une sortie JUnit XML sont fournies avec le dépôt.',
        },
      ],
      // Citations sortantes vers les travaux sur lesquels reposent nos priorités.
      sourcesHeading: 'La recherche derrière l’outil',
      sources: [
        { label: 'GEO : Generative Engine Optimization (KDD 2024) — arXiv 2311.09735', url: 'https://arxiv.org/abs/2311.09735' },
        { label: 'C-SEO Bench : réécrire le contenu est largement inefficace — arXiv 2506.11097', url: 'https://arxiv.org/abs/2506.11097' },
        { label: 'Search Arena : à quelle fréquence les moteurs récupèrent et citent — arXiv 2508.00838', url: 'https://arxiv.org/abs/2508.00838' },
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
