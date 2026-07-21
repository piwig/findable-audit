import type { Check } from '../types.js';
import {
  robotsExists, robotsWellformedCheck, searchCrawlersAllowed, aiCrawlersAllowed,
  homepageOk, robotsDirectives,
} from './ai-access.js';
import { llmsTxt, llmsFullTxt, contentWithoutJs } from './llm-content.js';
import {
  jsonLd, jsonLdEntity, twitterCard, jsonLdValid, sdOrganization, sdEntityGrounding,
  sdLocalBusiness, sdWebsiteSearchAction, sdVideo, sdSpecialTypes, sdGraphIntegrity, sdConsistency,
} from './structured-data.js';
import { sdArticle, sdProduct, sdFaq, sdBreadcrumb, napConsistency } from './structured-data-mp.js';
import {
  sitemapCheck, indexnowCheck, sitemapLastmod, sitemapUrlsValid, sitemapIndexLimits, sitemapOrphans,
} from './sitemap.js';
import { titleDescription, canonical, openGraph, httpsCheck, viewport } from './fundamentals.js';
import { metaRobotsNoindex, snippetPreviewDirectives, uniqueTitles, imagesAlt, schemaCoverage } from './multi-page.js';
import { brokenInternalLinks, redirectHygiene, hreflang } from './links.js';
import {
  canonicalResolves, wwwConsolidation, trailingSlash, redirectChains, soft404, custom404,
  urlStructure, paginationCanonical, metaRefresh, hreflangXDefault, internalLinking,
} from './technical-seo.js';
import {
  metaPerPage, titlePattern, titleH1Alignment, headingsOutline, anchorText,
  charset, favicon, contentReadability, figureCaption,
} from './on-page.js';

export function buildChecks(opts: { indexnowKey?: string } = {}): Check[] {
  return [
    robotsExists, robotsWellformedCheck, searchCrawlersAllowed, aiCrawlersAllowed,
    homepageOk, robotsDirectives, snippetPreviewDirectives,
    llmsTxt, llmsFullTxt, contentWithoutJs, imagesAlt,
    jsonLd, jsonLdEntity, schemaCoverage, sitemapCheck, indexnowCheck(opts.indexnowKey),
    titleDescription, canonical, openGraph, twitterCard, httpsCheck, viewport,
    metaRobotsNoindex, uniqueTitles, brokenInternalLinks, redirectHygiene, hreflang,
    metaPerPage, titlePattern, titleH1Alignment, headingsOutline, anchorText,
    charset, favicon, contentReadability, figureCaption,
    jsonLdValid, sdOrganization, sdEntityGrounding, sdLocalBusiness, sdArticle, sdProduct,
    sdFaq, sdBreadcrumb, sdWebsiteSearchAction, sdVideo, sdSpecialTypes, sdGraphIntegrity,
    sdConsistency, napConsistency,
    canonicalResolves, wwwConsolidation, trailingSlash, redirectChains, soft404, custom404,
    urlStructure, paginationCanonical, metaRefresh, hreflangXDefault, internalLinking,
    sitemapLastmod, sitemapUrlsValid, sitemapIndexLimits, sitemapOrphans,
  ];
}
