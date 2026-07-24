---
name: geo-audit
description: Use when the user wants to audit a website's visibility for AI assistants (ChatGPT, Claude, Perplexity) or its technical SEO — runs findable-audit and turns the report into a prioritized fix plan.
---

# geo-audit

Audit a live website's readiness for AI search (GEO) and technical SEO using the `findable-audit` CLI (112 checks across 8 families), then turn the raw report into a prioritized, actionable fix plan.

## Step 1: Run the audit

```bash
npx findable-audit <url> --json
```

- The URL scheme is optional; bare domains are assumed `https://`.
- By default two report files are also written to the current directory
  (`<host>-<date>.md` and a self-contained printable `<host>-<date>.html`).
  Use `--no-report` to suppress them, or `--report <file>` (repeatable) to pick
  names and formats — extension decides: `.md`, `.html`, `.json`, `.sarif`
  (GitHub code scanning).

Useful options:

- `--max-pages <n>` (default `10`, `1` = homepage only): audits the homepage
  plus up to `n-1` same-origin pages discovered from the sitemap (falling back
  to homepage links); audited paths are listed in `sampledPages`.
- `--min-score <n>` (default `60`): only affects the exit code, not the report.
- `--cwv` (+ `--psi-key <key>`, `--psi-strategy <mobile|desktop>`): opts into
  Core Web Vitals via one PageSpeed Insights call (~15–30 s). Without it the
  `cwv-*` / `lab-*` checks report `skip`. The keyless endpoint is rate-limited,
  so pass a PSI key when the user has one.
- `--indexnow-key <key>`: lets the IndexNow check verify the key file.
- `--user-agent <ua>` (e.g. `"GPTBot/1.0"`): test UA-based blocking.
- `--lang <en|fr>`: report chrome language (check texts stay in English).
- `--compare <url2,url3,...>`: side-by-side competitor scorecard (overall +
  per-family, with the gaps where the user trails).
- `--baseline <file.json>` + `--fail-on-regression`
  (+ `--regression-tolerance <n>`, default 0): diff against a prior JSON report
  and exit 1 on regression — ideal as a CI gate.
- `--emit <dir>`: write ready-to-deploy starter files (`robots.txt`,
  `llms.txt`, `llms-full.txt`, `.well-known/ai.json`, `sitemap.xml`,
  `jsonld-stubs.json`). Content is generic — review before deploying (the
  `geo-implement` skill adapts these per framework).
- `--entity-graph <file>`: JSON-LD entity graph across the sampled pages
  (`.json`, `.dot` or `.mmd` by extension).

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | score >= min-score |
| `1`  | score below min-score (or regression with `--fail-on-regression`) |
| `2`  | site unreachable / fatal error |

**If the exit code is 2, the site is unreachable.** Report that to the user (quote the `findable-audit: Cannot reach <url>` error) and stop — do not guess or invent audit results.

## Step 2: Parse the JSON report

The `--json` output is an `AuditReport`:

```json
{
  "url": "https://example.com/",
  "score": 72,
  "grade": "C",
  "familyScores": { "ai-access": 90, "llm-content": 55 },
  "sampledPages": ["/", "/about.html"],
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
- `grade`: letter grade — A >= 90, B >= 80, C >= 70, D >= 60, F below.
- `familyScores`: per-family subscores — use them to spot the weakest area fast.
- `sampledPages`: the paths actually audited (homepage first) — cite these when a
  check reports offenders so the user knows the scope.
- `results[]`: one entry per check with `id`, `family`, `status` (`pass` | `warn` | `fail` | `skip`), `points`, `maxPoints`, `message`, and an optional `fix` suggestion.
- The 8 families (112 checks): `ai-access` (9), `llm-content` (13),
  `structured-data` (20), `technical-seo` (22), `on-page` (11),
  `performance` (19), `accessibility` (9), `security` (9).
- Most checks evaluate the whole `sampledPages` sample and list the offending
  paths in `message`. Checks report `skip` when not applicable (e.g. CWV
  without `--cwv`, no hreflang declared, local host).

## Step 3: Present the results

1. Lead with the overall **score** and **grade**, and whether it clears the min-score threshold.
2. List the **failures and warnings grouped by family**, with families ordered by **total lost points (`maxPoints - points`) descending** — the family bleeding the most points comes first (`familyScores` makes this ordering easy).
3. Within each family, show each failing/warning check's `message` and its `fix` suggestion when present.
4. Passing checks can be summarized in one line; don't bury the failures.

## Step 4: Propose a fix plan

Turn the failures into a prioritized fix plan: biggest point recovery first, quick wins highlighted (e.g. a missing `robots.txt` or `llms.txt` is usually a single generated file — `--emit` can produce starters for all of them at once).

If the project's source code is available locally, offer to apply the fixes directly:

- **`geo-implement`** — GEO / AI-visibility artifacts: `robots.txt`, `llms.txt`,
  `llms-full.txt`, `.well-known/ai.json`, JSON-LD, sitemap wiring and IndexNow,
  for the user's framework.
- **`fix-technical-seo`** — everything else: `technical-seo`, `on-page`,
  `security`, `performance` and `accessibility` findings (canonicals, redirects,
  www/trailing-slash consolidation, titles/meta, security headers, image and
  asset hygiene…).

After fixes are deployed, re-run the audit — pass the previous JSON report as
`--baseline` to show the deltas and prove nothing regressed.
