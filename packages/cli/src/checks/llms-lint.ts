import type { Check, CrawlContext } from '../types.js';
import { makeResult, isPlainText, isXml, t } from '../types.js';

// ---------------------------------------------------------------------------
// llms-txt-lint (backlog A1 — validate an EXISTING llms.txt, beyond format)
//
// `llms-txt` judges the shape of the file (H1, summary, sections, link count).
// This check judges whether the file is *true*: do its links resolve on the
// live site, is there exactly one H1, are targets absolute as the spec asks,
// and do the linked URLs exist in the sitemap the site itself publishes?
// Skips when llms.txt is absent or unreadable — that is llms-txt's verdict.
// ---------------------------------------------------------------------------

/** Cap on same-origin link fetches, so a huge llms.txt cannot balloon the audit. */
const MAX_LINK_PROBES = 12;

interface MdLink { title: string; target: string; }

/** All markdown links `[title](target)` in a body, raw targets preserved. */
export function markdownLinks(body: string): MdLink[] {
  return [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)]
    .map((m) => ({ title: m[1].trim(), target: m[2].trim() }));
}

/** `<loc>` hrefs of a urlset sitemap, normalized (no trailing slash, no hash). */
function sitemapLocs(xml: string): Set<string> {
  const locs = new Set<string>();
  for (const m of xml.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi)) {
    const norm = normalizeHref(m[1].trim());
    if (norm) locs.add(norm);
  }
  return locs;
}

function normalizeHref(href: string, base?: URL): string | null {
  try {
    const u = base ? new URL(href, base) : new URL(href);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch { return null; }
}

export const llmsTxtLint: Check = {
  id: 'llms-txt-lint', family: 'llm-content', evidence: 'heuristic', maxPoints: 2,
  async run(ctx: CrawlContext) {
    const res = await ctx.fetch('/llms.txt');
    if (res?.status !== 200 || !isPlainText(res)) {
      return makeResult(this, 'skip', 'no readable llms.txt to lint (see llms-txt)');
    }
    const body = res.body;
    const issues: string[] = [];

    // 1. Exactly one H1 — the spec's single "# Site Name" root.
    const h1s = (body.match(/^#\s+\S/gm) ?? []).length;
    if (h1s > 1) issues.push(t`${h1s} H1 titles (the spec wants a single "# Site" root)`.text);

    // 2. Relative targets — the format asks for absolute URLs an agent can
    //    fetch without knowing where the file came from.
    const links = markdownLinks(body);
    const relative = links.filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target) && !l.target.startsWith('//'));
    if (relative.length > 0) {
      issues.push(t`${relative.length} relative link target(s) (use absolute URLs)`.text);
    }

    // 3. Same-origin links must resolve — a curated index pointing at 404s is
    //    worse than none. Budgeted; redirects are fine, only >=400 is broken.
    const sameOrigin: string[] = [];
    for (const l of links) {
      const norm = normalizeHref(l.target, ctx.baseUrl);
      if (!norm) continue;
      if (new URL(norm).origin === ctx.baseUrl.origin && !sameOrigin.includes(norm)) sameOrigin.push(norm);
    }
    const probed = sameOrigin.slice(0, MAX_LINK_PROBES);
    const broken: string[] = [];
    for (const href of probed) {
      const u = new URL(href);
      const r = await ctx.fetch(u.pathname + u.search);
      if (r && r.status >= 400) broken.push(u.pathname);
    }
    if (broken.length > 0) {
      issues.push(t`${broken.length}/${probed.length} linked URL(s) broken (${broken.slice(0, 3).join(', ')})`.text);
    }

    // 4. Sitemap coherence — only against a plain <urlset> (a sitemapindex
    //    lists child sitemaps, not pages, and would only produce noise).
    const sm = await ctx.fetch('/sitemap.xml');
    if (sm?.status === 200 && isXml(sm) && /<urlset[\s/>]/i.test(sm.body)) {
      const locs = sitemapLocs(sm.body);
      if (locs.size > 0) {
        const missing = probed.filter((href) => !locs.has(href) && !broken.includes(new URL(href).pathname));
        if (missing.length > 0 && missing.length === probed.length - broken.length) {
          issues.push('none of the linked URLs appear in sitemap.xml (stale index?)');
        }
      }
    }

    if (issues.length === 0) {
      return makeResult(this, 'pass',
        t`llms.txt lints clean (${probed.length} same-origin link(s) verified)`);
    }
    return makeResult(this, 'warn', t`llms.txt has lint issues: ${issues.join('; ')}`,
      'Keep llms.txt in sync with the site: one H1, absolute URLs, no dead links, targets present in the sitemap.');
  },
};
