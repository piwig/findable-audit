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

import { runAudit, UnreachableSiteError } from '../../packages/cli/dist/runner.js';
import { buildChecks } from '../../packages/cli/dist/checks/index.js';
import { renderHtml } from '../../packages/cli/dist/report/html.js';
import { renderJson } from '../../packages/cli/dist/report/json.js';
import { renderMarkdown } from '../../packages/cli/dist/report/markdown.js';

import { assertPublicUrl, BlockedUrlError } from './lib/ssrf.mjs';
import { createRateLimiter } from './lib/rate-limit.mjs';
import { createResultCache } from './lib/cache.mjs';
import { clientIp } from './lib/client-ip.mjs';
import { createJobStore } from './lib/jobs.mjs';
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

// Defense-in-depth CSP for the (already-escaped) HTML pages. The report uses an
// inline <style>, hence style-src 'unsafe-inline'; there is no script and no
// external origin, so scripts and everything else are locked to 'self'/'none'.
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; "
  + "img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const checks = buildChecks();
const rateLimiter = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS });

let inFlight = 0; // current number of running audits.
const cache = createResultCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });
const jobs = createJobStore({ ttlMs: 180_000, maxJobs: 500 });

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
`;

function shell(title, bodyHtml, { lang = 'en', alternates } = {}) {
  const hreflangLinks = alternates
    ? `\n<link rel="alternate" hreflang="en" href="${escapeHtml(alternates.en)}">`
      + `\n<link rel="alternate" hreflang="fr" href="${escapeHtml(alternates.fr)}">`
      + `\n<link rel="alternate" hreflang="x-default" href="${escapeHtml(alternates.en)}">`
    : '';
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>${hreflangLinks}
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${renderLangSelector(lang)}
${bodyHtml}
<footer>findable-audit · <a href="${REPO_URL}">source on GitHub</a></footer>
</main>
</body>
</html>
`;
}

// The landing page's final visual design (pb-ot.fr-inspired restyle) is
// DEFERRED to a separate visual-companion mockup + user-validation pass (see
// spec addendum §7.1 and §8, sub-phase 2C). This function delivers the
// functional bilingual structure — i18n wiring, hreflang, selector, form —
// using the existing minimal PAGE_STYLE; a future pass restyles it without
// changing this DOM contract (form action, input name, selector markup).
// Note: Task 4's routing block already calls this as `landingPage(split.lang)`
// (the pre-2C zero-arg signature simply ignored the extra argument until now),
// so no call-site change is needed here — only this definition.
function landingPage(lang = 'en') {
  const s = t(lang).landing;
  return shell(s.title, `
<h1>${escapeHtml(s.h1)}</h1>
<p class="lead">${escapeHtml(s.lead)}</p>
<ul class="features">
  <li>${escapeHtml(s.feature1)}</li>
  <li>${escapeHtml(s.feature2)}</li>
  <li>${escapeHtml(s.feature3)}</li>
</ul>
<form method="get" action="/${lang}/audit">
  <input type="url" name="url" placeholder="https://example.com" aria-label="${escapeHtml(s.urlLabel)}"
    autocomplete="off" autocapitalize="off" spellcheck="false" required>
  <button type="submit">${escapeHtml(s.cta)}</button>
</form>
<p class="hint">${escapeHtml(s.hint)}</p>
`, { lang, alternates: { en: '/en/', fr: '/fr/' } });
}

function errorPage(title, message, { status = 400, lang = 'en' } = {}) {
  const back = escapeHtml(t(lang).error.back);
  const body = `
<div class="err">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</div>
<p><a href="/">&larr; ${back}</a></p>
`;
  return { status, html: shell(title, body) };
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

// Wrap the stored report HTML with a download bar + back link (job-scoped).
function withResultChrome(reportHtml, jobId, lang) {
  const id = encodeURIComponent(jobId);
  const retry = escapeHtml(t(lang).progress.retry);
  const bar = '<p style="max-width:860px;margin:1.5rem auto 0;font:15px -apple-system,Segoe UI,Roboto,sans-serif">'
    + `Download: <a href="/audit/export?job=${id}&format=md" style="color:#1a7f37">Markdown</a> · `
    + `<a href="/audit/export?job=${id}&format=html" style="color:#1a7f37">HTML</a> · `
    + `<a href="/audit/export?job=${id}&format=json" style="color:#1a7f37">JSON</a>`
    + `&nbsp;&nbsp;|&nbsp;&nbsp;<a href="/" style="color:#1a7f37">&larr; ${retry}</a></p>`;
  const marker = '</body>';
  const idx = reportHtml.lastIndexOf(marker);
  if (idx === -1) return reportHtml + bar;
  return reportHtml.slice(0, idx) + bar + '\n' + reportHtml.slice(idx);
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
async function auditUrl(url) {
  const key = url.href;

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
  if (cwvActive()) { opts.cwv = true; opts.psiKey = process.env.PSI_KEY; opts.psiStrategy = 'mobile'; }
  const auditPromise = runAudit(key, checks, opts);
  // Free the slot when the real audit settles, even if the HTTP response has
  // already timed out below; swallow a late rejection so it is never unhandled.
  auditPromise.then(
    () => { inFlight--; },
    () => { inFlight--; },
  );

  let report;
  try {
    report = await withTimeout(auditPromise, auditTimeout());
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
    jobs.finish(job.id, { report: cached, html: renderHtml(cached, undefined, job.lang) });
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
  try {
    const report = await withTimeout(runAudit(key, checks, opts), auditTimeout());
    cache.set(key, report);
    jobs.finish(job.id, { report, html: renderHtml(report, undefined, job.lang) });
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
    pr = executeAudit(job).finally(() => running.delete(job.id));
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
    const p = errorPage('Report not ready', 'That report is not available for download.', { status: 409 });
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

  // Create the job but DO NOT run the audit yet — execution is lazy, kicked off
  // by /audit/stream or /audit/result (whichever the client hits first).
  const job = jobs.create({ url: url.href, lang });
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
  send(res, 200, 'application/json; charset=utf-8', renderJson(report));
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
  const HUMAN_PATHS = new Set(['/audit']);

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
      send(res, 200, 'text/html; charset=utf-8', landingPage(split.lang));
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

  if (pathname === '/healthz') {
    send(res, 200, 'text/plain; charset=utf-8', 'ok');
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
    if (!job) { const p = errorPage('Not found', 'No such page.', { status: 404 }); send(res, p.status, 'text/html; charset=utf-8', p.html); return; }
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

export { server, jobs, cwvActive, auditTimeout };
