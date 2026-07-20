---
name: fix-technical-seo
description: Fix technical SEO findings from findable-audit - titles and meta descriptions, canonical, Open Graph, viewport, noindex, redirect hygiene, broken internal links, duplicate titles, hreflang. Use when the user wants to fix SEO errors or improve their audit score.
---

# Fix technical SEO

Work from the audit report (run the `audit-site` skill first). Fix `fail`s
before `warn`s.

## Per-check fixes

- **title-description / unique-titles**: every page gets a unique `<title>`
  (10-70 chars) and meta description (50-160 chars).
- **canonical**: `<link rel="canonical" href="...">` with the absolute
  preferred URL on every page (self-referencing).
- **open-graph**: `og:title` + `og:description` at minimum.
- **viewport**: `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **meta-robots-noindex**: remove `noindex`/`none` (meta robots and
  `X-Robots-Tag` header) from pages that should rank; keep it only on
  genuinely private pages and exclude those from the sitemap.
- **https / redirect-hygiene**: serve over HTTPS with a single 301 from
  `http://` to `https://` (no chains).
- **broken-internal-links**: fix or remove every internal `<a href>` that
  returns >= 400; the audit message lists the dead paths.
- **images-alt**: descriptive `alt` on informative images, `alt=""` on
  decorative ones.
- **hreflang**: each language variant returns 200 and declares reciprocal
  `<link rel="alternate" hreflang="...">` tags, itself included.

## Verify

Re-run `npx findable-audit <url>`; the touched checks must be `pass` and the
overall score must improve.
