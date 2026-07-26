# findable-audit — working notes for Claude Code

One deterministic crawl → a catalogue of checks across 8 weighted families → a `/100`
score and an A–F grade. Monorepo: `packages/cli` (the engine, TypeScript) and `apps/web`
(a dependency-free Node web UI). `plugin/` ships the whole thing as a Claude Code plugin.

(The check count is deliberately absent from this file — it is already duplicated in nine
places, and adding a tenth is exactly the trap the skill below exists to avoid.)

Read `README.md` for what the tool does and `docs/guide.md` for what every check verifies.
This file is the part that is **not** obvious from reading the code.

## Commands

```bash
npm run build --workspaces          # tsc; apps/web has no build step
npm test --workspaces               # vitest, packages/cli
cd apps/web && node --test          # node:test, real HTTP servers on loopback
node packages/cli/dist/index.js <url> --max-pages 6 --report out.json
```

Always `npm run build --workspaces` before running the CLI or the web tests: `apps/web`
imports from `packages/cli/dist/`, so a stale build silently tests old code.

## Non-negotiable conventions

- **Cross-platform strict.** No POSIX shell in shipped code, `path.join` everywhere,
  native `fetch` (Node ≥ 20.3). CI runs ubuntu + windows × Node 20/22.
- **`process.exitCode`, never `process.exit`.** Calling `process.exit` while undici has
  sockets in flight crashes on Windows.
- **Zero new runtime dependencies** without a deliberate decision. The CLI has three
  (`fast-xml-parser`, `node-html-parser`, `picocolors`); `apps/web` has none, and that
  is a selling point in the README.
- `.gitattributes` pins `* text=auto eol=lf`.
- Commit subjects: one line, `type(scope): …`.

## How scoring works (and why checks skip)

`scoring.ts` gives each family a 0–100 sub-score computed **only over its non-skipped
checks**, then blends the eight with fixed weights summing to 1.0. A check that does not
apply (no Product page, no sitemap index, no `--cwv` key) must `skip` — never `pass` and
never `fail` — so a site is never penalized for something it does not have.

The invariant that protects this: `test/fixtures/perfect-site/` must score exactly
**100**. Any new check must `pass` or `skip` on that fixture.

## Adding or removing a check

`buildChecks().length` is the single source of truth for the count, and it is asserted in
`runner.test.ts`. The count is then *duplicated by hand* into user-facing copy across nine
files — see `.claude/skills/findable-new-check/SKILL.md`, which encodes the whole
sequence. Use it; the propagation step is the one that gets forgotten.

## Honesty guard-rails

The verified research in `docs/research/` shapes what the tool is allowed to claim:

- Never promise a citation-rate uplift (the "+40 % GEO" figure was refuted 0-3). Sell the
  *probability* of citation, never a guarantee.
- Retrievability beats stylistic rewriting (confirmed 3-0). Content-shaping heuristics —
  `hedging-rate`, `answer-units`, `chunk-boundary`, `chunk-retrieval-sim` — are advisory:
  **warn max, never fail.** Only unambiguous, verifiable defects may fail.
- `llms.txt` is documented in the guide as a *signal of unproven value*. Keep it that way.

## Dogfooding is a gate, not a ritual

`apps/web/test/dogfooding.test.mjs` boots the web app and runs the **real engine** against
it, asserting on check results rather than re-implementing their heuristics. It is how
three genuine product bugs were found (a `www-consolidation` false positive, English-only
question-heading regexes, an uppercase-start rule that rejected lowercase brand names).

Two findings are deliberately left as warnings rather than papered over —
`sd-entity-grounding` and `sd-website-searchaction`. The reasoning is in
`apps/web/README.md`, and the test asserts they are *still* warnings. If you are tempted
to make our own audit greener by adding markup we tell auditees not to add: don't.

## Working on `apps/web`

- Copy lives in `lib/i18n.mjs`, in **both** `en` and `fr`. Never hardcode user-visible
  strings in `server.mjs`.
- `SITE_PAGES` carries hand-maintained `lastmod` dates that are also served as JSON-LD
  `dateModified`. Change page copy → bump its date, or `freshness-coherence` starts
  reporting on us.
- The SSRF guard is shared with the crawler (`packages/cli/src/ssrf.ts`). Do not add a
  second URL-validation path.
- `admin.local.mjs`, `ADMIN.local.md` and `data/` are gitignored on purpose: the private
  dashboard and its JSONL store never enter this repository.
