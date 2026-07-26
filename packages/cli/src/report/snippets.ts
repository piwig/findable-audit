// Ready-to-paste remediation snippets, keyed by check id. Layer 2 of the report
// shows one inside each action-plan item's "how to do it" disclosure.
//
// Only checks whose fix IS a literal piece of configuration or markup get an
// entry — a header, a directive, a tag, a JSON-LD skeleton. Checks whose fix is
// editorial work ("open with a direct answer") deliberately have none: a fake
// snippet would be worse than no snippet.
//
// The content is code, not prose, so it is language-neutral: one map, no i18n.
// Placeholders are written in SCREAMING_SNAKE so it is obvious what to replace.

export const CHECK_SNIPPETS: Record<string, string> = {
  // --- security headers (nginx syntax; the header names are what matters) ---
  csp: `add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'" always;`,
  hsts: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
  'x-content-type-options': 'add_header X-Content-Type-Options "nosniff" always;',
  clickjacking: 'add_header X-Frame-Options "SAMEORIGIN" always;\n# or, preferred: Content-Security-Policy: frame-ancestors \'self\'',
  'referrer-policy': 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
  'permissions-policy': 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;',
  'asset-caching': 'location ~* \\.(css|js|woff2|png|jpg|svg)$ {\n  add_header Cache-Control "public, max-age=31536000, immutable";\n}',
  'text-compression': 'gzip on;\ngzip_types text/html text/css application/javascript application/json image/svg+xml;\n# better still: brotli on; brotli_types …',

  // --- robots / crawler access ---
  'ai-crawlers-allowed': `User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /`,
  'search-crawlers-allowed': 'User-agent: Googlebot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /',
  'robots-exists': 'User-agent: *\nAllow: /\n\nSitemap: https://YOUR_DOMAIN/sitemap.xml',
  'meta-robots-noindex': '<!-- remove any of these from pages that must be findable -->\n<meta name="robots" content="noindex">\nX-Robots-Tag: noindex',
  'snippet-preview-directives': '<meta name="robots" content="max-snippet:-1, max-image-preview:large, max-video-preview:-1">',

  // --- head markup ---
  charset: '<meta charset="utf-8">',
  viewport: '<meta name="viewport" content="width=device-width, initial-scale=1">',
  'viewport-zoom': '<!-- never disable zoom: drop maximum-scale / user-scalable=no -->\n<meta name="viewport" content="width=device-width, initial-scale=1">',
  'html-lang': '<html lang="fr">',
  canonical: '<link rel="canonical" href="https://YOUR_DOMAIN/THIS_EXACT_PATH">',
  favicon: '<link rel="icon" href="/favicon.ico" sizes="any">\n<link rel="icon" href="/icon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  'hreflang-x-default': `<link rel="alternate" hreflang="fr" href="https://YOUR_DOMAIN/fr/PATH">
<link rel="alternate" hreflang="en" href="https://YOUR_DOMAIN/en/PATH">
<link rel="alternate" hreflang="x-default" href="https://YOUR_DOMAIN/en/PATH">`,
  'open-graph': `<meta property="og:title" content="PAGE_TITLE">
<meta property="og:description" content="ONE_SENTENCE_SUMMARY">
<meta property="og:type" content="website">
<meta property="og:url" content="https://YOUR_DOMAIN/PATH">
<meta property="og:image" content="https://YOUR_DOMAIN/og.png">`,
  'twitter-card': '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="PAGE_TITLE">\n<meta name="twitter:image" content="https://YOUR_DOMAIN/og.png">',
  'resource-hints': '<link rel="preconnect" href="https://FONT_OR_CDN_HOST" crossorigin>\n<link rel="preload" as="image" href="/hero.avif" fetchpriority="high">',
  'render-blocking-js': '<script src="/app.js" defer></script>',

  // --- structured data ---
  'json-ld': `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization",
 "name":"YOUR_NAME","url":"https://YOUR_DOMAIN/","logo":"https://YOUR_DOMAIN/logo.png"}
</script>`,
  'sd-organization': `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","@id":"https://YOUR_DOMAIN/#org",
 "name":"YOUR_NAME","url":"https://YOUR_DOMAIN/","logo":"https://YOUR_DOMAIN/logo.png",
 "sameAs":["https://www.linkedin.com/company/YOU","https://www.wikidata.org/wiki/QID"]}
</script>`,
  'sd-localbusiness': `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"LocalBusiness","@id":"https://YOUR_DOMAIN/#business",
 "name":"YOUR_NAME","telephone":"+33 X XX XX XX XX",
 "address":{"@type":"PostalAddress","streetAddress":"STREET","postalCode":"CODE","addressLocality":"CITY","addressCountry":"FR"},
 "openingHours":"Mo-Fr 09:00-18:00","url":"https://YOUR_DOMAIN/"}
</script>`,
  'sd-breadcrumb': `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
 {"@type":"ListItem","position":1,"name":"Accueil","item":"https://YOUR_DOMAIN/"},
 {"@type":"ListItem","position":2,"name":"SECTION","item":"https://YOUR_DOMAIN/SECTION"}]}
</script>`,
  'sd-website-searchaction': `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","@id":"https://YOUR_DOMAIN/#website",
 "url":"https://YOUR_DOMAIN/","name":"YOUR_NAME",
 "potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint",
  "urlTemplate":"https://YOUR_DOMAIN/recherche?q={search_term_string}"},
  "query-input":"required name=search_term_string"}}
</script>`,
  'sd-entity-grounding': '"sameAs": [\n  "https://www.wikidata.org/wiki/QID",\n  "https://www.linkedin.com/company/YOU",\n  "https://www.google.com/maps/place/?q=place_id:PLACE_ID"\n]',
  'entity-graph-connectivity': `<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","@id":"https://YOUR_DOMAIN/#org","name":"YOUR_NAME"},
 {"@type":"WebSite","@id":"https://YOUR_DOMAIN/#website","url":"https://YOUR_DOMAIN/",
  "publisher":{"@id":"https://YOUR_DOMAIN/#org"}}]}
</script>`,

  // --- AI-facing files ---
  'llms-txt': `# YOUR_NAME

> One sentence saying what you do and for whom.

## Pages
- [Home](https://YOUR_DOMAIN/): what a visitor finds there
- [Services](https://YOUR_DOMAIN/services): what you sell
- [About](https://YOUR_DOMAIN/a-propos): who you are
- [Contact](https://YOUR_DOMAIN/contact): how to reach you
- [FAQ](https://YOUR_DOMAIN/faq): the questions you are actually asked`,
  'well-known-ai-json': `{
  "name": "YOUR_NAME",
  "url": "https://YOUR_DOMAIN/",
  "description": "One sentence.",
  "contact": {"email": "contact@YOUR_DOMAIN"},
  "policy": {"training": "allow", "citation": "allow"}
}`,

  // --- sitemap ---
  sitemap: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://YOUR_DOMAIN/</loc><lastmod>2026-07-26</lastmod></url>\n</urlset>',
  'sitemap-lastmod': '<url><loc>https://YOUR_DOMAIN/PATH</loc><lastmod>2026-07-26</lastmod></url>',

  // --- markup hygiene ---
  'img-dimensions': '<img src="/photo.avif" width="1200" height="800" alt="A real description">',
  'img-lazy-loading': '<!-- hero (LCP): eager -->\n<img src="/hero.avif" fetchpriority="high" width="1600" height="900" alt="…">\n<!-- below the fold -->\n<img src="/rest.avif" loading="lazy" width="800" height="600" alt="…">',
  'img-next-gen': '<picture>\n  <source srcset="/photo.avif" type="image/avif">\n  <source srcset="/photo.webp" type="image/webp">\n  <img src="/photo.jpg" width="1200" height="800" alt="A real description">\n</picture>',
  'form-labels': '<label for="email">E-mail</label>\n<input id="email" name="email" type="email" required>',
  'iframe-title': '<iframe src="…" title="What this embed shows"></iframe>',
  landmarks: '<header>…</header>\n<nav>…</nav>\n<main>\n  <h1>…</h1>\n</main>\n<footer>…</footer>',
  'meta-refresh': '# replace <meta http-equiv="refresh"> with a server-side redirect\nreturn 301 https://YOUR_DOMAIN/NEW_PATH;',
  'www-consolidation': 'server {\n  server_name www.YOUR_DOMAIN;\n  return 301 https://YOUR_DOMAIN$request_uri;\n}',
  'agent-usability': '<form action="/contact" method="post">\n  <label for="msg">Message</label>\n  <textarea id="msg" name="message"></textarea>\n  <button type="submit">Envoyer</button>\n</form>\n<a href="mailto:contact@YOUR_DOMAIN">contact@YOUR_DOMAIN</a>',
};

/** Ready-to-paste snippet for a check, when one genuinely exists. */
export function checkSnippet(id: string): string | undefined {
  return CHECK_SNIPPETS[id];
}
