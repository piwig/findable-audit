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
//   error:    { rateLimited, busy, timeout, unreachable, notFound, missingUrl, internal },  // each {title,message}
//             { urlNotAllowed },  // {title} only — the message is the SSRF layer's own technical BlockedUrlError.message, left untranslated
//             { back },           // plain string — generic error-page back-link label
//   landing:  { title, h1, lead, feature1, feature2, feature3, urlLabel, cta, hint },
//   selector: { ariaLabel, en, fr },
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
      back: 'Audit another site',
    },
    landing: {
      title: 'findable-audit — SEO & GEO audit',
      h1: 'findable-audit',
      lead: "Audit a website's SEO and GEO — how findable it is by AI search crawlers (GPTBot, ClaudeBot, PerplexityBot…) and classic search engines.",
      feature1: '107 checks across 8 weighted families — AI access, structured data, technical SEO, on-page, performance, accessibility, security.',
      feature2: 'A single score out of 100 and an A–F grade, with a prioritized action plan.',
      feature3: 'Multi-page crawl, Core Web Vitals (when configured), and exportable Markdown / HTML / JSON reports.',
      urlLabel: 'Website URL',
      cta: 'Audit',
      hint: 'Enter a public http(s) URL. Internal, private and reserved addresses are refused.',
    },
    selector: {
      ariaLabel: 'Language',
      en: 'English',
      fr: 'Français',
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
      back: 'Auditer un autre site',
    },
    landing: {
      title: 'findable-audit — audit SEO & GEO',
      h1: 'findable-audit',
      lead: "Auditez le SEO et le GEO d'un site — sa findabilité par les crawlers IA (GPTBot, ClaudeBot, PerplexityBot…) et les moteurs de recherche classiques.",
      feature1: '107 vérifications réparties sur 8 familles pondérées : accès IA, données structurées, SEO technique, on-page, performance, accessibilité, sécurité.',
      feature2: "Un score sur 100 et une note A–F, avec un plan d'action priorisé.",
      feature3: 'Crawl multi-pages, Core Web Vitals (si configurés), et rapports exportables en Markdown / HTML / JSON.',
      urlLabel: 'URL du site',
      cta: 'Auditer',
      hint: 'Entrez une URL http(s) publique. Les adresses internes, privées ou réservées sont refusées.',
    },
    selector: {
      ariaLabel: 'Langue',
      en: 'English',
      fr: 'Français',
    },
  },
};

/** Return the WEB chrome catalogue for `lang`, falling back to English. */
export function t(lang) {
  return WEB_MESSAGES[lang] ?? WEB_MESSAGES.en;
}
