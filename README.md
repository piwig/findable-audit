# findable-audit

**Your site can rank first on Google and still be invisible inside ChatGPT.** One command tells you which, and why.

[![CI](https://github.com/piwig/findable-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/piwig/findable-audit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/findable-audit)](https://www.npmjs.com/package/findable-audit)
[![Try it live](https://img.shields.io/badge/Try%20it%20live-findable-1a7f37)](https://findable.bordebat.fr)
[![findable score: A 99/100](docs/badge.svg)](https://findable.bordebat.fr/en/example-report/)

A robots.txt line, a page that only exists after JavaScript runs, a missing JSON-LD entity — any of these keeps you out of AI answers while your search ranking looks fine. `findable-audit` runs **146 checks** in one deterministic crawl and returns a weighted **A–F grade** across SEO, GEO, Core Web Vitals, accessibility and security, with the fixes ordered by what they are worth.

No account. No telemetry. Nothing sent to a third party.

## Run it

```bash
npx findable-audit https://your-site.com
```

That is the whole setup — Node ≥ 20.3, no configuration, no key. Prefer a browser? **[findable.bordebat.fr](https://findable.bordebat.fr)** runs the same engine.

## What you get back

```text
findable-audit report for https://stripe.com/

AI crawler access
  OK ai-crawlers-allowed     12/12  no AI or search crawlers blocked
  OK robots-wellformed        4/4   robots.txt parses cleanly

Answer-engine content
  OK content-without-js       6/6   static text present on all sampled pages
  !! content-lead-answer      2/5   no direct-answer lead on: /pricing (+2 more)
       fix: Open each page with a 1-2 sentence direct answer or a TL;DR block.

On-page & content
  XX meta-per-page            0/5   title/description out of range on: /pricing (+3 more)
       fix: Give every page a unique in-range title + meta description.

Performance & Core Web Vitals
  XX render-blocking-js       0/4   4 render-blocking head scripts on: /
       fix: Add defer/async or move scripts to the end of <body>.
  -- cwv-lcp                  0/6   run with --cwv --psi-key <key> to measure Core Web Vitals

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

*Excerpt from a real run (`stripe.com --max-pages 6`); a full run prints every applicable check.* `--` rows are checks that did not apply — **skipped checks never count against the score**.

Every audit also writes a self-contained **HTML report** and a Markdown one. See a real one, this project auditing itself: **[example report](https://findable.bordebat.fr/en/example-report/)**. We never publish audits of sites we do not own.

## Why this one

**Blocking a citation fetcher is a failure. Opting out of model training is a warning.**
28 named AI agents, tiered by *intention* — because who you block decides what you lose. A flat "N bots blocked" count treats a deliberate policy choice exactly like an outage.

**Every verdict says what it rests on.**
109 checks grade against an RFC, WCAG, schema.org or a threshold Google publishes. 37 are heuristics — a ratio, a lexicon, a bar we chose. The reports badge them, so you never mistake our taste for a specification.

**Five disciplines, one crawl, one grade.**
SEO, GEO, Core Web Vitals, accessibility and security in a single weighted A–F — not five tools and five dashboards you have to reconcile yourself.

**It stays on your side of the wire.**
Three small pure-JS dependencies, no headless browser, no LLM SDK, no key for the core audit. Two opt-in flags are the only things that ever fetch anything off your origin, and the CLI names them.

## What it checks

**146 checks in 8 families.** Each family scores `0–100` over its own non-skipped checks; the eight are then blended with the weights below.

| Family | Weight | Checks | What it covers |
|---|---|---:|---|
| **AI crawler access** | 0.16 | 9 | robots.txt validity, AI + search crawler permissions (2026 roster, training vs citation-time bots), `noindex`/preview directives, AI-vs-browser serving parity (cloaking / edge bot-blocking) — the gate: if crawlers are blocked, nothing else matters |
| **Answer-engine content** | 0.18 | 22 | `llms.txt` / `llms-full.txt`, server-rendered text, CSR/SPA content parity, content depth & freshness, direct-answer leads, question headings, author E-E-A-T, outbound citations, uniqueness, `/.well-known/ai.json`, syndication feed, plus **GEO-advanced** heuristics — freshness-signal coherence, lead hedging, liftable answer units, retrieval chunk-boundary hygiene, a **RAG-twin chunk simulation** (do ~512-token retrieval windows still stand alone?) and **ingestion hygiene** (hidden model instructions, unattributed UGC links) |
| **Structured data & metadata** | 0.15 | 23 | JSON-LD validity & entity typing, Organization / LocalBusiness / Article / Product / FAQ / Breadcrumb / Video markup, Google rich-result eligibility, page-level `about`/`mentions`, `sameAs` grounding, Open Graph, Twitter Card |
| **Technical SEO** | 0.15 | 29 | canonical hygiene, sitemap discovery & validity, redirects (www/apex, trailing slash, chains), soft/custom 404, URL structure, hreflang, JS-independent crawlable navigation, internal link-equity distribution and leaks, outbound link health, IndexNow |
| **On-page & content** | 0.12 | 14 | title & meta description quality and uniqueness, topical focus, keyword cannibalization, heading outline, anchor-to-target profile, charset, favicon, readability, figure captions |
| **Performance & Core Web Vitals** | 0.10 | 21 | always-on static perf heuristics (HTML weight, render-blocking JS/CSS, image dimensions, compression, caching), negotiated HTTP protocol and CDN edge-cache fingerprint, plus opt-in field/lab Core Web Vitals |
| **Accessibility** | 0.07 | 9 | `html lang`, image alt coverage & quality, landmarks, form labels, link names, viewport & zoom, iframe titles |
| **Security & trust** | 0.07 | 11 | HTTPS end-to-end, HTTP→HTTPS 301, negotiated TLS version, mixed content, HSTS, `X-Content-Type-Options`, CSP, clickjacking, referrer & permissions policy, `/.well-known/security.txt` (RFC 9116) |

Every check is documented individually — what it verifies, why it matters, how to fix it — in the **[check guide](docs/guide.md)** ([version française](docs/guide.fr.md)).

### Measured, or a bar we chose

Every check declares what its verdict rests on, and the reports say which. **104 are *measured*** — they grade against something outside this project, so two people reading the same response agree. **35 are *heuristic*** — a word count, a lexicon, a ratio, a notion of "reads like a direct answer". Reasonable people can disagree with those, and the verified research says their effectiveness varies by site, so the HTML and Markdown reports badge them and the JSON carries `evidence` on every result.

The two axes are independent: `security-txt` only ever warns and is measured; `content-lead-answer` is a judgement call whatever it reports. An auditor that blurs the distinction is asking you to trust its taste as if it were a specification.

### The exact bot roster

The AI-access checks test robots.txt (and serving parity) against a **named roster of 29 AI agents plus the mainstream search crawlers**, defined in [`packages/cli/src/robots.ts`](packages/cli/src/robots.ts). The tier drives the severity of a finding:

| Tier | Agents | Blocking one means | Severity |
|---|---|---|---|
| **Citation-time fetchers** (13) | OAI-SearchBot, ChatGPT-User, Perplexity-User, Claude-User, Claude-SearchBot, PerplexityBot, DuckAssistBot, MistralAI-User, Meta-ExternalFetcher, YouBot, iAskBot, LinerBot, Google-CloudVertexBot | the assistant cannot fetch your page while composing an answer — you disappear from live AI answers | **fail** |
| **Training-time crawlers** (15) | GPTBot, Google-Extended, ClaudeBot, anthropic-ai, CCBot, Applebot-Extended, Amazonbot, Bytespider, PanguBot, cohere-ai, cohere-training-data-crawler, meta-externalagent, Diffbot, Timpibot, omgilibot | future models learn less about your site — a legitimate policy choice, not a findability break | **warn** |
| **Search crawlers** (2 + wildcard) | Googlebot, Bingbot, `*` | you are removed from classic search, which most AI answers still lean on | **fail** (its own check) |

One nuance worth knowing (per Perplexity's docs): PerplexityBot is the *index-time* crawler — it respects robots.txt and doesn't feed training — while Perplexity-User is the *query-time* fetcher fired by a user's question, which generally ignores robots.txt. Blocking `-User` agents in robots.txt is mostly declarative; blocking the index crawlers is what reliably changes answer-engine visibility.

## Scoring

1. **Per check** — `pass` earns full points, `warn` half, `fail` zero, `skip` is excluded entirely.
2. **Per family** — subscore is `earned / max` over that family's **non-skipped** checks, out of 100.
3. **Overall** — the subscores are blended with the weights above (`round(100 × Σ weightᵢ·subᵢ / Σ weightᵢ)`). A family with no applicable checks is dropped and its weight redistributed.

**Inapplicable checks are never penalized.** No Product pages? Not marked down for Product markup. Single-language site? Not marked down for hreflang. No `--cwv`? Not marked down for field vitals never measured.

**Grade:** `A` ≥ 90 · `B` ≥ 80 · `C` ≥ 70 · `D` ≥ 60 · `F` < 60.

### What a normal score looks like

Across a 12-site sweep — static-site generators, framework documentation, a news site, an e-commerce store, a public-sector site and a minimal-HTML forum — scores land between **63 and 85, median 69**: one B, four C, seven D, and **no A**. Sites with dedicated accessibility and platform teams sit in the high 70s and 80s.

So a 69 is not a broken site. GEO adoption is genuinely early and the scale is demanding. Treat the grade as a ladder rather than a verdict: **the number that matters is the delta between two runs of your own site**, which is exactly what `--baseline` measures.

<details>
<summary>That sweep also found two things wrong with <em>this tool</em>, and we fixed them</summary>

Running against real sites is how the calibration gets tested, so here is what the first pass turned up and what changed in `0.10.0`:

- **`llms.txt` was the heaviest check in the tool** — 10 points, labelled *measured*, failing 10 of the 12 sites — for a convention this project's own guide calls a *signal of unproven value* (large studies find no measurable citation gain, adoption is ~3%, Google states it has no ranking impact). Calling that *measured* claimed the bar came from outside this project. It is now **heuristic, 3 points, warn at worst**.
- **"No JSON-LD at all" was counted four times**: `json-ld`, `json-ld-valid`, `json-ld-entity` and `sd-organization` all failed on the same missing thing, 24 of 88 points in one family. The three derived checks now **skip** when there is no JSON-LD to inspect — `json-ld` alone owns that verdict.

The effect was not grade inflation: the median moved 67 → 69, and no site gained more than 6 points. What dropped sharply was the number of **failures** — from 9 to 4 on the strongest site in the sample — because verdicts the tool could not justify are gone.

</details>

## Reports

Every successful audit writes `<host>-<date>.md` and `<host>-<date>.html` to the current directory. The HTML report is self-contained, responsive, printable (**Print to PDF**), available in **English and French**, and contains **no JavaScript at all** — every disclosure is a native `<details>`, so it stays servable under `script-src 'none'`.

It is built in **three layers, one screen each**, on the principle that a report is an argument and not a database dump:

1. **The verdict** — one score visual, the grade, and a plain-language sentence on what an assistant can and cannot do with the site (rule-based and deterministic, never generated prose). The eight families regroup into three axes a reader understands without a glossary: **Reachable**, **Understood**, **Usable**.
2. **The plan** — fixes grouped into **effort lanes** (quick wins / moderate / bigger projects), because a reader arbitrates on effort, not on family. Each lane carries a **real score projection** ("the 6 quick wins: 76 → 88 (B)"), recomputed with the same weighted formula as the score itself, names the **pages concerned**, and opens a "how to do it" disclosure with a ready-to-paste snippet where the fix is literally configuration or markup.
3. **The detail** — every check, family by family. The human title leads, the technical id is a small tag beside it, and passing checks fold away.

```bash
npx findable-audit https://your-site.com --report audit.md --report audit.html
```

Format is chosen by extension: `.html`, `.json`, `.sarif` (GitHub code-scanning), `.xml` (JUnit), `.svg` (score badge), anything else Markdown. `--no-report` writes nothing.

**Exit codes:** `0` = score ≥ `--min-score`, `1` = below, `2` = unreachable or error.

## Flags

| Flag | What it does |
|---|---|
| `--max-pages <n>` | Pages to sample (default `10`, `1` = homepage only). Depth is an intention: 1 fast check · 5–10 template audit · 25–50 site audit. |
| `--min-score <n>` | Exit `1` below this score (default `60`) — the CI floor. |
| `--baseline <f.json>` + `--fail-on-regression` | Fail when the score drops versus a committed baseline, even while above the floor. |
| `--compare <url2,url3>` | Side-by-side scorecard against competitors, overall and per family. |
| `--history <f.json>` | Append this run (date + overall and per-family scores, never full results) to a small committable JSON series; with 2+ runs the HTML report opens with sparklines — the score's direction over time. |
| `--answers <file>` | The **answer matrix**: the questions your own declarations imply, and whether a crawled page answers each one *and stands on its own* when a model is handed it in isolation. |
| `--summary <file>` | The one-screen version for whoever decides: score, verdict, three axes, the three highest-gain fixes and what they are worth together. |
| `--emit <dir>` | Generate ready-to-deploy `robots.txt`, `llms.txt`, `llms-full.txt`, `.well-known/ai.json`, `sitemap.xml`, JSON-LD stubs. |
| `--cwv` `--psi-key <key>` | Opt into Core Web Vitals via one PageSpeed Insights call. |
| `--lang <en\|fr>` | Report language. Terminal, JSON, SARIF, JUnit and the badge stay English. |

<details>
<summary><strong>All the other flags</strong></summary>

| Flag | What it does |
|---|---|
| `--regression-tolerance <n>` | Points the score may drop before `--fail-on-regression` trips (default `0`). |
| `--entity-graph <file>` | Export the JSON-LD entity graph: `.json`, `.dot` (Graphviz) or `.mmd` (Mermaid). The HTML report already draws it grouped by type; this exports it entity by entity, uncapped. |
| `--verify-profiles` | Fetch the profiles your JSON-LD declares in `sameAs` and check each links back — the return link is what turns a claim into a verified identity. At most 8 URLs, same SSRF guard. Never hunts for a presence you did not declare; a platform that refuses robots is *unverifiable*, never held against you. |
| `--check-outbound` | Probe the outbound links in your main content. 10 URLs max, one per host, same SSRF guard. Only `404`/`410` count as broken — `401`, `403`, `429`, `5xx`, timeouts and DNS failures are *unverifiable*, never dead. |
| `--submit` | Notify IndexNow (Bing, Yandex, Seznam, Naver — Google does not participate). Requires `--indexnow-key`, and sends nothing until `/<key>.txt` on your site proves you own it. |
| `--indexnow-key <key>` | Enable the IndexNow key-file check for the given key. |
| `--json` | Full report as JSON, for scripts and CI. |
| `--report <file>`, `-r` | Write exactly the named file(s). Repeatable, format by extension. |
| `--no-report` | Write no report files — stdout only. |
| `--timeout <ms>` | Per-request timeout (default `10000`). |
| `--user-agent <ua>` | Override the crawler UA, e.g. `"GPTBot/1.0"`, to see what a UA-filtered crawler gets. |
| `--psi-strategy <mobile\|desktop>` | PSI form factor for `--cwv` (default `mobile`). |
| `--experimental-agent-standards` | Probe emerging agent manifests (`agents.json` / UCP discovery). Same-origin only, informational, never scored. |
| `--quiet`, `-q` | Silence the informational notes on stderr ("auditing…", "report written to…"). The result on stdout and real errors still print. |
| `--no-color` | Strip ANSI colors from the terminal output (pagers, logs, CI). The `NO_COLOR` env var is honored too. |
| `--out <dir>` | Where `findable generate llms-txt` writes its files (default `.`). |

</details>

### Core Web Vitals

The `performance` family always runs its static heuristics with no key and no extra network cost. The field and lab vitals are **opt-in**:

```bash
npx findable-audit https://your-site.com --cwv --psi-key <your-google-api-key>
```

One PageSpeed Insights call, shared by all CWV checks, returning **field data** (real-user p75 from the Chrome UX Report) and **lab data** (Lighthouse). Without `--cwv`, or when a low-traffic URL has no field data, those checks `skip` rather than fail. A [free Google API key](https://developers.google.com/speed/docs/insights/v5/get-started) is strongly recommended — the keyless endpoint is aggressively rate-limited. The report renders a dedicated dashboard: gauges for LCP/INP/CLS/TTFB, colored by threshold, split field vs lab, with a plain-language explainer and targeted advice for anything outside "good".

### Generated indexing files (`--emit`)

```bash
npx findable-audit https://your-site.com --emit ./out
```

### `findable generate llms-txt`

```bash
npx findable-audit generate llms-txt https://your-site.com --out ./out
```

The remediation-only path: crawls your site (same sampler, same SSRF guard, `--max-pages`/`--timeout`/`--user-agent`/`--lang` all apply) and writes `llms.txt` + `llms-full.txt` built from your **real pages** — titles, meta descriptions, headings — with no audit, no score and no report. Drafts, not a finished product: review and complete them before deploying.

⚠️ **These are generic starting points, not a finished product — review every one before deploying, especially `robots.txt`.** The generated `robots.txt` allows every AI crawler by default with a commented-out `Disallow: /` under each, so opting a bot out is a deliberate, visible edit rather than an accident. `jsonld-stubs.json` only stubs the schema.org types missing from your existing entity graph, and is meant to be merged into your real JSON-LD. `GENERATED-README.md` explains where each file belongs. The same six files are downloadable from the web app's result page, regenerated on demand — nothing is written to disk server-side.

## CI

Gate merges on a score, upload findings to GitHub code-scanning as SARIF:

```yaml
# .github/workflows/findable-audit.yml
permissions:
  security-events: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - id: findable
        uses: piwig/findable-audit@main
        with:
          url: https://your-site.com
          min-score: '80'
          max-pages: '5'
      - if: always()
        uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: findable-audit.sarif }
      - run: echo "Score ${{ steps.findable.outputs.score }} — grade ${{ steps.findable.outputs.grade }}"
```

The action's inputs mirror the CLI gates: `baseline`, `fail-on-regression`, `regression-tolerance`, extra `report` files (extension picks the format) and `lang`. It exposes `score` and `grade` as step outputs. By default (`version: 'local'`) it builds from its own checkout; pin a published version instead with `version: '0.9.0'`. A complete example lives in [`.github/workflows/findable-gate.yml`](.github/workflows/findable-gate.yml).

### Regression gate

Fail CI when a change **lowers** your score, even while you are still above the floor:

```bash
# Once: capture the baseline and commit it.
npx findable-audit https://your-site.com --report baseline.json --no-report

# In CI: fail if the score drops by more than 2 points.
npx findable-audit https://your-site.com \
  --baseline baseline.json --fail-on-regression --regression-tolerance 2 --no-report
```

### Score badge

`--report <file>.svg` writes the same two-segment pill you see at the top of this README — itself the output of a real audit of findable.bordebat.fr.

```bash
npx findable-audit https://your-site.com --report docs/badge.svg --no-report
```

Self-contained: no script, no external reference, no third-party badge service, so it works in a private repo and behind a firewall and cannot silently change under you. Its `<title>` carries the audited host and date, so a badge committed months ago says how old it is instead of implying freshness.

## Self-hosted web app

`apps/web` is the same engine behind a **dependency-free**, SSRF-hardened Node HTTP server — a visitor enters a URL and gets the audit back. Live at **[findable.bordebat.fr](https://findable.bordebat.fr)**.

- **Streams progress** on a live "test in progress" screen, then loads the report with a download bar (Markdown / HTML / JSON) at the top.
- **Generates the indexing files** on demand from the in-memory report — nothing written to disk server-side.
- **Bilingual** (EN/FR) with language-prefixed URLs and `hreflang`, responsive, dark-theme aware.
- **Dogfoods its own audit**: connected JSON-LD graph, sitemap with real `lastmod`, `llms.txt` plus a ≥2000-word `llms-full.txt` built from the live check catalogue, OG image generated without an image library, single-hop 301s.
- **Optional Cloudflare Turnstile**, off by default and fully env-gated: set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to turn it on; leave either unset and the form, CSP and audit flow stay byte-identical. Verified server-side before an audit job is created; the secret only ever goes to Cloudflare.

Setup and the full SSRF/abuse protections: [`apps/web/README.md`](apps/web/README.md).

## Claude Code plugin

This repository is its own plugin marketplace, so installing takes two commands:

```bash
/plugin marketplace add piwig/findable-audit
/plugin install findable-audit@findable-audit
```

- **`geo-audit`** — runs the audit and turns the JSON into a prioritized fix plan, ordered by the points you are losing.
- **`geo-implement`** — implements the GEO artifacts on a static site (Astro, Next, Hugo), then verifies the result.
- **`fix-technical-seo`** — fixes the technical-SEO and on-page findings: canonical, `noindex`, redirect hygiene, broken links, duplicate titles, heading outline, Open Graph, viewport, hreflang.

**Why this matters, in numbers.** 68% of Google searches now end with no click (SparkToro, 2026 clickstream data, Jan–Apr sample) — the answer is consumed where it's generated, not on the linked page. The answer engines behind that shift already run at a scale that makes "invisible to AI crawlers" a real cost, not a hypothetical one: ChatGPT ~900M weekly active users, Gemini 750M+ monthly active users, AI Overviews serving 2B+ answers/month (2026 figures). This is the audience `findable-audit` measures readability and citability for.

## How it compares (honestly)

Almost every individual check here exists somewhere else. What no free, OSS, self-hostable tool offered as of mid-2026 is the *combination*: one deterministic crawl producing one weighted A–F across SEO + GEO + Core Web Vitals + accessibility + security, with no account and no data sent to a third party.

| Tool | AI/GEO layer | CWV | a11y | Security | Unified grade | Keyless |
|---|---|---|---|---|---|---|
| **findable-audit** | ✅ bots tiered by intention, `llms.txt`, SSR/CSR parity, JSON-LD entities | ✅ field CrUX + lab (one PSI call) | ✅ | ✅ headers | ✅ weighted A–F | ✅ (PSI key optional) |
| geo-optimizer-skill (Python) | ✅ 27 bots / 3 tiers, llms.txt, prompt-injection & RAG-chunk checks, `geo fix --apply` auto-fix | ❌ | ❌ | ❌ | 0–100 (GEO only) | ⚠️ citation feature needs a key |
| SEOmator (`@seomator/seo-audit`) | ✅ GPTBot/ClaudeBot, llms.txt, raw-vs-rendered DOM — no citation/training tiering, no PerplexityBot | ⚠️ lab only (Playwright) | ✅ | ✅ | ✅ (251 rules) | ✅ |
| seo-geo-audit (lireking) | ✅ core signals | ✅ (Playwright) | ❌ | ❌ | ❌ | PSI/GSC need key/OAuth |
| sitespeed.io / Lighthouse / Unlighthouse | ❌ no GEO layer | ✅ (real browser) | ✅ | ⚠️/✅ | — | ✅ |
| axe-core / pa11y | ❌ | ❌ | ✅ | ❌ | — | ✅ |
| Monitoring SaaS (Profound, Peec, Otterly, Semrush One — folded its AI Visibility Toolkit in mid-2026) | tracks how AI answers cite you — the *opposite*, output-side job | — | — | — | — | ❌ paid |

**Technical audit vs. visibility monitoring — not the same job.** findable-audit answers "is this site *readable and citable* by AI crawlers right now" from a single deterministic crawl of your own code and config — no account, nothing tracked over time. A monitoring tool answers "*is* this site actually being cited" by repeatedly polling live AI answers for brand mentions — that requires an account, a schedule, and a query list, and it says nothing about *why* a site is or isn't cited. Run the audit first to fix the input side; add a monitor once you want to track the output side over time.

**Structured-data coverage, in numbers.** Comparator sites in this space (e.g. score-geo.fr) list Schema.org type coverage as a decision criterion — 12 types for the best-rated tool there, 4–6 for others (Semrush, Ahrefs, Sistrix, Ubersuggest). The `structured-data` family here recognizes **~29 distinct types** (Article/BlogPosting/NewsArticle/TechArticle, FAQPage/QAPage, HowTo/Recipe/Event, Product/Offer, LocalBusiness and its retail/food subtypes, Organization and its subtypes, Person, WebSite/SearchAction, BreadcrumbList/ListItem, VideoObject).

**Verified, not just declared, E-E-A-T signals.** Most 2026 GEO/E-E-A-T checklists (e.g. unfoldmart.com, which names LinkedIn as "the strongest author-authority signal in 2026") stop at confirming a `Person` schema and `sameAs` links exist. The `sameas-verified` check here goes further: it fetches the linked profile and confirms the link is **reciprocal** (the external profile actually points back to the site), not just declaratively present — the same rigor `content-author-eeat` applies to author bylines.

**How deep, compared to a general SEO audit.** Public SEO audit checklists show how the industry weighs the GEO/AI topic today: the Yvarn audit grid (47 criteria, CC-BY-NC, 2026 Q2) added "AI and LLM visibility" as a 7th category in 2026 — 4 criteria out of 47, roughly 5–10% of the score. findable-audit dedicates a whole family to it: `llm-content`, 21 checks, 18% of the weighted score. General SEO checklists are starting to notice AI visibility; here it's a first-class axis, not an addendum.

**Where alternatives beat us today:**

- **Live answer/citation monitoring** (share of voice, brand mentions) — deliberately out of scope. Pair findable-audit (input side) with a monitor (output side) if you need it.
- **Confirming real bot traffic from server logs** (Screaming Frog LFA, Profound) — we *predict* access from code and config; we do not confirm a visit happened.
- **CWV in a local real browser** (sitespeed.io, SEOmator) — we depend on the PSI API, whose keyless endpoint is aggressively rate-limited.
- **Raw rule count** — SEOmator advertises 251 rules to our 146 checks.
- **One-shot auto-remediation** — geo-optimizer's `geo fix --apply` rewrites files in place; our `--emit` writes generic starter files for you to review and merge.
- **Ecosystem & adoption** — geo-optimizer and the SaaS vendors have far more traction than we do today.

## Why GEO

A growing share of product and local-business discovery now happens inside AI assistants instead of on a results page. Those assistants rely on their own crawlers (GPTBot, ClaudeBot, PerplexityBot), on machine-readable content (server-rendered text and, for the engines that read it, `llms.txt`) and on structured data to decide what to cite. A site can rank fine on Google and still be invisible to AI answers — because a robots.txt rule blocks AI crawlers, or the content only exists after JavaScript runs. GEO is the practice of making a site legible and citable for answer engines; `findable-audit` measures it the way Lighthouse measures performance.

## Install from source

```bash
git clone https://github.com/piwig/findable-audit && cd findable-audit
npm ci && npm run build
node packages/cli/dist/index.js https://your-site.com   # CLI
node apps/web/server.mjs                                 # web app on 127.0.0.1:3021
```

For a permanent CLI without cloning: `npm install -g findable-audit`.

## Project

Changes are in [CHANGELOG.md](CHANGELOG.md); releases are published to npm from CI over OIDC trusted publishing, with provenance attached.

Issues and pull requests are welcome — [CONTRIBUTING.md](CONTRIBUTING.md) covers how to run the suites, the non-negotiables (no new runtime dependency, cross-platform, never `process.exit`) and the procedure for proposing a check, including which verdicts a check is allowed to hand out. Security reports: [SECURITY.md](SECURITY.md).

## License

MIT.

Built and maintained by [PB OpenTech](https://pb-ot.fr), which builds open-source software
and AI integration for small businesses in Brittany.
