---
name: findable-new-check
description: Use when adding, removing or renaming a check in findable-audit — walks the full sequence from spec to dogfooding, including the check-count propagation across eleven files that no test catches.
---

# Adding a check to findable-audit

`buildChecks().length` is the **only** source of truth for the check count. Everything
else — both READMEs, both guides, the CLI help, the web copy, the plugin skill, the
Action's Marketplace description — repeats that number by hand. Three gates fail loudly if
you get the code wrong; **nothing fails if you forget the copy.** That asymmetry is what
this skill exists for.

Derive the real numbers from code, never from a previous document:

```bash
npm run build --workspaces
node -e "const{buildChecks}=require('./packages/cli/dist/checks/index.js');const c=buildChecks();const f={};for(const x of c)f[x.family]=(f[x.family]||0)+1;console.log('total',c.length);console.log(JSON.stringify(f,null,0))"
```

## 1 · Spec first

Write `docs/superpowers/specs/<YYYY-MM-DD>-<slug>.md` before any code. Follow the shape of
`2026-07-26-lot5-chunker.md`: inherited constraints, one section per check (sources,
thresholds, verdict table), an integration checklist, non-goals.

Decide the **verdict policy** here, and justify it against `docs/research/`:

- Unambiguous, verifiable defect (broken canonical, blocked crawler, hidden injection
  payload) → `fail` is allowed.
- Content-shaping heuristic (style, phrasing, structure) → **warn max, never fail.**
  Verified research says effectiveness varies by domain and retrievability beats
  rewriting; a heuristic that fails a site overstates what we know.
- Precondition absent → `skip`. Never `pass` a check that did not actually run.

Then declare **what the verdict rests on** — the required `evidence` field, which the
compiler will not let you omit:

- `measured` — the good state is defined outside this project (RFC, W3C/WHATWG, WCAG,
  schema.org, a threshold Google publishes). Two people reading the same response agree.
- `heuristic` — YOU chose the bar (a word count, a lexicon, a ratio, "reads like a direct
  answer"). Reports badge these, and readers weigh them accordingly.

It is independent of severity: `security-txt` only warns and is measured. If you find
yourself wanting `heuristic` **and** `fail`, re-read the verdict policy above — that
combination is what the guard-rails exist to prevent.

## 2 · Write the check

Module in `packages/cli/src/checks/`. Group related checks in one file (see
`geo-advanced.ts`, `geo-retrieval.ts`); put anything two checks share in
`checks/content.ts`, which is the home for text primitives (`isQuestionHeading`,
`hasFactAnchor`, `isSelfSufficientStart`, `opensWithoutBackreference`).

```ts
export const myCheck: Check = {
  id: 'my-check', family: 'llm-content', evidence: 'heuristic', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');
    // …
    return makeResult(this, 'pass', 'human-readable message');
  },
};
```

Rules: const object literal; `makeResult(this, …)` — the author never sets points; a
thrown error auto-skips, so never swallow errors to fake a pass. Bilingual lexicons
(FR + EN) for anything text-matching — two checks once shipped English-only regexes and
silently ignored every French page.

## 3 · Register and translate

- `packages/cli/src/checks/index.ts` — barrel import **and** an entry in the
  `buildChecks()` array.
- `packages/cli/src/report/check-i18n.ts` — one `{ why: {en, fr}, fix: {en, fr} }` entry.

## 4 · Tests

- Unit tests next to the module's siblings (`test/geo-retrieval.test.ts` pattern): use the
  in-memory `makeCtx` helper, and cover every verdict branch **including skip**.
- `packages/cli/test/runner.test.ts` — bump `toHaveLength(N)`, and add the id to the
  `llm-good` skip list if it skips on a homepage-only fixture.
- Check it `pass`es or `skip`s on `test/fixtures/perfect-site/` — that fixture must still
  score exactly **100**.

Gates that will fail if you skip this: the count assertion, `check-i18n.test.ts` (every id
covered, `why.en`/`why.fr` > 10 chars, `en !== fr`), and the perfect-site invariant.

## 5 · Propagate the count — the step nothing tests

Run the command at the top, then update **every** line below. Grep the old number across
the repo afterwards to be sure (`grep -rn "<old>" --include=*.md --include=*.ts --include=*.mjs .`,
ignoring `node_modules`, `dist/`, `package-lock.json` and `graphify-out/`).

| File | What to change |
|---|---|
| `README.md` | intro paragraph, "**N checks in 8 families**", the *Checks* column of the family table, and the competitive-comparison line |
| `packages/cli/README.md` | intro line **and** the *Docs* line — this is the npm package page, the first thing an installer reads |
| `action.yml` | the `description:` block (Marketplace listing copy) |
| `docs/guide.md` | intro line, family table row, **new `### <id> (N pts)` section** (Verifies / Why / Fix) |
| `docs/guide.fr.md` | same three, in French (note the table uses `0,18` with a comma) |
| `plugin/skills/geo-audit/SKILL.md` | the headline count **and** the per-family breakdown line |
| `apps/web/lib/i18n.mjs` | 8 places — EN and FR × `landing.familiesTitle`, `landing.geoBody`, `about.description`, `about.blocks` |
| `apps/web/server.mjs` | the `llms.txt` "About the project" line |
| `packages/cli/src/index.ts` | `--lang` help text |
| `packages/cli/src/report/i18n.ts` | header comment |
| `docs/backlog-geo-avance.md` | mark the shipped item, note `old → new` |

Adding a check to a family also changes that family's per-family count in the README
table, both guide tables, and the plugin skill breakdown. Take those from the command
output, not from arithmetic.

## 6 · Dogfood before committing

The engine has to survive its own new check:

```bash
npm run build --workspaces && npm test --workspaces
cd apps/web && node --test
```

Then run the real engine against the live web app and read the new check's verdict:

```bash
node --input-type=module -e "
process.env.PORT='31140';process.env.PUBLIC_ORIGIN='http://127.0.0.1:31140';
const {runAudit}=await import('./packages/cli/dist/runner.js');
const {buildChecks}=await import('./packages/cli/dist/checks/index.js');
const {server}=await import('./apps/web/server.mjs');
if(!server.listening)await new Promise(r=>server.once('listening',r));
const r=await runAudit('http://127.0.0.1:31140/',buildChecks(),{maxPages:6});
console.log(r.results.length,r.score,r.grade);
for(const c of r.results.filter(x=>x.status!=='pass'&&x.status!=='skip'))console.log(c.status,c.id,c.message);
server.close();"
```

Expect `open-graph`, `twitter-card`, `sd-organization` and `text-compression` to complain
over plain HTTP — those are artefacts of the loopback origin, not regressions; production
runs behind HTTPS and gzip. Anything else the new check reports on our own site is a real
finding: fix the site, or fix the check if it turns out to be a false positive. That is how
`www-consolidation` and the lowercase-brand rule were caught.

If the check earns its keep on our own pages, add an assertion to
`apps/web/test/dogfooding.test.mjs` so a future regression fails CI.

## 7 · Commit

One-line French subject without accents, `type(scope): …`, mentioning `old -> new`. Example:

```
feat(geo-retrieval): LOT 5 socle chunker partage — chunk-retrieval-sim + injection-hygiene, 117 -> 119
```
