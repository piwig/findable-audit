---
name: audit-site
description: Run a findable-audit GEO/SEO audit against a URL and interpret the report. Use when the user asks to audit, score, or diagnose a site's visibility to AI assistants (GEO) or its technical SEO.
---

# Audit a site

## Run

```bash
npx findable-audit <url> --json --max-pages 10 [--indexnow-key <key>]
```

Exit codes: 0 = score >= min-score (default 60), 1 = below, 2 = site unreachable or bad arguments.
Add `--report audit.md` to also write a Markdown report.

## Interpret

The JSON report has `score` (0-100), `sampledPages` (audited pages) and `results`
(one entry per check: `id`, `family`, `status` pass/warn/fail/skip, `points`,
`maxPoints`, `message`, `fix`).

Families: `ai-access` (robots/AI crawlers), `llm-content` (llms.txt, JS-free
content, image alt), `structured-data` (JSON-LD), `seo-fundamentals`
(title/canonical/sitemap/links/redirects/hreflang).

## Prioritize

1. `fail` results ordered by `maxPoints` descending.
2. Then `warn` results, same order.
3. Quote each result's `fix` line and name the offending pages from `message`.
4. Offer to apply fixes via the `implement-geo` (AI visibility) or
   `fix-technical-seo` (technical SEO) skills.
