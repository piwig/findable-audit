# Always write md + html reports by default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a successful audit, always write `<host>-<date>.md` and `<host>-<date>.html` to the current directory by default; `--report` overrides, `--no-report` suppresses. Per `docs/superpowers/specs/2026-07-20-default-md-html-reports-design.md`.

**Architecture:** A single CLI change in `src/index.ts` — a `defaultReportBase()` helper and a rewritten report-writing block that computes the target file list from `--report` / `--no-report` / default. No renderer or audit-logic change.

**Tech Stack:** Node >= 20, TypeScript ESM (`.js` imports), vitest. No new npm dependencies.

## Global Constraints

- Node `>=20`, ESM — relative imports end in `.js`.
- No new npm dependencies.
- NEVER `process.exit()` after the audit runs; write failures set `reportWriteFailed` → `process.exitCode = 2`. The write block stays inside the post-audit `try`.
- Run from `C:\Users\pieri\dev\findable-audit\packages\cli`: tests `npx vitest run <path>`, build `npm run build`. RTK hook may truncate long output — narrow the path or redirect if so.
- e2e `perfect-site` 100/100 unchanged (no check touched).
- Match existing style: 2-space indent, single quotes, semicolons.

---

### Task 1: Default md+html writing, `--no-report`, and tests

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Produces: CLI default behavior (two files) + `--no-report` flag. No exported API change.

- [ ] **Step 1: Write the failing tests**

In `test/cli.test.ts`:

1. Change the fs import to add `mkdtempSync` and `readdirSync`. The current import is:

```ts
import { readFileSync, rmSync } from 'node:fs';
```

Replace with:

```ts
import { readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
```

2. Give `runCli` an optional `cwd`. The current function is:

```ts
function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number ?? 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}
```

Replace with:

```ts
function runCli(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [distIndex, ...args], { windowsHide: true, cwd }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number ?? 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}
```

3. Add three new tests inside `describe('findable CLI binary', ...)`:

```ts
  it('writes <host>-<date>.md and .html to the cwd by default (no --report)', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-cwd-'));
    try {
      const { code } = await runCli([srv.url, '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      const files = readdirSync(workdir);
      const md = files.find((f) => f.endsWith('.md'));
      const html = files.find((f) => f.endsWith('.html'));
      expect(md).toMatch(/^127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.md$/);
      expect(html).toMatch(/^127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.html$/);
      expect(readFileSync(path.join(workdir, md!), 'utf8')).toContain('# findable-audit — ');
      expect(readFileSync(path.join(workdir, html!), 'utf8').trimStart()).toMatch(/^<!doctype html/i);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it('writes no files with --no-report', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-cwd-'));
    try {
      const { code } = await runCli([srv.url, '--no-report', '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      expect(readdirSync(workdir)).toEqual([]);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it('explicit --report suppresses the default files', async () => {
    const srv = await serveFixture(path.join(fixtures, 'perfect-site'));
    closers.push(srv.close);
    const workdir = mkdtempSync(path.join(tmpdir(), 'findable-cwd-'));
    try {
      const { code } = await runCli([srv.url, '--report', 'custom.md', '--indexnow-key', 'testkey123'], workdir);
      expect(code).toBe(0);
      expect(readdirSync(workdir)).toEqual(['custom.md']); // only the explicit file, no host-date defaults
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);
```

4. The two existing `--json` tests run the binary with NO `--report`, so the new default would write files into the CLI's own cwd. Add `--no-report` to both so they stay side-effect-free. Change:

```ts
    const { code, stdout } = await runCli([srv.url, '--json', '--indexnow-key', 'testkey123']);
```
to:
```ts
    const { code, stdout } = await runCli([srv.url, '--json', '--no-report', '--indexnow-key', 'testkey123']);
```

and change:

```ts
    const { code, stdout } = await runCli([srv.url, '--json', '--min-score', '100']);
```
to:
```ts
    const { code, stdout } = await runCli([srv.url, '--json', '--no-report', '--min-score', '100']);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npx vitest run test/cli.test.ts`
Expected: the three new tests FAIL — `--no-report` is an unknown option (parse error, exit 2) and no default files are written yet. (Build first so the spawned binary reflects current source.)

- [ ] **Step 3: Add the `--no-report` option**

In `src/index.ts`, in the `parseArgs` options, after the `report` line, add:

```ts
      'no-report': { type: 'boolean', default: false },
```

- [ ] **Step 4: Add the `defaultReportBase` helper**

In `src/index.ts`, add this function right after the `USAGE` constant (top-level; hoisted, so placement is fine):

```ts
/** Default report basename written when neither --report nor --no-report is given. */
function defaultReportBase(url: string, now: Date): string {
  let host = 'report';
  try { host = new URL(url).hostname || 'report'; } catch { /* keep 'report' */ }
  const safeHost = host.replace(/[^a-z0-9.-]/gi, '-');
  return `${safeHost}-${now.toISOString().slice(0, 10)}`;
}
```

- [ ] **Step 5: Rewrite the report-writing block**

In `src/index.ts`, replace the current block:

```ts
  console.log(values.json ? renderJson(report) : renderTerminal(report));
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

with:

```ts
  console.log(values.json ? renderJson(report) : renderTerminal(report));
  // Decide which report files to write:
  //   --report given  -> exactly those (format by extension); default suppressed
  //   --no-report     -> none
  //   otherwise       -> <host>-<date>.md and .html in the current directory
  const now = new Date();
  const explicit = values.report ?? [];
  let targets: string[];
  if (explicit.length > 0) {
    targets = explicit;
  } else if (values['no-report']) {
    targets = [];
  } else {
    const base = defaultReportBase(report.url, now);
    targets = [`${base}.md`, `${base}.html`];
  }
  let reportWriteFailed = false;
  for (const file of targets) {
    const isHtml = /\.html?$/i.test(file);
    const body = isHtml ? renderHtml(report, now) : renderMarkdown(report, now);
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

- [ ] **Step 6: Update USAGE**

Replace the `USAGE` constant with:

```ts
const USAGE = `Usage: findable <url> [--json] [--report <file.md|file.html>] [--no-report] [--min-score <n>] [--timeout <ms>] [--max-pages <n>] [--user-agent <ua>] [--indexnow-key <key>]

Audits a website's readiness for AI search (GEO) and technical SEO.
Samples up to --max-pages pages (default 10, homepage + sitemap/link-discovered pages; 1 = homepage only).
By default, two report files are written to the current directory: <host>-<date>.md and <host>-<date>.html
  (the .html is a self-contained, printable report — open it and "Print to PDF"). Use --no-report to write none.
--report <file> overrides the default and writes exactly the file(s) you name (repeatable); the format is chosen
  by extension: .html/.htm -> HTML, anything else -> Markdown.
--user-agent overrides the crawler User-Agent (e.g. "GPTBot/1.0") to test UA-based blocking.
Exit codes: 0 = score >= min-score, 1 = below, 2 = unreachable/error.`;
```

- [ ] **Step 7: Build and run the CLI tests**

Run: `npm run build && npx vitest run test/cli.test.ts`
Expected: PASS — the three new tests plus the updated `--json` tests all green.

- [ ] **Step 8: Full suite**

Run: `npx vitest run`
Expected: all PASS, e2e still 100/100.

- [ ] **Step 9: Manual smoke test in a scratch dir**

Run (from a scratch directory, not the repo):
```
node <repo>/packages/cli/dist/index.js example.com
```
Expected: `example.com-<today>.md` and `example.com-<today>.html` appear in the scratch dir; `--no-report` writes nothing; `--report x.html` writes only `x.html`.

- [ ] **Step 10: Commit**

```bash
git add src/index.ts test/cli.test.ts
git commit -m "feat(cli): write md+html reports by default; add --no-report to opt out"
```

---

### Task 2: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:** Consumes the CLI behavior from Task 1.

- [ ] **Step 1: Update `README.md`**

Read the usage/options section first and match its style. Document:
- By default, every successful audit now writes two files to the current directory: `<host>-<date>.md` and `<host>-<date>.html` (the HTML is self-contained and printable — open it and Print to PDF). Show an example, e.g. auditing `https://your-site.com` produces `your-site.com-YYYY-MM-DD.md` and `.html`.
- `--no-report` writes no files (use it with `--json` or in CI to keep stdout-only).
- `--report <file>` overrides the default and writes exactly the file(s) named (repeatable, format by extension) — update any prior wording that implied `--report` is the only way to get a file, or that no file is written without it.

- [ ] **Step 2: Consistency check**

Run (repo root): `git grep -n -- '--report' README.md`
Expected: wording is consistent with "reports written by default; `--report` overrides; `--no-report` disables". Fix any stale line.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document default md+html reports and --no-report"
```

---

## Self-Review (done while writing)

1. **Spec coverage:** §2 behavior (report/no-report/default precedence) → Task 1 Steps 3–5; §2.1 basename → Step 4; §2.2 shared `now` → Step 5 (one `now` passed to `defaultReportBase`, `renderMarkdown`, `renderHtml`); §3 USAGE → Step 6; §4 tests → Step 1 (incl. the two existing `--json` tests getting `--no-report` so the new default doesn't litter the CLI cwd); §5 docs → Task 2.
2. **Placeholder scan:** all code steps carry full content; the exact old/new blocks are quoted from the current `src/index.ts`.
3. **Type consistency:** `defaultReportBase(url: string, now: Date): string` used once; `values['no-report']` is boolean (option `default: false`); `renderMarkdown(report, now)` / `renderHtml(report, now)` match their existing `(report, now = new Date())` signatures.
4. **No regression risk:** explicit `--report` path unchanged; write loop still uses `reportWriteFailed`/`exitCode`, never `process.exit` post-audit.
