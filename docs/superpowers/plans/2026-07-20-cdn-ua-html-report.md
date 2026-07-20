# Infra-path exclusion, `--user-agent`, printable HTML report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop counting Cloudflare `/cdn-cgi/` links as broken, add a `--user-agent` override, and emit a self-contained printable HTML audit report (md + html, PDF via browser print), per `docs/superpowers/specs/2026-07-20-cdn-ua-html-report-design.md`.

**Architecture:** Three additive features in `packages/cli`. A shared `crawl-filters.ts` module owns the crawl-exclusion regexes (used by the sampler and the link check). The Crawler gains an optional user-agent. A new `renderHtml` renderer joins the existing markdown/json/terminal renderers, and `--report` becomes repeatable with per-extension dispatch.

**Tech Stack:** Node >= 20, TypeScript ESM (imports end in `.js`), vitest. No new npm dependencies.

## Global Constraints

- Node `>=20`, `"type": "module"` — all relative imports use the `.js` suffix.
- No new npm dependencies (only `fast-xml-parser`, `node-html-parser`, `picocolors`).
- NEVER call `process.exit()` after the audit runs (Windows libuv crash); set `process.exitCode`. Arg validation BEFORE `runAudit` may use `process.exit(2)`.
- All shell commands run from `C:\Users\pieri\dev\findable-audit\packages\cli` unless stated. Run tests: `npx vitest run <path>`. Build: `npm run build`. An RTK hook may truncate long output — narrow the path or redirect to a file if so.
- The e2e contract holds: `perfect-site` scores **100/100**, zero warn/fail.
- Match existing style: 2-space indent, single quotes, semicolons present.
- Escape all site-derived text when emitting HTML (the report can contain attacker-controlled strings from the audited site).

---

### Task 1: Infra-path exclusion (`/cdn-cgi/`)

**Files:**
- Create: `packages/cli/src/crawl-filters.ts`
- Modify: `packages/cli/src/sampler.ts` (import `NON_PAGE_EXT` + `isContentPath`, drop the local `NON_PAGE_EXT`, exclude infra paths)
- Modify: `packages/cli/src/checks/links.ts` (`internalLinks` skips non-content paths)
- Modify: `packages/cli/test/fixtures/links-fallback/index.html` (add a `/cdn-cgi/` link)
- Test: `packages/cli/test/checks/links.test.ts`

**Interfaces:**
- Produces: `crawl-filters.ts` exports `NON_PAGE_EXT: RegExp`, `INFRA_PATH: RegExp`, `isContentPath(pathname: string): boolean`.
- `sampler.ts` and `links.ts` consume `isContentPath`; `sampler.ts` also consumes `NON_PAGE_EXT` from this module.

- [ ] **Step 1: Create `src/crawl-filters.ts`**

```ts
/** Extensions that are never HTML pages worth crawling. */
export const NON_PAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|mp4|webm|css|js|json|xml|txt)$/i;

/** Infrastructure endpoints injected by CDNs/WAFs (e.g. Cloudflare email
 *  protection at /cdn-cgi/l/email-protection) — never real content pages. */
export const INFRA_PATH = /^\/cdn-cgi\//i;

/** true when a pathname is a crawlable content path (not an infra endpoint). */
export function isContentPath(pathname: string): boolean {
  return !INFRA_PATH.test(pathname);
}
```

- [ ] **Step 2: Write the failing test**

In `test/checks/links.test.ts`, add inside `describe('broken-internal-links', ...)`:

```ts
  it('ignores Cloudflare /cdn-cgi/ links instead of reporting them broken', async () => {
    // links-fallback links to /cdn-cgi/l/email-protection, which does not exist
    // as a page; it must NOT be counted as a broken internal link.
    expect((await brokenInternalLinks.run(await sampled('links-fallback'))).status).toBe('pass');
  });
```

Then edit `test/fixtures/links-fallback/index.html` to add the infra link in `<body>` (after the existing links):

```html
<a href="/cdn-cgi/l/email-protection">[email protected]</a>
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/checks/links.test.ts`
Expected: FAIL — the new `/cdn-cgi/` link is fetched, 404s, and `broken-internal-links` reports it (status `fail` or `warn`, not `pass`).

- [ ] **Step 4: Wire `isContentPath` into `links.ts`**

In `src/checks/links.ts`, add the import near the top:

```ts
import { isContentPath } from '../crawl-filters.js';
```

In `internalLinks`, after resolving `u` and confirming same origin, skip infra paths. The current loop body is:

```ts
      try {
        const u = new URL(href, p.finalUrl || baseUrl);
        if (u.origin !== baseUrl.origin) continue;
        u.hash = '';
        seen.add(u.toString());
      } catch { /* invalid href ignored */ }
```

Replace with:

```ts
      try {
        const u = new URL(href, p.finalUrl || baseUrl);
        if (u.origin !== baseUrl.origin || !isContentPath(u.pathname)) continue;
        u.hash = '';
        seen.add(u.toString());
      } catch { /* invalid href ignored */ }
```

- [ ] **Step 5: Wire `crawl-filters` into `sampler.ts`**

In `src/sampler.ts`:

1. Remove the local `NON_PAGE_EXT` declaration:

```ts
const NON_PAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|mp4|webm|css|js|json|xml|txt)$/i;
```

2. Add the import (alongside the existing imports):

```ts
import { NON_PAGE_EXT, isContentPath } from './crawl-filters.js';
```

3. In the candidate normalization loop, extend the skip condition. The current line:

```ts
    if (u.origin !== ctx.baseUrl.origin || NON_PAGE_EXT.test(u.pathname)) continue;
```

becomes:

```ts
    if (u.origin !== ctx.baseUrl.origin || NON_PAGE_EXT.test(u.pathname) || !isContentPath(u.pathname)) continue;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/checks/links.test.ts test/sampler.test.ts`
Expected: PASS — the `/cdn-cgi/` link is excluded from both link-checking and sampling; the sampler still yields `['/', '/one.html', '/two.html']`.

- [ ] **Step 7: Full suite + build**

Run: `npx vitest run` then `npm run build`
Expected: all PASS, tsc exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/crawl-filters.ts src/sampler.ts src/checks/links.ts test/checks/links.test.ts test/fixtures/links-fallback/index.html
git commit -m "fix(checks): exclude Cloudflare /cdn-cgi/ infra paths from link checks and sampling"
```

---

### Task 2: `--user-agent` override

**Files:**
- Modify: `packages/cli/src/crawler.ts` (constructor param + `DEFAULT_UA`)
- Modify: `packages/cli/src/runner.ts` (`AuditOptions.userAgent`, pass to Crawler)
- Modify: `packages/cli/src/index.ts` (CLI flag + validation + USAGE)
- Test: `packages/cli/test/crawler.test.ts`

**Interfaces:**
- Consumes: `AuditOptions` (extended), `Crawler` constructor.
- Produces: `Crawler(url, timeoutMs?, userAgent?)`; `AuditOptions.userAgent?: string`; CLI `--user-agent <string>`.

- [ ] **Step 1: Write the failing test**

In `test/crawler.test.ts`, add inside `describe('Crawler', ...)`:

```ts
  it('sends the default user-agent, and an override when provided', async () => {
    const seen: string[] = [];
    const url = await listen(http.createServer((req, res) => {
      seen.push(req.headers['user-agent'] ?? '');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    }));
    await new Crawler(url).fetch('/');
    await new Crawler(url, undefined, 'GPTBot/1.0').fetch('/');
    expect(seen[0]).toMatch(/^findable-audit/);
    expect(seen[1]).toBe('GPTBot/1.0');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/crawler.test.ts`
Expected: FAIL — `new Crawler(url, undefined, 'GPTBot/1.0')` ignores the 3rd arg today, so `seen[1]` is the default UA, not `'GPTBot/1.0'`.

- [ ] **Step 3: Add the user-agent to `Crawler`**

In `src/crawler.ts`, add the constant above the class:

```ts
export const DEFAULT_UA = 'findable-audit/0.1 (+https://github.com/piwig/findable-audit)';
```

Change the constructor signature:

```ts
  constructor(url: string, private timeoutMs = 10_000, private userAgent = DEFAULT_UA) {
    this.baseUrl = new URL(url);
  }
```

In the `fetch` call, change the header to use the field:

```ts
        headers: { 'user-agent': this.userAgent },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/crawler.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread `userAgent` through the runner**

In `src/runner.ts`, extend `AuditOptions`:

```ts
export interface AuditOptions {
  timeoutMs?: number;
  /** Max pages sampled (homepage included). 1 = homepage only. Default 10. */
  maxPages?: number;
  /** Override the crawler User-Agent (e.g. "GPTBot/1.0" to test UA-based blocking). */
  userAgent?: string;
}
```

And pass it when constructing the crawler:

```ts
  const crawler = new Crawler(url, opts.timeoutMs, opts.userAgent);
```

- [ ] **Step 6: Add the CLI flag**

In `src/index.ts`:

1. In `parseCliArgs` options, after `'max-pages'`:

```ts
      'user-agent': { type: 'string' },
```

2. After the `--max-pages` validation block, add:

```ts
const userAgent = values['user-agent'];
if (userAgent !== undefined && userAgent.trim() === '') {
  console.error(`findable-audit: --user-agent must not be empty\n\n${USAGE}`);
  process.exit(2);
}
```

3. Pass it to `runAudit`:

```ts
  const report = await runAudit(targetUrl,
    buildChecks({ indexnowKey: values['indexnow-key'] }), { timeoutMs, maxPages, userAgent });
```

4. Update `USAGE`'s first line to include the flag:

```ts
const USAGE = `Usage: findable <url> [--json] [--report <file.md|file.html>] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--user-agent <ua>] [--indexnow-key <key>]
```

(Full USAGE body is finalized in Task 3 Step 6, which also documents the repeatable `--report`. Keep this first line consistent there.)

- [ ] **Step 7: Full suite + build + commit**

Run: `npx vitest run` then `npm run build`
Expected: all PASS, tsc exits 0.

```bash
git add src/crawler.ts src/runner.ts src/index.ts test/crawler.test.ts
git commit -m "feat(cli): add --user-agent override for crawling"
```

---

### Task 3: Printable HTML report + repeatable `--report`

**Files:**
- Modify: `packages/cli/src/report/terminal.ts` (export `FAMILY_LABELS`)
- Create: `packages/cli/src/report/html.ts`
- Modify: `packages/cli/src/index.ts` (repeatable `--report`, extension dispatch, USAGE)
- Test: `packages/cli/test/report/html.test.ts`
- Test: `packages/cli/test/cli.test.ts` (both-formats case)

**Interfaces:**
- Consumes: `AuditReport` (`runner.ts`), `CheckResult`/`Family` (`types.ts`), `FAMILY_LABELS` (now exported from `terminal.ts`).
- Produces: `renderHtml(report: AuditReport, now?: Date): string`.

- [ ] **Step 1: Export `FAMILY_LABELS` from `terminal.ts`**

In `src/report/terminal.ts`, change:

```ts
const FAMILY_LABELS: Record<Family, string> = {
```

to:

```ts
export const FAMILY_LABELS: Record<Family, string> = {
```

- [ ] **Step 2: Write the failing test**

Create `test/report/html.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../src/report/html.js';
import type { AuditReport } from '../../src/runner.js';

const report: AuditReport = {
  url: 'https://example.com/',
  score: 72,
  sampledPages: ['/', '/about'],
  results: [
    { id: 'llms-txt', family: 'llm-content', status: 'fail', points: 0, maxPoints: 10,
      message: 'llms.txt missing', fix: 'Add a /llms.txt file.' },
    { id: 'json-ld', family: 'structured-data', status: 'pass', points: 10, maxPoints: 10,
      message: '1 valid JSON-LD block(s)' },
    { id: 'evil', family: 'seo-fundamentals', status: 'warn', points: 2, maxPoints: 4,
      message: 'weird <script>alert(1)</script> title', fix: 'Fix the <title>.' },
  ],
};

describe('renderHtml', () => {
  const html = renderHtml(report, new Date('2026-07-20T00:00:00Z'));

  it('is a self-contained HTML document', () => {
    expect(html.trimStart()).toMatch(/^<!doctype html/i);
    expect(html).toContain('<style');
  });
  it('references no external resource (fully inline)', () => {
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
  });
  it('shows the score and audited URL', () => {
    expect(html).toContain('72');
    expect(html).toContain('https://example.com/');
  });
  it('lists every family that has results', () => {
    expect(html).toContain('Content for LLMs');
    expect(html).toContain('Structured data');
    expect(html).toContain('SEO fundamentals');
  });
  it('shows a fix for a failing check', () => {
    expect(html).toContain('Add a /llms.txt file.');
  });
  it('escapes site-derived text', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/report/html.test.ts`
Expected: FAIL — `Cannot find module` for `src/report/html.js`.

- [ ] **Step 4: Create `src/report/html.ts`**

```ts
import type { AuditReport } from '../runner.js';
import type { CheckResult, Family } from '../types.js';
import { FAMILY_LABELS } from './terminal.js';

const STATUS_LABEL: Record<CheckResult['status'], string> = {
  pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP',
};

/** Escape text for safe inclusion in HTML (the report contains site-derived strings). */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreClass(score: number): string {
  return score >= 80 ? 'good' : score >= 60 ? 'ok' : 'bad';
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fff; margin: 0; padding: 2rem; max-width: 860px; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 1.75rem 0 .5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .25rem; }
  .meta { color: #666; font-size: .9rem; margin-bottom: 1rem; }
  .score { display: inline-block; font-weight: 700; font-size: 1.1rem; padding: .35rem .8rem;
    border-radius: 6px; color: #fff; }
  .score.good { background: #1a7f37; } .score.ok { background: #9a6700; } .score.bad { background: #b42318; }
  .pages { color: #444; font-size: .85rem; margin: .5rem 0 0; }
  table { width: 100%; border-collapse: collapse; margin: .25rem 0; }
  td { padding: .4rem .5rem; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  td.st { white-space: nowrap; font-weight: 700; font-size: .8rem; width: 3.5rem; }
  td.pts { white-space: nowrap; text-align: right; color: #555; width: 3.5rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
  .st.pass { color: #1a7f37; } .st.warn { color: #9a6700; } .st.fail { color: #b42318; } .st.skip { color: #999; }
  .fix { color: #555; font-size: .85rem; margin-top: .15rem; }
  .row { break-inside: avoid; }
  footer { margin-top: 2rem; color: #888; font-size: .8rem; border-top: 1px solid #e5e5e5; padding-top: .75rem; }
  @media print {
    body { padding: 0; max-width: none; }
    h2, tr { break-inside: avoid; }
  }
`;

export function renderHtml(report: AuditReport, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const families = Object.keys(FAMILY_LABELS) as Family[];
  const sections: string[] = [];

  for (const family of families) {
    const results = report.results.filter((r) => r.family === family);
    if (results.length === 0) continue;
    const earned = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.points), 0);
    const max = results.reduce((s, r) => (r.status === 'skip' ? s : s + r.maxPoints), 0);
    const rows = results.map((r) => {
      const fix = r.fix && r.status !== 'pass' && r.status !== 'skip'
        ? `<div class="fix">${escapeHtml(r.fix)}</div>` : '';
      return `<tr class="row">
        <td class="st ${r.status}">${STATUS_LABEL[r.status]}</td>
        <td><code>${escapeHtml(r.id)}</code><div class="msg">${escapeHtml(r.message)}</div>${fix}</td>
        <td class="pts">${r.points}/${r.maxPoints}</td>
      </tr>`;
    }).join('\n');
    sections.push(`<h2>${escapeHtml(FAMILY_LABELS[family])} <span class="pts">(${earned}/${max})</span></h2>
      <table>${rows}</table>`);
  }

  const pages = report.sampledPages.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>findable-audit report — ${escapeHtml(report.url)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>findable-audit report</h1>
<div class="meta">${escapeHtml(report.url)} · ${date}</div>
<p><span class="score ${scoreClass(report.score)}">Score: ${report.score}/100</span></p>
<p class="pages">Pages audited: ${pages}</p>
${sections.join('\n')}
<footer>Generated by findable-audit · https://github.com/piwig/findable-audit</footer>
</body>
</html>
`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/report/html.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Make `--report` repeatable with extension dispatch**

In `src/index.ts`:

1. Add the import:

```ts
import { renderHtml } from './report/html.js';
```

2. Change the `report` option to repeatable:

```ts
      report: { type: 'string', short: 'r', multiple: true },
```

3. Replace the single-report write block. The current block is:

```ts
  let reportWriteFailed = false;
  if (values.report) {
    try {
      writeFileSync(values.report, renderMarkdown(report), 'utf8');
      console.error(`report written to ${values.report}`);
    } catch (err) {
      console.error(`findable-audit: cannot write report to "${values.report}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }
```

Replace with:

```ts
  let reportWriteFailed = false;
  for (const file of values.report ?? []) {
    const isHtml = /\.html?$/i.test(file);
    const body = isHtml ? renderHtml(report) : renderMarkdown(report);
    try {
      writeFileSync(file, body, 'utf8');
      console.error(`report written to ${file}`);
    } catch (err) {
      // Never process.exit() here (undici sockets closing → libuv crash on
      // Windows); set the flag and let the event loop drain.
      console.error(`findable-audit: cannot write report to "${file}": ${(err as Error).message}`);
      reportWriteFailed = true;
    }
  }
```

4. Finalize `USAGE`:

```ts
const USAGE = `Usage: findable <url> [--json] [--report <file.md|file.html>] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--user-agent <ua>] [--indexnow-key <key>]

Audits a website's readiness for AI search (GEO) and technical SEO.
Samples up to --max-pages pages (default 10, homepage + sitemap/link-discovered pages; 1 = homepage only).
--report writes a report file; repeat it for several formats. The format is chosen by extension:
  .html/.htm -> a self-contained, printable HTML report (open it and "Print to PDF"); anything else -> Markdown.
--user-agent overrides the crawler User-Agent (e.g. "GPTBot/1.0") to test UA-based blocking.
Exit codes: 0 = score >= min-score, 1 = below, 2 = unreachable/error.`;
```

- [ ] **Step 7: Extend the CLI test**

In `test/cli.test.ts`, add after the existing `--report` test:

```ts
  it('writes both a Markdown and an HTML report when --report is repeated', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const md = path.join(tmpdir(), `findable-report-${Date.now()}.md`);
    const html = path.join(tmpdir(), `findable-report-${Date.now()}.html`);
    try {
      const { code } = await runCli([srv.url, '--report', md, '--report', html, '--indexnow-key', 'testkey123']);
      expect(code).toBe(0);
      expect(readFileSync(md, 'utf8')).toContain('# findable-audit — ');
      const h = readFileSync(html, 'utf8');
      expect(h.trimStart()).toMatch(/^<!doctype html/i);
      expect(h).toContain('Score: 100/100');
    } finally {
      rmSync(md, { force: true });
      rmSync(html, { force: true });
    }
  }, 30_000);
```

- [ ] **Step 8: Build, then run the CLI tests (they compile+spawn the binary)**

Run: `npm run build` then `npx vitest run test/report/html.test.ts test/cli.test.ts`
Expected: PASS. (`cli.test.ts` recompiles via tsc in its `beforeAll`, but running `npm run build` first surfaces type errors faster.)

- [ ] **Step 9: Full suite**

Run: `npx vitest run`
Expected: all PASS, e2e still 100/100.

- [ ] **Step 10: Manual smoke test**

Run: `node dist/index.js example.com --report /tmp/a.md --report /tmp/a.html` (or a scratch path).
Expected: both files written; the `.html` opens in a browser as a clean, printable report.

- [ ] **Step 11: Commit**

```bash
git add src/report/terminal.ts src/report/html.ts src/index.ts test/report/html.test.ts test/cli.test.ts
git commit -m "feat(report): self-contained printable HTML report, repeatable --report by extension"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/guide.md` and `docs/guide.fr.md`

(Paths relative to repo root `C:\Users\pieri\dev\findable-audit`.)

**Interfaces:** Consumes the CLI contract finalized in Tasks 2–3.

- [ ] **Step 1: Update `README.md`**

In the usage/options section, document the new capabilities. Add (adapt wording to the surrounding README style — find the existing options/flags description and extend it):

- `--user-agent <ua>` — override the crawler User-Agent, e.g. `--user-agent "GPTBot/1.0"`, to see what an AI crawler that a site filters by UA would get.
- `--report <file>` is repeatable and picks its format by extension: `.html`/`.htm` produces a self-contained, printable HTML report (open it and **Print to PDF**); any other extension produces Markdown. Example:

```bash
npx findable-audit https://your-site.com --report audit.md --report audit.html
```

- A one-line note that `broken-internal-links` ignores Cloudflare `/cdn-cgi/` endpoints (email protection etc.), which are not content pages.

- [ ] **Step 2: Update the check guide**

In `docs/guide.md`, in the `broken-internal-links` check description, add one line: infrastructure endpoints under `/cdn-cgi/` (injected by Cloudflare) are ignored, not treated as broken links. Mirror the same one-line note in `docs/guide.fr.md` (in French).

- [ ] **Step 3: Verify no stale flag references**

Run (repo root): `git grep -n -- '--report' README.md docs`
Expected: every mention is consistent with "repeatable, extension-dispatched" — fix any that still imply Markdown-only.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/guide.md docs/guide.fr.md
git commit -m "docs: document --user-agent, repeatable --report (md/html/pdf), /cdn-cgi/ handling"
```

---

## Self-Review (done while writing)

1. **Spec coverage:** §2 infra exclusion → Task 1; §3 `--user-agent` → Task 2; §4 HTML report + repeatable `--report` → Task 3; §5 docs → Task 4. §4.3 (JSON unchanged) — nothing to do, confirmed. Non-goal (no other infra prefixes, no PDF binary, no UA presets) respected.
2. **Placeholder scan:** every code step carries full content; the escapeHtml, STYLE, and renderHtml bodies are complete.
3. **Type consistency:** `renderHtml(report, now?)` matches the test call and the CLI call (`renderHtml(report)`); `Crawler(url, timeoutMs?, userAgent?)` matches the test (`new Crawler(url, undefined, 'GPTBot/1.0')`) and the runner call; `AuditOptions.userAgent` flows CLI → runner → Crawler; `FAMILY_LABELS` exported once from `terminal.ts` and imported by `html.ts` (no third copy added; the pre-existing markdown.ts copy is left as-is, out of scope).
4. **Windows/libuv:** the repeatable `--report` write loop still uses `exitCode`, never `process.exit`, after the audit. The `--user-agent` validation is pre-audit, so its `process.exit(2)` is safe.
