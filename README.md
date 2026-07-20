# findable-audit

[![CI](https://github.com/piwig/findable-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/piwig/findable-audit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/findable-audit)](https://www.npmjs.com/package/findable-audit)

**SEO & GEO audit CLI: check how findable your site is by search engines and AI assistants.**

AI assistants are becoming a major way people discover websites, but most sites are only optimized for classic search engines. `findable-audit` audits a site for **GEO** (Generative Engine Optimization) and technical SEO in one command, scores it out of 100, and tells you exactly what to fix.

## Quick start

```bash
npx findable-audit https://your-site.com
```

Sample output (run against the project's own "perfect site" test fixture):

```text
findable-audit report for http://127.0.0.1:53339/

AI crawler access
  OK robots-exists          4/4  robots.txt found
  OK ai-crawlers-allowed    12/12  all AI crawlers allowed
  OK homepage-ok            6/6  homepage responds 200

Content for LLMs
  OK llms-txt               10/10  llms.txt found and structured
  OK llms-full-txt          4/4  llms-full.txt found
  OK content-without-js     6/6  homepage has 361 chars of static text

Structured data
  OK json-ld                10/10  1 valid JSON-LD block(s)
  OK json-ld-entity         6/6  relevant entity found: LocalBusiness
  OK sitemap                10/10  valid sitemap, referenced in robots.txt
  OK indexnow               4/4  IndexNow key file verified

SEO fundamentals
  OK title-description      8/8  title and meta description look good
  OK canonical              5/5  canonical set: https://example.com/
  OK open-graph             5/5  Open Graph tags present
  -- https                  0/5  local host — HTTPS check skipped
  OK viewport               5/5  mobile viewport set

Score: 100/100
```

More real-site case studies (before/after scores) will be published in `examples/` at launch.

## What it checks

Score /100, 15 checks in 4 families:

| Family | Checks |
|---|---|
| AI crawler access | robots.txt present; GPTBot, ClaudeBot, PerplexityBot, Google-Extended not blocked; homepage responds 200 without a JS wall |
| Content for LLMs | `llms.txt` present and structured; `llms-full.txt` present; main content readable without JavaScript |
| Structured data | JSON-LD present and parsable; relevant type (LocalBusiness / Organization / Article); NAP consistency; valid sitemap XML referenced in robots.txt; IndexNow key file |
| SEO fundamentals | title/meta description lengths; canonical; Open Graph tags; HTTPS; mobile viewport |

Each check is explained in detail — including how to fix failures — in the [check guide](docs/guide.md) ([version française](docs/guide.fr.md)).

## Flags

| Flag | Description |
|---|---|
| `--json` | Output the full report as JSON (for scripts and CI). |
| `--min-score <n>` | Score threshold for exit code 0 (default: `60`). Below it, exit code is 1. |
| `--timeout <ms>` | Per-request timeout in milliseconds (default: `10000`). |
| `--indexnow-key <key>` | Enable the IndexNow key-file check for the given key. |
| `--user-agent <ua>` | Override the crawler User-Agent, e.g. `--user-agent "GPTBot/1.0"`, to see what an AI crawler that a site filters by UA would get. |
| `--report <file>`, `-r` | Also write the report to the given file. Repeatable. Format is picked by extension: `.html`/`.htm` produces a self-contained, printable HTML report (open it and **Print to PDF**); any other extension produces Markdown. |

Exit codes: `0` = score >= min-score, `1` = below, `2` = site unreachable / error (including a report file that cannot be written). This makes `findable-audit` usable as a CI gate:

```bash
npx findable-audit https://your-site.com --min-score 80
```

Write both a Markdown and an HTML report in one run:

```bash
npx findable-audit https://your-site.com --report audit.md --report audit.html
```

The `broken-internal-links` check ignores Cloudflare `/cdn-cgi/` endpoints (e.g. email protection) — they are infrastructure, not content pages.

## Claude Code plugin

findable-audit ships as a Claude Code plugin with two skills:

```bash
# in Claude Code
/plugin install findable-audit
```

- **`geo-audit`** — runs `findable-audit` on a URL, interprets the JSON report and turns it into a prioritized fix plan, ordered by the points you are losing.
- **`geo-implement`** — implements GEO + SEO on a static site (Astro, Next, Hugo): generates `robots.txt`, `llms.txt`, `llms-full.txt`, JSON-LD, sitemap wiring and IndexNow, then verifies the result with `findable-audit`.

## Why GEO

A growing share of product and local-business discovery now happens inside AI assistants instead of a search results page. Those assistants rely on their own crawlers (GPTBot, ClaudeBot, PerplexityBot), on machine-readable content (`llms.txt`, server-rendered text) and on structured data (JSON-LD) to decide what to cite. A site can rank fine on Google and still be invisible to AI answers — because a robots.txt rule blocks AI crawlers, or the content only exists after JavaScript runs. GEO is the practice of making a site legible and citable for answer engines; `findable-audit` measures it the way Lighthouse measures performance.

## Contributing

Issues and pull requests are welcome. Run `npm ci`, `npm run build` and `npm test` before submitting.

## License

[MIT](LICENSE)
