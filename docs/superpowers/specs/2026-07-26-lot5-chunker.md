# LOT 5 — shared chunker (`chunk-retrieval-sim`, `injection-hygiene`)

> Scope: the "LOT 5 recommandé (socle chunker partagé)" row of `docs/backlog-geo-avance.md`.
> The backlog lists three ideas but folds one into another ("self-containment
> anaphorique … fusionne avec retrieval-sim"), so this lot ships **two** new checks
> on top of one shared chunker. Check count 117 → **119** (source of truth =
> `buildChecks().length`, enforced by `runner.test.ts`).
>
> Guard-rails (verified research, `docs/research/2026-07-25-deep-research-citations-verifiee.md`):
> effectiveness varies by domain (3-0) and retrievability beats stylistic rewriting
> (3-0). `chunk-retrieval-sim` is therefore an **advisory heuristic — warn max,
> never fail**. `injection-hygiene` may fail, but only on the one unambiguous
> signature (hidden text carrying machine-directed instructions), never on style.

## Constraints (inherited, non-negotiable)

- Zero new npm dependencies; crawl-only (no JS execution, no CSS fetch); cross-platform
  strict; `process.exitCode`, never `process.exit`.
- Hard gates: `runner.test.ts` count assertion; `check-i18n.test.ts` (bilingual `why`,
  en≠fr, >10 chars); perfect-site e2e invariant = 100 (new checks must PASS or SKIP on
  `test/fixtures/perfect-site/`).
- Check-authoring pattern: const object literal, `makeResult(this, …)`, author never sets
  points; register in `checks/index.ts` barrel import + `buildChecks()` array; crash → auto-skip.
- Scoring: no rebalance — family weights fixed; both checks join **`llm-content`**
  (renormalizes within the family). maxPoints: `chunk-retrieval-sim` = 4, `injection-hygiene` = 3.

## Shared foundation

`packages/cli/src/checks/chunker.ts` — a pure, ctx-free module (unit-testable on its
own) that emulates what a RAG pipeline does to a page before embedding it.

- **Block walk.** Traverse `mainContent(page).root` in document order, keeping only
  block-level text carriers: `h1`–`h6`, `p`, `li`, `blockquote`, `pre`, `dt`, `dd`,
  `figcaption`, and `tr` (rendered as its cells joined by " | "). Nested blocks are
  emitted once, by their innermost carrier. Empty/whitespace blocks are dropped.
- **Heading trail.** A heading of level *n* truncates the trail to *n−1* entries and
  pushes itself. Every chunk records the trail *in effect at its first block* — real
  pipelines prepend such "contextual chunk headers" before embedding, and our anchor
  test does the same.
- **Packing.** Non-heading blocks accumulate until adding the next one would exceed
  `targetTokens` (default **512**, the figure named in the backlog); then the buffer is
  flushed and the next chunk opens. A heading never forces a flush by itself — chunk
  *boundary* hygiene is already QW4 `chunk-boundary`'s job; this module models size.
- **Token estimate.** `Math.ceil(chars / 4)` — the standard ~4-chars-per-token rule of
  thumb. Documented as an approximation: shipping a real tokenizer would mean a
  dependency, and the check's thresholds are deliberately coarse enough not to care.
- A block longer than the target becomes its own single-block chunk (never split
  mid-sentence).

Two text primitives move from `checks/geo-advanced.ts` to `checks/content.ts`, next to
`isQuestionHeading`, because LOT 5 now shares them with QW3: `isSelfSufficientStart`
(uppercase/digit start, no anaphoric opener, no discourse connector) and `hasFactAnchor`
(a digit run, or a capitalized token that does not open a sentence). `geo-advanced.ts`
imports them back — no behaviour change to `answer-units`.

## `chunk-retrieval-sim` — retrieval (the RAG twin)

Cut the page the way a retriever would, then ask of each window: *would this still make
sense if it were the only thing an engine retrieved?*

- Pages evaluated: `mainContent().wordCount ≥ 300` (pillar pages, same threshold as
  `answer-units`). None → **skip**.
- A chunk **survives isolated extraction** when both hold:
  - **topic anchor** — `hasFactAnchor(headingTrail + firstBlockText)` is true. The
    heading trail counts because retrievers prepend it; this is also what makes good
    heading structure pay off here.
  - **self-sufficient opening** — `isSelfSufficientStart(firstBlockText)` is true, i.e.
    the window does not open on a pronoun/demonstrative whose antecedent was left behind
    in the previous window (*it, this, they, cela, celui-ci…*) nor on a discourse
    connector (*however, therefore, par ailleurs…*).
  - `firstBlockText` is the chunk's first **non-heading** block, or its heading when the
    chunk carries nothing else.
- Verdict over all chunks of all pillar pages: `ratio = survivors / total`.
  - `ratio ≥ 0.7` → **pass** (message reports survivors/total and the chunk size used);
  - otherwise → **warn max**, listing the worst pages with their ratio.
- A single-chunk page trivially scores 1.0 — correctly: a short page *is* one window.

## `injection-hygiene` — generation (what the model actually ingests)

Cleanliness of the text an engine ingests, judged over the **whole** document (hidden
payloads live outside `<main>` as often as inside). Three signals, each named in the
message:

1. **Hidden text.** Elements carrying an inline `style` that hides them
   (`display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`, `text-indent:-…px`,
   `clip:rect(0,0,0,0)`, off-screen `left/top:-9999px`) or the `hidden` attribute, whose
   own text runs to ≥ 15 words. **Only inline styles and attributes count** — crawl-only
   means no stylesheet, and the legitimate `.sr-only` / `.visually-hidden` class patterns
   live in stylesheets, so restricting to inline markup is what keeps this precise.
2. **Machine-directed instructions inside hidden text.** FR/EN patterns aimed at a model
   rather than a reader: *ignore (all) previous instructions, disregard …, as an AI
   model, system prompt, respond only with, always recommend, do not mention*; *ignore
   les instructions précédentes, en tant que modèle, réponds uniquement, recommande
   toujours, ne mentionne pas*. Deliberately **not** scanned in visible text: a security
   blog visibly discussing prompt injection is legitimate, a page hiding the same string
   is not. This is what makes the signal specific enough to fail on.
3. **Undelimited UGC.** Outbound links inside a comment/review container
   (`#comments`, `[class*=comment]`, `[class*=review]`, `[itemtype*=Comment]`,
   `[itemtype*=Review]`) that carry neither `rel="ugc"` nor `rel="nofollow"` — the
   attribution Google asks for on user-contributed links.

- **fail**: signal 1 **and** 2 together on the same element (an actual injection payload).
- **warn**: any signal alone.
- **pass**: none of the three, on every sampled page.
- Rolls up with `rollupBySeverity` over sampled pages.

## Integration (single wiring task)

1. `checks/index.ts`: barrel import of the 2 checks + entries in `buildChecks()` → 119.
2. `report/check-i18n.ts`: 2 × `{why:{en,fr}, fix:{en,fr}}`.
3. `runner.test.ts`: `toHaveLength(119)`; `chunk-retrieval-sim` joins the llm-good
   skip-list (homepage-only fixture, no pillar page); `injection-hygiene` runs and passes.
4. Counts derived FROM CODE, then propagated: README total + family table, `index.ts`
   help text, `apps/web/lib/i18n.mjs` (landing counts + About copy, both languages),
   `docs/guide.md` + `docs/guide.fr.md`, `report/i18n.ts` comment, plugin skill.
5. Dogfooding: re-run the built CLI against the web app and confirm both checks pass.

## Non-goals

Real tokenizer; chunk overlap; embedding or similarity scoring; external fetches
(sameAs resolution); re-fetch stability; C2PA; agentic affordances — see backlog LOT 6.
