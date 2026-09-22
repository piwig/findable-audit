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

import { buildChecks } from '../../../packages/cli/dist/checks/index.js';
const CHECK_COUNT = buildChecks().length;

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
      // #59: the pasted baseline is unusable (not JSON, or not a findable report).
      badBaseline: { title: 'Not a findable-audit report', message: 'This content is not a findable-audit JSON report. Choose an exported JSON file, or paste its complete contents.' },
      jobGone: { title: 'Report expired', message: 'That report is no longer available. Completed reports are kept for up to 30 minutes, subject to server capacity. Run the audit again, then import your previous report.' },
      back: 'Audit another site',
    },
    landing: {
      title: 'SEO & AI findability audit, graded A–F — findable-audit',
      description: 'Free, open-source SEO and GEO audit: assess crawler access, readable content and technical quality, with evidence and prioritized fixes.',
      eyebrow: 'Classic SEO + GEO (AI findability) · open source',
      h1Lead: 'Your ',
      h1Accent: 'SEO and your AI findability',
      h1Tail: ', graded A–F.',
      lead: 'Find what prevents search engines and AI search tools from accessing and using your pages. Get measured findings, their evidence, and a prioritized action plan.',
      urlLabel: 'Website URL',
      cta: 'Audit',
      // #60: crawl depth, bounded server-side (PAGE_CHOICES).
      depthLabel: 'Pages to audit',
      // #66: the depth is an intention, not a number.
      depthOption: (n) => (n === 1 ? 'Homepage only — fast check' : n <= 3 ? `${n} pages — template audit` : `${n} pages — wider sample`),
      hint: 'A domain or public URL is enough. No account needed. Audit a sample of up to 6 pages.',
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
      previewTitle: 'A real report, before you start',
      previewVerdict: 'Our own site, audited with Findable. This archived score describes the sampled pages at the time of the audit.',
      previewPlanTitle: 'Findings in this report',
      previewSource: 'Archived audit of {host} · {date} · engine {version}',
      previewStatuses: { pass: 'Passed', warn: 'To review', fail: 'To fix', skip: 'Not applicable' },
      previewFamilies: ['AI access', 'Structured data', 'Technical SEO'],
      previewPlan: [],
      exampleLink: 'See a full example report',
      // L8: the strongest argument the product has, and it was written nowhere.
      // The number is asserted against the live engine by a dogfooding test.
      proof: 'One auditable method. The checks, their evidence and their limits stay visible. A technical score does not measure mentions in AI answers.',
      familiesTitle: `8 weighted families · ${CHECK_COUNT} checks`,
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
      // The site is also the distribution surface for the package: without this
      // section nobody landing here learns the CLI, the Action or the plugin exist.
      devTitle: 'Run it yourself, or in CI',
      devLead: 'The same engine is an open-source CLI. Run audits without an account and keep your reports on your machine.',
      devCmd: 'npx findable-audit https://your-site.com',
      // A one-line lead-in before the list: our own chunk-boundary check flags a
      // list whose preceding element is not a heading or a paragraph, and it
      // flagged this very section when the list sat right under the command.
      devList: 'The same engine, packaged four ways:',
      devNpm: 'the published package, MIT — install it globally or run it with npx.',
      devAction: 'gate a merge on a score floor or on a regression, with SARIF and JUnit output.',
      devPlugin: 'the plugin turns a report into a prioritized fix plan, inside your editor.',
      devSource: 'engine, web app and check guide — issues and pull requests welcome.',
      geoTitle: 'Why GEO matters',
      geoBody: [
        'GEO (Generative Engine Optimization) concerns how search tools using AI can discover and use your content. Useful, accessible pages remain the foundation. Findable checks access, readable content, links and structured data; it does not measure or guarantee citations in an AI answer.',
        'Training crawlers such as GPTBot have a different purpose from search crawlers and user-triggered retrieval. Blocking training is not the same as blocking AI search. Neither llms.txt nor a special schema format is required to appear in an AI answer; content advice remains guidance, with evidence and limits.',
        `findable-audit samples several pages and runs ${CHECK_COUNT} checks across 8 weighted families. The report separates measured defects from content advice, then prioritizes fixes. The score describes this sample, not every page or actual AI citations. The same open-source engine is available in the CLI and CI.`,
      ],
      // Outbound citations to the crawler operators' own documentation: these are
      // the primary sources behind the AI-access family, and they are what our own
      // `outbound-citations` check asks every audited page to provide.
      sourcesTitle: 'Sources — crawler documentation',
      sources: [
        { label: 'OpenAI — GPTBot, OAI-SearchBot and ChatGPT-User', url: 'https://developers.openai.com/api/docs/bots' },
        { label: 'Anthropic — ClaudeBot and how site owners can block it', url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
        { label: 'Perplexity — PerplexityBot and Perplexity-User', url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
        { label: 'Google Search Central — introduction to robots.txt', url: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro' },
      ],
    },
    nav: {
      audit: 'Audit',
      compare: 'Compare',
      example: 'Example report',
      by: 'by PB OpenTech',
      source: 'Source on GitHub',
      about: 'About',
      contact: 'Contact',
    },
    about: {
      title: 'About findable-audit — open-source SEO + GEO audit',
      description: `What findable-audit checks and why: ${CHECK_COUNT} SEO and GEO checks across 8 weighted families, how the A–F score works, and the open-source project behind it.`,
      h1: 'About findable-audit',
      // The FIRST paragraph is deliberately a short, self-contained answer
      // (40–320 chars): that is exactly what our own `content-lead-answer`
      // check rewards, and what an answer engine lifts as a definition.
      blocks: [
        { p: 'findable-audit is a free, open-source tool that measures how findable a website is — by classic search engines and by AI assistants such as ChatGPT, Claude and Perplexity.' },
        { p: 'It answers one question: what verifiable obstacles prevent search engines and AI search tools from reaching and using the pages in your sample?' },
        { h2: 'What it checks', p: `Each audit samples several pages and runs ${CHECK_COUNT} checks grouped into 8 weighted families: AI crawler access, answer-engine content, structured data, technical SEO, on-page semantics, performance and Core Web Vitals, accessibility, and security headers. Training robots and search robots have different purposes. Content heuristics are advisory; llms.txt is an experimental convention, not a requirement for AI visibility.` },
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
          a: 'SEO concerns search results; GEO concerns how AI search uses sources. They share foundations: accessible, useful and clearly presented content. Findable measures technical prerequisites and reports content guidance. A crawl cannot prove that an assistant will mention or cite a site.',
        },
        {
          q: 'What do you keep about the sites I audit?',
          a: 'The report is available for up to 30 minutes after completion, subject to server capacity. One minimal usage record per audit is kept: the URL and its domain, the score, the grade, the eight family sub-scores, a timestamp and a salted hash of the IP address. Page contents and findings are never stored.',
        },
        {
          q: 'Can I run findable-audit in continuous integration?',
          a: 'Yes. The CLI stores a baseline report and, with --fail-on-regression, exits non-zero when a deploy lowers the score. A composite GitHub Action and JUnit XML output ship with the repository.',
        },
      ],
      // Outbound citations to the peer-reviewed work the tool's priorities rest on.
      sourcesHeading: 'Sources and research',
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
        { h2: 'Report a bug', p: 'Include the audited URL, the grade you got and, if possible, the exported Markdown or JSON report. Reports are available for up to 30 minutes after completion, subject to server capacity: attach the export itself rather than a temporary link.' },
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
      expiry: 'Available for up to 30 minutes after completion, subject to server capacity. Download a copy to keep your findings.',
      actionsLabel: 'Report actions',
      exampleBack: 'Back to Findable',
      exampleNote: 'Archived report · {date} · engine {version}. A measured example, not a current audit.',
    },
    generate: {
      heading: 'Generate indexing files',
      note: 'Generic files — review before deploying, especially robots.txt.',
    },
    // #59: compare this audit with a previous one the reader already has.
    baseline: {
      summary: 'Compare with a previous audit',
      help: 'Choose a previous Findable JSON report or paste it below (2 MB maximum). A selected file takes priority. It is compared immediately and is not stored.',
      label: 'Previous audit, as JSON',
      fileLabel: 'Import a JSON report',
      cta: 'Show the diff',
    },
    compare: {
      needMoreTitle: 'Not enough sites to compare',
      needMore: 'Provide your URL and at least one reachable competitor URL.',
      heading: 'Compare against competitors',
      lead: 'Audit your site next to up to two competitors — see where you lead and where you trail, family by family.',
      urlLabel: 'Your URL',
      competitorsLabel: 'Competitor URLs (comma-separated, up to 2)',
      competitorOne: 'First competitor',
      competitorTwo: 'Second competitor (optional)',
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
      // #59 : la baseline collée est inutilisable (pas du JSON, ou pas un rapport findable).
      badBaseline: { title: "Ce n’est pas un rapport findable-audit", message: 'Ce contenu n’est pas un rapport JSON findable-audit. Choisissez un fichier JSON exporté ou collez son contenu complet.' },
      jobGone: { title: 'Rapport expiré', message: "Ce rapport n’est plus disponible. Les rapports terminés sont gardés jusqu’à 30 minutes, selon la capacité du serveur. Relancez l’audit, puis importez votre précédent rapport." },
      back: 'Auditer un autre site',
    },
    landing: {
      title: 'Audit SEO & findabilité IA, noté A–F — findable-audit',
      description: 'Audit SEO et GEO gratuit : examinez l’accès des robots, le contenu lisible et la qualité technique, avec des preuves et des corrections priorisées.',
      eyebrow: 'SEO classique + GEO (findabilité IA) · open source',
      h1Lead: 'Votre ',
      h1Accent: 'SEO et votre findabilité IA',
      h1Tail: ', notés A–F.',
      lead: 'Repérez ce qui empêche les moteurs de recherche et les outils de recherche IA d’accéder à vos pages et d’exploiter leur contenu. Obtenez des constats mesurés, leurs preuves et un plan de correction priorisé.',
      urlLabel: 'URL du site',
      cta: 'Auditer',
      // #60 : profondeur de crawl, bornée côté serveur (PAGE_CHOICES).
      depthLabel: 'Pages à auditer',
      // #66 : la profondeur est une intention, pas un nombre.
      depthOption: (n) => (n === 1 ? 'Page d’accueil seule — vérification rapide' : n <= 3 ? `${n} pages — audit de gabarits` : `${n} pages — échantillon élargi`),
      hint: 'Un domaine ou une URL publique suffit. Sans compte. Analyse d’un échantillon de 6 pages maximum.',
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
      previewTitle: 'Un vrai rapport, avant de commencer',
      previewVerdict: 'Notre propre site, audité avec Findable. Ce score archivé décrit les pages échantillonnées au moment de la mesure.',
      previewPlanTitle: 'Constats de ce rapport',
      previewSource: 'Audit archivé de {host} · {date} · moteur {version}',
      previewStatuses: { pass: 'Réussis', warn: 'À examiner', fail: 'À corriger', skip: 'Non applicables' },
      previewFamilies: ['Accès IA', 'Données structurées', 'SEO technique'],
      previewPlan: [],
      exampleLink: 'Voir un rapport d’exemple complet',
      // L8 : l'argument le plus fort du produit, écrit nulle part jusqu'ici.
      // Le chiffre est vérifié contre le moteur réel par un test de dogfooding.
      proof: 'Une méthode vérifiable. Les contrôles, leurs preuves et leurs limites restent visibles. Un score technique ne mesure pas les mentions dans les réponses IA.',
      familiesTitle: `8 familles pondérées · ${CHECK_COUNT} vérifications`,
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
      // Le site est aussi la surface de distribution du paquet : sans cette section,
      // personne qui arrive ici n'apprend que la CLI, l'Action et le plugin existent.
      devTitle: 'À lancer soi-même, ou en CI',
      devLead: 'Le même moteur est une CLI open source. Lancez vos audits sans compte et conservez vos rapports sur votre machine.',
      devCmd: 'npx findable-audit https://votre-site.com',
      devList: 'Le même moteur, empaqueté de quatre façons :',
      devNpm: 'le paquet publié, sous licence MIT — à installer globalement ou à lancer avec npx.',
      devAction: 'bloquez une fusion sous un seuil de score ou en cas de régression, avec sortie SARIF et JUnit.',
      devPlugin: 'le plugin transforme un rapport en plan de correction priorisé, dans votre éditeur.',
      devSource: 'moteur, application web et guide des checks — issues et pull requests bienvenues.',
      geoTitle: 'Pourquoi le GEO compte',
      geoBody: [
        'Le GEO (Generative Engine Optimization) concerne la découverte et l’utilisation de vos contenus par les outils de recherche IA. Des pages utiles et accessibles restent la base. Findable contrôle l’accès, le contenu lisible, les liens et les données structurées ; il ne mesure ni ne garantit les citations dans une réponse IA.',
        'Les robots d’entraînement comme GPTBot ont un rôle différent des robots de recherche et des visites déclenchées par un utilisateur. Bloquer l’entraînement ne revient pas à bloquer la recherche IA. Ni llms.txt ni un format de schéma particulier ne sont requis pour apparaître dans une réponse IA ; les conseils de contenu restent accompagnés de leurs preuves et limites.',
        `findable-audit échantillonne plusieurs pages et exécute ${CHECK_COUNT} vérifications réparties en 8 familles pondérées. Le rapport distingue les défauts mesurés des conseils de contenu, puis classe les corrections. Le score décrit cet échantillon, pas toutes les pages ni les citations IA réelles. Le même moteur open source est disponible en CLI et en CI.`,
      ],
      // Citations sortantes vers la documentation des opérateurs de crawlers :
      // ce sont les sources primaires de la famille « accès IA », et c'est
      // exactement ce que notre check `outbound-citations` demande à toute page.
      sourcesTitle: 'Sources — documentation des robots',
      sources: [
        { label: 'OpenAI — GPTBot, OAI-SearchBot et ChatGPT-User', url: 'https://developers.openai.com/api/docs/bots' },
        { label: 'Anthropic — ClaudeBot et comment le bloquer', url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
        { label: 'Perplexity — PerplexityBot et Perplexity-User', url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
        { label: 'Google Search Central — introduction à robots.txt', url: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro' },
      ],
    },
    nav: {
      audit: 'Auditer',
      compare: 'Comparer',
      example: 'Exemple de rapport',
      by: 'par PB OpenTech',
      source: 'Code sur GitHub',
      about: 'À propos',
      contact: 'Contact',
    },
    about: {
      title: 'À propos de findable-audit — audit SEO + GEO open source',
      description: `Ce que findable-audit vérifie et pourquoi : ${CHECK_COUNT} contrôles SEO et GEO en 8 familles pondérées, le fonctionnement de la note A–F et le projet open source.`,
      h1: 'À propos de findable-audit',
      // Le PREMIER paragraphe est volontairement une réponse courte et
      // autoportante (40–320 caractères) : c'est exactement ce que récompense
      // notre check `content-lead-answer`, et ce qu'un moteur de réponse extrait.
      blocks: [
        { p: 'findable-audit est un outil gratuit et open source qui mesure la findabilité d’un site web — par les moteurs de recherche classiques et par les assistants IA comme ChatGPT, Claude ou Perplexity.' },
        { p: 'Il répond à une question : quels obstacles vérifiables empêchent les moteurs de recherche et les outils de recherche IA d’accéder aux pages de votre échantillon et d’en exploiter le contenu ?' },
        { h2: 'Ce qui est vérifié', p: `Chaque audit échantillonne plusieurs pages et exécute ${CHECK_COUNT} contrôles en 8 familles pondérées : accès des robots IA, contenu pour moteurs de réponse, données structurées, SEO technique, sémantique on-page, performance et Core Web Vitals, accessibilité et sécurité. Les robots d’entraînement et de recherche ont des rôles distincts. Les heuristiques de contenu sont des conseils ; llms.txt reste une convention expérimentale, pas un prérequis de visibilité IA.` },
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
          a: 'Le SEO concerne les résultats de recherche ; le GEO concerne l’utilisation des sources par la recherche IA. Ils partagent des bases : un contenu accessible, utile et clair. Findable mesure des prérequis techniques et formule des conseils. Un crawl ne prouve pas qu’un assistant mentionnera ou citera un site.',
        },
        {
          q: 'Que conservez-vous des sites que j’audite ?',
          a: 'Le rapport est disponible jusqu’à 30 minutes après la fin, selon la capacité du serveur. Un enregistrement d’usage minimal est conservé par audit : l’URL et son domaine, le score, la note, les huit sous-scores par famille, un horodatage et une empreinte salée de l’adresse IP. Le contenu des pages et les résultats détaillés ne sont jamais stockés.',
        },
        {
          q: 'Puis-je utiliser findable-audit en intégration continue ?',
          a: 'Oui. La CLI enregistre un rapport de référence et, avec --fail-on-regression, sort en code non nul quand un déploiement fait baisser le score. Une action GitHub composite et une sortie JUnit XML sont fournies avec le dépôt.',
        },
      ],
      // Citations sortantes vers les travaux sur lesquels reposent nos priorités.
      sourcesHeading: 'Sources et recherche',
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
        { h2: 'Signaler un bug', p: 'Indiquez l’URL auditée, la note obtenue et, si possible, l’export Markdown ou JSON du rapport. Les rapports sont disponibles jusqu’à 30 minutes après la fin, selon la capacité du serveur : joignez l’export lui-même plutôt qu’un lien temporaire.' },
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
      expiry: 'Disponible jusqu’à 30 minutes après la fin, selon la capacité du serveur. Téléchargez une copie pour conserver vos résultats.',
      actionsLabel: 'Actions du rapport',
      exampleBack: 'Retour à Findable',
      exampleNote: 'Rapport archivé · {date} · moteur {version}. Un exemple mesuré, pas un audit actuel.',
    },
    generate: {
      heading: 'Générer les fichiers d’indexation',
      note: 'Fichiers génériques — à relire avant de déployer, en particulier robots.txt.',
    },
    // #59 : comparer cet audit avec un précédent que le lecteur possède déjà.
    baseline: {
      summary: 'Comparer avec un audit précédent',
      help: 'Choisissez un précédent rapport JSON Findable ou collez-le ci-dessous (2 Mo maximum). Le fichier choisi est prioritaire. Il est comparé immédiatement, sans être conservé.',
      label: 'Audit précédent, en JSON',
      fileLabel: 'Importer un rapport JSON',
      cta: 'Afficher l’écart',
    },
    compare: {
      needMoreTitle: 'Pas assez de sites à comparer',
      needMore: 'Indiquez votre URL et au moins un concurrent joignable.',
      heading: 'Comparer à des concurrents',
      lead: 'Auditez votre site à côté de deux concurrents maximum — voyez où vous menez et où vous êtes devancé, famille par famille.',
      urlLabel: 'Votre URL',
      competitorsLabel: 'URL concurrentes (séparées par des virgules, 2 max)',
      competitorOne: 'Premier concurrent',
      competitorTwo: 'Second concurrent (facultatif)',
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
