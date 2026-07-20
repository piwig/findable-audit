import type { Check } from '../types.js';
import { robotsExists, aiCrawlersAllowed, homepageOk, robotsDirectives } from './ai-access.js';
import { llmsTxt, llmsFullTxt, contentWithoutJs } from './llm-content.js';
import { jsonLd, jsonLdEntity } from './structured-data.js';
import { sitemapCheck, indexnowCheck } from './sitemap.js';
import { titleDescription, canonical, openGraph, httpsCheck, viewport } from './fundamentals.js';
import { metaRobotsNoindex, uniqueTitles, imagesAlt, schemaCoverage } from './multi-page.js';
import { brokenInternalLinks, redirectHygiene, hreflang } from './links.js';

export function buildChecks(opts: { indexnowKey?: string } = {}): Check[] {
  return [
    robotsExists, aiCrawlersAllowed, homepageOk, robotsDirectives,
    llmsTxt, llmsFullTxt, contentWithoutJs, imagesAlt,
    jsonLd, jsonLdEntity, schemaCoverage, sitemapCheck, indexnowCheck(opts.indexnowKey),
    titleDescription, canonical, openGraph, httpsCheck, viewport,
    metaRobotsNoindex, uniqueTitles, brokenInternalLinks, redirectHygiene, hreflang,
  ];
}
