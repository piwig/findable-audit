import type { Check } from '../types.js';
import { robotsExists, aiCrawlersAllowed, homepageOk } from './ai-access.js';
import { llmsTxt, llmsFullTxt, contentWithoutJs } from './llm-content.js';
import { jsonLd, jsonLdEntity } from './structured-data.js';
import { sitemapCheck, indexnowCheck } from './sitemap.js';
import { titleDescription, canonical, openGraph, httpsCheck, viewport } from './fundamentals.js';

export function buildChecks(opts: { indexnowKey?: string } = {}): Check[] {
  return [
    robotsExists, aiCrawlersAllowed, homepageOk,
    llmsTxt, llmsFullTxt, contentWithoutJs,
    jsonLd, jsonLdEntity, sitemapCheck, indexnowCheck(opts.indexnowKey),
    titleDescription, canonical, openGraph, httpsCheck, viewport,
  ];
}
