---
name: geo-audit
description: Use when the user wants to audit a website's visibility for AI assistants (ChatGPT, Claude, Perplexity) or its technical SEO — runs findable-audit and turns the report into a prioritized fix plan.
---

# geo-audit

Audit a live website's readiness for AI search (GEO) and technical SEO using the `findable-audit` CLI, then turn the raw report into a prioritized, actionable fix plan.

## Step 1: Run the audit

```bash
npx findable-audit <url> --json
```

- If the user provides an IndexNow key, add `--indexnow-key <key>` so the IndexNow check can verify the key file.
- The URL scheme is optional; bare domains are assumed `https://`.
- Options: `--min-score <n>` (default `60`) only affects the exit code, not the report.

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | score >= min-score |
| `1`  | score below min-score |
| `2`  | site unreachable / fatal error |

**If the exit code is 2, the site is unreachable.** Report that to the user (quote the `findable-audit: Cannot reach <url>` error) and stop — do not guess or invent audit results.

## Step 2: Parse the JSON report

The `--json` output is an `AuditReport`:

```json
{
  "url": "https://example.com/",
  "score": 72,
  "results": [
    {
      "id": "llms-txt",
      "family": "llm-content",
      "status": "fail",
      "points": 0,
      "maxPoints": 10,
      "message": "…",
      "fix": "…"
    }
  ]
}
```

- `score`: 0–100, normalized (`skip` results are excluded from scoring).
- `results[]`: one entry per check with `id`, `family`, `status` (`pass` | `warn` | `fail` | `skip`), `points`, `maxPoints`, `message`, and an optional `fix` suggestion.
- Families: `ai-access`, `llm-content`, `structured-data`, `seo-fundamentals`.

## Step 3: Present the results

1. Lead with the overall **score** (out of 100) and whether it clears the min-score threshold.
2. List the **failures and warnings grouped by family**, with families ordered by **total lost points (`maxPoints - points`) descending** — the family bleeding the most points comes first.
3. Within each family, show each failing/warning check's `message` and its `fix` suggestion when present.
4. Passing checks can be summarized in one line; don't bury the failures.

## Step 4: Propose a fix plan

Turn the failures into a prioritized fix plan: biggest point recovery first, quick wins highlighted (e.g. a missing `robots.txt` or `llms.txt` is usually a single generated file).

If the project's source code is available locally, offer to apply the fixes directly using the **`geo-implement`** skill, which generates `robots.txt`, `llms.txt`, JSON-LD, sitemap wiring and IndexNow for the user's framework.

After fixes are deployed, re-run `npx findable-audit <url> --json` to confirm the score improved.
