# findable-audit check guide

findable-audit scores a site out of 100 across **137 checks in 8 families**.

**Measured or heuristic.** Every check declares what its verdict rests on. A **measured** check grades against something outside this project — an RFC, a W3C/WHATWG spec, WCAG, schema.org, or a threshold Google publishes: two people reading the same response agree. A **heuristic** check grades against a bar *we* chose — a word count, a lexicon, a ratio, a notion of "reads like a direct answer": reasonable people can disagree, and the verified research says effectiveness varies by site. Reports badge the heuristic ones so you can weigh them accordingly, and the JSON carries `evidence` on every result. Of the 137 checks, **102 are measured and 35 heuristic**. This guide documents every check: what it verifies, why it matters for search and AI answer engines, and how to fix a failure.

**Families & weights** (the family subscore is combined into the overall score using these weights):

| Family | Weight | Checks |
|---|---|---:|
| AI crawler access | 0.16 | 9 |
| Answer-engine content | 0.18 | 21 |
| Structured data & metadata | 0.15 | 23 |
| Technical SEO | 0.15 | 29 |
| On-page & content | 0.12 | 14 |
| Performance & Core Web Vitals | 0.10 | 21 |
| Accessibility | 0.07 | 9 |
| Security & trust | 0.07 | 11 |

**Grade:** `A` ≥ 90 · `B` ≥ 80 · `C` ≥ 70 · `D` ≥ 60 · `F` < 60.

**Statuses:** `OK` (pass, full points), `!!` (warn, half points), `XX` (fail, 0 points), `--` (skip). **Skipped checks are excluded from scoring** — a site is never penalized for a check that doesn't apply to it (no Product page, single language, no `--cwv`, etc.). Entries below marked *(skip when …)* only run when their precondition is met.

The HTML report is laid out in three layers — the verdict (one score visual, a plain-language sentence, three axes), the plan (fixes grouped in effort lanes, each lane showing the score it would reach), then the detail (every check, human title first, passing ones folded). The Markdown report carries the same verdict and the same action plan, near the end. Run with `--cwv --psi-key <key>` to add Core Web Vitals — a radial-gauge dashboard in the HTML report and a metrics table in Markdown (field/CrUX vs lab/Lighthouse).

---

## AI crawler access

The gate: if crawlers are blocked or the page is `noindex`, nothing else matters.

### `homepage-ok` (6 pts)
**Verifies:** The root URL returns HTTP 200 with HTML.
**Why:** If the homepage errors, redirects to a login, or needs JavaScript to produce any HTML, crawlers get nothing to index and assistants get nothing to cite.
**Fix:** Serve a 200 HTML page at `/` without requiring JavaScript; check hosting, redirects and any bot-protection layer.

### `robots-exists` (4 pts)
**Verifies:** `/robots.txt` responds 200 as `text/plain` (warn on an HTML fallback or if missing).
**Why:** robots.txt is the first file every crawler requests; without it you have no explicit crawl policy and can't advertise your sitemap.
**Fix:** Serve a static `text/plain` robots.txt with a `User-agent` group and a `Sitemap:` line.

### `robots-wellformed` (4 pts)
**Verifies:** robots.txt parses cleanly — under ~500 KB, only known directives, no `Allow`/`Disallow` before the first `User-agent`, not an HTML error page.
**Why:** A malformed robots.txt is interpreted unpredictably by different crawlers, silently changing what they will fetch.
**Fix:** Emit a valid `User-agent` group plus `Sitemap:`; never return HTML for robots.txt.

### `search-crawlers-allowed` (6 pts)
**Verifies:** robots.txt does not `Disallow: /` for Googlebot, Bingbot, or `*` (RFC 9309 longest-match).
**Why:** A site-wide disallow on these agents removes you from classic search, which most AI answers still lean on.
**Fix:** Remove any site-wide `Disallow: /`; scope disallows to cart/search/admin paths only.

### `ai-crawlers-allowed` (12 pts)
**Verifies:** No AI crawler is blocked — training bots (GPTBot, Google-Extended, ClaudeBot, CCBot, Applebot-Extended, Amazonbot, Bytespider, cohere-ai, meta-externalagent) and, more critically, citation-time fetchers (OAI-SearchBot, ChatGPT-User, Perplexity-User, Claude-User, PerplexityBot). Fails if any citation-time fetcher is blocked; warns if only training bots are blocked.
**Why:** The single highest-weighted check — if a citation-time fetcher is disallowed, that assistant simply cannot read or cite your site.
**Fix:** Never `Disallow: /` a citation-time fetcher; block training bots only if that is deliberate policy.

### `robots-directives` (4 pts)
**Verifies:** The homepage `X-Robots-Tag` header and `<meta name="robots">` are free of `noindex`/`noai` (warn if present).
**Why:** A `noindex`/`noai` directive on the homepage tells search and AI crawlers to skip the page entirely.
**Fix:** Remove `noindex`/`noai` from the header and meta tag unless the exclusion is intentional.

### `meta-robots-noindex` (6 pts)
**Verifies:** No sampled page carries `noindex`/`none` in meta robots or `X-Robots-Tag` (fails on any); warns on `nofollow`-only or a header↔meta conflict.
**Why:** A noindexed page is invisible to search engines and AI crawlers alike — content you meant to be found silently isn't.
**Fix:** Remove `noindex`/`none` from pages that should be discoverable; keep it only on genuinely private pages and exclude those from the sitemap.

### `ai-serving-parity` (8 pts)
**Verifies:** Refetches the homepage (plus up to two sampled pages) as GPTBot, ClaudeBot and a mobile browser, comparing HTTP status, body size, `<title>` and main content against the default fetch. Fails on a 403/451/5xx or missing main content for an AI user-agent; warns on softer divergence (title mismatch, >30% size delta, mobile-only difference). Skips without the per-UA fetch capability or when the homepage is unreachable.
**Why:** If a CDN/WAF hands AI crawlers a blocked, redirected or stripped-down document, your content never reaches the assistants that would cite it — even though a browser sees the page fine. A 403 to GPTBot may be deliberate bot management, so the wording stays descriptive, not accusatory.
**Fix:** Make sure GPTBot and ClaudeBot receive the same document a browser gets; review any bot-management rule that blocks or rewrites AI-crawler requests.

### `snippet-preview-directives` (4 pts)
**Verifies:** No page sets `nosnippet`, `max-snippet:0`, `max-image-preview:none`, or `max-video-preview:0` (warn if merely absent; `max-image-preview:large` counts positively).
**Why:** Preview-starving directives suppress the very snippets and thumbnails answer engines surface.
**Fix:** Set `max-image-preview:large, max-snippet:-1, max-video-preview:-1`; remove stray `nosnippet`.

---

## Answer-engine content

The GEO heart: is the answer actually extractable, dated, authored, and quotable.

### `llms-txt` (10 pts)
**Verifies:** `/llms.txt` (text/plain) has an H1 title + a summary line + ≥1 `##` section + ≥5 descriptive absolute same-origin links (warn if H1-only or under 5 links; fail if missing/HTML).
**Why:** `llms.txt` gives models a curated, token-efficient map of your site so they answer about it accurately instead of guessing from raw HTML. Honest caveat: treat it as a **signal of unproven value** — large 2025–26 studies (Ahrefs 137K sites, SE Ranking 300K, Otterly 62K, Trakkr 37.9K) measured **no citation gain**, adoption is ~3.2%, and Google says it has zero ranking impact. It stays in the audit as a cheap, low-weight bet; the value lies in the combined check set, not in this file alone.
**Fix:** Structure it as `# Site`, a one-line summary, then `## Section` blocks of `- [Title](https://abs-url): note`.

### `llms-full-txt` (4 pts)
**Verifies:** `/llms-full.txt` (text/plain) carries real body content — roughly ≥2000 words with multiple headings (warn under 500; fail if missing/HTML).
**Why:** Where `llms.txt` is the map, `llms-full.txt` is the territory: your full text in one file a model can ingest in a single request. The same unproven-value caveat as `llms.txt` applies — no measured citation gain in the large 2025–26 studies — hence its small weight.
**Fix:** Concatenate full page text under headings at build time.

### `content-without-js` (6 pts)
**Verifies:** Each sampled page has ≥200 chars of static (no-JS) visible body text after stripping script/style/noscript (warn a minority thin; fail if most are empty).
**Why:** AI crawlers do not execute JavaScript, so a client-rendered page is an empty shell to them.
**Fix:** Server-render or statically generate the main content (Astro, Hugo, Next static export, SSR).

### `csr-content-parity` (4 pts)
**Verifies:** Flags sampled pages whose only mount root (`#root`, `#__next`, `#app`, `<app-root>`, `[data-reactroot]`, `[ng-version]`…) is empty in the raw HTML *and* that ship almost no server-rendered text (warn a minority; fail if most). Genuine SSR/SSG output that also carries framework hydration markup — including `data-server-rendered="true"` — passes.
**Why:** Content that appears only after client-side hydration is invisible to AI crawlers, which generally don't run JavaScript: an empty mount root reads as a blank page. This complements `content-without-js` by pinpointing the SPA shell as the cause.
**Fix:** Server-render (SSR/SSG) the initial HTML for `#root`/`#__next`/`#app` and similar mount points so the main content is present before any JavaScript runs.

### `content-depth` (5 pts)
**Verifies:** Main-content word count meets a per-type threshold — Article/Blog ≥300 words, other content pages ≥150, with chrome stripped (warn a minority below; fail if most are thin).
**Why:** Thin pages rarely have enough substance for an assistant to extract or cite a confident answer.
**Fix:** Expand or consolidate thin pages with substantive copy.

### `content-lead-answer` (5 pts)
**Verifies:** The first substantive paragraph after the H1 is a concise self-contained answer/definition (~40–320 chars) or an explicit TL;DR block (warn if buried/overlong; fail if long pages open with fluff/nav).
**Why:** Answer engines quote the lead; a direct opening sentence is far more likely to be lifted verbatim.
**Fix:** Open each page with a 1–2 sentence direct answer or a TL;DR / Key-takeaways block.

### `answer-headings` (4 pts)
**Verifies:** *(skip short pages)* Long content pages carry ≥1 question-style/descriptive H2/H3 — ends `?`, or opens with an English (what/how/why/when/which/…) **or French** (quel/comment/pourquoi/quand/où/combien/…) interrogative, or a listicle opener (best/top/vs, meilleur); warns if all-generic.
**Why:** Question-shaped subheads match how users phrase queries and how assistants segment content into answerable chunks.
**Fix:** Phrase subheadings as the questions readers actually ask.

### `extractable-structure` (4 pts)
**Verifies:** Content has a `<ul>/<ol>` (outside nav/footer) or a data `<table>` with `<th>` inside `<main>/<article>` (warn if sparse; fail on long prose-only pages).
**Why:** Lists and tables are the structures assistants extract most reliably for steps, comparisons and specs.
**Fix:** Break comparisons, steps and specs into bullets and tables.

### `content-freshness` (5 pts)
**Verifies:** *(skip if no article-type pages)* Content pages expose a machine-readable date (`<time datetime>`, `article:*_time`, or JSON-LD datePublished/dateModified) that is recent — pass if freshest ≤12 mo, warn 12–24 mo or only one of pub/mod, fail if none or >24 mo.
**Why:** Assistants prefer and cite recent, dated content; an undated or stale page is discounted.
**Fix:** Emit ISO-8601 datePublished + dateModified and a visible date, and keep them honest.

### `content-author-eeat` (5 pts)
**Verifies:** *(skip if none)* Article/BlogPosting pages have a named `Person` author in JSON-LD **and** a visible byline (warn if only one; fail if neither).
**Why:** E-E-A-T signals — a real, attributable author — raise the trust an answer engine places in the content.
**Fix:** Add a visible byline linking a bio, plus `author:{@type:Person,name,url,jobTitle}` in JSON-LD.

### `outbound-citations` (3 pts)
**Verifies:** Main content links out to distinct non-social, non-self domains (warn if very few sitewide; fail on long content citing nothing).
**Why:** Outbound citations to primary sources are a credibility signal assistants weigh when deciding what to trust.
**Fix:** Cite primary/authoritative sources with real outbound links.

### `content-uniqueness` (3 pts)
**Verifies:** Normalized main text is compared pairwise across the sample (warn on one near-duplicate cluster; fail on several).
**Why:** Near-duplicate bodies split relevance and can get pages filtered as boilerplate.
**Fix:** Give each URL unique content, or canonicalize duplicates.

### `about-contact` (3 pts)
**Verifies:** About + Contact pages are reachable and expose ≥1 contact method (tel/email/ContactPoint) — warn if one is missing, fail if neither.
**Why:** About/Contact pages are core trust and entity signals assistants use to ground and recommend a business.
**Fix:** Publish linked `/about` and `/contact`; add a ContactPoint to Organization JSON-LD.

### `well-known-ai-json` (1 pt)
**Verifies:** `/.well-known/ai.json` answers 200 with a JSON **object** manifest. Missing file, invalid JSON (typically a SPA fallback shell answering 200), or a non-object root all produce a warn — never a fail, because the convention is still emerging.
**Why:** `/.well-known/ai.json` is an emerging AI-discovery convention: a small manifest telling agents what the site is and how to interact with it (name, description, contact, policies). It is advisory-weighted (1 pt) since it is not yet standardized.
**Fix:** Publish a small JSON object at `/.well-known/ai.json` (name, description, contact, policies) — and make sure your SPA fallback doesn't answer that path with 200 HTML.

### `freshness-coherence` (4 pts)
**Verifies:** Cross-checks the three freshness signals a page can emit — the HTTP `Last-Modified` header, the JSON-LD `dateModified` (or `article:modified_time`), and the sitemap `<lastmod>`. Warns when they contradict each other by more than 24h; fails only on a *future* claimed date. Skips a page with fewer than two of the three sources.
**Why:** When a site's freshness signals disagree — or claim a date in the future — engines stop trusting any of them. A deploy that merely bumps `Last-Modified` newer than the claimed dates is benign and not flagged.
**Fix:** Align HTTP `Last-Modified`, JSON-LD `dateModified` and sitemap `<lastmod>` on the real last-edit date, never in the future.

### `hedging-rate` (3 pts)
**Verifies:** On substantial pages (≥150 words), counts hedging phrases (*maybe, it seems, peut-être, il semble*…) in the first two paragraphs; warns (never fails) at two or more. One hedge in the lead is tolerated.
**Why:** Generative engines preferentially quote confident, committed statements, so an evasive lead lowers the odds of being cited. The effect varies by domain — this is an advisory heuristic, not a guarantee.
**Fix:** Open with one crisp, committed claim and move hedged nuance below the lead.

### `answer-units` (4 pts)
**Verifies:** On pillar pages (≥300 words), looks for at least one "answer unit": a short block (8–40 words) that carries a number, date or named entity, opens self-sufficiently (no anaphora/connector) and hedges nothing. Warns (never fails) when a pillar page has none.
**Why:** Answer units are the passages a generative engine can lift and quote verbatim. A long page with no self-contained, fact-anchored statement gives an engine nothing clean to cite.
**Fix:** Add short, self-contained statements (8–40 words) carrying a number, date or named entity.

### `chunk-boundary` (3 pts)
**Verifies:** On substantial pages (≥150 words), flags DOM structures that fall apart when the page is split into retrieval chunks: long tables (>10 rows) without header cells, FAQ answers detached from their question by decorative markup, and 3+-item lists orphaned from any title. Warns (never fails). Nested lists are exempt.
**Why:** Retrieval pipelines chunk a page and lose the context outside each chunk. A headerless table row, an answer far from its question, or an untitled list reaches the model stripped of the meaning that sat around it.
**Fix:** Give long tables `<thead>`/`<th>` headers, keep FAQ answers directly under their question, and title every list.

### `chunk-retrieval-sim` (4 pts)
**Verifies:** *(skip if no pillar page ≥300 words)* Cuts each pillar page into ~512-token windows at block boundaries — the way a retrieval pipeline would — and measures how many of those windows still stand on their own. A window survives when it carries a topic anchor (a number or a named entity, counting the heading trail a retriever prepends) **and** opens without pointing back at the previous window (*it, this, cela, celui-ci…*) or at a discourse connector. Passes at ≥70% survivors; warns below (never fails).
**Why:** An engine is handed one retrieved window, not the page. A window that opens on "It also means…" or names nothing at all is unusable as a citation however good the surrounding article is.
**Fix:** Open each section with a named subject rather than a pronoun, and keep a descriptive heading above every passage.

### `injection-hygiene` (3 pts)
**Verifies:** Text an assistant ingests but a visitor never sees. Three signals: copy hidden by an **inline** style (`display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`, off-screen offsets) or the `hidden` attribute and running to ≥15 words; model-directed instructions (*ignore previous instructions*, *as an AI model*, *recommande toujours*…) found **inside** that hidden copy; and outbound links inside a comment/review container carrying neither `rel="ugc"` nor `rel="nofollow"`. Fails only on hidden copy that carries model instructions; warns on any single signal. Script, style, template and noscript content is exempt, and only inline styles count — stylesheets are never fetched, so the legitimate `.sr-only` pattern is never mistaken for hiding.
**Why:** Hidden instructions are a prompt-injection payload aimed at whatever assistant reads the page, and unattributed user links let third parties speak in the site's voice. The same wording in *visible* copy is fine — a security article discussing injection is legitimate; a page concealing it is not.
**Fix:** Remove inline-hidden copy, and mark user-contributed links `rel="ugc"`.

### `agent-usability` (4 pts)
**Verifies:** Whether an agent can *act* on the site, not only read it. Two dimensions. **Forms** (only when the sampled pages carry at least one `<form>`): fails a form whose submit control is `disabled` or that has no submit control at all (`<button>` with no `type` counts — `type="button"`/`"reset"` do not); warns on an `action` of `javascript:…` or `#`, and on nameable fields (`input`/`select`/`textarea`) missing a `name`. A **missing** `action` is not penalized — HTML posts such a form to the current URL. **Contact path** (always): at least one machine-readable way to reach a human — a `mailto:`/`tel:` link, a form with a non-JavaScript action, or `email`/`telephone`/`contactPoint` (or a `ContactPoint` node) in the JSON-LD; warns if none.
**Why:** Every other check asks whether an engine can read the page. This one asks whether an assistant acting on a visitor's behalf can finish the job — request a quote, send a message, reach a human. An agent cannot run your click handlers, so a form that only submits through JavaScript, or whose button is disabled pending a "V1", is a dead end for it exactly as it is for a visitor with JS off.
**Fix:** Give every form a real submit button that is never disabled, a non-JavaScript `action` and a `name` on every field, and expose a `mailto:`, `tel:` or JSON-LD `contactPoint`.

---

## Structured data & metadata

Machine-readable identity and rich-result eligibility.

### `json-ld` (10 pts)
**Verifies:** The homepage has ≥1 `application/ld+json` block (fail if none).
**Why:** JSON-LD is the machine-readable description answer engines lean on to extract facts without guessing from prose.
**Fix:** Add a JSON-LD block describing the business or content.

### `json-ld-valid` (4 pts)
**Verifies:** Every JSON-LD block parses and each top node has a schema.org `@context` plus a non-empty `@type` (fail on any parse error or missing `@type`).
**Why:** A single syntax error makes the whole block invisible to every parser.
**Fix:** Fix trailing commas/unescaped quotes; set `@context` + an explicit `@type`.

### `json-ld-entity` (6 pts)
**Verifies:** The homepage declares a substantive primary entity (LocalBusiness subtype / Organization / Article / WebSite), with NAP present when LocalBusiness (warn on incomplete NAP; fail if only WebPage/BreadcrumbList wrappers).
**Why:** A generic or missing primary `@type` tells assistants nothing usable about what the page represents.
**Fix:** Mark up the real thing the page is about, not just a WebPage wrapper.

### `schema-coverage` (5 pts)
**Verifies:** *(skip if <2 pages sampled)* Fraction of sampled pages carrying valid JSON-LD — pass ≥50%, warn >0%, fail if only the homepage.
**Why:** Structured data on inner pages helps assistants understand and cite the whole site, not just the front door.
**Fix:** Emit page-appropriate JSON-LD from every template.

### `sd-organization` (4 pts)
**Verifies:** An Organization/LocalBusiness node with name + url + absolute-https logo + ≥1 `sameAs` (warn if no/empty sameAs or a relative logo; fail if no Organization).
**Why:** A complete Organization node is the anchor for your brand's knowledge-graph identity.
**Fix:** Add name/url/square-logo/sameAs to the homepage `@graph`.

### `sd-entity-grounding` (4 pts)
**Verifies:** `sameAs` has ≥2 absolute profile URLs, with a bonus for a wikipedia.org or wikidata.org anchor (warn if only 1 or no KG anchor; fail if no sameAs).
**Why:** Linking to authoritative profiles grounds your entity so assistants can disambiguate and trust it.
**Fix:** List official LinkedIn/GitHub/Wikipedia/Wikidata URLs in `sameAs`.

### `sd-localbusiness` (3 pts)
**Verifies:** *(skip if no LocalBusiness)* Structured `PostalAddress` (street/locality/postal/country) + telephone + `geo` + opening hours (warn on a bare-string address or missing geo/hours; fail if no structured address).
**Why:** Complete, structured NAP + geo + hours is what lets an assistant recommend you with correct, verifiable details.
**Fix:** Use structured PostalAddress + GeoCoordinates + openingHoursSpecification.

### `sd-article` (4 pts)
**Verifies:** *(skip if no Article/News/BlogPosting)* headline ≤110 chars + author(name) + datePublished (ISO); recommends dateModified/image/publisher.logo (warn on bare-string author or missing recommended; fail if no headline or unparseable date).
**Why:** Complete Article markup drives article rich results and gives assistants clean metadata to cite.
**Fix:** Add headline/author/datePublished, plus dateModified/image/publisher.logo.

### `sd-product` (4 pts)
**Verifies:** *(skip if no Product)* name + image + `offers` with numeric price + ISO-4217 priceCurrency + availability; bonus brand/aggregateRating/gtin/mpn (warn on missing bonus fields; fail on missing price/currency or an out-of-range rating).
**Why:** Product markup powers merchant rich results and lets shopping assistants surface accurate price and availability.
**Fix:** Add offers(price/priceCurrency/availability) + brand + gtin/mpn; never mark up ratings not shown on the page.

### `sd-faq` (4 pts)
**Verifies:** *(skip if no FAQ-shaped content)* FAQPage/QAPage JSON-LD (≥2 Question → non-empty acceptedAnswer) and/or an on-page Q&A block — `<details>/<summary>` pairs, or question headings (French and English) each followed by an answer paragraph (warn if the on-page FAQ has no schema).
**Why:** FAQ markup is among the most directly quotable structures for question-answering assistants.
**Fix:** Mark FAQs as FAQPage → Question → acceptedAnswer.Text.

### `sd-breadcrumb` (3 pts)
**Verifies:** *(skip homepage-only)* Interior pages expose a `BreadcrumbList` (ordered ListItem, contiguous position from 1) or visible breadcrumb nav (warn on broken positions/URLs).
**Why:** Breadcrumbs convey site hierarchy that assistants use to understand where a page sits.
**Fix:** Emit a BreadcrumbList with ordered position/name/item.

### `sd-website-searchaction` (2 pts)
**Verifies:** *(skip if no WebSite node)* A WebSite node with a `potentialAction` SearchAction whose target contains `{search_term_string}` (warn if WebSite present but no SearchAction).
**Why:** It enables the sitelinks search box in results.
**Fix:** Add a SearchAction target `?q={search_term_string}` with `required name=search_term_string`.

### `sd-video` (2 pts)
**Verifies:** *(skip unless a `<video>`/YouTube embed or VideoObject is present)* VideoObject with name + description + absolute thumbnailUrl + ISO uploadDate; bonus contentUrl/embedUrl/duration (fail if video present but no/incomplete VideoObject).
**Why:** VideoObject markup makes video eligible for video rich results and assistant surfaces.
**Fix:** Add VideoObject(name/description/thumbnailUrl/uploadDate).

### `sd-special-types` (3 pts)
**Verifies:** *(skip unless present)* HowTo / Event / Recipe required fields are well-formed (e.g. Event needs name + ISO startDate + location); fail on any missing required field.
**Why:** These types unlock their own rich results only when the required fields are complete and valid.
**Fix:** Fill the required fields for the declared type, using ISO dates and structured Place.

### `sd-graph-integrity` (3 pts)
**Verifies:** *(skip unless `@id` used)* Every `{"@id":…}` reference resolves to a node in the same page graph (warn on duplicated entities; fail on a dangling reference).
**Why:** Dangling `@id` references break the entity graph assistants try to assemble.
**Fix:** Use one `@graph` with a stable `@id` per entity and reference by `@id`.

### `sd-consistency` (3 pts)
**Verifies:** Key JSON-LD values (name/headline, price, ratingValue) have a matching string in the visible body (**warn-only** — never hard-fails).
**Why:** Marking up content that isn't visible on the page risks a structured-data spam penalty.
**Fix:** Only mark up content the page actually shows.

### `nap-consistency` (3 pts)
**Verifies:** *(skip if no NAP)* One normalized phone (and address) appears consistently across sampled footers and matches the JSON-LD NAP (warn on minor divergence; fail on conflicts).
**Why:** Inconsistent contact details erode the trust needed for an assistant to recommend a business.
**Fix:** Render one canonical NAP from a single source and match it in JSON-LD.

### `entity-graph-connectivity` (4 pts)
**Verifies:** Builds the JSON-LD entity graph across sampled pages and checks it is coherent — every `@id` reference resolves to a defined node, and named root entities (Organization/WebSite/Person/LocalBusiness) are linked into one connected graph (warn if no JSON-LD entities exist at all, or if root entities form separate disconnected clusters; fail on any dangling `@id` reference).
**Why:** A clean, connected entity graph is how AI engines resolve who you are and tie your pages, brand and authors together.
**Fix:** Use one `@graph` with a stable `@id` per entity, define every referenced `@id`, and cross-link Organization ↔ WebSite (and Person/LocalBusiness) by `@id`.

### `open-graph` (5 pts)
**Verifies:** Core OG tags are non-empty — og:title, og:description, og:image (absolute https), og:type, og:url; bonus og:site_name/og:locale (warn on missing bonus; fail on missing og:image or og:title).
**Why:** Open Graph is the de facto preview format for chat apps and increasingly AI citations; missing tags produce bare links.
**Fix:** Add the full OG set with og:image absolute and ≥1200×630.

### `twitter-card` (2 pts)
**Verifies:** A `twitter:card` with a known type (summary/summary_large_image); title/description/image direct or via OG fallback (warn on a generic type; fail if no card and no OG image fallback).
**Why:** It controls how links render on X/Twitter and some other embedders.
**Fix:** Add `twitter:card` (summary_large_image) or rely on a complete OG set.

---

### `rich-result-eligibility` (4 pts)
**Verifies:** *(skip when no marked-up type has published Google requirements)* For each detected type — Article, Product snippet, merchant listing, Recipe, Event, Breadcrumb, Video, Review snippet, aggregate rating — that Google's REQUIRED properties are present (fail if not) and its RECOMMENDED ones too (warn).
**Why:** schema.org validity is not eligibility. A `Product` without `offers.price` is valid markup that still cannot produce a rich result.
**Fix:** Fill the REQUIRED properties Google publishes for each type you mark up; treat RECOMMENDED as the gap between eligible and competitive.

### `sd-page-entity` (3 pts)
**Verifies:** *(skip when no homepage WebPage/CreativeWork node and no article page)* That `WebPage`/`Article`/`CreativeWork` nodes name their primary entity through `about` or `mainEntity`, and that the entity named is anchored — a resolvable `@id` in the graph, or a `sameAs`. Warn at worst.
**Why:** A page that never states its subject leaves the engine to infer it from prose. Naming it removes the guess.
**Fix:** Add `about` (and `mentions` for secondary entities) pointing at an `@id` that exists in your graph.

## Technical SEO

Crawlability and indexation hygiene.

### `canonical` (5 pts)
**Verifies:** Each sampled page has exactly one `rel=canonical`, absolute + same-origin + https, self-referential for standalone pages (an HTTP `Link: rel=canonical` header counts); fail if missing, multiple, or everything points at `/`.
**Why:** Without a correct canonical, content reachable via several URLs splits its authority and confuses crawlers.
**Fix:** Set one absolute, self-referential canonical per page.

### `canonical-resolves` (4 pts)
**Verifies:** Each declared canonical URL returns 200 with no redirect hop and is not noindex (warn on a redirecting canonical; fail on 4xx/5xx or noindex).
**Why:** A canonical pointing at a broken or noindexed URL tells crawlers to consolidate onto a page that can't rank.
**Fix:** Point canonicals only at live, indexable, non-redirecting URLs.

### `sitemap` (10 pts)
**Verifies:** A sitemap is discovered (robots `Sitemap:` / `/sitemap.xml` / `-index` / `_index`), is valid XML with `urlset|sitemapindex` and ≥1 `<loc>` (warn if valid but unreferenced; fail if none/invalid).
**Why:** The sitemap is how crawlers discover pages beyond the homepage and learn what changed.
**Fix:** Generate sitemap.xml and reference it in robots.txt.

### `sitemap-lastmod` (4 pts)
**Verifies:** A share of `<url>` entries carry a valid W3C/ISO `<lastmod>`, none future-dated, values varied (warn if missing/uniform; fail if all future/garbage).
**Why:** Honest per-URL lastmod values help crawlers prioritize what to recrawl.
**Fix:** Emit real per-URL lastmod, not the build date.

### `sitemap-urls-valid` (4 pts)
**Verifies:** Sampled sitemap URLs return 200 same-origin https, self-canonical, not noindex, no redirect hop (warn a minority; fail on redirects/404/noindex/non-canonical entries).
**Why:** A sitemap listing non-indexable URLs wastes crawl budget and signals low quality.
**Fix:** List only final, indexable, self-canonical URLs.

### `sitemap-index-limits` (2 pts)
**Verifies:** *(skip unless a `<sitemapindex>`)* Each child `<loc>` is fetchable, valid XML, same-origin, and under 50,000 URLs / ~50 MB (fail on an oversize or unreachable child).
**Why:** Oversized or broken child sitemaps are silently dropped by crawlers.
**Fix:** Split into ≤50k-URL children under one index.

### `sitemap-orphans` (3 pts)
**Verifies:** Cross-references sitemap URLs against same-origin internal links in the sample (warn on divergence — sitemap URLs never linked, or linked pages absent from the sitemap).
**Why:** Pages that are in the sitemap but never linked (or vice-versa) send mixed discoverability signals.
**Fix:** Ensure key pages are both internally linked and in the sitemap.

### `internal-linking` (4 pts)
**Verifies:** Each sampled content page has ≥1 internal outlink, BFS click-depth from home ≤3, no sampled non-home page unreferenced (warn on isolated/deep pages).
**Why:** Shallow, well-linked pages are crawled more fully and pass authority to one another.
**Fix:** Add contextual internal links via hub pages; keep key pages ≤3 clicks from home.

### `link-equity-map` (3 pts)
**Verifies:** Over the internal link graph of the sample, computes each page's in-degree and a sample-scoped PageRank (damping 0.85, 20 fixed iterations, deterministic), names the top-ranked pages with their share and flags orphans (no inbound links from other sampled pages) and dead-ends (no internal outlinks). Skips on fewer than 3 sampled pages.
**Why:** Where `internal-linking` flags depth and underlinking as booleans, this maps how link equity is actually *distributed* — revealing which pages hoard authority and which are starved of it.
**Fix:** Link every page from at least one other page and give every page at least one internal outlink, so equity flows across the whole site instead of pooling on a few pages.

### `crawlable-nav` (4 pts)
**Verifies:** Share of navigation anchors that need JavaScript to work — anchors with no `href`, `href="#"`, or `href="javascript:…"` — across the sampled pages. In-page `#section` fragments are ignored; a ratio guard passes the odd UI-toggle link (warn >20 %, fail >50 % JS-dependent).
**Why:** Most AI answer-engine crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot) and Google's first crawl pass do not run JavaScript, so JS-only links are dead ends and the pages behind them go undiscovered.
**Fix:** Use real `<a href="/path">` links for navigation so crawlers that don't execute JavaScript can reach every page.

### `broken-internal-links` (8 pts)
**Verifies:** Up to 30 distinct same-origin `<a>` targets across the sample resolve below 400 (warn ≥80% ok; fail below). Cloudflare `/cdn-cgi/` endpoints are ignored.
**Why:** Broken internal links waste crawl budget and break the trail an assistant follows to verify a citation.
**Fix:** Fix or remove links returning 400+.

### `www-consolidation` (5 pts)
**Verifies:** The www and apex variants — exactly one *lands* on 200 on its own host and the other 301s across to it (warn on 302; fail if both are live, if they point at each other, or if a chain loops). A same-host path redirect (`/` → `/en/`) still counts as serving; only a hop that leaves the host is a consolidation signal.
**Why:** Two live hostnames duplicate every URL and split ranking signals.
**Fix:** 301 the non-canonical host to the chosen one.

### `trailing-slash` (4 pts)
**Verifies:** For sampled paths, the slash-toggled variant (no-follow) 301s to the canonical form rather than both returning 200 (warn on 302; fail on both-200 duplicates).
**Why:** `/page` and `/page/` both serving 200 creates duplicate URLs.
**Fix:** Enforce one convention with a 301.

### `redirect-chains` (4 pts)
**Verifies:** Manual-follow from home + sampled URLs — no chain over 1 hop, no loop, permanent moves use 301/308 not 302/307 (warn on a wrong-type redirect; fail on chains/loops).
**Why:** Redirect chains waste crawl budget and leak a little authority at each hop.
**Fix:** Collapse to a single 301 to the final URL.

### `soft-404` (6 pts)
**Verifies:** A random nonexistent path returns 404/410, not 200 or a redirect to home (fail on a 200 soft-404 or a 301→home).
**Why:** Soft-404s let junk URLs into the index and hide genuinely missing pages.
**Fix:** Make missing routes return a real 404/410 status.

### `custom-404` (2 pts)
**Verifies:** The 404 body offers a way back — nav, internal links, or search (warn on a bare/raw error).
**Why:** A dead-end 404 loses users and crawlers who could otherwise recover.
**Fix:** Return a branded 404 (with 404 status) that includes nav and a home link.

### `url-structure` (3 pts)
**Verifies:** Sampled URLs and link targets are ≤~115 chars, lowercase, hyphen-separated, shallow, with no session/tracking params (warn a minority; fail on widespread session IDs/params in canonical form).
**Why:** Clean, stable, readable URLs are easier to crawl, cite and share.
**Fix:** Use short lowercase hyphenated slugs and strip tracking params.

### `pagination-canonical` (2 pts)
**Verifies:** *(skip unless pagination is detected)* Paginated pages are self-canonical and indexable, not canonicalized to page 1 (fail if pointed at page 1).
**Why:** Canonicalizing page 2+ to page 1 hides their content from the index.
**Fix:** Self-reference each paginated page and keep it indexable.

### `hreflang` (3 pts)
**Verifies:** *(skip single-language)* Declared hreflang alternates return 200 and reciprocate (fail on broken or non-reciprocal alternates).
**Why:** Search and AI systems only trust hreflang when alternates are reachable and mutually reference each other.
**Fix:** Ensure every alternate returns 200 and links back.

### `hreflang-x-default` (3 pts)
**Verifies:** *(skip single-language)* An `x-default` alternate exists, every hreflang value is valid BCP-47, a self-referencing hreflang is present, hrefs are absolute (warn on missing x-default/self; fail on invalid codes).
**Why:** A complete hreflang set with x-default is what routes users to the right language variant.
**Fix:** Add x-default + a self hreflang, valid BCP-47 codes and absolute URLs.

### `meta-refresh` (2 pts)
**Verifies:** No sampled page uses `<meta http-equiv="refresh">` as a redirect (fail on any).
**Why:** Meta-refresh redirects are a hidden, non-cacheable redirect class that crawlers handle poorly.
**Fix:** Replace them with a server 301.

### `indexnow` (4 pts)
**Verifies:** *(skip unless `--indexnow-key`)* `/<key>.txt` returns the key exactly (fail if missing/mismatched).
**Why:** IndexNow pushes URL changes to participating engines instantly; the key file proves domain ownership.
**Fix:** Publish `<key>.txt` at the root containing exactly the key.

---

### `internal-link-context` (3 pts)
**Verifies:** *(skip below 5 sampled pages, or when the sample has no internal link)* The share of internal links sitting in the main content rather than in nav, header or footer; warn below 10%.
**Why:** A link that exists only in sitewide furniture carries far less signal than one a crawler meets inside the copy.
**Fix:** Link from inside your body copy, not only from the navigation and footer.

### `internal-equity-leaks` (3 pts)
**Verifies:** *(skip when the sample has no internal link)* Internal `<a>` carrying `rel=nofollow`, `sponsored` or `ugc`. Redirect targets are excluded deliberately — no equity is lost through a 30x — and `noindex` targets are counted in the message but never graded, because deliberately de-indexing a page is a normal choice. Warn at worst.
**Why:** `rel=nofollow` on your own links stops them being followed for no gain, and is almost always an accidental template or plugin setting.
**Fix:** Remove `rel=nofollow` from links to your own pages.

### `outbound-link-health` (3 pts)
**Verifies:** *(opt-in: skip unless `--check-outbound` is passed)* Up to 10 outbound links, one per host, main-content links first, probed with HEAD and a ranged GET fallback. Only 404 and 410 count as broken; 401, 403, 429, 5xx, timeouts and DNS failures are reported as unverifiable, never as dead.
**Why:** A citation that no longer resolves weakens the page that made it, for readers and for engines weighing your sourcing.
**Fix:** Update or remove the outbound links returning 404/410.

## On-page & content

Titles, headings, meta, and document-head correctness.

### `title-description` (8 pts)
**Verifies:** The homepage has a `<title>` (10–70 chars) and a meta description (50–160 chars); warn if out of range, fail if either is missing.
**Why:** These two tags are the default snippet on every search surface and a compressed summary answer engines read.
**Fix:** Add a 10–70 char title and a 50–160 char description; be specific and factual.

### `meta-per-page` (5 pts)
**Verifies:** Every sampled page has an in-range `<title>` and meta description (warn a minority; fail if many are missing or too long).
**Why:** Every page — not just the homepage — needs its own snippet metadata to rank and be cited distinctly.
**Fix:** Give each page a unique in-range title + description.

### `unique-titles` (5 pts)
**Verifies:** *(skip if <2 pages)* Titles and descriptions are unique across the sample; duplicates lower the score by proportion.
**Why:** Duplicate titles/descriptions make results and citations indistinguishable and dilute relevance.
**Fix:** Give every page a distinct, descriptive title and description.

### `title-pattern` (3 pts)
**Verifies:** The homepage title is not brand-only and has a brand segment after a separator (`| - – — ·`), brand not front-loaded (warn on brand-first or no separator).
**Why:** A topic-first title surfaces the page's subject before the brand in truncated results.
**Fix:** Format as `Primary topic — Brand`.

### `title-h1-alignment` (2 pts)
**Verifies:** The homepage `<title>` and `<h1>` share meaningful tokens after removing stopwords/brand (warn on near-zero overlap).
**Why:** A title and H1 on divergent topics dilute the page's perceived subject.
**Fix:** Keep the H1 and title on the same subject.

### `headings-outline` (5 pts)
**Verifies:** Exactly one non-empty `<h1>` per page and no skipped heading level descending (warn if mostly conformant; fail on zero/multiple H1 or repeated skips).
**Why:** A clean heading hierarchy is how assistants segment a page into extractable sections.
**Fix:** Use one H1 stating the topic and nest H2/H3 without skipping levels.

### `anchor-text` (3 pts)
**Verifies:** Internal anchor text is descriptive — under 10% generic/empty ("click here", "read more", bare URL, image-only without alt) (warn above 10%; fail if most are non-descriptive).
**Why:** Descriptive anchors tell crawlers and assistants what the destination is about.
**Fix:** Name the destination in the anchor text.

### `charset` (3 pts)
**Verifies:** UTF-8 is declared in the first 1024 bytes of `<head>` (`<meta charset>` / http-equiv) and/or the Content-Type header (warn on a legacy charset; fail if none).
**Why:** An undeclared or wrong charset can garble text for parsers.
**Fix:** Add `<meta charset="utf-8">` first in `<head>`.

### `favicon` (2 pts)
**Verifies:** A `rel=icon`/`shortcut icon` (or `/favicon.ico`) plus an `apple-touch-icon`; bonus `theme-color` (warn if favicon only; fail if neither).
**Why:** Favicons and touch icons appear beside your brand in results, tabs and share cards.
**Fix:** Add `rel=icon` + `apple-touch-icon` (and optionally `theme-color`).

### `content-readability` (2 pts)
**Verifies:** Flesch reading-ease / average sentence length of the homepage main text (**warn-only** on wall-of-text).
**Why:** Dense, hard-to-read copy is harder for both people and models to extract a clean answer from.
**Fix:** Break up long sentences and paragraphs.

### `figure-caption` (2 pts)
**Verifies:** *(skip if no content images)* Explanatory content images are wrapped in `<figure>` with `<figcaption>` (**warn-only**).
**Why:** Captions give images textual context that assistants can read and cite.
**Fix:** Wrap explanatory images in `<figure>`/`<figcaption>`.

---

### `topical-focus` (3 pts)
**Verifies:** *(skip when no page declares at least 3 title/H1 topic words and carries 100 words of prose)* How much of the main-content prose reinforces the topic declared by `<title>` and `<h1>` (weighted double) plus the meta description; warn below 35%.
**Why:** A title is a promise. When the body does not deliver on it, a retriever that pulled the page for that topic finds nothing worth quoting.
**Fix:** Say in the body what the title claims the page is about.

### `keyword-cannibalization` (3 pts)
**Verifies:** *(needs at least 2 pages; skip below 2 comparable ones)* Distinct pages whose `<title>`/`<h1>` token sets, brand removed, overlap at Jaccard ≥ 0.6. Byte-identical titles, near-duplicate bodies and declared language variants are excluded — they belong to `unique-titles`, `content-uniqueness` and hreflang respectively.
**Why:** Two pages promising the same thing split the signal, and neither wins the intent.
**Fix:** Merge them, or re-aim one at a distinct intent and redirect.

### `anchor-target-profile` (3 pts)
**Verifies:** *(skip below 2 internal targets with a gradable profile)* Per internal target, whether the dominant anchor text shares meaningful, non-brand words with the target's title/H1, and whether 3 or more anchors show any diversity. Language-switcher links (`hreflang`) and the brand logo link are ignored.
**Why:** The words people click are the strongest hint an engine gets about what the destination covers.
**Fix:** Name the destination in the anchor text.

## Performance & Core Web Vitals

Static heuristics run always; field/lab Core Web Vitals are opt-in via `--cwv --psi-key`. Without a key, the CWV checks skip and the family scores on the static heuristics alone.

### `html-weight` (3 pts)
**Verifies:** Raw HTML document bytes — pass ≤100 KB, warn ≤250 KB, fail >250 KB.
**Why:** A heavy HTML document slows first paint and inflates crawl cost.
**Fix:** Externalize large inline blobs and paginate huge pages.

### `render-blocking-js` (4 pts)
**Verifies:** External `<script src>` in `<head>` lacking async/defer/module — pass 0, warn 1–2, fail ≥3.
**Why:** Head scripts block rendering, delaying LCP and interactivity.
**Fix:** Add defer/async or move scripts to the end of `<body>`.

### `render-blocking-css` (3 pts)
**Verifies:** External `<link rel=stylesheet>` in `<head>` without media/preload deferral — pass ≤2, warn 3–4, fail ≥5.
**Why:** Every render-blocking stylesheet is a round-trip before the page can paint.
**Fix:** Inline critical CSS, defer the rest, and reduce requests.

### `img-dimensions` (4 pts)
**Verifies:** `<img>` with explicit width+height or CSS aspect-ratio — pass ≥90%, warn 70–89%, fail <70%.
**Why:** Images without reserved space cause layout shift (CLS).
**Fix:** Set intrinsic width/height (or aspect-ratio) on images.

### `img-lazy-loading` (2 pts)
**Verifies:** Below-fold images carry `loading=lazy` while the hero stays eager (**warn-only** on many eager off-screen images or a lazy likely-LCP image).
**Why:** Lazy-loading off-screen images saves bandwidth; lazy-loading the hero delays LCP.
**Fix:** Add `loading=lazy` below the fold and keep the LCP image eager.

### `img-next-gen` (2 pts)
**Verifies:** Raster images are served as/offered in WebP/AVIF — pass ≥50% (**warn-only** on a high share of raw jpg/png).
**Why:** Modern formats cut image bytes substantially, speeding load.
**Fix:** Serve AVIF/WebP with `<picture>` + srcset.

### `resource-hints` (2 pts)
**Verifies:** `preconnect`/`dns-prefetch` for critical third-party origins and `preload` for the LCP image/key font (**warn-only** when absent).
**Why:** Hints let the browser open connections and fetch critical assets earlier.
**Fix:** Preconnect critical hosts and preload the hero image/font.

### `dom-size` (2 pts)
**Verifies:** Total element nodes and max nesting depth — pass ≤800 elements, warn ≤1400 or depth >32, fail >1400.
**Why:** A large DOM slows style, layout and interaction.
**Fix:** Simplify markup and virtualize long lists.

### `text-compression` (3 pts)
**Verifies:** The HTML response `Content-Encoding` is br/zstd/gzip (fail if absent on text/html).
**Why:** Uncompressed HTML wastes bandwidth and slows delivery.
**Fix:** Enable Brotli/gzip for text at the server or CDN.

### `asset-caching` (2 pts)
**Verifies:** A sampled static asset carries `Cache-Control` max-age / ETag (**warn-only** when missing).
**Why:** Long-lived caching on hashed assets speeds repeat visits.
**Fix:** Send `Cache-Control: public, max-age=31536000, immutable` on hashed assets.

### `inline-head-volume` (2 pts)
**Verifies:** Byte volume of inline `<style>`+`<script>` in `<head>` — pass ≤14 KB (**warn-only** >50 KB).
**Why:** Bloated inline head content delays the first paint it was meant to speed up.
**Fix:** Keep only minimal critical CSS inline and externalize the rest.

### `lighthouse-perf` (5 pts)
**Verifies:** *(skip without PSI)* Lighthouse performance score (mobile) — pass ≥0.90, warn 0.50–0.89, fail <0.50.
**Why:** A single lab score summarizes the page's synthetic performance.
**Fix:** Act on the top PSI opportunities — render-blocking resources, unused JS, images.

### `cwv-lcp` (6 pts)
**Verifies:** *(skip without data)* Field p75 Largest Contentful Paint (lab fallback) — pass ≤2500 ms, warn 2500–4000, fail >4000.
**Why:** LCP is the headline loading metric and a confirmed ranking signal.
**Fix:** Preload the LCP image/font and remove render-blocking resources ahead of it.

### `cwv-cls` (4 pts)
**Verifies:** *(skip without data)* Field p75 Cumulative Layout Shift — pass ≤0.10, warn 0.10–0.25, fail >0.25.
**Why:** Layout shift is a jarring experience and a ranking signal.
**Fix:** Set dimensions on media/ads and reserve space for injected banners.

### `cwv-inp` (4 pts)
**Verifies:** *(skip if absent)* Field p75 Interaction to Next Paint — pass ≤200 ms, warn 200–500, fail >500 (low traffic → skip, never fail).
**Why:** INP measures real responsiveness to user input and is a Core Web Vital.
**Fix:** Break up long JS tasks and defer third-party scripts.

### `cwv-assessment` (4 pts)
**Verifies:** *(skip without field data)* The CrUX `overall_category` — pass FAST, warn AVERAGE, fail SLOW.
**Why:** It's Google's own pass/fail verdict on the page's field experience.
**Fix:** Fix whichever of LCP/CLS/INP is worst first.

### `cwv-ttfb` (3 pts)
**Verifies:** Field p75 Time To First Byte (lab server-response fallback) — pass ≤800 ms, warn 800–1800, fail >1800.
**Why:** A slow TTFB delays everything downstream of it.
**Fix:** Add edge caching/CDN and enable keep-alive/HTTP2.

### `lab-tbt` (3 pts)
**Verifies:** *(skip without PSI)* Lab Total Blocking Time (an INP proxy) — pass <200 ms, warn 200–600, fail >600.
**Why:** TBT approximates how long the main thread is blocked during load.
**Fix:** Reduce/defer JS, code-split, and cut third-party tags.

### `lab-fcp` (3 pts)
**Verifies:** *(skip without PSI)* Lab First Contentful Paint (and LCP) when no field data — pass FCP ≤1800 ms & lab LCP ≤2500 ms.
**Why:** When no real-user data exists, lab paint timings are the best available proxy.
**Fix:** Shorten the critical request chain and eliminate render-blocking CSS/JS.

---

### `http-protocol` (3 pts)
**Verifies:** *(skip on plain HTTP, a non-standard port, a private address, a DNS failure, or a handshake that does not complete)* The protocol ALPN actually negotiates over one TLS connection to the origin; warn on HTTP/1.1 or on no ALPN protocol at all. An `Alt-Svc: h3` advertisement is reported but never graded — it is an announcement, and this probe cannot speak QUIC to verify it.
**Why:** HTTP/1.1 serialises requests per connection; HTTP/2 removes that queue for every visitor and every crawler.
**Fix:** Enable HTTP/2 at your host or CDN — it is a configuration setting, not an engineering project.

### `cdn-edge-cache` (2 pts)
**Verifies:** *(skip when no CDN or cache header is present, or when no sampled page both declares a cacheable policy and reports a cache status)* CDN and edge-cache fingerprints read from headers the crawl already collected — no extra request. Warn when pages ask to be cached and none was served from the edge.
**Why:** A cacheable page that never hits the edge pays origin latency on every single request.
**Fix:** Check the cache rules your CDN applies to HTML.

## Accessibility

Semantics that double as extraction signals.

### `html-lang` (4 pts)
**Verifies:** Every sampled page's `<html lang>` is present and valid BCP-47, consistent with self hreflang on multilingual sites (warn if malformed; fail if absent).
**Why:** The lang attribute tells assistive tech and crawlers what language to interpret.
**Fix:** Add `<html lang="…">` with a valid BCP-47 code.

### `images-alt` (4 pts)
**Verifies:** Share of `<img>` with an `alt` attribute (`alt=""` ok for decorative) — pass ≥90%, warn 60–89%, fail <60%.
**Why:** Alt text is how screen readers and LLMs understand images; missing alt loses that content.
**Fix:** Add descriptive alt (and `alt=""` for decorative images).

### `alt-descriptive` (3 pts)
**Verifies:** Non-empty alts are genuinely descriptive — not a filename or "image"/"photo" placeholder (pass ≥90% descriptive; warn 70–90%; fail below).
**Why:** A filename or placeholder alt conveys nothing to a reader or model.
**Fix:** Replace filename/placeholder alt with a real description.

### `landmarks` (4 pts)
**Verifies:** A single `<main>` (or `<article>` for posts) plus ≥2 of header/nav/footer (or ARIA roles) (warn on main-only; fail on div-soup).
**Why:** Landmarks let assistive tech and extractors find the primary content vs chrome.
**Fix:** Wrap content in `<main>` and use header/nav/footer.

### `form-labels` (3 pts)
**Verifies:** *(skip if no forms)* Every input/select/textarea has an accessible name (label/aria-label/aria-labelledby/title) — pass 100%, warn 1–2, fail >2 or >20%.
**Why:** Unlabelled controls are unusable to screen-reader users.
**Fix:** Associate each input with a label or `aria-label`.

### `link-text` (3 pts)
**Verifies:** Links have an accessible name (text / aria-label / title / image-child alt); no empty or icon-only links without a name (warn on a few; fail on multiple).
**Why:** A nameless link is announced as "link" with no destination context.
**Fix:** Give icon/image links an accessible name.

### `viewport` (5 pts)
**Verifies:** A `<meta name="viewport">` tag is present (fail if absent).
**Why:** The viewport tag marks a mobile-ready page; search engines index mobile-first.
**Fix:** Add `<meta name="viewport" content="width=device-width, initial-scale=1">`.

### `viewport-zoom` (3 pts)
**Verifies:** The viewport does not disable zoom — no `user-scalable=no`, `maximum-scale` ≥2 or unset (warn on maximum-scale 1–2; fail on user-scalable=no or ≤1).
**Why:** Disabling zoom fails WCAG 1.4.4 and locks out low-vision users.
**Fix:** Remove `user-scalable=no` and any low `maximum-scale`.

### `iframe-title` (2 pts)
**Verifies:** *(skip if no iframes)* Every `<iframe>` has a non-empty title/aria-label (warn on some missing; fail on multiple untitled).
**Why:** An untitled iframe is announced without any description of its content.
**Fix:** Add a `title` to each iframe.

---

## Security & trust

Trust posture: HTTPS end-to-end, security headers, no mixed content.

### `https` (5 pts)
**Verifies:** *(skip local/private hosts)* The final URL scheme is https (fail on http).
**Why:** HTTPS is a baseline trust signal; crawlers demote plain-HTTP sites and browsers warn users away.
**Fix:** Serve everything over HTTPS.

### `redirect-hygiene` (4 pts)
**Verifies:** *(skip local)* The `http://` variant 301-redirects to https, not just landing on https (warn on a 302 or no redirect; fail if served over http).
**Why:** Without a clean HTTP→HTTPS 301, legacy links land on a non-canonical or insecure URL.
**Fix:** 301 all http→https.

### `mixed-content` (4 pts)
**Verifies:** *(skip if not https)* No subresource (script/link/img/iframe/media) uses `http://` (warn on passive-only; fail on active mixed content).
**Why:** Mixed content is blocked or downgraded by browsers and undermines the HTTPS guarantee.
**Fix:** Use https:// (or protocol-relative) for all subresources.

### `hsts` (4 pts)
**Verifies:** *(skip local)* `Strict-Transport-Security` with `max-age` ≥ 180 days; bonus includeSubDomains/preload (warn if shorter; fail if absent on https).
**Why:** HSTS forces browsers to use HTTPS, closing the first-request downgrade window.
**Fix:** Send `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

### `x-content-type-options` (3 pts)
**Verifies:** `X-Content-Type-Options: nosniff` (fail if absent/other).
**Why:** Without nosniff, browsers may MIME-sniff responses into an exploitable type.
**Fix:** Add `X-Content-Type-Options: nosniff`.

### `csp` (3 pts)
**Verifies:** A `Content-Security-Policy` header or meta (warn if it uses `unsafe-inline`/`*` for scripts; fail if none).
**Why:** A CSP is the main defense against injected-script (XSS) attacks.
**Fix:** Add a CSP restricting script/style/connect sources.

### `clickjacking` (3 pts)
**Verifies:** `X-Frame-Options` DENY/SAMEORIGIN **or** CSP `frame-ancestors` (not `*`) (fail if neither).
**Why:** Without it, your pages can be framed for clickjacking attacks.
**Fix:** Add `X-Frame-Options: SAMEORIGIN` or `frame-ancestors 'self'`.

### `referrer-policy` (2 pts)
**Verifies:** A `Referrer-Policy` with a non-leaky value (warn on a leaky `unsafe-url`; fail if absent).
**Why:** A leaky referrer policy exposes full URLs (and any params) to third parties.
**Fix:** Send `Referrer-Policy: strict-origin-when-cross-origin`.

### `permissions-policy` (2 pts)
**Verifies:** A `Permissions-Policy` (or legacy Feature-Policy) is present (fail if absent).
**Why:** It restricts which powerful browser features (camera, mic, geolocation) the page and its frames may use.
**Fix:** Add `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

---

### `security-txt` (2 pts)
**Verifies:** `/.well-known/security.txt` (RFC 9116) exists, is served as text (not an HTML app shell), carries the required `Contact:` field, and an `Expires:` date still in the future. Warns — never fails — in every other case.
**Why:** It is the machine-readable address a security researcher (or an automated scanner) uses to reach you. An absent, contactless or expired file reads as an unattended site, and it is the last `/.well-known/` discovery file alongside `robots.txt`, `llms.txt` and `ai.json`.
**Fix:** Publish `/.well-known/security.txt` with at least `Contact:` (a mailto: or https: address that reaches someone) and `Expires:` an ISO-8601 date in the future — then renew it before it lapses.

### `broken-subresources` (4 pts)
**Verifies:** A page's markup can be flawless while the files it loads are gone.
**Why:** A page's markup can be flawless while the files it loads are gone. A 404 on a stylesheet strips the page of its layout, a 404 on a script removes whatever it was meant to hydrate, and a 404 on an image leaves an alt string where the illustration a citation refers to should be. None of this is visible in the HTML — only the response tells you, which is why it survives review and ships. This probes the subresources the sampled pages actually reference (<script src>, <link rel=stylesheet href>, <img src>/<img srcset>, <source srcset>), deduped, same-origin, code assets first, capped at 20 real GETs with bounded concurrency. Cross-origin assets are counted but never probed: a CDN answering 403 to an unfamiliar user-agent is indistinguishable from a dead file, and a site should not be failed for a third party's bot wall. The verdict rests only on the HTTP status (RFC 9110: 4xx/5xx is an error response) and is graded like the other multi-page checks — pass at 100 % reachable, warn at 80 % or better, fail below.
**Fix:** Open each reported path directly and fix or remove the reference: restore the missing file, correct the path (a typo, a case mismatch on a case-sensitive server, a stale build hash after a deploy), or delete the <img>/<script>/<link> that points at it. Check the responsive variants too — a broken URL often hides in a srcset candidate while the src fallback still works.

### `js-only-destinations` (3 pts)
**Verifies:** Pulls the destination URL back out of the markup of elements that are not links — a div, span or button wired with onclick="location.href=…", location.assign/replace, window.open(), router.push()/navigate(), a javascript: href, or a data-href/data-url/data-link/data-route attribute on an interactive element — then checks whether that same internal URL is also exposed as a real <a href> somewhere in the sample (or is itself a sampled page).
**Why:** Pulls the destination URL back out of the markup of elements that are not links — a div, span or button wired with onclick="location.href=…", location.assign/replace, window.open(), router.push()/navigate(), a javascript: href, or a data-href/data-url/data-link/data-route attribute on an interactive element — then checks whether that same internal URL is also exposed as a real <a href> somewhere in the sample (or is itself a sampled page). Crawlers that do not execute JavaScript (GPTBot, ClaudeBot, PerplexityBot, CCBot, and Google's first pass) only ever follow href attributes, so a URL that exists solely inside a click handler is a page they can never discover — and unlike a ratio of JS-dependent anchors, this names the pages actually at risk. Scripted asset downloads, cross-origin targets and CDN infrastructure paths are ignored, and the verdict never exceeds a warning because the sample is bounded and the set of attributes treated as link affordances is a convention, not a standard.
**Fix:** Wrap the same destination in a real <a href="/path"> link. Keep the click handler if the interaction needs it, but a crawler that does not run JavaScript sees only href attributes, so a URL that lives inside an onclick handler or a data-href attribute is a page it can never reach — expose it as an anchor and the handler becomes an enhancement rather than the only way in.

### `indexing-conflicts` (4 pts)
**Verifies:** Cross-references three signals the crawl already holds — robots.txt Disallow rules, the sitemap's URL list, and the sampled pages' canonical and noindex directives — and reports where they contradict each other: a sitemap entry that robots.txt forbids, a canonical pointing at a forbidden URL, or a noindex page listed in the sitemap.
**Why:** Cross-references three signals the crawl already holds — robots.txt Disallow rules, the sitemap's URL list, and the sampled pages' canonical and noindex directives — and reports where they contradict each other: a sitemap entry that robots.txt forbids, a canonical pointing at a forbidden URL, or a noindex page listed in the sitemap. A blocked URL is never fetched, so a crawler can neither read it nor read the noindex on it; the page can end up stuck in results as a bare URL the site has no way to remove, and canonical consolidation onto a blocked target is simply dropped.
**Fix:** Never Disallow a URL you also list in a sitemap or point a canonical at: drop the Disallow, or drop the URL from the sitemap and stop canonicalizing to it. Keep noindex pages out of the sitemap.

### `soft-error-pages` (4 pts)
**Verifies:** Reads the pages the crawl actually sampled and flags any that answer HTTP 200 while their own <title> or <h1> is an error message ("Page not found", "404 Not Found", "Page introuvable", "Une erreur est survenue"), or that serve almost no main content on a URL that is not the homepage.
**Why:** Reads the pages the crawl actually sampled and flags any that answer HTTP 200 while their own <title> or <h1> is an error message ("Page not found", "404 Not Found", "Page introuvable", "Une erreur est survenue"), or that serve almost no main content on a URL that is not the homepage. This is where `soft-404` cannot look: that check fires one synthetic probe at a random path that cannot exist, so it only learns what the server does with an obviously-missing route, never what it does with the real URLs a sitemap or an internal link advertised. Crawlers and AI answer engines trust the status line — RFC 9110 makes the status code carry the semantics of the response — so an error page served as 200 gets indexed, chunked and quoted as if it were content, while the genuinely missing page never drops out of the index. The lexicon is bilingual (FR + EN) and a marked page must also be short (under 400 words of main content), so an article that merely writes about 404 errors is never flagged.
**Fix:** Return 404 (or 410 for permanently removed content) on the routes whose page says it failed, and give every URL that answers 200 a real document.

### `sameas-verified` (3 pts)
**Verifies:** *(opt-in: `--verify-profiles`)* Fetches each profile URL declared in your JSON-LD `sameAs` and checks whether it links back to your site. Warns at worst — never fails.
**Why:** Anyone can list a LinkedIn or Wikipedia URL in their own markup; only whoever controls that profile can make it point back, so the return link is what turns a claim into an identity an engine can rely on. With `outbound-link-health`, this is one of only two checks that fetch anything off your own origin — and neither implies the other: you have to ask for the one you want (here at most 8 URLs, http(s) only, under the same SSRF guard). It only ever looks at profiles you declared — it never goes hunting for a presence you did not claim. A platform that refuses robots (LinkedIn answers 999, Instagram serves a login wall) is reported as **unverifiable** and never held against you: "we could not read it" and "it does not link back" are different facts, and only the second is about your site.
**Fix:** On each profile you list in `sameAs`, fill in the website field with your site URL. Most platforms have one, and it is what makes the pair verifiable in both directions.

### `tls-version` (3 pts)
**Verifies:** *(same skip conditions as `http-protocol`)* The TLS version and cipher suite actually negotiated: fail on TLS 1.0/1.1 (RFC 8996), warn without forward secrecy, pass otherwise. One version per handshake — this reports what a modern client is given, not the full matrix a server would accept.
**Why:** Obsolete TLS is deprecated by RFC 8996 and surfaced to users as a browser warning.
**Fix:** Serve TLS 1.2 at minimum, prefer TLS 1.3, and keep forward-secret cipher suites.

## Generating indexing files

Fixing several of the checks above (`llms-txt`, `llms-full-txt`, `robots-wellformed`, `ai-crawlers-allowed`, or missing `Organization` / `WebSite` / `BreadcrumbList` / `FAQPage` markup) starts with having *something* to publish. `findable-audit` can generate a starter set of those files directly from the audit it just ran:

```bash
npx findable-audit https://your-site.com --emit ./out
```

This writes `robots.txt`, `llms.txt`, `llms-full.txt`, `.well-known/ai.json`, `sitemap.xml`, `jsonld-stubs.json`, and a `GENERATED-README.md` into `./out`, built from the pages actually sampled during the audit. `--emit` works alongside `--report`/`--no-report` (independent flags) and honors `--lang` for the generated wording.

The same six files (minus `GENERATED-README.md`) are also downloadable one at a time from the web app's result page, under **"Generate indexing files"** — regenerated on demand from the in-memory report; nothing is written to disk server-side.

⚠️ **These are generic starting points, not finished content — review every file before deploying, especially `robots.txt`.** It ships with every AI crawler allowed and a commented-out `Disallow: /` under each one, so opting a bot out of training or citation is a deliberate, visible edit. `jsonld-stubs.json` only stubs the schema.org types missing from the site's existing entity graph (`Organization`, `WebSite`, `BreadcrumbList`, `FAQPage`) and is meant to be merged into your real JSON-LD, not published verbatim.

The web app's audit and comparison forms can optionally sit behind a Cloudflare Turnstile CAPTCHA (env-gated, off unless configured) — see the [main README](../README.md#cloudflare-turnstile-optional-captcha) for setup.

---

## Running in CI

The audit is designed as a CI gate — the exit code is `0` at/above `--min-score`, `1` below it (or on regression), `2` when the site is unreachable.

- **GitHub Actions** — the repo root ships a composite [`action.yml`](../action.yml): `uses: piwig/findable-audit@main` with `url` and `min-score`, then upload the emitted `findable-audit.sarif` to code scanning. A complete example (baseline regression gate + SARIF upload + JUnit artifact) is in [`.github/workflows/findable-gate.yml`](../.github/workflows/findable-gate.yml).
- **GitLab CI / Jenkins** — write a JUnit report with `--report findable.junit.xml` (the extension picks the format; one `<testcase>` per check, fail → `<failure>`, warn/skip → `<skipped>`) and declare it as a JUnit artifact so failures land in the tests tab.
- **Regression gate** — commit a `--report *.json` baseline, then run with `--baseline <file> --fail-on-regression [--regression-tolerance <n>]` to fail only when the score drops.
- **Entity graph** — every HTML report draws the JSON-LD entity graph inline: one box per entity **type** (with a ×N count), one arrow per reference, hoverable for the detail. `--entity-graph <file>` exports the same graph entity by entity, uncapped, as `.json` / `.dot` / `.mmd`.
- **Answer matrix** — `--answers <file>` writes the questions this site's own declarations imply (its services, its areas, its markup) and whether the crawled pages hold a passage that answers each one and stands on its own, as `.json` or Markdown. The questions come from what the site **declares**, never from measured search demand, and the file says so — along with the pages it was built from, and a warning when the crawl stopped at its page limit.
- **One-screen summary** — `--summary <file>.html` (or `.md`) writes the version for whoever decides rather than whoever fixes: score, verdict, the three axes, the three highest-gain actions with their cost, and the score those three would reach. Assembled from the same numbers as the full report, so the two can never disagree.
- **Score badge** — `--report <file>.svg` writes a self-contained status badge (no script, no external badge service; the audited host and the audit date live in its `<title>`). Commit it and point your README at it; regenerate it in the same job that runs the gate.
</content>
