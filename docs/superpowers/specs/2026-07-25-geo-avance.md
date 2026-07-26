# Section « GEO avancé » — quick-wins design (QW1 freshness-coherence, QW2 hedging-rate, QW3 answer-units, QW4 chunk-boundary)

> Scope: the 4 quick wins of `docs/backlog-geo-avance.md` (retrieval → selection → generation
> taxonomy, AgentGEO arXiv 2603.09296, confirmed 2-0). Four NEW checks, all crawl-only
> (no JS execution, no new dependencies). Check count 113 → **117** (source of truth =
> `buildChecks().length`, enforced by `runner.test.ts`).
>
> Guard-rails (verified research, `docs/research/2026-07-25-deep-research-citations-verifiee.md`):
> effectiveness varies by domain (3-0) and stylistic rewriting loses to retrievability (3-0),
> so QW2/QW3/QW4 are *advisory heuristics* — **warn max, never fail** — and all messages sell
> the *probability* of citation, never a guarantee (no "+40 %" claims, refuted 0-3).

## Constraints (inherited, non-negotiable)

- Zero new npm dependencies; cross-platform strict; `process.exitCode`, never `process.exit`.
- Hard gates: `runner.test.ts` count assertion; `check-i18n.test.ts` (bilingual `why`, en≠fr,
  >10 chars); perfect-site e2e invariant = 100 (new checks must PASS or SKIP on
  `test/fixtures/perfect-site/`).
- Check-authoring pattern: const object literal, `makeResult(this, …)`, author never sets
  points; register in `checks/index.ts` barrel import + `buildChecks()` array; crash → auto-skip.
- Scoring: no rebalance — family weights fixed; all four checks join **`llm-content`**
  (renormalizes within the family). maxPoints follow family conventions: QW1 = 4, QW2 = 3,
  QW3 = 4, QW4 = 3.
- Module: `packages/cli/src/checks/geo-advanced.ts` (one shared FR/EN hedge lexicon used by
  QW2 + QW3); tests in `packages/cli/test/geo-advanced.test.ts` with the standard
  in-memory `makeCtx` pattern.

## QW1 `freshness-coherence` — retrieval (anti « fake freshness »)

Tripartite coherence of the freshness signal. When the three sources diverge, engines
distrust and ignore freshness.

- Sources per sampled page (`pagesOf(ctx)`):
  - **S1** — HTTP `Last-Modified` response header (parseable date);
  - **S2** — claimed on-page modified date: `meta[property="article:modified_time"]`, else
    first parseable JSON-LD `dateModified` (same extraction family as `content-freshness`);
  - **S3** — sitemap `<lastmod>` for that URL (`discoverSitemap` + `parseSitemapEntries`,
    top-level urlset only — no index recursion; URL match via `canonicalIdentity`).
- A page is **evaluated only when ≥ 2 sources are present**; when no sampled page has ≥ 2
  sources → **skip** (message says which sources exist). Tolerance = **24 h**.
- Per-page verdict, direction-aware (a deploy touching file mtimes makes S1 newer than the
  claimed dates — that is benign and must NOT be flagged):
  - **fail** (flagrant): a *claimed* source (S2/S3) is more than 24 h in the **future**;
  - **warn** (notable): |S2 − S3| > 24 h (the two claimed sources disagree), or a claimed
    source is > 24 h **newer** than S1 (the page claims to be fresher than what is served);
  - otherwise **pass** (S1 ≥ claims within tolerance, or claims coherent).
- Rollup via `rollupBySeverity` (fail only ever reachable through the flagrant case).
- Fixtures: the test server sends no `Last-Modified` and no fixture carries `dateModified`
  → at most 1 source everywhere → the check **skips** on `perfect-site` and `llm-good`.

## QW2 `hedging-rate` — selection (leads évasifs)

Engines cite crisp claims; hedged leads lose the selection step.

- Lead = first 2 non-empty `<p>` of `mainContent` (same para extraction as
  `content-lead-answer`). Pages evaluated: `wordCount ≥ 150`; none → skip.
- Shared FR/EN hedge lexicon (word-boundary, case-insensitive), e.g. EN *maybe, perhaps,
  possibly, arguably, probably, presumably, seemingly, apparently, it seems, it appears,
  some say, might be, may be, could be, in some cases*; FR *peut-être, il semble,
  il semblerait, il paraît, sans doute, probablement, apparemment, éventuellement,
  en principe, a priori, selon les cas, dans certains cas, cela dépend*.
- Offender = **≥ 2 lexicon matches** in the lead (one hedge is tolerated — heuristic).
- Verdict: 0 offenders → pass; else **warn max** (message lists `path (n hedges)`).

## QW3 `answer-units` — selection (citabilité par passage)

An "answer unit" is a passage an engine can lift verbatim: direct claim + anchor fact +
self-sufficient + short.

- Pillar pages = `mainContent.wordCount ≥ 300` (article threshold). None → skip.
- Candidate blocks: `<p>` and `<li>` of the main content. A block is an **answer unit** when
  ALL hold:
  - **8 ≤ words ≤ 40** (N = 40);
  - carries a **fact anchor**: a digit sequence (number/date/year) OR an entity proxy
    (capitalized token not at sentence start, Unicode-aware);
  - **self-sufficient**: starts with an uppercase letter/digit and NOT with an anaphoric
    opener (*it, this, that, these, those, they, he, she, such / il(s), elle(s), cela, ceci,
    c'est, celui/celle/ceux, cette, ces*) nor a discourse connector (*however, moreover,
    therefore, also / cependant, toutefois, donc, ainsi, de plus, en outre, par ailleurs*);
  - **direct**: zero hedge-lexicon match (shared with QW2).
- Offender = pillar page with **zero** answer units. Verdict: 0 offenders → pass (message
  counts units); else **warn max**.

## QW4 `chunk-boundary` — generation (hygiène des frontières de chunk)

RAG chunkers split the DOM; content whose meaning depends on distant context dies at the
boundary. Pages evaluated: `wordCount ≥ 150`; none → skip. Three signals (pure DOM, each
reported as the reason):

1. **headerless long table**: `<table>` with > 10 `<tr>` and no `<th>`/`<thead>` — rows
   chunked mid-table lose all column meaning;
2. **detached FAQ answer**: a question heading (h2/h3/h4 ending in `?` or starting with an
   EN/FR interrogative — *what/how/why/when/where/who/which/can/does/is/are,
   quel(le)(s)/comment/pourquoi/quand/où/qui/combien/est-ce*) separated from its first
   text block (`p/ul/ol/table/blockquote/dl`) by ≥ 1 decorative node (`img/hr/figure/
   picture/svg/video/iframe`, or any element with no text) before the next heading;
3. **orphaned list**: top-level `<ul>/<ol>` with ≥ 3 items whose nearest preceding element
   (own `previousElementSibling`, else walking up ancestors inside main content) is missing
   or is NOT a heading/`<p>`/`<figcaption>` — the list separated from its title chunks
   context-free. Nested lists (ancestor `li/ul/ol`) excluded.

- Offender = page with ≥ 1 signal. Verdict: 0 offenders → pass; else **warn max**
  (offender list with reasons).

## Integration (single wiring task)

1. `checks/index.ts`: barrel import of the 4 checks + entries in `buildChecks()` → 117.
2. `report/check-i18n.ts`: 4 × `{why:{en,fr}, fix:{en,fr}}`.
3. `runner.test.ts`: `toHaveLength(117)`; the 4 ids join the llm-good skip-list
   (homepage-only sample < 150 words; no sitemap/dateModified/Last-Modified → QW1 < 2 sources).
4. Counts derived FROM CODE, then propagated: README total + family table, `index.ts` help
   text, `apps/web/lib/i18n.mjs` landing counts (both languages), `docs/guide.md` +
   `docs/guide.fr.md` (### sections for the 4 checks + totals), `report/i18n.ts` comment.
5. Dogfooding: run the built CLI against https://findable.bordebat.fr, inspect the 4 new
   statuses, fix what is fixable in `apps/web` (content/headers/JSON-LD) with tests.

## Non-goals

LOT 5 shared chunker (retrieval-sim / injection-hygiene / anaphora), external fetches
(sameAs resolution), re-fetch stability, C2PA, agentic affordances — see backlog LOT 5/6.
