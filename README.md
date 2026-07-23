# findable-audit

[![CI](https://github.com/piwig/findable-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/piwig/findable-audit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/findable-audit)](https://www.npmjs.com/package/findable-audit)
[![Try it live](https://img.shields.io/badge/Try%20it%20live-findable-1a7f37)](https://findable.bordebat.fr)

Audit any URL right in your browser — no install: **[findable.bordebat.fr](https://findable.bordebat.fr)**.

**SEO & GEO audit CLI: check how findable your site is by search engines and AI assistants.**

AI assistants are becoming a major way people discover websites, but most sites are only optimized for classic search engines. `findable-audit` runs **108 automatable SEO + GEO + Core Web Vitals + accessibility + security checks** against a site in one command, scores it out of 100 with a weighted **A–F grade** across 8 families, and tells you exactly what to fix.

## Quick start

```bash
npx findable-audit https://your-site.com
```

Below is a representative run against a large production site (`stripe.com --max-pages 6`, Core Web Vitals not enabled). The footer shows the overall score, the letter grade, and a subscore per family; individual checks print `OK` / `!!` / `XX` / `--` with a one-line fix on anything that isn't passing.

```text
findable-audit report for https://stripe.com/

AI crawler access
  OK ai-crawlers-allowed     12/12  no AI or search crawlers blocked
  OK homepage-ok              6/6   homepage responds 200
  OK robots-wellformed        4/4   robots.txt parses cleanly

Answer-engine content
  OK content-without-js       6/6   static text present on all sampled pages
  !! content-lead-answer      2/5   no direct-answer lead on: /pricing (+2 more)
       fix: Open each page with a 1-2 sentence direct answer or a TL;DR block.
  !! content-freshness        2/5   missing/stale content date on: /about (+1 more)
       fix: Emit ISO-8601 datePublished+dateModified and a visible date.

On-page & content
  OK headings-outline         5/5   one H1 + no skipped levels
  XX meta-per-page            0/5   title/description out of range on: /pricing (+3 more)
       fix: Give every page a unique in-range title + meta description.

Performance & Core Web Vitals
  XX render-blocking-js       0/4   4 render-blocking head scripts on: /
       fix: Add defer/async or move scripts to the end of <body>.
  -- cwv-lcp                  0/6   run with --cwv --psi-key <key> to measure Core Web Vitals

Security & trust
  OK https                    5/5   served over HTTPS
  OK hsts                     4/4   HSTS max-age >= 180d

Score: 73/100  Grade: C
  AI crawler access               96/100  (weight 16%)
  Answer-engine content           72/100  (weight 18%)
  Structured data & metadata      79/100  (weight 15%)
  Technical SEO                   72/100  (weight 15%)
  On-page & content               53/100  (weight 12%)
  Performance & Core Web Vitals   44/100  (weight 10%)
  Accessibility                   71/100  (weight  7%)
  Security & trust                93/100  (weight  7%)
```

*(Illustrative excerpt — check lines are trimmed for length; a real run prints every applicable check in each family.)* The `--` rows are checks that don't apply to this run (here, Core Web Vitals were not requested) — skipped checks never count against the score.

More real-site case studies (before/after scores) will be published in `examples/` at launch.

## What it checks

**109 checks in 8 families.** Each family earns a subscore (`0–100`) from its own non-skipped checks; those subscores are combined with the weights below into the overall `/100` score and letter grade.

| Family | Weight | Checks | What it covers |
|---|---|---:|---|
| **AI crawler access** | 0.16 | 8 | robots.txt validity, AI + search crawler permissions (2026 roster, training vs citation-time bots), `noindex`/preview directives — the gate: if crawlers are blocked, nothing else matters |
| **Answer-engine content** | 0.18 | 12 | `llms.txt` / `llms-full.txt`, server-rendered text, content depth & freshness, direct-answer leads, question headings, author E-E-A-T, outbound citations, uniqueness |
| **Structured data & metadata** | 0.15 | 19 | JSON-LD validity & entity typing, Organization / LocalBusiness / Article / Product / FAQ / Breadcrumb / Video markup, `sameAs` grounding, Open Graph, Twitter Card |
| **Technical SEO** | 0.15 | 21 | canonical hygiene, sitemap discovery & validity, redirects (www/apex, trailing slash, chains), soft/custom 404, URL structure, hreflang, JS-independent crawlable navigation, IndexNow |
| **On-page & content** | 0.12 | 11 | title & meta description quality and uniqueness, heading outline, anchor text, charset, favicon, readability, figure captions |
| **Performance & Core Web Vitals** | 0.10 | 19 | always-on static perf heuristics (HTML weight, render-blocking JS/CSS, image dimensions, compression, caching) + opt-in field/lab Core Web Vitals |
| **Accessibility** | 0.07 | 9 | `html lang`, image alt coverage & quality, landmarks, form labels, link names, viewport & zoom, iframe titles |
| **Security & trust** | 0.07 | 9 | HTTPS end-to-end, HTTP→HTTPS 301, mixed content, HSTS, `X-Content-Type-Options`, CSP, clickjacking, referrer & permissions policy |

Every check is documented individually — what it verifies, why it matters, and how to fix a failure — in the [check guide](docs/guide.md) ([version française](docs/guide.fr.md)).

## Scoring

findable-audit uses a **weighted per-family model**:

1. **Per check** — `pass` earns full points, `warn` earns half, `fail` earns 0, `skip` is excluded entirely.
2. **Per family** — the subscore is `earned / max` over that family's **non-skipped** checks, expressed out of 100.
3. **Overall** — the family subscores are combined using the weights above (`round(100 × Σ weightᵢ·subᵢ / Σ weightᵢ)`). If a whole family has no applicable checks, it is dropped and its weight is redistributed proportionally over the rest.

**Skipped / inapplicable checks are never penalized.** A site with no Product pages isn't marked down for lacking Product markup; a single-language site isn't marked down for hreflang; a run without `--cwv` isn't marked down for the field Core Web Vitals it never measured. Only checks that actually apply shape the score.

**Letter grade:** `A` ≥ 90 · `B` ≥ 80 · `C` ≥ 70 · `D` ≥ 60 · `F` < 60.

## Flags

| Flag | Description |
|---|---|
| `--compare <url2,url3,...>` | Audit your URL against one or more competitors (comma-separated) and write a side-by-side scorecard — overall and per-family scores, with the families where you trail the leader. |
| `--baseline <file.json>` | Diff this run against a prior `--report *.json`: overall/per-family score deltas, plus which checks regressed, improved, appeared or disappeared. Shown in the terminal and added as a "Change vs baseline" section to the md/html reports. |
| `--fail-on-regression` | Exit `1` when the score drops below the baseline by more than `--regression-tolerance` points. Requires `--baseline`. The CI gate for "did this change hurt our findability?". |
| `--regression-tolerance <n>` | Points the score may drop below the baseline before `--fail-on-regression` trips (default `0`). |
| `--entity-graph <file>` | Write the JSON-LD entity graph across the sampled pages. Format by extension: `.json`, `.dot` (Graphviz), or `.mmd` (Mermaid). |
| `--json` | Output the full report as JSON (for scripts and CI). |
| `--report <file>`, `-r` | Write the report to the given file instead of the default files. Repeatable. Format is picked by extension: `.html`/`.htm` produces a self-contained, printable HTML report (open it and **Print to PDF**); any other extension produces Markdown. |
| `--no-report` | Write no report files at all — only print to stdout. Useful with `--json` or in CI when you just want the exit code / stdout output. |
| `--min-score <n>` | Score threshold for exit code 0 (default: `60`). Below it, exit code is 1. |
| `--timeout <ms>` | Per-request timeout in milliseconds (default: `10000`). |
| `--max-pages <n>` | Pages to sample: the homepage plus up to `n-1` same-origin pages discovered from the sitemap (falling back to homepage links). Default: `10`; `1` audits the homepage only. |
| `--user-agent <ua>` | Override the crawler User-Agent, e.g. `--user-agent "GPTBot/1.0"`, to see what an AI crawler that a site filters by UA would get. |
| `--indexnow-key <key>` | Enable the IndexNow key-file check for the given key. |
| `--cwv` | Opt into Core Web Vitals via one (slow, ~15–30s) PageSpeed Insights call. Without it, the field/lab CWV checks skip; static performance heuristics still run. |
| `--psi-key <key>` | Google PageSpeed Insights / CrUX API key (a [free Google API key](https://developers.google.com/speed/docs/insights/v5/get-started)). Recommended: the keyless endpoint is rate-limited and often returns HTTP 429. |
| `--psi-strategy <mobile\|desktop>` | PSI form factor for `--cwv` (default: `mobile`). |

### Report files

By default, every successful audit writes two files to the current directory: `<host>-<date>.md` and `<host>-<date>.html`. For example:

```bash
npx findable-audit https://your-site.com
# writes ./your-site.com-2026-07-20.md
# and    ./your-site.com-2026-07-20.html
```

`<host>` is the host actually audited, so if the URL redirects (e.g. `www.example.com` → `example.com`), the filenames use the final host. The HTML report is self-contained (no external assets — the findable-audit logomark is an inline SVG), **responsive** (mobile-first, adapts to any screen), and printable — open it in a browser and use **Print to PDF** to get a PDF.

Both the HTML and Markdown reports open with a one-line verdict summarizing the result, and — when run with `--cwv --psi-key <key>` — add a **Core Web Vitals dashboard** in its own distinct card: radial gauges (HTML) or a table (Markdown) for LCP/INP/CLS/TTFB, colored by threshold and split between field (CrUX) and lab (Lighthouse) data, plus a **plain-language explainer** of what each metric means and **targeted advice** for the ones that aren't in the "good" range (a discreet "not measured" note otherwise). When issues are found, the report also includes a **prioritized action plan** — recommended fixes grouped by severity and ordered by weighted impact (recoverable points × family weight); each item shows the raw recoverable points as a `+N pts` badge and a "Learn more" link. Reports are available in **English and French**.

Pass `--report <file>` to override the default and write exactly the file(s) named instead (repeatable, format by extension), or `--no-report` to write nothing.

Exit codes: `0` = score >= min-score, `1` = below, `2` = site unreachable / error (including a report file that cannot be written). This makes `findable-audit` usable as a CI gate:

```bash
npx findable-audit https://your-site.com --min-score 80 --no-report
```

Write both a Markdown and an HTML report to specific paths in one run:

```bash
npx findable-audit https://your-site.com --report audit.md --report audit.html
```

The `broken-internal-links` check ignores Cloudflare `/cdn-cgi/` endpoints (e.g. email protection) — they are infrastructure, not content pages.

## Core Web Vitals

The `performance` family always runs its static heuristics (HTML weight, render-blocking JS/CSS, image dimensions, text compression, caching headers, DOM size…) with no key and no network cost beyond the pages already fetched.

The field and lab Core Web Vitals — `cwv-lcp`, `cwv-cls`, `cwv-inp`, `cwv-ttfb`, `cwv-assessment`, `lighthouse-perf`, `lab-tbt`, `lab-fcp` — are **opt-in**:

```bash
npx findable-audit https://your-site.com --cwv --psi-key <your-google-api-key>
```

This makes a single PageSpeed Insights call (shared across all CWV checks) that returns **field data** (real-user p75 LCP / CLS / INP / TTFB from the Chrome UX Report) and **lab data** (a Lighthouse run). Without `--cwv`, or when no field data exists for a low-traffic URL, those checks `skip` rather than fail. A free Google API key is strongly recommended — the keyless endpoint is aggressively rate-limited.

## Web app

`apps/web` is a self-hostable, **SSRF-hardened** web UI: a tiny dependency-free Node HTTP server where a visitor enters a URL and gets the same audit back. A live "test in progress" screen streams progress, then the report loads with a **download bar at the top** (Markdown / HTML / JSON export + "audit another site") and a responsive, **bilingual (EN/FR)** layout with language-prefixed URLs (`/en`, `/fr`) and `hreflang`. It imports the CLI's built modules directly (no separate build, zero runtime npm dependencies) and is designed to sit on `127.0.0.1` behind nginx on a shared VPS. Try it live at **[findable.bordebat.fr](https://findable.bordebat.fr)**. See [`apps/web/README.md`](apps/web/README.md) for setup and the SSRF/abuse protections.

## GitHub Action & CI

Run findable-audit in CI, upload the findings to GitHub code-scanning as **SARIF**, and gate merges on a minimum score.

```yaml
# .github/workflows/findable-audit.yml
name: findable-audit
on: [workflow_dispatch]
permissions:
  security-events: write   # required to upload SARIF
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - id: findable
        uses: piwig/findable-audit@main
        with:
          url: https://your-site.com
          min-score: '80'        # fail the job below 80
          max-pages: '5'
      - if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: findable-audit.sarif
      - run: echo "Score ${{ steps.findable.outputs.score }} — grade ${{ steps.findable.outputs.grade }}"
```

### Regression gate (`--baseline`)

Beyond a fixed `--min-score` floor, you can fail CI when a change **lowers** your
score versus a committed baseline — catching a regression even while you are
still well above the floor:

```bash
# One-time: capture the baseline and commit it.
npx findable-audit https://your-site.com --report baseline.json --no-report

# In CI: re-audit and fail if the score drops by more than 2 points.
npx findable-audit https://your-site.com \
  --baseline baseline.json --fail-on-regression --regression-tolerance 2 --no-report
# exit 1 on regression; the terminal + md/html reports show the per-check diff.
```

Export the entity graph for inspection or diagrams:

```bash
npx findable-audit https://your-site.com --entity-graph graph.mmd  # or .dot / .json
```

The action exposes `score` and `grade` as step outputs, so you can drive a **score badge** from them (a shields.io endpoint, or a static badge in your README):

```markdown
![findable-audit](https://img.shields.io/badge/findable--audit-B-1a7f37)
```

You can also emit SARIF straight from the CLI: `findable-audit https://your-site.com --report audit.sarif`.

## Claude Code plugin

findable-audit ships as a Claude Code plugin with three skills:

```bash
# in Claude Code
/plugin install findable-audit
```

- **`geo-audit`** — runs `findable-audit` on a URL, interprets the JSON report and turns it into a prioritized fix plan, ordered by the points you are losing.
- **`geo-implement`** — implements the GEO / AI-visibility artifacts on a static site (Astro, Next, Hugo): generates `robots.txt`, `llms.txt`, `llms-full.txt`, JSON-LD, sitemap wiring and IndexNow, then verifies the result with `findable-audit`.
- **`fix-technical-seo`** — fixes the technical-SEO and on-page findings: canonical, meta robots (`noindex`), redirect hygiene, broken internal links, duplicate titles, heading outline, Open Graph, viewport and hreflang.

## Why GEO

A growing share of product and local-business discovery now happens inside AI assistants instead of a search results page. Those assistants rely on their own crawlers (GPTBot, ClaudeBot, PerplexityBot), on machine-readable content (`llms.txt`, server-rendered text) and on structured data (JSON-LD) to decide what to cite. A site can rank fine on Google and still be invisible to AI answers — because a robots.txt rule blocks AI crawlers, or the content only exists after JavaScript runs. GEO is the practice of making a site legible and citable for answer engines; `findable-audit` measures it the way Lighthouse measures performance.

## Contributing

Issues and pull requests are welcome. Run `npm ci`, `npm run build` and `npm test` before submitting.

## License

[MIT](LICENSE)
</content>
</invoke>
