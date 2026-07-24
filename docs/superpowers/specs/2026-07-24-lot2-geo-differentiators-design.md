# LOT 2 — "GEO differentiators" design (#19 CSR/SPA parity, #20 AI-bot serving parity, #47 link-equity map)

> Scope validated by the user (roadmap §0 + §13, memory 2026-07-24). Three NEW checks, all
> crawl-only (no JS execution, no new dependencies, no headless browser). Check count
> 109 → **112** (the "111" noted pre-/clear was an arithmetic slip; source of truth =
> `buildChecks().length`, enforced by `runner.test.ts`).

## Constraints (inherited, non-negotiable)

- Zero new npm dependencies; cross-platform strict (`path.join`, native fetch, no POSIX shell).
- `process.exitCode`, never `process.exit`.
- Hard gates: `runner.test.ts` count assertion; `check-i18n.test.ts` (every check id has
  bilingual `why`, en≠fr, >10 chars); perfect-site e2e invariant = 100 (new checks must
  PASS or SKIP on `test/fixtures/perfect-site/`).
- Check-authoring pattern: `.superpowers/sdd/lot1/explore-checks.md` (const object literal,
  `makeResult(this, …)`, author never sets points; register in `checks/index.ts` barrel
  import + `buildChecks()` array; crash → auto-skip).
- Scoring: no rebalance needed — family weights fixed, adding a check auto-renormalizes
  within its family.

## #19 `csr-content-parity` — family `llm-content`

"What GPTBot actually sees": flag sampled pages whose main content only exists after
client-side rendering. Complements (does not replace) `content-without-js`.

- Per sampled page (`pagesOf(ctx)`), raw HTML only:
  - **Empty mount roots**: `#root`, `#__next`, `#app` (div/section/main), `<app-root>`,
    `[data-reactroot]`, plus Angular `[ng-version]` root — "empty" = no meaningful text
    inside (trimmed text < ~50 chars) and no content-bearing element children.
  - **Hydration/state blobs** (framework fingerprint, NOT an offense by itself):
    `script#__NEXT_DATA__`, `window.__NUXT__`, `__INITIAL_STATE__`, `__APOLLO_STATE__`,
    `#___gatsby`, `data-server-rendered` (this one is an SSR *positive* signal).
- **Offender** = page with an empty mount root AND thin server-rendered text (visible text
  outside the blob < ~200 chars). Framework markers + substantial SSR text = conforming
  (SSR/SSG done right must NOT be penalized).
- Verdict via `aggregate(total, offenders)` (pass = 0 offenders; warn ≥ 0.8 conform; else
  fail, message lists offenders "a, b, c (+N more)").
- Perfect-site: fully SSR, no mount roots → pass.

## #20 `ai-serving-parity` — family `ai-access`

Cloaking / dynamic-serving detection: does the server give AI crawlers the same document
as browsers?

- **New optional context capability** — `CrawlContext.fetchWithUA?(path, userAgent)`:
  implemented by `Crawler` reusing the SAME plain/guarded (SSRF) code paths as `fetch()`,
  with a separate cache keyed `(userAgent, url)` and NO origin re-pinning. Optional so
  lightweight test ctxs need not implement it → check **skips** when absent.
- Probes (politeness budget ≤ 5 extra requests, all deterministic):
  - Homepage × {mobile UA, GPTBot UA, ClaudeBot UA} (default-UA copy comes free from
    `ctx.fetch('/')` cache).
  - First 2 non-homepage sampled pages × {GPTBot UA}.
- UA constants live in the check module (realistic full strings for GPTBot 1.2, ClaudeBot,
  iPhone Safari).
- **Diff per probed page** vs default-UA response: HTTP status class; byte length
  (>30% shrink = divergence); `<title>` text; main-content presence (same extractor as
  llm-content). Redirect to a different final path also counts as divergence.
- Verdict: **fail** = AI UA blocked (403/451/5xx/network-null) or main content absent
  while default UA is fine (hard cloaking / edge bot-block); **warn** = soft divergence
  (title mismatch, >30% size delta, mobile-only divergence); **pass** = parity; **skip** =
  no `fetchWithUA`, or default-UA homepage itself unreachable. Messages must stay honest:
  a 403 to GPTBot may be *deliberate* bot management — say "AI crawlers appear blocked at
  the edge", never accuse.
- Perfect-site fixture server ignores UA → parity → pass. Local fixtures run with SSRF
  guard off (CLI default), so loopback probes work in tests.

## #47 `link-equity-map` — family `technical-seo`

Internal link-equity distribution over the sample. Reuses `buildLinkGraph` (zero extra
crawl). Distinct value vs `internal-linking` (depth/underlinked): equity *distribution* +
named winners/losers.

- From `buildLinkGraph(pages, ctx.baseUrl)`:
  - **In-degree** per discovered internal URL (targets include non-sampled URLs; self-links
    excluded).
  - **Sample-scoped PageRank**: damping 0.85, 20 fixed iterations, nodes = sampled pages ∪
    discovered targets, dangling mass redistributed uniformly; fully deterministic (stable
    insertion order, fixed iteration count, 2-decimal formatting in messages).
  - **Orphans**: sampled non-homepage pages with in-degree 0 from other sampled pages.
  - **Equity leaks / dead-ends**: sampled pages with zero internal content outlinks
    (rank sinks).
- Offenders = orphans ∪ dead-ends → `aggregate(total, offenders)`. Message names top-3
  PageRank pages (with share) + orphan/dead-end lists.
- Skip when no sample or < 3 sampled pages (distribution meaningless on 1-2 pages).
- Perfect-site: all pages inter-linked via nav → pass.

## Integration (single wiring task)

1. `checks/index.ts`: 3 barrel imports + 3 entries in `buildChecks()`.
2. `report/check-i18n.ts`: 3 × `{why:{en,fr}, fix:{en,fr}}`.
3. `runner.test.ts`: `toHaveLength(112)`; skip-list: none of the three skips on the
   llm-good fixture (real Crawler implements `fetchWithUA`; ≥3 pages sampled) — verify.
4. Counts derived FROM CODE (`buildChecks()` by family), then propagated: README.md total +
   family table (also fix the pre-existing structured-data off-by-one), `index.ts` help
   text, `apps/web/lib/i18n.mjs` landing counts (both languages), `docs/guide.md` +
   `docs/guide.fr.md` (### sections for the 3 checks + totals), `report/i18n.ts` comment.
5. maxPoints: match each family's existing conventions (inspect neighbors; do not rebalance).

## Non-goals

JS execution, headless CWV, new bots roster expansion (#13), rel=nofollow scan (#50),
anchor-text profiling (#48), web UI changes beyond count strings (the web report renders
new checks automatically through the shared engine).
