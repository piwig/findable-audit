# findable-audit

[![npm](https://img.shields.io/npm/v/findable-audit)](https://www.npmjs.com/package/findable-audit)
[![CI](https://github.com/piwig/findable-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/piwig/findable-audit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/findable-audit)](https://github.com/piwig/findable-audit/blob/main/LICENSE)

**SEO & GEO audit CLI: is your site findable by search engines *and* by AI assistants?**
143 checks across 8 weighted families — AI crawler access, answer-engine content,
structured data, technical SEO, on-page, performance & Core Web Vitals, accessibility,
security & trust — scored `/100` with an A–F grade and a prioritized fix list.

```bash
npx findable-audit https://your-site.com
```

Try it without installing anything: **<https://findable.bordebat.fr>** ·
[example report](https://findable.bordebat.fr/en/example-report/)

```text
AI crawler access
  OK ai-crawlers-allowed     12/12  no AI or search crawlers blocked
Answer-engine content
  !! content-lead-answer      2/5   no direct-answer lead on: /pricing (+2 more)
       fix: Open each page with a 1-2 sentence direct answer or a TL;DR block.
On-page & content
  XX meta-per-page            0/5   title/description out of range on: /pricing (+3 more)
       fix: Give every page a unique in-range title + meta description.

Score: 73/100  Grade: C
  AI crawler access               96/100  (weight 16%)
  Answer-engine content           72/100  (weight 18%)
  …
```

It also writes a Markdown report and a self-contained, printable HTML report next to it.
Exit codes make it a CI gate: `0` = score ≥ `--min-score`, `1` = below (or a regression
against a baseline), `2` = unreachable.

## Why this one

- **AI crawlers are first-class.** 28 named agents, tiered *by intention*: blocking a
  citation-time fetcher (Perplexity-User, OAI-SearchBot, Claude-User…) **fails**, because
  you vanish from live AI answers; blocking a training crawler only **warns**, because
  that is a legitimate policy choice. Most tools grep for "GPTBot" and stop there.
- **Nothing leaves your machine.** No account, no API key (Core Web Vitals are opt-in),
  no telemetry. Self-hostable web UI included.
- **Reproducible, not vibes.** Fixed weights summing to 1.0, checks that *skip* when they
  do not apply instead of penalizing you, and a test fixture that must score exactly 100.
- **CI-native.** SARIF for GitHub code-scanning, JUnit for GitLab/Jenkins, a regression
  gate against a committed baseline, and an SVG score badge for your README.

## Install

```bash
npm install -g findable-audit
findable https://your-site.com        # global bin: `findable`
```

Node ≥ 20.3, zero configuration. The crawler stays polite: same-origin only, a
`--max-pages` cap (default 10), and one PageSpeed call only when you ask for `--cwv`.

## Key flags

| Flag | What it does |
|---|---|
| `--report <file>` (repeatable) | Write exactly the named file(s); format by extension: `.html`, `.json`, `.sarif` (GitHub code-scanning), `.xml` (JUnit), `.svg` (README score badge), anything else Markdown. |
| `--no-report` | Terminal output only. |
| `--min-score <n>` | Exit `1` below this score — the CI floor. |
| `--baseline <audit.json>` + `--fail-on-regression` | Diff against a prior `--report *.json` and exit `1` when the score drops. |
| `--compare <url2,url3>` | Side-by-side scorecard against competitors. |
| `--emit <dir>` | Generate ready-to-deploy `robots.txt`, `llms.txt`, `llms-full.txt`, `.well-known/ai.json`, `sitemap.xml`, JSON-LD stubs (review before deploying). |
| `--submit` + `--indexnow-key <key>` | Notify IndexNow (Bing, Yandex, Seznam, Naver) of the audited URLs. Opt-in, and only once the key file on your site proves you own it. |
| `--entity-graph <file>` | Export the JSON-LD entity graph (`.json` / `.dot` / `.mmd`). |
| `--answers <file>` | The **answer matrix**: the questions your own declarations imply, and whether a crawled page holds a passage that answers each one *and stands on its own* when a model is handed it in isolation. `.json` or Markdown. |
| `--summary <file>` | The one-screen version for whoever decides: score, verdict, three axes, the three highest-gain fixes and what they are worth. `.html` or Markdown. |
| `--verify-profiles` / `--check-outbound` | The **only** two capabilities that fetch anything outside the audited origin — profile back-links, and outbound-link liveness. Both opt-in, both bounded, neither implies the other. Without them the audit touches nothing but your own site. |
| `--cwv` [`--psi-key <key>`] | Opt into Core Web Vitals via PageSpeed Insights. |
| `--lang <en\|fr>` | Report language (chrome, check titles, explanations, fixes and messages). |

## CI in one snippet

GitHub Actions — composite action from the same repo, SARIF uploaded to code-scanning,
`score`/`grade` exposed as step outputs:

```yaml
- uses: piwig/findable-audit@main
  with:
    url: https://your-site.com
    min-score: '80'
```

GitLab CI — results in the tests tab:

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

## Also in the box

- **Web UI** (`apps/web`): dependency-free Node server, the same engine, self-hostable.
- **Claude Code plugin**: three skills that run an audit and turn it into a fix plan.
- **Check guide**: every one of the 143 checks documented — what it verifies, why it
  matters, how to fix it — in [English](https://github.com/piwig/findable-audit/blob/main/docs/guide.md)
  and [French](https://github.com/piwig/findable-audit/blob/main/docs/guide.fr.md).

Full docs, bot roster and scoring model: <https://github.com/piwig/findable-audit#readme>

MIT © piwig
