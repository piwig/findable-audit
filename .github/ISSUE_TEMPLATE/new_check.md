---
name: Propose a check
about: A signal findable-audit should look at and does not
labels: enhancement, check
---

**What signal, and on what evidence**

<!-- What would the check read from the page, the headers or the robots/sitemap files? -->

**Why it matters for findability**

<!-- Ideally with a source. Claims in this project have to survive
     docs/research/ — "an engine might like it" is not enough on its own. -->

**What verdict would it deserve?**

- [ ] **fail** — an unambiguous, verifiable defect (a blocked citation-time crawler, a
      broken canonical, a hidden instruction payload)
- [ ] **warn** — a content-shaping heuristic (phrasing, structure, style). These may never
      fail a site: effectiveness varies by domain, and failing on a judgement call claims
      more than we know.
- [ ] **skip** when a precondition is absent

**Can it be answered from the crawl alone?**

<!-- The tool fetches same-origin pages and never executes JavaScript. A check needing an
     API key must degrade to `skip` without one (like Core Web Vitals do), and a check
     needing a headless browser is a much bigger conversation. -->
