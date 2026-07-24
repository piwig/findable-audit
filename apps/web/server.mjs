// findable-audit — public web front-end.
//
// A tiny, dependency-free HTTP server: a visitor enters a URL and gets the
// findable-audit report (SEO + GEO / AI-search visibility) rendered as HTML or
// JSON. It reuses the CLI's built library modules directly (they are
// side-effect-free); run `npm run build` in packages/cli first so dist/ exists.
//
// Public-facing on a shared VPS, so it is defensive by default: every target
// URL passes SSRF validation before we fetch it, audits are concurrency-capped
// and per-IP rate-limited, and each audit has a hard timeout.
//
// Binds to 127.0.0.1 and expects to sit behind nginx (which terminates TLS and
// sets X-Forwarded-For). Configure the port with the PORT env var (default 3021).

import http from 'node:http';
import crypto from 'node:crypto';
import { basename } from 'node:path';

import { runAudit, UnreachableSiteError } from '../../packages/cli/dist/runner.js';
import { buildChecks } from '../../packages/cli/dist/checks/index.js';
import { renderHtml } from '../../packages/cli/dist/report/html.js';
import { renderJson } from '../../packages/cli/dist/report/json.js';
import { renderMarkdown } from '../../packages/cli/dist/report/markdown.js';
import { renderCompareHtml } from '../../packages/cli/dist/report/compare.js';
import { EMITTED_FILES } from '../../packages/cli/dist/generate/index.js';

import { assertPublicUrl, BlockedUrlError } from './lib/ssrf.mjs';
import { createRateLimiter } from './lib/rate-limit.mjs';
import { createResultCache } from './lib/cache.mjs';
import { clientIp } from './lib/client-ip.mjs';
import { createJobStore } from './lib/jobs.mjs';
import { createStore, loadOrCreateSalt, ipHasher, eventFromReport } from './lib/store.mjs';
import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from './lib/turnstile.mjs';
import { t } from './lib/i18n.mjs';
import { negotiateLang, splitLangPrefix, DEFAULT_LANG } from './lib/lang.mjs';
import { renderLangSelector } from './lib/lang-selector.mjs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 3021;
const HOST = '127.0.0.1'; // behind nginx; never bind publicly.
const MAX_CONCURRENT = 10; // at most N audits at once. Audits are I/O-bound (~0.6s CPU each), so this is generous without stressing CPU; memory is the real limit and each audit is only a few MB.
const RATE_LIMIT = 20; // audits per IP...
const RATE_WINDOW_MS = 60_000; // ...per rolling minute.
const AUDIT_TIMEOUT_MS = 45_000; // hard cap on a single audit (must stay < nginx proxy_read_timeout, 60s).
const AUDIT_TIMEOUT_CWV_MS = 90_000; // raised cap when CWV (PageSpeed) is active; nginx proxy_read_timeout must be >= this.
const FETCH_TIMEOUT_MS = 10_000; // per-request timeout inside the crawler.
const MAX_PAGES = 6; // pages sampled per audit (capped for cost/speed; frees the concurrency slot sooner).
const CACHE_TTL_MS = 60_000; // reuse a fresh report for the same URL.
const CACHE_MAX_ENTRIES = 500; // bound the result cache so it can't grow unbounded.
const REPO_URL = 'https://github.com/piwig/findable-audit';
// Public origin for canonical/OG/sitemap URLs. Behind nginx we can't infer TLS
// host reliably, so it is configured explicitly (default = production host).
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN ?? 'https://findable.bordebat.fr').replace(/\/$/, '');

// Defense-in-depth CSP for the (already-escaped) HTML pages. The report uses an
// inline <style>, hence style-src 'unsafe-inline'; there is no script and no
// external origin, so scripts and everything else are locked to 'self'/'none'.
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; "
  + "img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// Relaxed landing CSP, served ONLY when turnstileEnabled() (#7): allow-lists
// Cloudflare's Turnstile origin for the widget script (loaded by `src`, no
// inline code so no nonce is needed), its challenge iframe, and its XHR calls.
// Every other directive matches the default CSP above.
const CSP_TURNSTILE = "default-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; "
  + "connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; "
  + "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const checks = buildChecks();
const rateLimiter = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS });

let inFlight = 0; // current number of running audits.
const cache = createResultCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });
const jobs = createJobStore({ ttlMs: 180_000, maxJobs: 500 });

// Usage-stats store (JSONL, best-effort). DATA_DIR defaults to apps/web/data/,
// created lazily on the first append. The hashing salt is resolved once, lazily.
const store = createStore({ dataDir: process.env.DATA_DIR ?? new URL('./data/', import.meta.url).pathname });
let hashIpFn = null;
async function hashIp(ip) {
  if (!hashIpFn) hashIpFn = ipHasher(await loadOrCreateSalt(store.dataDir));
  return hashIpFn(ip);
}
/** Append a completed audit to the store (fire-and-forget, never throws). */
function recordAuditEvent(report, meta) {
  return store.append(eventFromReport(report, meta));
}

class AuditTimeoutError extends Error {}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PAGE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 16px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fff; margin: 0; padding: 3rem 1.5rem; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.8rem; margin: 0 0 .35rem; }
  p.lead { color: #555; margin: 0 0 2rem; }
  form { display: flex; gap: .5rem; flex-wrap: wrap; margin: 0 0 1rem; }
  input[type=url], input[type=text] { flex: 1 1 18rem; min-width: 0; font-size: 1rem;
    padding: .6rem .7rem; border: 1px solid #ccc; border-radius: 6px; color: #1a1a1a; }
  input:focus { outline: 2px solid #1a7f37; outline-offset: 1px; border-color: #1a7f37; }
  button { font-size: 1rem; font-weight: 600; padding: .6rem 1.2rem; border: 0; border-radius: 6px;
    background: #1a7f37; color: #fff; cursor: pointer; }
  button:hover { background: #166a2e; }
  .hint { color: #777; font-size: .85rem; margin: 0 0 2rem; }
  .err { border-left: 3px solid #b42318; background: #fdf3f2; padding: .75rem 1rem; border-radius: 0 6px 6px 0; }
  .err h1 { color: #b42318; font-size: 1.2rem; }
  a { color: #1a7f37; }
  footer { margin-top: 3rem; color: #888; font-size: .85rem; border-top: 1px solid #e5e5e5; padding-top: 1rem; }
  .progress { height: 8px; background: #eee; border-radius: 999px; overflow: hidden; margin: 0 0 1rem; }
  .bar { height: 100%; width: 0; background: #1a7f37; transition: width .3s ease; }
  .lang-switch { font-size: .85rem; color: #777; margin: 0 0 1.5rem; }
  .lang-switch a { color: #1a7f37; text-decoration: none; }
  .lang-switch a:hover { text-decoration: underline; }
  .lang-switch [aria-current] { font-weight: 600; color: #1a1a1a; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin: 0 0 1.75rem; }
  .topbar .lang-switch { margin: 0; }
  .brand { display: inline-flex; align-items: center; gap: .55rem; text-decoration: none; }
  .brand svg { display: block; flex: 0 0 auto; }
  .brand-name { font-weight: 800; font-size: 1.05rem; letter-spacing: -.01em; color: #1c2230; }
  .g-dash { background: linear-gradient(100deg,#3bbf6b,#1a7f37 55%,#0f766e); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ld-eyebrow { font: 600 .72rem/1 system-ui; letter-spacing: .14em; text-transform: uppercase; color: #7a8290; display: flex; align-items: center; gap: 10px; margin: 0 0 .9rem; }
  .ld-eyebrow::before { content: ""; width: 26px; height: 2px; border-radius: 2px; flex: 0 0 auto; background: linear-gradient(100deg,#3bbf6b,#1a7f37 55%,#0f766e); }
  .ld-h1 { font-weight: 800; letter-spacing: -.02em; line-height: 1.06; color: #1c2230; font-size: clamp(1.9rem, 1rem + 2.8vw, 2.9rem); margin: 0 0 .7rem; max-width: 20ch; }
  .ld-h1 .g { background: linear-gradient(100deg,#3bbf6b,#1a7f37 55%,#0f766e); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ld-cta { position: relative; overflow: hidden; background: #1c2230; }
  .ld-cta::before { content: ""; position: absolute; inset: 0; opacity: 0; transition: opacity .25s; background: linear-gradient(100deg,#3bbf6b,#1a7f37 55%,#0f766e); }
  .ld-cta:hover::before { opacity: 1; }
  .ld-cta > span { position: relative; }
  .ld-sec { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #eef1f3; }
  .ld-chips { display: flex; flex-wrap: wrap; gap: .55rem; }
  .ld-chip { font-size: .85rem; font-weight: 600; color: #2b3240; background: #fff; border: 1px solid #e2e7ea; border-radius: 999px; padding: .42rem .8rem; display: inline-flex; align-items: center; gap: 7px; box-shadow: 0 1px 2px rgb(20 60 40 / .05), 0 10px 26px -14px rgb(20 60 40 / .16); }
  .ld-chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: linear-gradient(100deg,#3bbf6b,#1a7f37 55%,#0f766e); }
  .ld-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  @media (max-width: 560px) { .ld-steps { grid-template-columns: 1fr; } }
  .ld-step { display: flex; gap: .7rem; align-items: flex-start; font-size: .88rem; color: #5b6472; }
  .ld-step .n { width: 24px; height: 24px; border-radius: 50%; flex: 0 0 auto; color: #fff; font: 800 12px/1 system-ui; display: flex; align-items: center; justify-content: center; background: linear-gradient(100deg,#3bbf6b,#1a7f37 55%,#0f766e); }
  .ld-step b { color: #1c2230; display: block; font-size: .92rem; }
  .ld-rule { height: 3px; border: 0; border-radius: 999px; margin: 2rem 0 0; background: linear-gradient(100deg,#3bbf6b,#1a7f37 55%,#0f766e); }
  /* Mobile: tighter top padding, and a full-width stacked form (input + CTA). */
  @media (max-width: 560px) {
    body { padding: 1.5rem 1rem 3rem; }
    h1 { font-size: 1.5rem; }
    p.lead { margin-bottom: 1.5rem; }
    input[type=url], input[type=text] { flex-basis: 100%; }
    button { width: 100%; }
    .ld-h1 { max-width: none; }
    .topbar { margin-bottom: 1.5rem; }
  }
`;

// findable-audit logomark: "Aube verte" gradient tile + white magnifier
// (search / audit). Self-contained inline SVG — CSP-safe, no external asset.
// One inline instance per page (the brand), so the gradient id never collides
// with the /favicon.svg document (a separate resource).
function logoMark(size = 26) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`
    + '<defs><linearGradient id="faGrad" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#3bbf6b"/><stop offset=".55" stop-color="#1a7f37"/><stop offset="1" stop-color="#0f766e"/>'
    + '</linearGradient></defs>'
    + '<rect x="1" y="1" width="30" height="30" rx="7" fill="url(#faGrad)"/>'
    + '<circle cx="13.5" cy="13.5" r="6.3" fill="none" stroke="#fff" stroke-width="2.5"/>'
    + '<line x1="18.3" y1="18.3" x2="24" y2="24" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
    + '</svg>';
}

// Standalone favicon document served at /favicon.svg (32×32, no width/height so
// it scales to whatever the browser tab needs).
// Slightly heavier strokes than the larger brand/report marks so the magnifier
// stays crisp when the browser scales this document down to a 16px tab icon.
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="findable-audit">'
  + '<defs><linearGradient id="faGrad" x1="0" y1="0" x2="1" y2="1">'
  + '<stop offset="0" stop-color="#3bbf6b"/><stop offset=".55" stop-color="#1a7f37"/><stop offset="1" stop-color="#0f766e"/>'
  + '</linearGradient></defs>'
  + '<rect x="1" y="1" width="30" height="30" rx="7" fill="url(#faGrad)"/>'
  + '<circle cx="13.5" cy="13.5" r="6.2" fill="none" stroke="#fff" stroke-width="3"/>'
  + '<line x1="18.4" y1="18.4" x2="24" y2="24" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>'
  + '</svg>';

// Brand header (logomark + wordmark), links to the language-scoped home.
function brandHeader(lang) {
  return `<a class="brand" href="/${encodeURIComponent(lang)}/" aria-label="findable-audit">`
    + `${logoMark(26)}<span class="brand-name">findable<span class="g-dash">-</span>audit</span></a>`;
}

// --- Well-known discovery files (dogfooding our own GEO recommendations) ---
function robotsTxt() {
  return [
    '# findable-audit — SEO + GEO audit tool. AI crawlers are explicitly welcome.',
    '# We audit whether AI crawlers can reach and extract sites — so we allow them all.',
    'User-agent: *',
    'Allow: /',
    '',
    '# Named AI crawlers (citation-time and training) — all allowed:',
    '# GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, anthropic-ai,',
    '# PerplexityBot, Perplexity-User, Google-Extended, CCBot, Bytespider, Amazonbot.',
    '',
    'Disallow: /audit/',
    'Disallow: /compare/',
    '',
    `Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}

function sitemapXml() {
  const urls = [
    { loc: `${PUBLIC_ORIGIN}/en/`, en: `${PUBLIC_ORIGIN}/en/`, fr: `${PUBLIC_ORIGIN}/fr/` },
    { loc: `${PUBLIC_ORIGIN}/fr/`, en: `${PUBLIC_ORIGIN}/en/`, fr: `${PUBLIC_ORIGIN}/fr/` },
  ];
  const body = urls.map((u) =>
    `  <url>\n    <loc>${u.loc}</loc>\n`
    + `    <xhtml:link rel="alternate" hreflang="en" href="${u.en}"/>\n`
    + `    <xhtml:link rel="alternate" hreflang="fr" href="${u.fr}"/>\n`
    + `    <xhtml:link rel="alternate" hreflang="x-default" href="${u.en}"/>\n`
    + '  </url>').join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}

function llmsTxt() {
  return [
    '# findable-audit',
    '',
    '> Free, open-source SEO + GEO audit. It checks whether search engines and AI',
    '> crawlers (GPTBot, ClaudeBot, PerplexityBot, …) can both reach and extract a',
    '> site, then scores it A–F across 8 weighted families (AI access, LLM content,',
    '> structured data, technical SEO, on-page, performance/CWV, accessibility, security).',
    '',
    '## Use it',
    `- Web: ${PUBLIC_ORIGIN}/`,
    `- Source & CLI: ${REPO_URL}`,
    '',
    '## What it is not',
    '- Not an AI-answer monitor: it audits the *input* (your site), not the *output*',
    '  of ChatGPT/Perplexity/Gemini. It predicts findability; it does not track mentions.',
    '',
  ].join('\n');
}

function securityTxt() {
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
  return [
    `Contact: ${REPO_URL}/issues`,
    `Expires: ${expires}`,
    'Preferred-Languages: fr, en',
    `Canonical: ${PUBLIC_ORIGIN}/.well-known/security.txt`,
    '',
  ].join('\n');
}

function shell(title, bodyHtml, { lang = 'en', alternates, meta } = {}) {
  // Absolute hreflang for an indexable page (canonical origin), relative for the
  // ephemeral pages that were never meant to be crawled anyway.
  const abs = (p) => (meta ? PUBLIC_ORIGIN + p : p);
  const hreflangLinks = alternates
    ? `\n<link rel="alternate" hreflang="en" href="${escapeHtml(abs(alternates.en))}">`
      + `\n<link rel="alternate" hreflang="fr" href="${escapeHtml(abs(alternates.fr))}">`
      + `\n<link rel="alternate" hreflang="x-default" href="${escapeHtml(abs(alternates.en))}">`
    : '';
  // Indexable pages (the landing) get description/canonical/OG/JSON-LD; every
  // other (ephemeral) page stays noindex.
  let seo = '<meta name="robots" content="noindex">';
  if (meta) {
    const canonical = PUBLIC_ORIGIN + meta.path;
    const ogLocale = lang === 'fr' ? 'fr_FR' : 'en_US';
    const altLocale = lang === 'fr' ? 'en_US' : 'fr_FR';
    seo = '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">'
      + `\n<meta name="description" content="${escapeHtml(meta.description)}">`
      + `\n<link rel="canonical" href="${escapeHtml(canonical)}">`
      + `\n<meta property="og:type" content="website">`
      + `\n<meta property="og:title" content="${escapeHtml(title)}">`
      + `\n<meta property="og:description" content="${escapeHtml(meta.description)}">`
      + `\n<meta property="og:url" content="${escapeHtml(canonical)}">`
      + `\n<meta property="og:locale" content="${ogLocale}">`
      + `\n<meta property="og:locale:alternate" content="${altLocale}">`
      + `\n<meta name="twitter:card" content="summary">`
      + (meta.jsonLd ? `\n<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>` : '');
  }
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seo}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${escapeHtml(title)}</title>${hreflangLinks}
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<header class="topbar">${brandHeader(lang)}${renderLangSelector(lang)}</header>
${bodyHtml}
<footer>findable-audit · <a href="${REPO_URL}">source on GitHub</a></footer>
</main>
</body>
</html>
`;
}

// Redesigned landing page: ports pb-ot.fr's "Aube" design system to a green
// accent, self-contained (no external fonts/resources), CSP-safe (no inline
// script — the landing keeps `script-src 'none'`). Preserves the DOM
// contract: form action, input name, selector markup, hreflang.
function landingPage(lang = 'en') {
  const s = t(lang).landing;
  const c = t(lang).compare;
  const chips = s.families.map((f) => `<span class="ld-chip">${escapeHtml(f)}</span>`).join('');
  const steps = s.steps.map((st, i) =>
    `<div class="ld-step"><span class="n">${i + 1}</span><span><b>${escapeHtml(st.t)}</b>${escapeHtml(st.d)}</span></div>`).join('');
  // #7: only when Turnstile is env-gated ON — never on a plain dev/local/test
  // server, which keeps the default (script-src 'none') CSP and an unchanged
  // form. Read at REQUEST time (turnstileEnabled() defaults to process.env),
  // not cached, so toggling the env takes effect on the next request.
  const turnstileWidget = turnstileEnabled()
    ? `\n  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
      + `\n  <div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey())}"></div>`
      + `\n  <noscript>${escapeHtml(s.captchaNoscript)}</noscript>`
    : '';
  return shell(s.title, `
<p class="ld-eyebrow">${escapeHtml(s.eyebrow)}</p>
<h1 class="ld-h1">${escapeHtml(s.h1Lead)}<span class="g">${escapeHtml(s.h1Accent)}</span>${escapeHtml(s.h1Tail)}</h1>
<p class="lead">${escapeHtml(s.lead)}</p>
<form method="get" action="/${lang}/audit">
  <input type="url" name="url" placeholder="https://example.com" aria-label="${escapeHtml(s.urlLabel)}"
    autocomplete="off" autocapitalize="off" spellcheck="false" required>${turnstileWidget}
  <button type="submit" class="ld-cta"><span>${escapeHtml(s.cta)}</span></button>
</form>
<p class="hint">${escapeHtml(s.hint)}</p>
<section class="ld-sec">
  <p class="ld-eyebrow">${escapeHtml(s.familiesTitle)}</p>
  <div class="ld-chips">${chips}</div>
</section>
<section class="ld-sec">
  <p class="ld-eyebrow">${escapeHtml(s.howTitle)}</p>
  <div class="ld-steps">${steps}</div>
</section>
<section class="ld-sec">
  <p class="ld-eyebrow">${escapeHtml(c.heading)}</p>
  <p class="lead" style="margin:.1rem 0 1rem">${escapeHtml(c.lead)}</p>
  <form method="get" action="/${lang}/compare/start">
    <input type="url" name="url" placeholder="https://your-site.com" aria-label="${escapeHtml(c.urlLabel)}"
      autocomplete="off" autocapitalize="off" spellcheck="false" required>
    <input type="text" name="compare" placeholder="https://rival-1.com, https://rival-2.com" aria-label="${escapeHtml(c.competitorsLabel)}"
      autocomplete="off" autocapitalize="off" spellcheck="false">
    <button type="submit" class="ld-cta"><span>${escapeHtml(c.cta)}</span></button>
  </form>
  <p class="hint">${escapeHtml(c.hint)}</p>
</section>
<hr class="ld-rule">
`, { lang, alternates: { en: '/en/', fr: '/fr/' }, meta: landingMeta(lang) });
}

// SEO/OG metadata + a connected JSON-LD @graph for the landing (dogfooding: this
// graph must itself pass our entity-graph-connectivity check).
function landingMeta(lang) {
  const description = lang === 'fr'
    ? 'Audit SEO + GEO gratuit et open source : mesure si les moteurs de recherche ET les crawlers IA (GPTBot, ClaudeBot, PerplexityBot) peuvent trouver et extraire votre site. Note A–F, plan d’action priorisé.'
    : 'Free, open-source SEO + GEO audit: measures whether search engines AND AI crawlers (GPTBot, ClaudeBot, PerplexityBot) can find and extract your site. A–F grade, prioritized action plan.';
  const org = `${PUBLIC_ORIGIN}/#org`;
  const site = `${PUBLIC_ORIGIN}/#website`;
  const app = `${PUBLIC_ORIGIN}/#app`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': org, name: 'findable-audit', url: `${PUBLIC_ORIGIN}/`, sameAs: [REPO_URL] },
      { '@type': 'WebSite', '@id': site, url: `${PUBLIC_ORIGIN}/`, name: 'findable-audit', inLanguage: lang, publisher: { '@id': org } },
      {
        '@type': 'WebApplication', '@id': app, name: 'findable-audit', url: `${PUBLIC_ORIGIN}/`,
        applicationCategory: 'DeveloperApplication', operatingSystem: 'Any', isPartOf: { '@id': site }, provider: { '@id': org },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        description,
      },
    ],
  };
  return { path: `/${lang}/`, description, jsonLd };
}

function errorPage(title, message, { status = 400, lang = 'en' } = {}) {
  const back = escapeHtml(t(lang).error.back);
  const body = `
<div class="err">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</div>
<p><a href="/${encodeURIComponent(lang)}/">&larr; ${back}</a></p>
`;
  return { status, html: shell(title, body, { lang }) };
}

// Localized 404 (and other job-lifecycle) error page: links back to the
// lang-prefixed landing page rather than the "/" root redirect that
// errorPage() uses.
function localizedErrorPage(lang, title, message, { status = 404 } = {}) {
  const back = escapeHtml(t(lang).error.back);
  const body = `
<div class="err">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</div>
<p><a href="/${lang}/">&larr; ${back}</a></p>
`;
  return { status, html: shell(title, body, { lang }) };
}

// #55 (web): "generate indexing files" section — one download link per
// EMITTED_FILES entry (the same single source of truth as the CLI's --emit,
// packages/cli/src/generate/index.ts) plus the required bilingual warning.
// Every link hits /audit/generate, which regenerates the file IN MEMORY on
// each request — nothing is ever written to disk.
function generateFilesSection(jobId, lang) {
  const id = encodeURIComponent(jobId);
  const g = t(lang).generate;
  const links = EMITTED_FILES.map((f) =>
    `<a href="/audit/generate?job=${id}&file=${encodeURIComponent(f.filename)}" style="color:#1a7f37">${escapeHtml(f.filename)}</a>`)
    .join(' · ');
  return '<p style="max-width:860px;margin:0 auto .75rem;font:14px -apple-system,Segoe UI,Roboto,sans-serif;color:#555">'
    + `<strong>${escapeHtml(g.heading)}:</strong> ${links}<br>`
    + `<span style="color:#b45309">${escapeHtml(g.note)}</span></p>`;
}

// Wrap the stored report HTML with a download bar + back link (job-scoped),
// injected at the TOP of the report so the actions are reachable without
// scrolling past a long report.
function withResultChrome(reportHtml, jobId, lang) {
  const id = encodeURIComponent(jobId);
  const retry = escapeHtml(t(lang).progress.retry);
  const download = escapeHtml(t(lang).result.download);
  const home = `/${encodeURIComponent(lang)}/`;
  const bar = '<p style="max-width:860px;margin:1rem auto .5rem;font:15px -apple-system,Segoe UI,Roboto,sans-serif">'
    + `${download} <a href="/audit/export?job=${id}&format=md" style="color:#1a7f37">Markdown</a> · `
    + `<a href="/audit/export?job=${id}&format=html" style="color:#1a7f37">HTML</a> · `
    + `<a href="/audit/export?job=${id}&format=json" style="color:#1a7f37">JSON</a>`
    + `&nbsp;&nbsp;|&nbsp;&nbsp;<a href="${home}" style="color:#1a7f37">&larr; ${retry}</a></p>`
    + generateFilesSection(jobId, lang);
  const marker = '<body>';
  const idx = reportHtml.indexOf(marker);
  if (idx === -1) return bar + reportHtml;
  const at = idx + marker.length;
  return reportHtml.slice(0, at) + '\n' + bar + reportHtml.slice(at);
}

// HTTP status per error code: timeout/unreachable return 200 (so Cloudflare shows
// OUR friendly page, not its branded 5xx); busy → 429; anything else → 502.
function statusForError(code) {
  if (code === 'timeout' || code === 'unreachable') return 200;
  if (code === 'busy') return 429;
  return 502;
}

// ---------------------------------------------------------------------------
// Audit execution
// ---------------------------------------------------------------------------
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AuditTimeoutError('Audit timed out.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run an audit for an already-validated URL, honouring the concurrency cap,
 * hard timeout and short-lived result cache.
 * @param {URL} url validated target
 * @returns {Promise<import('../../packages/cli/dist/runner.js').AuditReport>}
 */
async function auditUrl(url, { cwv = cwvActive() } = {}) {
  // Compare mode runs without CWV (no PSI call) so N audits stay fast; cache it
  // under a distinct key so it never cross-contaminates a full single audit.
  const key = url.href + (cwv ? '' : '#nocwv');

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  if (inFlight >= MAX_CONCURRENT) {
    const err = new Error('busy');
    err.code = 'BUSY';
    throw err;
  }

  inFlight++;
  // Tie an AbortController to the hard timeout: when the audit times out we
  // abort it, which cancels every in-flight crawler fetch, lets runAudit settle
  // promptly and frees the concurrency slot instead of leaking it for ~10s.
  const ac = new AbortController();
  const opts = {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxPages: MAX_PAGES,
    blockPrivateHosts: true, // fetch-layer SSRF guard: every hop is revalidated.
    signal: ac.signal,
  };
  if (cwv) { opts.cwv = true; opts.psiKey = process.env.PSI_KEY; opts.psiStrategy = 'mobile'; }
  const auditPromise = runAudit(url.href, checks, opts);
  // Free the slot when the real audit settles, even if the HTTP response has
  // already timed out below; swallow a late rejection so it is never unhandled.
  auditPromise.then(
    () => { inFlight--; },
    () => { inFlight--; },
  );

  let report;
  try {
    report = await withTimeout(auditPromise, cwv ? AUDIT_TIMEOUT_CWV_MS : AUDIT_TIMEOUT_MS);
  } catch (err) {
    ac.abort(); // on timeout (or any race failure) cancel in-flight fetches.
    throw err;
  }
  cache.set(key, report);
  return report;
}

// ---------------------------------------------------------------------------
// Async audit execution (lazy, idempotent per job) + SSE stream
// ---------------------------------------------------------------------------
const cwvActive = () => Boolean(process.env.PSI_KEY && process.env.PSI_KEY.trim());
const auditTimeout = () => (cwvActive() ? AUDIT_TIMEOUT_CWV_MS : AUDIT_TIMEOUT_MS);

const running = new Map(); // jobId -> Promise, so an audit runs at most once per job.

function classifyError(err, lang) {
  const e = t(lang).error;
  if (err instanceof AuditTimeoutError) return { code: 'timeout', message: e.timeout.message };
  if (err instanceof UnreachableSiteError) return { code: 'unreachable', message: e.unreachable.message };
  if (err && err.code === 'BUSY') return { code: 'busy', message: e.busy.message };
  console.error('audit error:', err);
  return { code: 'internal', message: e.internal.message };
}

async function executeAudit(job) {
  const key = job.url;
  const cached = cache.get(key);
  if (cached !== undefined) {
    jobs.finish(job.id, { report: cached, html: renderHtml(cached, undefined, job.lang, { collapsed: true }) });
    return;
  }
  if (inFlight >= MAX_CONCURRENT) {
    jobs.fail(job.id, 'busy', t(job.lang).error.busy.message);
    return;
  }
  inFlight++;
  const ac = new AbortController();
  const opts = {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxPages: MAX_PAGES,
    blockPrivateHosts: true,          // fetch-layer SSRF guard, unchanged.
    signal: ac.signal,
    onProgress: (ev) => jobs.setProgress(job.id, ev),
  };
  if (cwvActive()) { opts.cwv = true; opts.psiKey = process.env.PSI_KEY; opts.psiStrategy = 'mobile'; }
  const startedAt = Date.now();
  try {
    const report = await withTimeout(runAudit(key, checks, opts), auditTimeout());
    cache.set(key, report);
    jobs.finish(job.id, { report, html: renderHtml(report, undefined, job.lang, { collapsed: true }) });
    recordAuditEvent(report, {
      kind: 'audit', lang: job.lang, ipHash: job.ipHash ?? null,
      durationMs: Date.now() - startedAt, cwv: Boolean(report.psi),
    });
  } catch (err) {
    ac.abort();
    const { code, message } = classifyError(err, job.lang);
    jobs.fail(job.id, code, message);
  } finally {
    inFlight--;
  }
}

/** Start a job at most once. No-op (resolved) if it is already terminal. */
function ensureStarted(job) {
  if (job.status !== 'running') return Promise.resolve();
  let pr = running.get(job.id);
  if (!pr) {
    // Bound the map: drop the entry once the audit settles so `running` cannot
    // grow unbounded on a long-running server. Safe because this function
    // short-circuits above on any non-'running' (i.e. terminal) job status, so
    // a deleted entry is never wrongly re-executed for a terminal job.
    pr = (job.kind === 'compare' ? executeCompare(job) : executeAudit(job)).finally(() => running.delete(job.id));
    running.set(job.id, pr);
  }
  return pr;
}

function jobFromQuery(req) {
  const parsed = new URL(req.url, 'http://localhost');
  const id = parsed.searchParams.get('job') ?? '';
  return jobs.get(id);
}

function handleStream(req, res, job) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',          // ask nginx not to buffer the stream.
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.write(': connected\n\n'); // open the stream immediately.
  ensureStarted(job);

  let lastSig = '';
  let quiet = 0;
  const tick = setInterval(() => {
    const j = jobs.get(job.id);
    if (!j) { clearInterval(tick); res.end(); return; }
    const p = j.progress;
    if (p) {
      const sig = `${p.phase}:${p.done}:${p.total}`;
      if (sig !== lastSig) {
        lastSig = sig; quiet = 0;
        res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`);
      }
    }
    if (j.status === 'done') { res.write('event: done\ndata: {}\n\n'); clearInterval(tick); res.end(); return; }
    if (j.status === 'error') {
      res.write(`event: error\ndata: ${JSON.stringify(j.error ?? { code: 'internal', message: '' })}\n\n`);
      clearInterval(tick); res.end(); return;
    }
    if (++quiet >= 50) { quiet = 0; res.write(': ping\n\n'); } // ~10s heartbeat keeps proxies open.
  }, 200);
  req.on('close', () => clearInterval(tick));
}

function safeHost(urlHref) {
  try { return (new URL(urlHref).hostname || 'report').replace(/[^a-z0-9.-]/gi, '-'); }
  catch { return 'report'; }
}

async function handleExport(req, res, job, format) {
  await ensureStarted(job);
  const j = jobs.get(job.id);
  if (!j) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
  if (j.status !== 'done' || !j.report) {
    const e = t(j.lang).error.reportNotReady;
    const p = localizedErrorPage(j.lang, e.title, e.message, { status: 409 });
    send(res, p.status, 'text/html; charset=utf-8', p.html);
    return;
  }

  let body, contentType, ext;
  if (format === 'json') { body = renderJson(j.report); contentType = 'application/json; charset=utf-8'; ext = 'json'; }
  else if (format === 'md') { body = renderMarkdown(j.report, undefined, j.lang); contentType = 'text/markdown; charset=utf-8'; ext = 'md'; }
  else { body = renderHtml(j.report, undefined, j.lang); contentType = 'text/html; charset=utf-8'; ext = 'html'; }

  const filename = `${safeHost(j.url)}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  send(res, 200, contentType, body, { 'content-disposition': `attachment; filename="${filename}"` });
}

// #55 (web): GET /audit/generate?job=<id>&file=<name> — regenerate one of the
// EMITTED_FILES (robots.txt, llms.txt, llms-full.txt, .well-known/ai.json,
// sitemap.xml, jsonld-stubs.json) from the job's in-memory report and stream
// it as an attachment. CRITICAL: nothing is written to disk — the file body
// is produced fresh by entry.build(report, {lang}) on every single request.
// Unknown/expired job, an unfinished/failed job, or a `file` not present in
// EMITTED_FILES all 404 (mirrors handleExport's unknown-job convention: a
// plain-text 404, no page chrome, since this is a raw download endpoint).
async function handleGenerate(req, res, job) {
  await ensureStarted(job);
  const j = jobs.get(job.id);
  if (!j || j.status !== 'done' || !j.report) {
    send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.');
    return;
  }

  const parsed = new URL(req.url, 'http://localhost');
  const name = parsed.searchParams.get('file') ?? '';
  // Exact match against the fixed EMITTED_FILES catalogue — no path
  // traversal is possible since nothing derived from `name` ever touches the
  // filesystem; basename() below only shapes the download's display name.
  const entry = EMITTED_FILES.find((f) => f.filename === name);
  if (!entry) {
    send(res, 404, 'text/plain; charset=utf-8', 'Unknown file.');
    return;
  }

  const body = entry.build(j.report, { lang: j.lang });
  send(res, 200, `${entry.mime}; charset=utf-8`, body, {
    'content-disposition': `attachment; filename="${basename(entry.filename)}"`,
  });
}

async function handleResult(req, res, job) {
  await ensureStarted(job); // starts + awaits (idempotent); no-op if already terminal.
  const j = jobs.get(job.id);
  if (!j) {
    // Rare race: the job existed at dispatch time but is gone now (pruned).
    // Fall back to the lang the caller already resolved for this job.
    const nf = t(job.lang ?? 'en').error.notFound;
    const p = localizedErrorPage(job.lang ?? 'en', nf.title, nf.message, { status: 404 });
    send(res, p.status, 'text/html; charset=utf-8', p.html);
    return;
  }

  if (j.status === 'done' && j.html) {
    send(res, 200, 'text/html; charset=utf-8', withResultChrome(j.html, j.id, j.lang));
    return;
  }
  // Error (or the rare not-yet-terminal race): render a localized error page.
  const code = j.error?.code ?? 'internal';
  const cat = t(j.lang).error[code] ?? t(j.lang).error.internal;
  const title = cat.title;
  const message = j.error?.message ?? cat.message;
  const status = statusForError(code);
  const p = localizedErrorPage(j.lang, title, message, { status });
  send(res, p.status, 'text/html; charset=utf-8', p.html);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function send(res, status, contentType, body, extraHeaders = {}) {
  const headers = {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'permissions-policy': 'geolocation=(), camera=(), microphone=()',
    ...extraHeaders,
  };
  // Default CSP for served HTML, unless the caller already set one (progress page).
  if (contentType.startsWith('text/html') && !('content-security-policy' in headers)) {
    headers['content-security-policy'] = CSP;
  }
  res.writeHead(status, headers);
  res.end(body);
}

// ---------------------------------------------------------------------------
// Async /audit progress page (lazy execution: Tasks 5-8 add the runner + routes)
// ---------------------------------------------------------------------------
function normalizeLang(raw) { return raw === 'fr' ? 'fr' : 'en'; }

function progressPage(jobId, lang, nonce) {
  const m = t(lang).progress;
  const id = encodeURIComponent(jobId);
  // Our own controlled catalogue; JSON.stringify + escape '<' guards against a
  // stray "</script>" ever appearing in a label.
  const labels = JSON.stringify(m.phases).replace(/</g, '\\u003c');
  const jobLiteral = JSON.stringify(jobId);
  const body = `
<h1>${escapeHtml(m.heading)}</h1>
<p class="lead">${escapeHtml(m.lead)}</p>
<div class="progress" role="progressbar" aria-live="polite" aria-label="${escapeHtml(m.heading)}">
  <div id="bar" class="bar" style="width:0%"></div>
</div>
<p id="status" class="hint">${escapeHtml(m.phases.connect)}</p>
<noscript>
  <meta http-equiv="refresh" content="0; url=/audit/result?job=${id}">
  <p>${escapeHtml(m.noscript)} <a href="/audit/result?job=${id}">${escapeHtml(m.done)}</a></p>
</noscript>
<script nonce="${nonce}">
(function () {
  var LABELS = ${labels};
  var status = document.getElementById('status');
  var bar = document.getElementById('bar');
  var job = ${jobLiteral};
  var es = new EventSource('/audit/stream?job=' + encodeURIComponent(job));
  es.addEventListener('progress', function (e) {
    try {
      var p = JSON.parse(e.data);
      if (status && LABELS[p.phase]) status.textContent = LABELS[p.phase];
      if (bar && p.total) bar.style.width = Math.round(p.done / p.total * 100) + '%';
    } catch (_) {}
  });
  es.addEventListener('done', function () { es.close(); window.location = '/audit/result?job=' + encodeURIComponent(job); });
  es.addEventListener('error', function () { es.close(); window.location = '/audit/result?job=' + encodeURIComponent(job); });
})();
</script>
`;
  return shell(m.title, body, { lang });
}

// Task 5 (#7): server-side Turnstile verification, called from
// handleAuditStart/handleCompareStart just before job creation. Indirected
// through a reassignable module-level binding — rather than calling
// verifyTurnstile() directly — purely so tests can stub the outbound
// siteverify call without a real network request (setVerifyTurnstileForTest,
// exported below). Production code never reassigns it.
let verifyTurnstileImpl = verifyTurnstile;
function setVerifyTurnstileForTest(fn) {
  verifyTurnstileImpl = fn ?? verifyTurnstile;
}

// Rate-limit + SSRF check, then create the job and return the progress page.
// Execution is lazy: the audit itself is kicked off by /audit/stream or
// /audit/result (added in Tasks 5-8), whichever the client hits first.
async function handleAuditStart(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const lang = normalizeLang(parsed.searchParams.get('lang'));

  const ip = clientIp(req);
  const rl = rateLimiter.take(ip);
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    const e = t(lang).error.rateLimited;
    const p = errorPage(e.title, `${e.message} (~${retryAfter}s)`, { status: 429, lang });
    send(res, p.status, 'text/html; charset=utf-8', p.html, { 'retry-after': String(retryAfter) });
    return;
  }

  const rawUrl = parsed.searchParams.get('url') ?? '';
  const normalized = normalizeInput(rawUrl);
  if (normalized === '') {
    const e = t(lang).error.missingUrl;
    const p = errorPage(e.title, e.message, { lang });
    send(res, p.status, 'text/html; charset=utf-8', p.html);
    return;
  }

  let url;
  try {
    url = await assertPublicUrl(normalized);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      // Only the title is localized — err.message is the SSRF layer's own
      // technical message and is kept as-is.
      const title = t(lang).error.urlNotAllowed.title;
      const p = errorPage(title, err.message, { lang });
      send(res, p.status, 'text/html; charset=utf-8', p.html);
      return;
    }
    throw err;
  }

  // #7: server-side Turnstile verification, AFTER rate-limit + SSRF, BEFORE
  // job creation. turnstileEnabled() is read once per request (calling it
  // twice would double the misconfiguration console.warn — see turnstile.mjs).
  // Env-gated: with no keys, this block never runs and the token is never
  // even read — behavior is byte-identical to before Turnstile existed.
  if (turnstileEnabled()) {
    const token = parsed.searchParams.get('cf-turnstile-response');
    const { ok } = await verifyTurnstileImpl(token, ip, { secret: process.env.TURNSTILE_SECRET_KEY });
    if (!ok) {
      const e = t(lang).error.captchaFailed;
      const p = errorPage(e.title, e.message, { status: 400, lang });
      send(res, p.status, 'text/html; charset=utf-8', p.html);
      return;
    }
  }

  // Create the job but DO NOT run the audit yet — execution is lazy, kicked off
  // by /audit/stream or /audit/result (whichever the client hits first).
  const ipHash = await hashIp(ip);
  const job = jobs.create({ url: url.href, lang, ipHash });
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; "
    + `script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; `
    + "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  send(res, 200, 'text/html; charset=utf-8', progressPage(job.id, lang, nonce), { 'content-security-policy': csp });
}

// Normalize what the user typed: allow a bare "example.com" (default https).
function normalizeInput(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// ---------------------------------------------------------------------------
// Route handler for /audit.json (JSON-only). The HTML flow is now the async
// /audit → /audit/stream → /audit/result path (handleAuditStart, handleStream,
// handleResult, handleExport) — see Tasks 4-7.
// ---------------------------------------------------------------------------
async function handleAudit(req, res) {
  const ip = clientIp(req);
  const rl = rateLimiter.take(ip);
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    send(res, 429, 'application/json; charset=utf-8',
      JSON.stringify({ error: 'rate_limited', retryAfterSeconds: retryAfter }),
      { 'retry-after': String(retryAfter) });
    return;
  }

  const parsed = new URL(req.url, 'http://localhost');
  const rawUrl = parsed.searchParams.get('url') ?? '';
  const normalized = normalizeInput(rawUrl);
  if (normalized === '') {
    send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing url parameter' }));
    return;
  }

  // 1) SSRF + validation. Failures are safe 400s.
  let url;
  try {
    url = await assertPublicUrl(normalized);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      send(res, 400, 'application/json; charset=utf-8',
        JSON.stringify({ error: 'blocked', reason: err.code, message: err.message }));
      return;
    }
    throw err;
  }

  // 2) Run the audit (concurrency-capped, timed).
  let report;
  const startedAt = Date.now();
  try {
    report = await auditUrl(url);
  } catch (err) {
    if (err && err.code === 'BUSY') {
      const msg = 'The server is busy running other audits. Please try again in a few seconds.';
      send(res, 429, 'application/json; charset=utf-8', JSON.stringify({ error: 'busy', message: msg }),
        { 'retry-after': '5' });
      return;
    }
    if (err instanceof AuditTimeoutError) {
      const msg = 'The audit took too long and was stopped. The target site may be slow or unresponsive.';
      send(res, 504, 'application/json; charset=utf-8', JSON.stringify({ error: 'timeout', message: msg }));
      return;
    }
    if (err instanceof UnreachableSiteError) {
      const msg = `Could not reach ${url.href} — the site may be down or blocking automated requests.`;
      send(res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: 'unreachable', message: msg }));
      return;
    }
    // Unexpected failure: log server-side, return a generic message.
    console.error('audit error:', err);
    const msg = 'Something went wrong while auditing that site.';
    send(res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal', message: msg }));
    return;
  }

  // 3) Render JSON only — no reportWithBackLink, no HTML branch.
  recordAuditEvent(report, {
    kind: 'audit', lang: DEFAULT_LANG, ipHash: await hashIp(ip),
    durationMs: Date.now() - startedAt, cwv: Boolean(report.psi),
  });
  send(res, 200, 'application/json; charset=utf-8', renderJson(report));
}

// ---------------------------------------------------------------------------
// /compare — audit your URL against up to two competitors, ASYNC via the job
// pattern (a redo of the reverted synchronous /compare, 31966ea, which timed
// out behind the proxy). CWV-free so N audits stay fast. The main URL must
// succeed; competitors are best-effort (an unreachable one is skipped).
// ---------------------------------------------------------------------------
const MAX_COMPARE_COMPETITORS = 2;

function compareProgressPage(jobId, lang, nonce) {
  const m = t(lang).compare;
  const id = encodeURIComponent(jobId);
  const jobLiteral = JSON.stringify(jobId);
  const siteTpl = JSON.stringify(m.progressSite).replace(/</g, '\\u003c');
  const body = `
<h1>${escapeHtml(m.progressHeading)}</h1>
<p class="lead">${escapeHtml(m.lead)}</p>
<div class="progress" role="progressbar" aria-live="polite" aria-label="${escapeHtml(m.progressHeading)}">
  <div id="bar" class="bar" style="width:0%"></div>
</div>
<p id="status" class="hint">${escapeHtml(m.progressHeading)}</p>
<noscript>
  <meta http-equiv="refresh" content="0; url=/compare/result?job=${id}">
  <p><a href="/compare/result?job=${id}">${escapeHtml(m.resultTitle)}</a></p>
</noscript>
<script nonce="${nonce}">
(function () {
  var TPL = ${siteTpl};
  var status = document.getElementById('status');
  var bar = document.getElementById('bar');
  var job = ${jobLiteral};
  var es = new EventSource('/compare/stream?job=' + encodeURIComponent(job));
  es.addEventListener('progress', function (e) {
    try {
      var p = JSON.parse(e.data);
      if (status && p.total) status.textContent = TPL.replace('{i}', p.done).replace('{n}', p.total);
      if (bar && p.total) bar.style.width = Math.round(p.done / p.total * 100) + '%';
    } catch (_) {}
  });
  es.addEventListener('done', function () { es.close(); window.location = '/compare/result?job=' + encodeURIComponent(job); });
  es.addEventListener('error', function () { es.close(); window.location = '/compare/result?job=' + encodeURIComponent(job); });
})();
</script>
`;
  return shell(m.progressTitle, body, { lang });
}

async function handleCompareStart(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const lang = normalizeLang(parsed.searchParams.get('lang'));
  const errHtml = (title, message, status = 400) => {
    const p = localizedErrorPage(lang, title, message, { status });
    send(res, p.status, 'text/html; charset=utf-8', p.html);
  };

  const ip = clientIp(req);
  const mainRaw = normalizeInput(parsed.searchParams.get('url') ?? '');
  const competitorsRaw = (parsed.searchParams.get('compare') ?? '')
    .split(',').map((s) => normalizeInput(s.trim())).filter(Boolean).slice(0, MAX_COMPARE_COMPETITORS);
  if (mainRaw === '') { const e = t(lang).error.missingUrl; errHtml(e.title, e.message); return; }

  // Rate-limit: one token PER URL submitted (main + competitors), so a compare
  // costs its true share of the per-IP budget.
  const rawUrls = [mainRaw, ...competitorsRaw];
  for (let i = 0; i < rawUrls.length; i++) {
    const rl = rateLimiter.take(ip);
    if (!rl.allowed) {
      const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
      const e = t(lang).error.rateLimited;
      errHtml(e.title, `${e.message} (~${retryAfter}s)`, 429);
      return;
    }
  }

  // Validate the main URL up front (a bad main URL is a hard 400); competitors
  // are validated lazily during execution and skipped if blocked.
  let mainUrl;
  try {
    mainUrl = await assertPublicUrl(mainRaw);
  } catch (err) {
    errHtml(t(lang).error.urlNotAllowed.title, err instanceof BlockedUrlError ? err.message : 'Invalid URL');
    return;
  }

  // #7: same server-side Turnstile gate as handleAuditStart, before job
  // creation. See the comment on verifyTurnstileImpl for why this is
  // indirected. Env-gated: with no keys, unchanged.
  if (turnstileEnabled()) {
    const token = parsed.searchParams.get('cf-turnstile-response');
    const { ok } = await verifyTurnstileImpl(token, ip, { secret: process.env.TURNSTILE_SECRET_KEY });
    if (!ok) {
      const e = t(lang).error.captchaFailed;
      errHtml(e.title, e.message, 400);
      return;
    }
  }

  const urls = [mainUrl.href, ...competitorsRaw];
  const ipHash = await hashIp(ip);
  const job = jobs.create({ url: mainUrl.href, lang, kind: 'compare', urls, ipHash });
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; "
    + `script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; `
    + "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  send(res, 200, 'text/html; charset=utf-8', compareProgressPage(job.id, lang, nonce), { 'content-security-policy': csp });
}

// Sequentially audit each URL (CWV-free), reporting per-site progress. The main
// URL must succeed; competitors are best-effort. < 2 reachable sites → fail with
// the localized "needMore" code, surfaced by handleCompareResult.
async function executeCompare(job) {
  // No own inFlight bookkeeping: auditUrl() already caps concurrency, times out
  // and caches per sub-audit. Audits run sequentially so at most one sub-audit
  // holds a slot at a time.
  const startedAt = Date.now();
  const total = job.urls.length;
  const reports = [];
  const skipped = [];
  for (let i = 0; i < job.urls.length; i++) {
    const isMain = i === 0;
    jobs.setProgress(job.id, { phase: 'compare', done: i, total });
    let url;
    try {
      url = await assertPublicUrl(job.urls[i]);
    } catch {
      if (isMain) { jobs.fail(job.id, 'unreachable', t(job.lang).error.unreachable.message); return; }
      skipped.push(job.urls[i]); continue;
    }
    try {
      const report = await auditUrl(url, { cwv: false });
      reports.push(report);
      recordAuditEvent(report, { kind: 'compare', lang: job.lang, ipHash: job.ipHash ?? null, durationMs: Date.now() - startedAt, cwv: false });
    } catch (err) {
      if (isMain) {
        const code = err instanceof AuditTimeoutError ? 'timeout'
          : (err && err.code === 'BUSY') ? 'busy'
            : err instanceof UnreachableSiteError ? 'unreachable' : 'internal';
        jobs.fail(job.id, code, t(job.lang).error[code]?.message ?? t(job.lang).error.internal.message);
        return;
      }
      skipped.push(job.urls[i]);
    }
  }
  jobs.setProgress(job.id, { phase: 'compare', done: total, total });
  if (reports.length < 2) { jobs.fail(job.id, 'needMore', t(job.lang).compare.needMore); return; }
  const skippedNote = skipped.length
    ? `<p style="max-width:960px;margin:.5rem auto;color:#b45309;font:14px system-ui,sans-serif">`
      + skipped.map((u) => escapeHtml(t(job.lang).compare.skipped.replace('{url}', u))).join('<br>') + '</p>'
    : '';
  const html = renderCompareHtml(reports, undefined, job.lang);
  jobs.finish(job.id, { report: reports[0], reports, html: injectAfterBody(html, skippedNote) });
}

// Insert extra HTML right after <body> (used to prepend the skipped-sites note).
function injectAfterBody(html, extra) {
  if (!extra) return html;
  const idx = html.indexOf('<body>');
  if (idx === -1) return extra + html;
  const at = idx + '<body>'.length;
  return html.slice(0, at) + '\n' + extra + html.slice(at);
}

async function handleCompareResult(req, res, job) {
  await ensureStarted(job);
  const j = jobs.get(job.id);
  if (!j) {
    const nf = t(job.lang ?? 'en').error.notFound;
    const p = localizedErrorPage(job.lang ?? 'en', nf.title, nf.message, { status: 404 });
    send(res, p.status, 'text/html; charset=utf-8', p.html);
    return;
  }
  if (j.status === 'done' && j.html) {
    send(res, 200, 'text/html; charset=utf-8', withCompareChrome(j.html, j.id, j.lang));
    return;
  }
  // needMore is a compare-specific "error" surfaced as a friendly page.
  if (j.error?.code === 'needMore') {
    const c = t(j.lang).compare;
    const p = localizedErrorPage(j.lang, c.needMoreTitle, c.needMore, { status: 400 });
    send(res, p.status, 'text/html; charset=utf-8', p.html);
    return;
  }
  const code = j.error?.code ?? 'internal';
  const cat = t(j.lang).error[code] ?? t(j.lang).error.internal;
  const p = localizedErrorPage(j.lang, cat.title, j.error?.message ?? cat.message, { status: statusForError(code) });
  send(res, p.status, 'text/html; charset=utf-8', p.html);
}

// Download/back bar for the compare result (parallels withResultChrome).
function withCompareChrome(reportHtml, jobId, lang) {
  const id = encodeURIComponent(jobId);
  const retry = escapeHtml(t(lang).progress.retry);
  const download = escapeHtml(t(lang).result.download);
  const home = `/${encodeURIComponent(lang)}/`;
  const bar = '<p style="max-width:960px;margin:1rem auto .5rem;font:15px -apple-system,Segoe UI,Roboto,sans-serif">'
    + `${download} <a href="/compare/export?job=${id}&format=html" style="color:#1a7f37">HTML</a>`
    + `&nbsp;&nbsp;|&nbsp;&nbsp;<a href="${home}" style="color:#1a7f37">&larr; ${retry}</a></p>`;
  return injectAfterBody(reportHtml, bar);
}

async function handleCompareExport(req, res, job) {
  await ensureStarted(job);
  const j = jobs.get(job.id);
  if (!j || j.status !== 'done' || !j.html) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or unfinished comparison.'); return; }
  const filename = `compare-${new Date().toISOString().slice(0, 10)}.html`;
  send(res, 200, 'text/html; charset=utf-8', j.html, { 'content-disposition': `attachment; filename="${filename}"` });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // Only GET (and HEAD) are supported.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', { allow: 'GET' });
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    send(res, 400, 'text/plain; charset=utf-8', 'Bad Request');
    return;
  }

  // --- i18n path-prefix routing (sub-phase 2C) ------------------------------
  // Every human-facing page lives under /en or /fr. `/` redirects to the
  // Accept-Language match (else English). Only `/audit` is human-navigable
  // (typed/bookmarked directly), so only it 301-redirects to its English form
  // when requested unprefixed. `/audit/stream`, `/audit/result`, and
  // `/audit/export` are never navigated to directly — 2B's progress page
  // hardcodes them as unprefixed URLs (the EventSource source, the
  // <noscript> refresh link, and the download-bar links), so redirecting
  // them would add a wasteful extra 301 hop to every SSE/result/export
  // request. They — like `/healthz` and `/audit.json` — stay global,
  // unprefixed routes left untouched by this block.
  const HUMAN_PATHS = new Set(['/audit', '/compare/start']);

  if (pathname === '/') {
    const lang = negotiateLang(req.headers['accept-language']);
    send(res, 302, 'text/plain; charset=utf-8', 'Found', { location: `/${lang}/` });
    return;
  }

  const split = splitLangPrefix(pathname);
  if (split) {
    // Rewrite the request so the existing (2B-extended) dispatch chain below
    // sees the unprefixed pathname, with `lang` forced onto the query string.
    // 2B's job routes read `lang` from the query per the Phase-2 contract, so
    // no further coupling to their internals is needed here.
    const rewritten = new URL(req.url, 'http://localhost');
    rewritten.pathname = split.rest;
    rewritten.searchParams.set('lang', split.lang);
    req.url = rewritten.pathname + rewritten.search;
    req.__lang = split.lang;
    pathname = split.rest;

    if (pathname === '/') {
      // #7: serve the relaxed (Cloudflare-allow-listed) CSP only when
      // Turnstile is enabled; otherwise `send()` applies the default CSP
      // (script-src 'none') unchanged, matching today's behavior exactly.
      const headers = turnstileEnabled() ? { 'content-security-policy': CSP_TURNSTILE } : {};
      send(res, 200, 'text/html; charset=utf-8', landingPage(split.lang), headers);
      return;
    }
    // Any other rest path (/audit, /audit/stream, /audit/result, /audit/export,
    // or an unknown path) falls through to the dispatch chain below.
  } else if (HUMAN_PATHS.has(pathname)) {
    const rewritten = new URL(req.url, 'http://localhost');
    rewritten.pathname = `/${DEFAULT_LANG}${pathname}`;
    // Force the query string through the URLSearchParams serializer (percent-
    // encoding reserved characters like ":" and "/" in param values) so the
    // Location header is well-formed regardless of how the client wrote it.
    rewritten.searchParams.sort();
    send(res, 301, 'text/plain; charset=utf-8', 'Moved Permanently', { location: rewritten.pathname + rewritten.search });
    return;
  }

  if (pathname === '/favicon.svg' || pathname === '/favicon.ico') {
    // Serve the SVG for both: browsers request /favicon.ico by default when a
    // page (e.g. the served report) declares no icon link — modern browsers
    // accept an SVG payload regardless of the .ico extension.
    send(res, 200, 'image/svg+xml; charset=utf-8', FAVICON_SVG, { 'cache-control': 'public, max-age=86400' });
    return;
  }
  if (pathname === '/healthz') {
    send(res, 200, 'text/plain; charset=utf-8', 'ok');
    return;
  }
  if (pathname === '/robots.txt') {
    send(res, 200, 'text/plain; charset=utf-8', robotsTxt(), { 'cache-control': 'public, max-age=86400' });
    return;
  }
  if (pathname === '/sitemap.xml') {
    send(res, 200, 'application/xml; charset=utf-8', sitemapXml(), { 'cache-control': 'public, max-age=86400' });
    return;
  }
  if (pathname === '/llms.txt') {
    send(res, 200, 'text/plain; charset=utf-8', llmsTxt(), { 'cache-control': 'public, max-age=86400' });
    return;
  }
  if (pathname === '/.well-known/security.txt' || pathname === '/security.txt') {
    send(res, 200, 'text/plain; charset=utf-8', securityTxt(), { 'cache-control': 'public, max-age=86400' });
    return;
  }
  if (pathname === '/audit') {
    handleAuditStart(req, res).catch((err) => {
      console.error('unhandled /audit error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
  if (pathname === '/audit.json') {
    handleAudit(req, res).catch((err) => {
      console.error('unhandled /audit.json error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
  if (pathname === '/audit/stream') {
    const job = jobFromQuery(req);
    if (!job) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
    handleStream(req, res, job);
    return;
  }
  if (pathname === '/audit/result') {
    const job = jobFromQuery(req);
    if (!job) {
      const lang = negotiateLang(req.headers['accept-language']);
      const nf = t(lang).error.notFound;
      const p = localizedErrorPage(lang, nf.title, nf.message, { status: 404 });
      send(res, p.status, 'text/html; charset=utf-8', p.html);
      return;
    }
    handleResult(req, res, job).catch((err) => {
      console.error('unhandled /audit/result error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
  if (pathname === '/audit/export') {
    const parsed = new URL(req.url, 'http://localhost');
    const format = parsed.searchParams.get('format') ?? '';
    if (format !== 'md' && format !== 'html' && format !== 'json') {
      send(res, 400, 'text/plain; charset=utf-8', 'format must be one of: md, html, json');
      return;
    }
    const job = jobFromQuery(req);
    if (!job) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
    handleExport(req, res, job, format).catch((err) => {
      console.error('unhandled /audit/export error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
  if (pathname === '/audit/generate') {
    const job = jobFromQuery(req);
    if (!job) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
    handleGenerate(req, res, job).catch((err) => {
      console.error('unhandled /audit/generate error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
  if (pathname === '/compare/start') {
    handleCompareStart(req, res).catch((err) => {
      console.error('unhandled /compare/start error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
  if (pathname === '/compare/stream') {
    const job = jobFromQuery(req);
    if (!job) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
    handleStream(req, res, job);
    return;
  }
  if (pathname === '/compare/result') {
    const job = jobFromQuery(req);
    if (!job) {
      const lang = negotiateLang(req.headers['accept-language']);
      const nf = t(lang).error.notFound;
      const p = localizedErrorPage(lang, nf.title, nf.message, { status: 404 });
      send(res, p.status, 'text/html; charset=utf-8', p.html);
      return;
    }
    handleCompareResult(req, res, job).catch((err) => {
      console.error('unhandled /compare/result error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }
  if (pathname === '/compare/export') {
    const job = jobFromQuery(req);
    if (!job) { send(res, 404, 'text/plain; charset=utf-8', 'Unknown or expired job.'); return; }
    handleCompareExport(req, res, job).catch((err) => {
      console.error('unhandled /compare/export error:', err);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error');
    });
    return;
  }

  {
    const lang = req.__lang ?? negotiateLang(req.headers['accept-language']);
    const notFound = t(lang).error.notFound;
    const page = localizedErrorPage(lang, notFound.title, notFound.message, { status: 404 });
    send(res, page.status, 'text/html; charset=utf-8', page.html);
  }
});

// Periodically drop stale rate-limiter buckets and cache entries; unref so it
// never blocks exit.
setInterval(() => { rateLimiter.sweep(); cache.sweep(); jobs.prune(); }, RATE_WINDOW_MS).unref();

server.listen(PORT, HOST, () => {
  console.log(`findable-audit web app listening on http://${HOST}:${PORT}`);
});

export { server, jobs, cwvActive, auditTimeout, store, recordAuditEvent, setVerifyTurnstileForTest };
