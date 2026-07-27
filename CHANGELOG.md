# Changelog

Notable changes to `findable-audit`. Versions follow [semver](https://semver.org): a new
check or flag is a minor, a fix is a patch, and anything that moves a score is at least a
minor because it changes your output.

The project is older than its first npm release — `0.2.0` is where it became installable,
not where it started.

## 0.7.0 — 2026-07-27

### Added

- **`sameas-verified` (opt-in `--verify-profiles`) — 125 → 126 checks.** Fetches the
  profiles your JSON-LD declares in `sameAs` and checks each links back. Anyone can list
  a LinkedIn or Wikipedia URL in their own markup; only whoever controls that profile can
  make it point back, and that return link is what turns a claim into a verifiable
  identity.

  This is the **only** capability in the tool that leaves the audited origin, so it is
  deliberately narrow: opt-in, at most 8 URLs per audit, http(s) only, under the same SSRF
  guard as everything else, and wired up only when asked for — without the flag the
  Crawler does not even expose it. It only ever looks at profiles you **declared**; it
  never hunts for a presence you did not claim, because that is not verifiable from a
  crawl. A platform that refuses robots is reported as *unverifiable* and never held
  against the site — "we could not read it" and "it does not link back" are different
  facts, and only the second is about you. Warns at worst, never fails.
- **The published package is now smoke-tested by CI.** Everything before ran against the
  checkout; this installs the published version from the registry on Linux and Windows,
  checks `--version` matches the tag, and runs a real audit with it. The tarball is also
  inspected **before** publishing, since publishing cannot be undone.

## 0.6.0 — 2026-07-27

### Added

- **Four new checks — 121 → 125.** `broken-subresources` (a page whose markup is fine but
  whose stylesheet, script or image 404s), `js-only-destinations` (internal destinations
  only reachable by running JavaScript), `soft-error-pages` (a page served 200 whose
  content says "not found"), `indexing-conflicts` (sitemap URLs disallowed in robots.txt,
  canonicals pointing at blocked URLs — contradictions between signals we already fetch).
- **Crawl depth named by intention** in the CLI help and on the web form: fast check,
  template audit, site audit, deep investigation.
- **A `badge` input on the GitHub Action**, so the SVG score badge is one obvious knob
  rather than an extension convention.

### Changed

- **Checks now run concurrently.** The audit used to be the sum of every check's network
  wait; it is now bounded by the slowest, not the total. Measured against a real slow
  site: 57s → 21s without Core Web Vitals, 103s → 58s with. Verdicts are byte-identical —
  results keep their declared order, and the audited site is protected by a single global
  ceiling of 6 simultaneous requests plus single-flight deduplication, so more parallelism
  overlaps waiting, never load.

## 0.5.0 — 2026-07-27

### Added

- **`--summary <file>`: the one-screen version**, for whoever decides rather than whoever
  fixes — score, verdict, the three axes, the three highest-gain actions with their cost,
  and the score those three would reach. `.html` (printable, self-contained, no script) or
  Markdown by extension. It is assembled from the same numbers as the full report, so the
  two cannot disagree, and it deliberately carries no check table.

## 0.4.0 — 2026-07-27

### Added

- **Every check now declares what its verdict rests on** (`evidence`): *measured* when the
  good state is defined outside this project (RFC, W3C/WHATWG, WCAG, schema.org, a
  threshold Google publishes) or *heuristic* when we chose the bar (a word count, a
  lexicon, a ratio). **94 measured, 27 heuristic.** HTML and Markdown reports badge the
  heuristic ones with a one-line legend; JSON carries `evidence` on every result. The two
  axes are independent of severity — `security-txt` only warns and is measured.
  The field is required on the `Check` type, so a new check cannot compile without its
  author deciding.

## 0.3.1 — 2026-07-27

### Fixed

- **SARIF uploads were rejected by GitHub code scanning.** Results pointed at the audited
  `https://` URL, and GitHub refuses an upload whose absolute URI scheme differs from the
  checkout's `file://` root — so the integration advertised in the README never actually
  landed an alert. Findings now carry a relative, stable pseudo-path
  (`findable-audit/<host>/<path>`) and keep the real URL in `properties.url`. Caught by
  this repo auditing its own site in CI, not by a user.

## 0.3.0 — 2026-07-27

### Added

- **`security-txt` check** (`security`, 2 pts) — verifies `/.well-known/security.txt`
  (RFC 9116): served as text, a `Contact:` field, and an `Expires:` date still in the
  future. Warns rather than fails: a missing vulnerability-reporting address is a missed
  good practice, not a findability defect. **120 → 121 checks.**
- **`--submit`: IndexNow notification** — tells Bing, Yandex, Seznam and Naver about the
  URLs the audit sampled. Opt-in, and refused unless `--indexnow-key` is given *and* the
  key file is verified on the audited site, which is what proves you own it. Only sampled
  same-origin URLs are sent, and a refused submission never changes the exit code.
  (Google does not participate in IndexNow — use Search Console there.)
- **Web**: a "Run it yourself, or in CI" section on the landing page, so the CLI, the
  GitHub Action and the Claude Code plugin can be found from the site at all.

### Changed

- npm package page rewritten: what it does, why it differs, and the flags that matter.
- Package keywords and description broadened for npm search.

## 0.2.1 — 2026-07-27

### Changed

- Releases now publish through **OIDC trusted publishing**: no npm token exists in the
  repository any more, and provenance is generated automatically. No functional change to
  the tool itself — this version exists to prove the new pipeline end to end.

## 0.2.0 — 2026-07-27

First published release. The engine had been in use privately; this is where
`npx findable-audit` starts working for everyone.

### Added

- **120 checks across 8 weighted families** (weights summing to 1.0), scored `/100` with
  an **A–F grade**. Checks that do not apply *skip* instead of penalizing the site, and a
  `perfect-site` fixture must score exactly 100.
- **AI crawler roster of 28 named agents, tiered by intention**: blocking a citation-time
  fetcher fails, blocking a training crawler warns.
- **Multi-page crawl** (`--max-pages`), same-origin, deterministic sampling.
- **Reports**: terminal, Markdown, self-contained printable HTML, JSON, **SARIF** (GitHub
  code-scanning), **JUnit** (GitLab/Jenkins) and an **SVG score badge**, all chosen by
  file extension on `--report`.
- **JSON-LD entity graph**, drawn inline in the HTML report (grouped by entity type) and
  exportable with `--entity-graph` as `.json` / `.dot` / `.mmd`.
- **Regression gate**: `--baseline audit.json --fail-on-regression [--regression-tolerance n]`.
- **Competitive scorecard**: `--compare url2,url3`.
- **`--emit <dir>`**: ready-to-deploy `robots.txt`, `llms.txt`, `llms-full.txt`,
  `.well-known/ai.json`, `sitemap.xml` and JSON-LD stubs, generated from what was found.
- **Core Web Vitals** via PageSpeed Insights (`--cwv --psi-key`), field (CrUX) with a lab
  fallback; without a key the CWV checks skip cleanly.
- **Full French reports** — chrome, check titles, explanations, fixes *and* the checks'
  own dynamic messages.
- **Web app** (`apps/web`): dependency-free Node server running the same engine,
  SSRF-hardened, self-hostable; live at <https://findable.bordebat.fr>.
- **GitHub Action** (`action.yml`) and a **Claude Code plugin** (three skills).
