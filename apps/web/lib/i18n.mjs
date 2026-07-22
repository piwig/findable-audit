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
//   landing:  { title, eyebrow, h1Lead, h1Accent, h1Tail, lead, urlLabel, cta, hint,
//               familiesTitle, families:[8 strings], howTitle, steps:[{t,d} x3] },
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
      back: 'Audit another site',
    },
    landing: {
      title: 'findable-audit — SEO & GEO audit',
      eyebrow: 'Classic SEO + GEO (AI findability) · open source',
      h1Lead: 'Your ',
      h1Accent: 'SEO and your AI findability',
      h1Tail: ', graded A–F.',
      lead: "Audit a website's search visibility — by classic search engines AND by AI crawlers (GPTBot, ClaudeBot, PerplexityBot…) — in a single pass, with a prioritized action plan.",
      urlLabel: 'Website URL',
      cta: 'Audit',
      hint: 'Enter a public http(s) URL. Internal, private and reserved addresses are refused.',
      familiesTitle: '8 weighted families · 108 checks',
      families: ['AI access', 'Answer-engine content', 'Structured data', 'Technical SEO', 'On-page', 'Performance / CWV', 'Accessibility', 'Security'],
      howTitle: 'How it works',
      steps: [
        { t: 'Paste a URL', d: 'a public http(s) address.' },
        { t: 'Live audit', d: 'multi-page crawl + checks, streamed in real time.' },
        { t: 'Score + plan', d: 'A–F grade, prioritized fixes, Markdown / HTML / JSON export.' },
      ],
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
    compare: {
      needMoreTitle: 'Not enough sites to compare',
      needMore: 'Provide your URL and at least one reachable competitor URL.',
      heading: 'Compare against competitors',
      lead: 'Audit your site next to up to two competitors — see where you lead and where you trail, family by family.',
      urlLabel: 'Your URL',
      competitorsLabel: 'Competitor URLs (comma-separated, up to 2)',
      cta: 'Compare',
      hint: 'Public http(s) URLs. Core Web Vitals are skipped in compare mode to keep it fast.',
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
      eyebrow: 'SEO classique + GEO (findabilité IA) · open source',
      h1Lead: 'Votre ',
      h1Accent: 'SEO et votre findabilité IA',
      h1Tail: ', notés A–F.',
      lead: "Auditez le référencement d'un site — par les moteurs de recherche classiques ET par les crawlers IA (GPTBot, ClaudeBot, PerplexityBot…) — en une passe, avec un plan d'action priorisé.",
      urlLabel: 'URL du site',
      cta: 'Auditer',
      hint: 'Entrez une URL http(s) publique. Les adresses internes, privées ou réservées sont refusées.',
      familiesTitle: '8 familles pondérées · 108 vérifications',
      families: ['Accès IA', 'Contenu pour moteurs de réponse', 'Données structurées', 'SEO technique', 'On-page', 'Performance / CWV', 'Accessibilité', 'Sécurité'],
      howTitle: 'Comment ça marche',
      steps: [
        { t: 'Collez une URL', d: 'publique http(s).' },
        { t: 'Test en cours', d: 'crawl multi-pages + checks, en direct.' },
        { t: 'Score + plan', d: 'note A–F, corrections priorisées, export Markdown / HTML / JSON.' },
      ],
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
    compare: {
      needMoreTitle: 'Pas assez de sites à comparer',
      needMore: 'Indiquez votre URL et au moins un concurrent joignable.',
      heading: 'Comparer à des concurrents',
      lead: 'Auditez votre site à côté de deux concurrents maximum — voyez où vous menez et où vous êtes devancé, famille par famille.',
      urlLabel: 'Votre URL',
      competitorsLabel: 'URL concurrentes (séparées par des virgules, 2 max)',
      cta: 'Comparer',
      hint: 'URL http(s) publiques. Les Core Web Vitals sont ignorés en mode comparaison pour rester rapide.',
    },
  },
};

/** Return the WEB chrome catalogue for `lang`, falling back to English. */
export function t(lang) {
  return WEB_MESSAGES[lang] ?? WEB_MESSAGES.en;
}
