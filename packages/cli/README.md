# findable-audit

SEO & GEO audit CLI: check how findable your site is by search engines **and AI
assistants** — 120 checks across 8 families (AI crawler access, answer-engine
content, structured data, technical SEO, on-page, performance & Core Web Vitals,
accessibility, security & trust).

```bash
npx findable-audit https://your-site.com
```

Prints a scored terminal report (`/100` + letter grade, per-family subscores) and
writes a Markdown + self-contained HTML report next to it. Exit codes make it a CI
gate: `0` = score ≥ `--min-score`, `1` = below (or regression), `2` = unreachable/error.

## Install

```bash
npm install -g findable-audit
findable https://your-site.com        # global bin: `findable`
```

Node ≥ 20.3, zero configuration. The crawler stays polite: same-origin only,
`--max-pages` cap (default 10), one PageSpeed call only when you opt in with `--cwv`.

## Key flags

| Flag | What it does |
|---|---|
| `--report <file>` (repeatable) | Write exactly the named report file(s); format by extension: `.html`/`.htm`, `.json`, `.sarif` (GitHub code-scanning), `.xml` (JUnit — GitLab CI / Jenkins), `.svg` (status badge for a README), anything else Markdown. |
| `--no-report` | Terminal output only. |
| `--min-score <n>` | Exit `1` below this score — the CI floor. |
| `--baseline <audit.json>` + `--fail-on-regression` [`--regression-tolerance <n>`] | Diff against a prior `--report *.json` and exit `1` when the score drops — the CI regression gate. |
| `--compare <url2,url3>` | Side-by-side scorecard against competitors. |
| `--emit <dir>` | Generate ready-to-deploy `robots.txt`, `llms.txt`, `llms-full.txt`, `.well-known/ai.json`, `sitemap.xml`, JSON-LD stubs (review before deploying). |
| `--cwv` [`--psi-key <key>`] | Opt into Core Web Vitals via PageSpeed Insights. |
| `--lang <en\|fr>` | Report chrome language. |

## CI in one snippet

GitHub Actions (composite action from the same repo — SARIF to code-scanning,
`score`/`grade` step outputs):

```yaml
- uses: piwig/findable-audit@main
  with:
    url: https://your-site.com
    min-score: '80'
```

GitLab CI (JUnit in the tests tab):

```yaml
findable:
  image: node:22
  script:
    - npx -y findable-audit https://your-site.com --report findable.junit.xml --min-score 80
  artifacts:
    when: always
    reports:
      junit: findable.junit.xml
```

## Docs

Full documentation — check guide (what each of the 120 checks measures and how to
fix it), bot roster, scoring model, web UI, Claude Code plugin:
<https://github.com/piwig/findable-audit#readme>

MIT © piwig
