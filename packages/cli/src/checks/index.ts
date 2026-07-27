import { brokenSubresources } from './broken-subresources.js';
import { jsOnlyDestinations } from './js-only-destinations.js';
import { softErrorPages } from './soft-error-pages.js';
import { indexingConflicts } from './indexing-conflicts.js';
import type { Check } from '../types.js';
import {
  robotsExists, robotsWellformedCheck, searchCrawlersAllowed, aiCrawlersAllowed,
  homepageOk, robotsDirectives, aiServingParity,
} from './ai-access.js';
import {
  llmsTxt, llmsFullTxt, contentWithoutJs, csrContentParity, contentDepth, contentLeadAnswer, answerHeadings,
  extractableStructure, contentFreshness, contentAuthorEeat, outboundCitations, contentUniqueness,
  aboutContact, wellKnownAiJson,
} from './llm-content.js';
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
  urlStructure, paginationCanonical, metaRefresh, hreflangXDefault, internalLinking, crawlableNav,
  linkEquityMap,
} from './technical-seo.js';
import {
  metaPerPage, titlePattern, titleH1Alignment, headingsOutline, anchorText,
  charset, favicon, contentReadability, figureCaption,
} from './on-page.js';
import {
  htmlLang, altDescriptive, landmarks, formLabels, linkText, viewportZoom, iframeTitle,
} from './accessibility.js';
import {
  mixedContent, hsts, xContentTypeOptions, csp, clickjacking, referrerPolicy, permissionsPolicy, securityTxt,
} from './security.js';
import {
  htmlWeight, renderBlockingJs, renderBlockingCss, imgDimensions, imgLazyLoading, imgNextGen,
  resourceHints, domSize, textCompression, assetCaching, inlineHeadVolume,
} from './performance.js';
import {
  lighthousePerf, cwvLcp, cwvCls, cwvInp, cwvAssessment, cwvTtfb, labTbt, labFcp,
} from './performance-cwv.js';
import { entityGraphConnectivity } from './entity-graph.js';
import { freshnessCoherence, hedgingRate, answerUnits, chunkBoundary } from './geo-advanced.js';
import { chunkRetrievalSim, injectionHygiene } from './geo-retrieval.js';
import { agentUsability } from './agentic.js';

export function buildChecks(opts: { indexnowKey?: string } = {}): Check[] {
  return [
    robotsExists, robotsWellformedCheck, searchCrawlersAllowed, aiCrawlersAllowed,
    homepageOk, robotsDirectives, aiServingParity, snippetPreviewDirectives,
    llmsTxt, llmsFullTxt, contentWithoutJs, csrContentParity, contentDepth, contentLeadAnswer, answerHeadings,
    extractableStructure, contentFreshness, contentAuthorEeat, outboundCitations, contentUniqueness,
    aboutContact, wellKnownAiJson, imagesAlt,
    freshnessCoherence, hedgingRate, answerUnits, chunkBoundary,
    chunkRetrievalSim, injectionHygiene, agentUsability,
    jsonLd, jsonLdEntity, schemaCoverage, sitemapCheck, indexnowCheck(opts.indexnowKey),
    titleDescription, canonical, openGraph, twitterCard, httpsCheck, viewport,
    metaRobotsNoindex, uniqueTitles, brokenInternalLinks, redirectHygiene, hreflang,
    metaPerPage, titlePattern, titleH1Alignment, headingsOutline, anchorText,
    charset, favicon, contentReadability, figureCaption,
    jsonLdValid, sdOrganization, sdEntityGrounding, sdLocalBusiness, sdArticle, sdProduct,
    sdFaq, sdBreadcrumb, sdWebsiteSearchAction, sdVideo, sdSpecialTypes, sdGraphIntegrity,
    sdConsistency, napConsistency, entityGraphConnectivity,
    canonicalResolves, wwwConsolidation, trailingSlash, redirectChains, soft404, custom404,
    urlStructure, paginationCanonical, metaRefresh, hreflangXDefault, internalLinking, linkEquityMap, crawlableNav,
    sitemapLastmod, sitemapUrlsValid, sitemapIndexLimits, sitemapOrphans,
    htmlLang, altDescriptive, landmarks, formLabels, linkText, viewportZoom, iframeTitle,
    brokenSubresources, jsOnlyDestinations, softErrorPages, indexingConflicts,
    mixedContent, hsts, xContentTypeOptions, csp, clickjacking, referrerPolicy, permissionsPolicy, securityTxt,
    htmlWeight, renderBlockingJs, renderBlockingCss, imgDimensions, imgLazyLoading, imgNextGen,
    resourceHints, domSize, textCompression, assetCaching, inlineHeadVolume,
    lighthousePerf, cwvLcp, cwvCls, cwvInp, cwvAssessment, cwvTtfb, labTbt, labFcp,
  ];
}
