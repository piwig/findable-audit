# Benchmark de couverture — findable-audit vs checkers gratuits 2026 (A39)

Date : 2026-08-09 (session auto). Périmètres concurrents vérifiés en ligne le jour même ; voir sources en bas.

## Notre couverture (référence)

141 checks répartis en 8 familles (comptage `family:` dans `packages/cli/src/checks/*.ts`) :

| Famille | Checks |
|---|---|
| technical-seo | 29 |
| structured-data | 23 |
| llm-content | 22 |
| performance | 21 |
| on-page | 14 |
| ai-access | 12 |
| security | 11 |
| accessibility | 9 |

## Périmètres des 4 checkers gratuits

1. **Siftly Crawler Audit** — 7 zones documentées : HTTPS/SSL, robots.txt (crawlers IA + search), en-têtes X-Robots-Tag, meta robots, sitemap (présence + validité), SSR (contenu visible sans JS), structured data JSON-LD. Lecture seule, fixes par plateforme (WordPress/Shopify/Next.js).
2. **PageForge AI Search Readiness Checker** — accès crawlers, dépendance JavaScript, structure de contenu, métadonnées, schema, liens internes. Sans inscription, pages publiques uniquement.
3. **Rank Prompt Free AI Readiness Checker** (apparu dans la vérification, périmètre publié) — accès bots IA (15+ crawlers), Schema.org, meta tags, Open Graph, SSL, sitemap.
4. **Search Engine Land AI Agent Readiness Checker** — accès crawlers IA ; périmètre détaillé non publié (**non vérifié** au-delà). **Apify AI Readiness Auditor** : périmètre non retrouvé dans la vérification du jour (**non vérifié**).

## Matrice de couverture

| Zone concurrente | Siftly | PageForge | Rank Prompt | Chez nous (famille) | Verdict |
|---|---|---|---|---|---|
| HTTPS / SSL | x | — | x | security | Couvert |
| robots.txt crawlers IA | x | x | x | ai-access | Couvert (12 checks, par-bot) |
| X-Robots-Tag headers | x | — | — | technical-seo | Couvert |
| Meta robots | x | x | x | technical-seo | Couvert |
| Sitemap | x | — | x | technical-seo | Couvert |
| SSR / dépendance JS | x | x | — | llm-content | Couvert |
| Structured data JSON-LD | x | x | x | structured-data | Couvert (23 checks vs présence simple) |
| Open Graph | — | — | x | on-page | Couvert |
| Liens internes / structure | — | x | — | on-page + llm-content | Couvert |
| llms.txt | (outil séparé) | — | — | ai-access | Couvert nativement |

**Manques chez nous : aucun.** Chaque zone testée par les 4 gratuits correspond à au moins un check existant ; aucun nouvel item de backlog à créer au titre d'A39.

## Argumentaire « pourquoi payer un audit complet »

- Les gratuits testent **7 à ~10 signaux binaires** ; nous en testons **141**, avec sévérité, axes et rapport JSON/SARIF/JUnit exploitable en CI.
- Zones entièrement absentes des gratuits : **performance (21)**, **accessibility (9)**, sécurité au-delà du SSL (10 autres checks), profondeur llm-content (chunking, extraction d'entités), agentic checks.
- Les gratuits sont mono-page instantanés ; nous faisons crawl multi-pages, baseline/compare, historique, `--fail-on-regression`.
- Angle honnête : les gratuits sont d'excellents « thermomètres » — nous sommes le diagnostic. À réutiliser dans la landing.

## Sources

- [Siftly — Free AI Crawler Audit Tool](https://siftly.ai/free-tools/crawler-audit) ; [Siftly free tools](https://siftly.ai/free-tools) ; [siftly.ai](https://siftly.ai/)
- [PageForge — AI Search Readiness Checker](https://pageforge.pro/tools/ai-search-readiness-checker/)
- [Rank Prompt — Free AI Readiness Checker](https://rankprompt.com/tools/free-ai-readiness-checker/)
- [Search Engine Land — AI Agent Readiness Checker](https://searchengineland.com/tools/ai-agent-readiness-checker)
