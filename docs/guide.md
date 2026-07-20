# findable-audit check guide

findable-audit scores a site out of 100 across 22 checks in 4 families. This guide explains, for each check: what it verifies, why it matters for AI answer engines, and how to fix a failure.

Statuses: `OK` (pass, full points), `!!` (warn, partial points), `XX` (fail, 0 points), `--` (skip, not counted against you but no points earned).

## AI crawler access

### `robots-exists` (4 pts)

**What it verifies:** `/robots.txt` responds with HTTP 200.

**Why it matters:** robots.txt is the first file every crawler — classic or AI — requests. Without one, you have no explicit crawl policy, and you cannot reference your sitemap or express AI-crawler permissions.

**How to fix:** Create a robots.txt file at the site root. A minimal permissive one is two lines: `User-agent: *` and `Allow: /`, plus a `Sitemap:` line pointing at your sitemap.

### `ai-crawlers-allowed` (12 pts)

**What it verifies:** None of the major AI crawlers — GPTBot (ChatGPT), ClaudeBot (Claude), PerplexityBot (Perplexity), Google-Extended (Gemini) — is blocked by robots.txt.

**Why it matters:** This is the single highest-weighted check. If an AI crawler is disallowed, that assistant simply cannot read your site, and nothing else in this audit can compensate. Many CMS templates and "SEO hardening" snippets block these bots by default without the owner realizing.

**How to fix:** Remove the `Disallow: /` rules for these user-agents in robots.txt. Check both dedicated `User-agent: GPTBot`-style groups and catch-all `User-agent: *` groups; a blanket disallow blocks AI crawlers too.

### `homepage-ok` (6 pts)

**What it verifies:** The root URL responds with HTTP 200.

**Why it matters:** If the homepage errors, redirects to a login, or requires JavaScript to produce any HTML, crawlers get nothing to index and AI assistants get nothing to cite.

**How to fix:** Ensure the root URL serves a 200 HTML page without requiring JavaScript. Check hosting configuration, redirect chains, and any bot-protection layer that might be serving errors to non-browser clients.

## Content for LLMs

### `llms-txt` (10 pts)

**What it verifies:** `/llms.txt` exists (fail if missing) and starts with a markdown H1 title (warn if unstructured).

**Why it matters:** `llms.txt` is an emerging convention that gives language models a curated, token-efficient map of your site: what it is, and which pages matter. Assistants that support it can answer questions about your site far more accurately than by crawling raw HTML.

**How to fix:** Add a `/llms.txt` file: an H1 title, a one-line summary, then a markdown list of key pages. Start it with `# Site Name` followed by a short description, then link each important page with a one-line note.

### `llms-full-txt` (4 pts)

**What it verifies:** `/llms-full.txt` responds with HTTP 200.

**Why it matters:** Where `llms.txt` is the map, `llms-full.txt` is the territory: the full text of your key pages in one plain file. A model can ingest it in a single request, with none of the markup noise of HTML.

**How to fix:** Add a `/llms-full.txt` containing the full text content of your key pages. Most static-site generators can concatenate page content into one file at build time.

### `content-without-js` (6 pts)

**What it verifies:** The homepage HTML contains at least 200 characters of visible text after removing `script`, `style` and `noscript` tags — i.e. real content exists without executing JavaScript.

**Why it matters:** AI crawlers do not execute JavaScript. A client-side-rendered page that looks rich in a browser is an empty shell to GPTBot or ClaudeBot, so your content never enters their index.

**How to fix:** Server-render your main content. Use static generation (Astro, Hugo, Next static export) or SSR so the meaningful text is present in the initial HTML response.

### `images-alt` (4 pts)

**What it verifies:** The proportion of images across the sampled pages that carry an `alt` attribute. Pass at 90% coverage or above, warn at 70% or above, fail below that; pages with no images pass. A decorative `alt=""` counts as present.

**Why it matters:** Alt text is how LLMs and screen readers understand images; missing alt text means that content is simply lost to them.

**How to fix:** Add descriptive `alt` text on informative images, and `alt=""` on purely decorative ones.

## Structured data

### `json-ld` (10 pts)

**What it verifies:** The homepage contains at least one `<script type="application/ld+json">` block that parses as valid JSON.

**Why it matters:** JSON-LD is the machine-readable description of who you are and what you offer. Answer engines lean on it to extract facts (name, type, offerings) without guessing from prose, which makes citations more accurate.

**How to fix:** Add a `<script type="application/ld+json">` block describing your business or content. Validate the JSON — a single syntax error makes the whole block invisible to parsers.

### `json-ld-entity` (6 pts)

**What it verifies:** The JSON-LD declares a relevant entity type (a LocalBusiness subtype, Organization, Article, Store, Restaurant or WebSite). For business types, it also warns if NAP (name, address, telephone) is incomplete.

**Why it matters:** A generic or missing `@type` tells assistants nothing usable. For local businesses, consistent NAP data is what allows an assistant to recommend you with correct, verifiable contact details.

**How to fix:** Declare a relevant `@type` (LocalBusiness subtype, Organization, or Article). If you are a business, add `name`, `address` and `telephone` so AI assistants can cite your business consistently.

### `schema-coverage` (5 pts)

**What it verifies:** How many of the sampled pages carry at least one valid JSON-LD block. Pass at 50% or more of sampled pages, warn above 0%, fail at 0%. Skipped when fewer than 2 pages are sampled (the homepage case is already covered by the `json-ld` check).

**Why it matters:** Structured data on inner pages — not just the homepage — helps AI assistants understand and cite the whole site, not only its front door.

**How to fix:** Add page-appropriate JSON-LD across the site: Article for posts, Product for product pages, BreadcrumbList for sections.

### `sitemap` (10 pts)

**What it verifies:** `/sitemap.xml` exists, is valid XML, and is referenced by a `Sitemap:` line in robots.txt (warn if unreferenced).

**Why it matters:** The sitemap is how crawlers discover pages beyond the homepage, and how they learn what changed. Referencing it in robots.txt is what makes it discoverable in the first place.

**How to fix:** Generate a sitemap.xml and reference it in robots.txt with a line like `Sitemap: https://your-site/sitemap.xml`. If the file exists but is invalid, regenerate the sitemap with your framework integration (e.g. `@astrojs/sitemap`, `next-sitemap`, Hugo's built-in) instead of writing it by hand.

### `indexnow` (4 pts)

**What it verifies:** When you pass `--indexnow-key <key>`, the file `/<key>.txt` exists at the site root and contains exactly the key. Skipped without the flag.

**Why it matters:** IndexNow lets you push URL changes to participating search engines (Bing, and through it several AI answer stacks) instantly instead of waiting for a recrawl. The key file is how you prove domain ownership.

**How to fix:** Publish a text file named `<key>.txt` at the site root containing exactly the key, then ping `https://api.indexnow.org/indexnow?url=<page>&key=<key>` when pages change.

## SEO fundamentals

### `title-description` (8 pts)

**What it verifies:** The homepage has both a `<title>` and a meta description; warns if lengths are outside 10-70 chars (title) or 50-160 chars (description).

**Why it matters:** These two tags are the default snippet in every search surface, and answer engines use them as a compressed summary of the page when deciding relevance.

**How to fix:** Add a `<title>` (10-70 chars) and a meta description (50-160 chars). Aim for a specific, factual sentence rather than a keyword list.

### `canonical` (5 pts)

**What it verifies:** The homepage declares a `<link rel="canonical">`.

**Why it matters:** Without a canonical URL, the same content reachable via several URLs (`http`/`https`, with/without `www`, trailing slash) splits its authority and confuses crawlers about which version to cite.

**How to fix:** Add `<link rel="canonical" href="...">` to every page, pointing at the one preferred absolute URL for that page.

### `open-graph` (5 pts)

**What it verifies:** The homepage has both `og:title` and `og:description` meta tags.

**Why it matters:** Open Graph is the de facto preview format. Link previews in chat apps — and increasingly in AI assistant citations — render from these tags; missing ones produce bare, unclickable links.

**How to fix:** Add Open Graph meta tags so shared links and AI previews render correctly: at minimum `og:title` and `og:description`, ideally also `og:image` and `og:url`.

### `https` (5 pts)

**What it verifies:** The site is served over HTTPS. Skipped for `localhost` / `127.0.0.1`.

**Why it matters:** HTTPS is a baseline trust signal; crawlers demote or refuse plain-HTTP sites, and browsers warn users away from them.

**How to fix:** Serve the site over HTTPS. Every mainstream host (Netlify, Vercel, Cloudflare Pages, GitHub Pages) provisions certificates automatically; enable the HTTP→HTTPS redirect as well.

### `viewport` (5 pts)

**What it verifies:** The homepage has a `<meta name="viewport">` tag.

**Why it matters:** The viewport tag is the marker of a mobile-ready page. Search engines index mobile-first, and its absence flags the site as unmaintained.

**How to fix:** Add `<meta name="viewport" content="width=device-width, initial-scale=1">` to the `<head>` of every page.

### `meta-robots-noindex` (6 pts)

**What it verifies:** No sampled page carries a `noindex` (or `none`) directive, in either a `<meta name="robots">` tag or the `X-Robots-Tag` HTTP header. Any noindexed sampled page fails the check.

**Why it matters:** A noindexed page is invisible to search engines and AI crawlers alike — content you meant to be found silently isn't.

**How to fix:** Remove `noindex`/`none` from pages that should rank; keep it only on genuinely private pages, and exclude those pages from the sitemap.

### `unique-titles` (5 pts)

**What it verifies:** Each sampled page has a unique `<title>` and meta description. Skipped when fewer than 2 pages are sampled. Duplicates across the sample lower the score, by proportion (warn/fail).

**Why it matters:** Duplicate titles and descriptions make search results and AI citations indistinguishable from one another, and dilute the perceived relevance of every page involved.

**How to fix:** Give every page a distinct, descriptive title (10-70 chars) and meta description (50-160 chars).

### `broken-internal-links` (8 pts)

**What it verifies:** Every same-origin `<a href>` link on the sampled pages resolves with a status below 400. Infrastructure endpoints under `/cdn-cgi/` (injected by Cloudflare, e.g. email protection) are ignored — they are not content pages.

**Why it matters:** Broken internal links waste crawl budget and break the trail an assistant follows to verify or expand on a citation.

**How to fix:** Fix or remove links returning 400+ so crawlers do not hit dead ends.

### `redirect-hygiene` (4 pts)

**What it verifies:** The `http://` version of the site redirects to `https://`. Skipped on local/private hosts (loopback), where it cannot be tested.

**Why it matters:** Without a clean HTTP→HTTPS redirect, legacy links and some crawlers land on a non-canonical or insecure URL.

**How to fix:** Serve a single 301 redirect from `http://` to `https://` (no redirect chains).

### `hreflang` (3 pts)

**What it verifies:** If the sampled pages declare `hreflang` alternates, each alternate returns 200 and declares a reciprocal `hreflang` link back to the referring page. Skipped when no hreflang annotations exist (single-language site).

**Why it matters:** Search and AI systems only trust hreflang when the alternates are reachable and mutually reference each other.

**How to fix:** Ensure every language variant returns 200 and declares reciprocal `<link rel="alternate" hreflang="...">` tags, itself included.
