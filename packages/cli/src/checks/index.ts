import { sameAsVerified } from './sameas-verified.js';
import { brokenSubresources } from './broken-subresources.js';
import { jsOnlyDestinations } from './js-only-destinations.js';
import { softErrorPages } from './soft-error-pages.js';
import { indexingConflicts } from './indexing-conflicts.js';
import type { Check } from '../types.js';
import {
  robotsExists, robotsWellformedCheck, searchCrawlersAllowed, aiCrawlersAllowed,
  homepageOk, robotsDirectives, aiServingParity, aiCrawlerReachability, cloudflareAiDefaults, payPerCrawl,
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
import { richResultEligibility } from './rich-results.js';
import { sdPageEntity } from './page-entity.js';
import {
  sitemapCheck, indexnowCheck, sitemapLastmod, sitemapUrlsValid, sitemapIndexLimits, sitemapOrphans,
} from './sitemap.js';
import { titleDescription, canonical, openGraph, httpsCheck, viewport } from './fundamentals.js';
import { metaRobotsNoindex, snippetPreviewDirectives, uniqueTitles, imagesAlt, schemaCoverage } from './multi-page.js';
import { brokenInternalLinks, redirectHygiene, hreflang } from './links.js';
import { anchorTargetProfile, internalLinkContext, internalEquityLeaks } from './internal-links.js';
import { outboundLinkHealth } from './outbound-links.js';
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
  htmlLang, altDescriptive, landmarks, formLabels, linkText, viewportZoom, iframeTitle, rgaaEaaDeadline,
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
import { httpProtocol, tlsVersion, cdnEdgeCache } from './transport.js';
import { entityGraphConnectivity } from './entity-graph.js';
import { freshnessCoherence, hedgingRate, answerUnits, chunkBoundary } from './geo-advanced.js';
import { chunkRetrievalSim, injectionHygiene } from './geo-retrieval.js';
import { agentUsability } from './agentic.js';
import { agentStandardsSignals } from './agent-standards.js';
import { llmsTxtLint } from './llms-lint.js';
import { topicalFocus, keywordCannibalization } from './semantic.js';

export function buildChecks(opts: { indexnowKey?: string; agentStandards?: boolean } = {}): Check[] {
  return [
    // A38 — opt-in (--experimental-agent-standards), maxPoints 0: emerging
    // agents.json / UCP manifests, informational only, never scored.
    ...(opts.agentStandards ? [agentStandardsSignals] : []),
    robotsExists, robotsWellformedCheck, searchCrawlersAllowed, aiCrawlersAllowed,
    homepageOk, robotsDirectives, aiServingParity, aiCrawlerReachability, cloudflareAiDefaults, snippetPreviewDirectives,
    llmsTxt, llmsTxtLint, llmsFullTxt, contentWithoutJs, csrContentParity, contentDepth, contentLeadAnswer, answerHeadings,
    extractableStructure, contentFreshness, contentAuthorEeat, outboundCitations, contentUniqueness,
    aboutContact, wellKnownAiJson, imagesAlt,
    freshnessCoherence, hedgingRate, answerUnits, chunkBoundary,
    chunkRetrievalSim, injectionHygiene, agentUsability,
    jsonLd, jsonLdEntity, schemaCoverage, sitemapCheck, indexnowCheck(opts.indexnowKey),
    titleDescription, canonical, openGraph, twitterCard, httpsCheck, viewport,
    metaRobotsNoindex, uniqueTitles, brokenInternalLinks, redirectHygiene, hreflang,
    metaPerPage, titlePattern, titleH1Alignment, topicalFocus, keywordCannibalization,
    headingsOutline, anchorText, anchorTargetProfile,
    charset, favicon, contentReadability, figureCaption,
    jsonLdValid, sdOrganization, sdEntityGrounding, sdLocalBusiness, sdArticle, sdProduct,
    sdFaq, sdBreadcrumb, sdWebsiteSearchAction, sdVideo, sdSpecialTypes, sdGraphIntegrity,
    sdConsistency, napConsistency, entityGraphConnectivity, richResultEligibility, sdPageEntity,
    canonicalResolves, wwwConsolidation, trailingSlash, redirectChains, soft404, custom404,
    urlStructure, paginationCanonical, metaRefresh, hreflangXDefault, internalLinking, linkEquityMap, crawlableNav,
    internalLinkContext, internalEquityLeaks, outboundLinkHealth,
    sitemapLastmod, sitemapUrlsValid, sitemapIndexLimits, sitemapOrphans,
    htmlLang, altDescriptive, landmarks, formLabels, linkText, viewportZoom, iframeTitle, rgaaEaaDeadline,
    brokenSubresources, jsOnlyDestinations, softErrorPages, indexingConflicts, sameAsVerified,
    mixedContent, hsts, xContentTypeOptions, csp, clickjacking, referrerPolicy, permissionsPolicy, securityTxt,
    tlsVersion,
    htmlWeight, renderBlockingJs, renderBlockingCss, imgDimensions, imgLazyLoading, imgNextGen,
    resourceHints, domSize, textCompression, assetCaching, inlineHeadVolume,
    httpProtocol, cdnEdgeCache,
    lighthousePerf, cwvLcp, cwvCls, cwvInp, cwvAssessment, cwvTtfb, labTbt, labFcp,
  ];
}
