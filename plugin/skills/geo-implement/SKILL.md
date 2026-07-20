---
name: geo-implement
description: "Use when implementing GEO + SEO on a static site (Astro, Next, Hugo): generates robots.txt, llms.txt, llms-full.txt, JSON-LD, sitemap wiring and IndexNow."
---

# geo-implement

Implement GEO (AI-search visibility) + technical SEO on a static site. Generate every artifact below, adapted to the user's framework, then verify with `findable-audit`.

## 1. Gather inputs

Ask (or infer from the repo) before generating anything:

- **Site URL** — canonical production origin, e.g. `https://example.com`
- **Language** — primary content language (`en`, `fr`, …)
- **Business type** — one of: **local business**, **organization**, **blog/personal**
- **Framework** — Astro, Next.js, Hugo, or plain static

For a local business, also collect NAP (name, address, phone), geo coordinates, and opening hours — from the user, never invented.

## 2. `robots.txt`

Place in the static/public root (`public/` for Astro & Next, `static/` for Hugo). Explicitly allow the AI crawlers and reference the sitemap:

```
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: *
Allow: /

Sitemap: https://example.com/sitemap-index.xml
```

Adjust the sitemap filename to what the framework integration actually emits (see §5).

## 3. `llms.txt` and `llms-full.txt`

`llms.txt` at the site root — Markdown, for AI crawlers:

- **H1**: site/business name
- **One-line summary** right under the H1 (a `>` blockquote works well)
- **Page list**: `- [Page title](https://example.com/path): one-line description` for each important page

`llms-full.txt` at the site root — the expanded version: same header, then the full text content of the key pages (services, pricing, about, contact) concatenated as Markdown so an LLM can answer from a single fetch.

## 4. JSON-LD structured data

Pick the entity by business type:

- **Local business** → the most specific `LocalBusiness` subtype (e.g. `HairSalon`, `Restaurant`, `Store`) with **full NAP** (`name`, `address` as `PostalAddress`, `telephone`), **`geo`** (`GeoCoordinates` with `latitude`/`longitude`), and **`openingHoursSpecification`**, plus `url` and `image`.
- **Organization** → `Organization` with `name`, `url`, `logo`, `sameAs`.
- **Blog/article pages** → `Article` (or `BlogPosting`) with `headline`, `datePublished`, `author`.

Ship it as a component appropriate to the framework:

- **Astro**: a component in `src/components/` (e.g. `JsonLd.astro`) rendering `<script type="application/ld+json" set:html={JSON.stringify(schema)} />`, included in the base layout `<head>`.
- **Next.js**: a metadata export / `<script type="application/ld+json">` in the root layout (App Router) using `dangerouslySetInnerHTML` with `JSON.stringify(schema)`.
- **Hugo**: a partial (e.g. `layouts/partials/jsonld.html`) included from `baseof.html`'s `<head>`, fed from site params.

## 5. Sitemap

Use the framework's own integration, then reference the output in `robots.txt`:

- **Astro**: `@astrojs/sitemap` (`npx astro add sitemap`; requires `site` in `astro.config`) → emits `sitemap-index.xml`.
- **Next.js**: `app/sitemap.ts` metadata route (or `next-sitemap`) → emits `sitemap.xml`.
- **Hugo**: built-in sitemap template → emits `sitemap.xml`.

## 6. IndexNow

1. Generate a key (any 32-char hex string) and place a key file at the site root: `<key>.txt` containing exactly the key.
2. After each deploy, ping per changed page:

```
https://api.indexnow.org/indexnow?url=<page>&key=<key>
```

3. Pass the key to audits: `npx findable-audit <url> --indexnow-key <key>`.

## 7. Verification checklist

After deploying:

```bash
curl -sI https://example.com/robots.txt
curl -s  https://example.com/llms.txt
curl -s  https://example.com/llms-full.txt
curl -sI https://example.com/sitemap-index.xml   # or sitemap.xml
curl -s  https://example.com/<key>.txt
```

Each must return 200 with the expected content. Then run the full audit:

```bash
npx findable-audit <url>
```

expecting a **score >= 80**. If below, feed the failures back through the fix loop (the `geo-audit` skill prioritizes them).

## Appendix: Local business France

For French local businesses, additionally:

- Mention the **SIRET** number on the site (legally expected on commercial sites; also a strong trust/entity signal) — e.g. in the footer or legal-notice page, and optionally as an `identifier` in the JSON-LD.
- JSON-LD address uses `addressCountry: "FR"`; format `postalCode` as 5 digits and use the official commune name in `addressLocality`.
- Opening hours in French display format (`Lun–Ven 9h–18h`) on the page, but keep the JSON-LD `openingHoursSpecification` in schema.org format (`"opens": "09:00"`, `"closes": "18:00"`).
- Register/claim **Google Business Profile** and **Bing Places for Business** with the exact same NAP as the JSON-LD — consistency across the three is the ranking signal.
