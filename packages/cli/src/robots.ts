import type { FetchedResource } from './types.js';
import { isPlainText } from './types.js';
import { parsePage } from './checks/dom.js';

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export type RobotsGroups = Record<string, RobotsRule[]>;

/** Product token of a user-agent value: part before '/', lower-cased ("GPTBot/1.0" -> "gptbot"). */
function agentToken(value: string): string {
  return value.split('/')[0].trim().toLowerCase();
}

export function parseRobots(body: string): RobotsGroups {
  const groups: RobotsGroups = {};
  let currentAgents: string[] = [];
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) { lastWasAgent = false; continue; }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) currentAgents = [];
      const agent = agentToken(value);
      groups[agent] ??= [];
      currentAgents.push(agent);
      lastWasAgent = true;
    } else {
      // An empty Allow/Disallow value carries no rule (RFC 9309).
      if (value !== '') {
        for (const a of currentAgents) groups[a].push({ allow: key === 'allow', path: value });
      }
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Compile a robots path pattern: '*' matches any sequence, trailing '$' anchors the end. */
function ruleRegex(pattern: string): RegExp {
  let anchored = false;
  if (pattern.endsWith('$')) { anchored = true; pattern = pattern.slice(0, -1); }
  const escaped = pattern
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/**
 * RFC 9309 evaluation: pick the matching rule with the longest path;
 * on a length tie, Allow wins. No matching rule means allowed.
 */
export function isBlocked(groups: RobotsGroups, agent: string, path = '/'): boolean {
  const rules = groups[agentToken(agent)] ?? groups['*'] ?? [];
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!ruleRegex(rule.path).test(path)) continue;
    if (
      best === null ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best !== null && !best.allow;
}

// ---------------------------------------------------------------------------
// Tiered 2026 AI-agent roster (spec §3.1 ai-crawlers-allowed)
// ---------------------------------------------------------------------------

/**
 * Agents that fetch pages to train future models — blocking them is a policy
 * choice, not a crawl-access break (15 agents, LOT 3 spec §A).
 * Deliberate omissions: PetalBot (a regional *search* crawler by intention),
 * FacebookBot (superseded by meta-externalagent), Applebot (search tier stays
 * deliberately mainstream-minimal) — see the LOT 3 design doc.
 */
export const TRAINING_BOTS = [
  'GPTBot',                       // OpenAI model training
  'Google-Extended',              // Gemini training opt-out token
  'ClaudeBot',                    // Anthropic training crawler
  'anthropic-ai',                 // legacy Anthropic training UA, still honoured in robots.txt files
  'CCBot',                        // Common Crawl (feeds many LLM corpora)
  'Applebot-Extended',            // Apple Intelligence training opt-out
  'Amazonbot',                    // Amazon/Alexa model training
  'Bytespider',                   // ByteDance training crawler
  'PanguBot',                     // Huawei Pangu model training
  'cohere-ai',                    // legacy Cohere training UA
  'cohere-training-data-crawler', // current Cohere training crawler
  'meta-externalagent',           // Meta AI model training
  'Diffbot',                      // knowledge-graph extraction resold into AI datasets
  'Timpibot',                     // Timpi index/data collection
  'omgilibot',                    // Omgili/Webz.io — data resold for LLM training
];

/**
 * Agents an assistant dispatches live, at answer/citation time (or the index a
 * live answer engine reads) — blocking these hides the site from live AI
 * answers (14 agents, LOT 3 spec §A + A53 Google-Agent).
 *
 * Index-time vs query-time (per docs.perplexity.ai): PerplexityBot is the
 * *index-time* crawler — it respects robots.txt and does not feed model
 * training — while Perplexity-User is the *query-time* fetcher fired by a
 * user's question, which generally IGNORES robots.txt. Blocking the -User
 * agents in robots.txt is therefore mostly declarative; only blocking the
 * index crawlers reliably changes answer-engine visibility.
 */
export const CITATION_BOTS = [
  'OAI-SearchBot',         // ChatGPT search index
  'ChatGPT-User',          // user-triggered live fetch (ChatGPT)
  'Perplexity-User',       // query-time live fetch (Perplexity) — generally ignores robots.txt
  'Claude-User',           // user-triggered live fetch (Claude)
  'Claude-SearchBot',      // Anthropic search index (mirrors OAI-SearchBot)
  'PerplexityBot',         // index-time Perplexity answer-engine crawler — respects robots.txt, no training
  'DuckAssistBot',         // DuckDuckGo AI answers (DuckAssist)
  'MistralAI-User',        // user-triggered live fetch (Le Chat, Mistral)
  'Meta-ExternalFetcher',  // user-requested link fetch (Meta AI)
  'YouBot',                // You.com answer engine
  'iAskBot',               // iAsk.ai answer engine
  'LinerBot',              // Liner AI research assistant (sourced citations)
  'Google-CloudVertexBot', // Vertex AI Search grounding / customer agents
  'Google-Agent',          // Google's user-triggered agentic fetcher (added 2026-03-20) — acts on a
                           // user's behalf and, unlike Googlebot, IGNORES robots.txt; a "Disallow"
                           // here is purely declarative, only a server-side control (auth,
                           // application rate-limiting) actually blocks it.
];

/**
 * Date de la derniere revue du roster ci-dessus, et sources verifiables.
 *
 * Un roster de crawlers se perime en silence : sans date, personne ne peut dire
 * s'il a deux mois ou six, et un agent nouvellement apparu passe inapercu.
 * Cette constante rend le millesime lisible et re-verifiable.
 */
export const AI_ROSTER_REVIEWED = '2026-09-01';

/** Sources officielles a rouvrir a chaque revue du roster. */
export const AI_ROSTER_SOURCES = [
  'https://platform.openai.com/docs/bots',
  'https://docs.anthropic.com/en/docs/claude-code/bot',
  'https://docs.perplexity.ai/guides/bots',
  'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers',
  'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers',
  'https://darkvisitors.com/agents',
];

/** Full 2026 roster: training-time crawlers + citation-time fetchers. */
export const AI_BOTS = [...TRAINING_BOTS, ...CITATION_BOTS];

/** Mainstream search crawlers whose blocking removes the site from search entirely. */
export const SEARCH_BOTS = ['Googlebot', 'Bingbot', '*'];

// ---------------------------------------------------------------------------
// robots.txt well-formedness (spec §3.1 robots-wellformed)
// ---------------------------------------------------------------------------

const KNOWN_ROBOTS_DIRECTIVES = new Set(['user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay', 'host']);
const MAX_ROBOTS_BYTES = 500 * 1024;

export interface RobotsWellformedIssue {
  kind: 'orphan-directive' | 'unknown-directive';
  detail: string;
}

export interface RobotsWellformedResult {
  status: 'pass' | 'warn' | 'fail';
  issues: RobotsWellformedIssue[];
  /** Set on warn/fail: the lead issue, formatted for a check message. */
  reason?: string;
}

/**
 * Structural validation of a fetched /robots.txt body: size, only known
 * directives, no Allow/Disallow orphaned before a User-agent group, and not
 * an HTML error/SPA-fallback page (spec §3.1, §6 Batch 4).
 */
export function robotsWellformed(res: FetchedResource): RobotsWellformedResult {
  if (!isPlainText(res)) {
    return { status: 'fail', issues: [], reason: `served with content-type "${res.contentType}" (HTML error page or SPA fallback?)` };
  }
  if (Buffer.byteLength(res.body, 'utf8') > MAX_ROBOTS_BYTES) {
    return { status: 'fail', issues: [], reason: 'exceeds 500KB' };
  }
  const issues: RobotsWellformedIssue[] = [];
  let sawUserAgent = false;
  let parsedLines = 0;
  for (const raw of res.body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue; // stray text; folded into the "no recognizable directives" garbled check below
    // Any well-formed "key: value" line counts as parsed, known directive or not —
    // an unknown directive is a warn-worthy oddity, not garbled/unparseable content.
    parsedLines += 1;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') { sawUserAgent = true; continue; }
    if (!KNOWN_ROBOTS_DIRECTIVES.has(key)) {
      issues.push({ kind: 'unknown-directive', detail: `unknown directive "${m[1]}"` });
      continue;
    }
    if ((key === 'allow' || key === 'disallow') && !sawUserAgent) {
      issues.push({ kind: 'orphan-directive', detail: `"${m[1]}" before the first User-agent` });
    }
  }
  if (parsedLines === 0 && res.body.trim() !== '') {
    return { status: 'fail', issues: [], reason: 'no recognizable robots.txt directives (garbled content)' };
  }
  if (issues.length === 0) return { status: 'pass', issues };
  const reason = issues[0].detail + (issues.length > 1 ? ` (+${issues.length - 1} more)` : '');
  return { status: 'warn', issues, reason };
}

// ---------------------------------------------------------------------------
// Header + meta robots-directive parsing (spec §6 Batch 4 shared helper)
// ---------------------------------------------------------------------------

export interface RobotsDirectiveSet {
  headerRaw: string;
  metaRaw: string;
  /** Lower-cased, comma-split tokens from the X-Robots-Tag header. */
  headerTokens: string[];
  /** Lower-cased, comma-split tokens from <meta name="robots" content=…>. */
  metaTokens: string[];
}

function tokenize(value: string): string[] {
  // Handle BOTH space-separated directives ("noindex nofollow") AND "key: value"
  // pairs with an optional space after the colon ("max-snippet: -1"): normalize
  // any whitespace around a colon to a bare ":" first, so the value stays attached
  // to its key ("max-snippet:-1") instead of splitting into "max-snippet:" + "-1".
  return value.replace(/\s*:\s*/g, ':').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Parse a fetched page's X-Robots-Tag header and <meta name="robots"> content
 * into a directive-token set. Reused by robots-directives, meta-robots-noindex
 * and snippet-preview-directives so header/meta parsing lives in one place.
 */
export function robotsDirectiveSet(res: FetchedResource): RobotsDirectiveSet {
  const headerRaw = res.headers['x-robots-tag'] ?? '';
  const metaRaw = parsePage(res).querySelector('meta[name="robots"]')?.getAttribute('content') ?? '';
  return { headerRaw, metaRaw, headerTokens: tokenize(headerRaw), metaTokens: tokenize(metaRaw) };
}

/** true when `name` appears as an exact directive token (e.g. "noindex") in either the header or the meta tag. */
export function hasDirectiveToken(set: RobotsDirectiveSet, name: string): boolean {
  return set.headerTokens.includes(name) || set.metaTokens.includes(name);
}

/** Value of a `key:value` directive token (e.g. "max-snippet:-1" -> "-1"); meta takes precedence over header. */
export function directiveValue(set: RobotsDirectiveSet, key: string): string | undefined {
  for (const tokens of [set.metaTokens, set.headerTokens]) {
    for (const t of tokens) {
      const idx = t.indexOf(':');
      if (idx === -1) continue;
      if (t.slice(0, idx).trim() === key) return t.slice(idx + 1).trim();
    }
  }
  return undefined;
}
