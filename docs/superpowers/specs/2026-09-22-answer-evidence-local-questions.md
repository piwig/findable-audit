# Evidence and supplied questions — 22 September 2026

Authorized scope: improve the existing CLI locally, preserving unfinished changes, without publishing, adding dependencies or changing score weights/check registration.

1. Repair the existing citability checks: numeric dates and word boundaries, resolved nonempty table labels, direct source links. Keep advisory severity. Fix local-context validation without process.exit.
2. Preserve a bounded (320-character) evidence excerpt and heading on answer-matrix cells. Existing states and predicates remain unchanged. Markup/affordance evidence must remain distinct from prose; do not manufacture a quote from JSON-LD.
3. Compare at most 50 operator-supplied questions with the sampled HTML. Exact normalized question headings with following text yield found; partial lexical matches or empty headings yield review; no match yields not-found in this sample. No semantic answer, factual truth, ranking or citation guarantee is inferred. Attach the actual source path and bounded excerpt.
4. Add explicit sample coverage (observed count, requested limit, whether reached, source, exhaustive=false). All report fields are additive and optional for old saved reports.
5. Escape extracted text in Markdown, preserve it as inert strings in JSON; HTML integration is owned by the coordinator. Do not change the crawler/SSRF path.

Implementation sequence: discriminating tests first; smallest fixes; evidence and supplied-question modules; runner/CLI integration; count synchronization using the existing script with no web edits; rebuild all workspaces; CLI suite; independent coordinator review. No release/version bump.

Primary guidance: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide — SEO fundamentals remain applicable; special AI files, schema and chunk sizes are not requirements. The 320-character cap is a report display limit, not an optimization target.

Final scope additions from independent review: exclude hidden/inert/aria-hidden question content, cap supplied questions to 500 characters and never serialize form fields as evidence. Cloudflare provider headers do not reveal account policies ([official policies](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/)); basic accessibility findings do not determine legal applicability or compliance ([Service Public](https://entreprendre.service-public.gouv.fr/actualites/A18669)). Wording corrected without changing weights or verdict branches. The existing count synchronizer now checks a fresh compiled registry and updates catalogue family counts and default-run counts separately.
