# Reviewable action priorities — 2026-09-22

The 0.13.0 report separates verified defects, review items and conditional advice.
The priority changes affect presentation, not check weights or scoring. A separate
FAQ detection fix in the same release excludes forms, navigation and non-question
disclosures; sites with that former false positive may now skip the FAQ check.
The former points/effort ratio did not represent a traffic return or even a normalized
overall score gain; it no longer determines the first actions. Every format uses the
same selection. Locations are limited to pages present in the report's sample.

Official references checked on 2026-09-22:

- [Google: sitelinks search box removal](https://developers.google.com/search/blog/2024/10/sitelinks-search-box): the feature was removed on 2024-11-21 without a ranking change. A missing SearchAction is not a universal technical defect; a declared broken action can be investigated.
- [Google: Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization): no required properties, and relevant properties depend on the organization. Additional identities must be real and attributable.
- [Google: Speakable](https://developers.google.com/search/docs/appearance/structured-data/speakable): the documented use concerns English news audio in the US, not a requirement for every French business website.
- [Google: generative AI optimization](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide): special machine-readable files such as llms.txt are not required for Google's AI search features. This does not establish behavior for every other provider.

Custom visitor questions use lexical matching only: an exact question heading followed
by text, a partial lexical match, or no match in the fetched sample. Excerpts remain
reviewable, and these statuses do not prove correctness, relevance or AI citation.
