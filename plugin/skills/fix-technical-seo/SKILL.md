---
name: fix-technical-seo
description: Fix non-GEO findings from findable-audit — technical SEO (canonical, redirects, www/trailing-slash, sitemap hygiene, soft-404), on-page (titles, meta, headings), security headers, performance and accessibility. Use when the user wants to fix technical SEO errors (not GEO/AI-visibility artifacts — that is the geo-implement skill) or improve their audit score.
---

# Fix technical SEO

This skill covers the `technical-seo`, `on-page`, `security`, `performance` and
`accessibility` findings; for GEO/AI-visibility artifacts (robots.txt, llms.txt,
`.well-known/ai.json`, JSON-LD, sitemap wiring, IndexNow) use the
`geo-implement` skill instead. Work from the audit report (run the `geo-audit`
skill first). Fix `fail`s before `warn`s, and biggest lost points first.

## Per-check fixes — technical-seo

- **canonical / canonical-resolves**: `<link rel="canonical" href="...">` with
  the absolute preferred URL on every page (self-referencing); the canonical
  target must return 200 directly, not redirect.
- **www-consolidation**: pick one host (www or apex) and 301 the other to it —
  a single hop, one canonical origin everywhere (canonicals, sitemap, links).
- **trailing-slash**: pick one style, 301 the other, consistently.
- **redirect-chains / redirect-hygiene / https**: serve over HTTPS with at most
  one 301 hop; update internal links to point at final URLs.
- **soft-404 / custom-404**: unknown URLs must return a real 404 status (not
  200), ideally with a helpful custom page.
- **broken-internal-links**: fix or remove every internal `<a href>` that
  returns >= 400; the audit message lists the dead paths.
- **sitemap-lastmod / sitemap-urls-valid / sitemap-orphans**: real `lastmod`
  dates (not all identical/today), only canonical 200 URLs in the sitemap, and
  every important page reachable from both sitemap and internal links.
- **meta-robots-noindex**: remove `noindex`/`none` (meta robots and
  `X-Robots-Tag` header) from pages that should rank; keep it only on
  genuinely private pages and exclude those from the sitemap.
- **hreflang / hreflang-x-default**: each language variant returns 200 and
  declares reciprocal `<link rel="alternate" hreflang="...">` tags, itself
  included, plus an `x-default`.

## Per-check fixes — on-page

- **title-description / unique-titles / meta-per-page**: every page gets a
  unique `<title>` (10–70 chars) and meta description (50–160 chars).
- **title-h1-alignment / headings-outline**: one `<h1>` per page consistent
  with the title; heading levels nested without gaps.
- **anchor-text**: descriptive link text (no bare "click here"/URLs).
- **open-graph / twitter-card**: `og:title` + `og:description` at minimum.
- **viewport**: `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **images-alt / alt-descriptive**: descriptive `alt` on informative images,
  `alt=""` on decorative ones.

## Per-check fixes — security & performance

- **hsts / x-content-type-options / csp / clickjacking / referrer-policy /
  permissions-policy**: add the missing response headers at the server/CDN
  level; the audit `fix` field gives a safe starting value for each.
- **img-dimensions / img-lazy-loading / img-next-gen**: explicit
  `width`/`height`, `loading="lazy"` below the fold, WebP/AVIF.
- **text-compression / asset-caching / render-blocking-js / render-blocking-css**:
  enable gzip/brotli, long-lived `Cache-Control` on static assets, `defer`
  scripts and inline or preload critical CSS.
- **cwv-\* / lab-\***: these only run with `--cwv` — treat them as
  field-measurement follow-ups to the static performance fixes above.

## Verify

Re-run `npx findable-audit <url>`; the touched checks must be `pass` and the
overall score must improve. Pass the previous JSON report as
`--baseline <file.json>` to show per-check deltas and catch regressions.
