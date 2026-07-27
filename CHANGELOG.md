# Changelog

Notable changes to `findable-audit`. Versions follow [semver](https://semver.org): a new
check or flag is a minor, a fix is a patch, and anything that moves a score is at least a
minor because it changes your output.

The project is older than its first npm release — `0.2.0` is where it became installable,
not where it started.

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
