// Lightweight per-page metadata extracted from the sampled HTML at crawl time
// (#A22). Deterministic regex extraction — no DOM, no JS execution — of the
// three signals the llms.txt generators need: <title>, meta description, <h1>.
// Kept in its own module so both the runner (attaches it to AuditReport) and
// the generate surface (consumes it) can import it without cycles.

/** Metadata of one sampled page, keyed by its pathname. Absent fields were not found in the HTML. */
export interface PageMeta {
  /** Pathname of the page ('/' for the homepage), matching AuditReport.sampledPages entries. */
  path: string;
  title?: string;
  description?: string;
  h1?: string;
  /** Real visible text excerpt of the page body (#A27) — verbatim page words, never fabricated. */
  excerpt?: string;
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;
const MAX_EXCERPT = 2000;
const MIN_EXCERPT = 80;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Decode the handful of entities that actually occur in titles/descriptions. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ');
}

function clean(raw: string, max: number): string | undefined {
  const s = collapseWs(decodeEntities(stripTags(raw))).slice(0, max).trim();
  return s === '' ? undefined : s;
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? clean(m[1], MAX_TITLE) : undefined;
}

function extractMetaDescription(html: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/name\s*=\s*["']?description["']?/i.test(tag)) continue;
    const m = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (m) return clean(m[1] ?? m[2] ?? m[3] ?? '', MAX_DESCRIPTION);
  }
  return undefined;
}

function extractH1(html: string): string | undefined {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? clean(m[1], MAX_TITLE) : undefined;
}

/**
 * Real visible-text excerpt of the page (#A27). Scope: <main>/<article> when
 * present, otherwise <body>; boilerplate containers (nav/header/footer/aside)
 * and non-text elements are dropped first. Verbatim page words only — returns
 * undefined below MIN_EXCERPT so junk pages keep the manual placeholder.
 */
function extractExcerpt(html: string): string | undefined {
  let scope = html;
  const bodyM = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(scope);
  if (bodyM) scope = bodyM[1];
  const mainM = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(scope);
  if (mainM) scope = mainM[2];
  scope = scope
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const text = collapseWs(decodeEntities(stripTags(scope)));
  if (text.length < MIN_EXCERPT) return undefined;
  if (text.length <= MAX_EXCERPT) return text;
  const cut = text.slice(0, MAX_EXCERPT);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > MAX_EXCERPT / 2 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** One PageMeta per sampled page, in sample order, path derived from the page's final URL. */
export function extractPageMeta(pages: ReadonlyArray<{ finalUrl: string; body: string }>): PageMeta[] {
  return pages.map((p) => {
    let path = '/';
    try { path = new URL(p.finalUrl).pathname || '/'; } catch { /* keep '/' */ }
    const meta: PageMeta = { path };
    const title = extractTitle(p.body);
    const description = extractMetaDescription(p.body);
    const h1 = extractH1(p.body);
    if (title !== undefined) meta.title = title;
    if (description !== undefined) meta.description = description;
    if (h1 !== undefined) meta.h1 = h1;
    const excerpt = extractExcerpt(p.body);
    if (excerpt !== undefined) meta.excerpt = excerpt;
    return meta;
  });
}
