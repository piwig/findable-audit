---
name: implement-geo
description: Implement GEO (AI-search visibility) fixes flagged by findable-audit - llms.txt, llms-full.txt, JSON-LD entities with NAP, robots.txt rules for AI crawlers, sitemap and IndexNow. Use when the user wants their site cited by ChatGPT, Claude, Perplexity or other AI assistants.
---

# Implement GEO fixes

Work from the audit report (run the `audit-site` skill first). Fix `fail`s
before `warn`s.

## llms.txt / llms-full.txt (checks: llms-txt, llms-full-txt)

Serve `/llms.txt`: an H1 with the site name, a one-line summary blockquote,
then Markdown link sections pointing to the key pages. Serve `/llms-full.txt`
with the full plain-text content of those pages. Both as `text/plain`.

## JSON-LD entity (checks: json-ld, json-ld-entity, schema-coverage)

On the homepage, one `<script type="application/ld+json">` block declaring the
main entity (LocalBusiness subtype, Organization or WebSite). For local
businesses always include NAP: `name`, `address` (PostalAddress), `telephone`.
On inner pages add page-appropriate types (Article, Product, BreadcrumbList)
until at least half the sampled pages carry JSON-LD.

## AI crawler access (checks: robots-exists, ai-crawlers-allowed, robots-directives)

robots.txt must not block GPTBot, ClaudeBot, PerplexityBot, Google-Extended &
co. unless the user explicitly wants to. Never `Disallow: /` for `*`.

## Discovery (checks: sitemap, indexnow)

Reference the sitemap from robots.txt (`Sitemap: <absolute-url>`). For
IndexNow, publish `/<key>.txt` containing exactly the key, then pass
`--indexnow-key <key>` when re-auditing.

## Verify

Re-run the audit; the touched checks must be `pass` and the score must not
regress anywhere else.
