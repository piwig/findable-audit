import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture, type ServeOptions } from '../helpers/server.js';
import { stubCtx } from '../helpers/stub.js';
import { Crawler } from '../../src/crawler.js';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import {
  llmsTxt, llmsFullTxt, contentWithoutJs, contentDepth, contentLeadAnswer, answerHeadings,
  extractableStructure, contentFreshness, contentAuthorEeat, outboundCitations, contentUniqueness,
  aboutContact,
} from '../../src/checks/llm-content.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function crawler(name: string, opts: ServeOptions = {}) {
  const srv = await serveFixture(path.join(fixtures, name), opts);
  closers.push(srv.close);
  return new Crawler(srv.url);
}

// --- in-memory multi-page context builders -------------------------------
const BASE = 'http://stub.example/';
function doc(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}
function pageRes(pathname: string, body: string): FetchedResource {
  return { status: 200, ok: true, body, contentType: 'text/html', finalUrl: new URL(pathname, BASE).toString(), headers: {} };
}
function mpCtx(pages: FetchedResource[]): CrawlContext {
  const resources: Record<string, Partial<FetchedResource>> = {};
  for (const p of pages) resources[new URL(p.finalUrl).pathname] = p;
  const ctx = stubCtx(resources, BASE);
  ctx.sample = { pages, source: 'links' };
  return ctx;
}
function wordCount(s: string): number { return (s.match(/\S+/g) ?? []).length; }
function fillerTo(minWords: number): string {
  const s = 'We bake simple honest bread here for the whole town to enjoy every day. ';
  let out = '';
  while (wordCount(out) < minWords) out += s;
  return out.trim();
}
const LEAD = 'Example Bakery is a family bakery in Springfield that bakes fresh sourdough bread and pastries every morning.';
/** An H1, a concise 40–320 char lead, filler to reach ~minWords, then optional extra markup. */
function contentPage(pathname: string, h1: string, minWords: number, extra = ''): FetchedResource {
  const fill = fillerTo(Math.max(1, minWords - wordCount(LEAD) - 2));
  return pageRes(pathname, doc(`<h1>${h1}</h1><p>${LEAD}</p><p>${fill}</p>${extra}`));
}
function articleHead(fields: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BlogPosting', ...fields })}</script>`;
}

// ---------------------------------------------------------------------------
// llms-txt (upgrade)
// ---------------------------------------------------------------------------

describe('llms-txt', () => {
  it('passes on a rich file (summary + section + ≥5 same-origin links)', async () => {
    expect((await llmsTxt.run(await crawler('perfect-site'))).status).toBe('pass');
  });
  it('warns when it has fewer than 5 descriptive same-origin links', async () => {
    const c = stubCtx({ '/llms.txt': { body: '# Site\n\n> A one-line summary of the site here.\n\n## Pages\n\n- [Our full menu](http://stub.example/menu): menu\n- [About the bakery](http://stub.example/about): about\n' } });
    const r = await llmsTxt.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('2/5');
  });
  it('does not count a too-short link title like "Go" as descriptive', async () => {
    const body = '# Site\n\n> A one-line summary of the site here.\n\n## Pages\n\n'
      + ['a', 'b', 'c', 'd', 'e', 'f'].map((p) => `- [Go](http://stub.example/${p}): x`).join('\n') + '\n';
    const r = await llmsTxt.run(stubCtx({ '/llms.txt': { body } }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('0/5');
  });
  it('warns when there is no markdown H1', async () => {
    const c = stubCtx({ '/llms.txt': { body: 'just some text, no heading at all here\n' } });
    expect((await llmsTxt.run(c)).status).toBe('warn');
  });
  it('fails when missing', async () => {
    expect((await llmsTxt.run(await crawler('mini'))).status).toBe('fail');
  });
  it('fails on a text/html SPA fallback', async () => {
    expect((await llmsTxt.run(await crawler('spa-fallback', { spaFallback: true }))).status).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// llms-full-txt (upgrade)
// ---------------------------------------------------------------------------

describe('llms-full-txt', () => {
  it('passes on a rich, multi-heading file (perfect-site)', async () => {
    expect((await llmsFullTxt.run(await crawler('perfect-site'))).status).toBe('pass');
  });
  it('warns on a thin stub', async () => {
    const c = stubCtx({ '/llms-full.txt': { body: '# Title\n\nToo short to be useful.\n' } });
    const r = await llmsFullTxt.run(c);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('thin');
  });
  it('fails when missing', async () => {
    expect((await llmsFullTxt.run(await crawler('mini'))).status).toBe('fail');
  });
  it('fails on a text/html SPA fallback', async () => {
    const r = await llmsFullTxt.run(await crawler('spa-fallback', { spaFallback: true }));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('text/html');
  });
});

// ---------------------------------------------------------------------------
// content-without-js (MP)
// ---------------------------------------------------------------------------

describe('content-without-js', () => {
  it('passes on a text-rich page', async () => {
    expect((await contentWithoutJs.run(await crawler('llm-good'))).status).toBe('pass');
  });
  it('fails on a JS-wall page', async () => {
    expect((await contentWithoutJs.run(await crawler('blocked-ai'))).status).toBe('fail');
  });
  it('warns when a minority of the sample is thin', async () => {
    const fat = contentPage('/a', 'A', 200);
    const pages = [fat, contentPage('/b', 'B', 200), contentPage('/c', 'C', 200), contentPage('/d', 'D', 200),
      pageRes('/e', doc('<p>tiny</p>'))];
    expect((await contentWithoutJs.run(mpCtx(pages))).status).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// content-depth (MP)
// ---------------------------------------------------------------------------

describe('content-depth', () => {
  it('passes when every content page clears the word threshold', async () => {
    expect((await contentDepth.run(mpCtx([contentPage('/a', 'A', 170), contentPage('/b', 'B', 170)]))).status).toBe('pass');
  });
  it('fails on a single thin page', async () => {
    const thin = pageRes('/', doc('<h1>Thin</h1><p>Only a few short words on this page.</p>'));
    expect((await contentDepth.run(mpCtx([thin]))).status).toBe('fail');
  });
  it('warns when only a minority is thin', async () => {
    const thin = pageRes('/e', doc('<h1>Thin</h1><p>Only a few short words here.</p>'));
    const pages = [contentPage('/a', 'A', 170), contentPage('/b', 'B', 170), contentPage('/c', 'C', 170),
      contentPage('/d', 'D', 170), thin];
    expect((await contentDepth.run(mpCtx(pages))).status).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// content-lead-answer (MP)
// ---------------------------------------------------------------------------

describe('content-lead-answer', () => {
  it('passes when the page opens with a concise answer', async () => {
    expect((await contentLeadAnswer.run(mpCtx([contentPage('/a', 'A', 170)]))).status).toBe('pass');
  });
  it('fails on a long page that opens with a nav list / fluff', async () => {
    const items = Array.from({ length: 60 }, (_, i) => `<li>menu section number ${i}</li>`).join('');
    const body = doc(`<h1>Directory</h1><p>Hi.</p><ul>${items}</ul><p>End.</p>`);
    expect((await contentLeadAnswer.run(mpCtx([pageRes('/', body)]))).status).toBe('fail');
  });
  it('warns when the direct answer is buried below opening fluff', async () => {
    const body = doc(`<h1>T</h1><p>Hi.</p><p>Yo.</p><p>${LEAD}</p>`);
    expect((await contentLeadAnswer.run(mpCtx([pageRes('/', body)]))).status).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// answer-headings (MP)
// ---------------------------------------------------------------------------

describe('answer-headings', () => {
  it('passes when a long page carries a question-style H2', async () => {
    const p = contentPage('/a', 'A', 340, '<h2>How do we bake our sourdough?</h2><p>Slowly, by hand.</p>');
    expect((await answerHeadings.run(mpCtx([p]))).status).toBe('pass');
  });
  it('warns when a long page has only generic headings', async () => {
    const p = contentPage('/a', 'A', 340, '<h2>General information section</h2><p>More text here.</p>');
    expect((await answerHeadings.run(mpCtx([p]))).status).toBe('warn');
  });
  it('skips when every page is short', async () => {
    const p = contentPage('/a', 'A', 120, '<h2>How do we bake?</h2>');
    expect((await answerHeadings.run(mpCtx([p]))).status).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// extractable-structure (MP)
// ---------------------------------------------------------------------------

describe('extractable-structure', () => {
  it('passes when substantial pages carry a list', async () => {
    const p = contentPage('/a', 'A', 170, '<ul><li>one item</li><li>two item</li></ul>');
    expect((await extractableStructure.run(mpCtx([p]))).status).toBe('pass');
  });
  it('fails on a long prose-only page with no list or table', async () => {
    expect((await extractableStructure.run(mpCtx([contentPage('/a', 'A', 420)]))).status).toBe('fail');
  });
  it('warns on a mid-length prose-only page', async () => {
    expect((await extractableStructure.run(mpCtx([contentPage('/a', 'A', 200)]))).status).toBe('warn');
  });
  it('skips when no page is substantial', async () => {
    const thin = pageRes('/', doc('<h1>Thin</h1><p>A few words here only.</p>'));
    expect((await extractableStructure.run(mpCtx([thin]))).status).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// content-freshness (MP)
// ---------------------------------------------------------------------------

describe('content-freshness', () => {
  it('skips when there are no article-type pages', async () => {
    expect((await contentFreshness.run(mpCtx([contentPage('/a', 'A', 170)]))).status).toBe('skip');
  });
  it('passes on a recently dated article', async () => {
    const head = articleHead({ headline: 'Post', datePublished: '2026-06-01', dateModified: '2026-06-15' });
    const p = pageRes('/blog/post', doc('<h1>Post</h1><p>Body.</p>', head));
    expect((await contentFreshness.run(mpCtx([p]))).status).toBe('pass');
  });
  it('warns when only one of published/modified is present', async () => {
    const head = articleHead({ headline: 'Post', datePublished: '2026-06-01' });
    const p = pageRes('/blog/post', doc('<h1>Post</h1><p>Body.</p>', head));
    expect((await contentFreshness.run(mpCtx([p]))).status).toBe('warn');
  });
  it('fails on an article with no machine-readable date', async () => {
    const head = articleHead({ headline: 'Post' });
    const p = pageRes('/blog/post', doc('<h1>Post</h1><p>Body.</p>', head));
    expect((await contentFreshness.run(mpCtx([p]))).status).toBe('fail');
  });
  it('does not let an unrelated recent <time> mask a stale article date', async () => {
    const head = articleHead({ headline: 'Post', datePublished: '2019-01-01', dateModified: '2019-02-01' });
    // A recent comment-widget <time> must NOT rescue an article whose own dates are years old.
    const p = pageRes('/blog/post',
      doc('<h1>Post</h1><p>Body.</p><aside><time datetime="2026-06-01">a recent comment</time></aside>', head));
    expect((await contentFreshness.run(mpCtx([p]))).status).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// content-author-eeat (MP)
// ---------------------------------------------------------------------------

describe('content-author-eeat', () => {
  it('skips when there are no article-type pages', async () => {
    expect((await contentAuthorEeat.run(mpCtx([contentPage('/a', 'A', 170)]))).status).toBe('skip');
  });
  it('passes with a Person author and a visible byline', async () => {
    const head = articleHead({ headline: 'Post', author: { '@type': 'Person', name: 'Jane Doe' } });
    const p = pageRes('/blog/post', doc('<h1>Post</h1><p class="byline">By Jane Doe</p><p>Body.</p>', head));
    expect((await contentAuthorEeat.run(mpCtx([p]))).status).toBe('pass');
  });
  it('warns when structured author exists but there is no visible byline', async () => {
    const head = articleHead({ headline: 'Post', author: { '@type': 'Person', name: 'Jane Doe' } });
    const p = pageRes('/blog/post', doc('<h1>Post</h1><p>Body only, no byline anywhere.</p>', head));
    expect((await contentAuthorEeat.run(mpCtx([p]))).status).toBe('warn');
  });
  it('fails on an article with no author at all', async () => {
    const head = articleHead({ headline: 'Post' });
    const p = pageRes('/blog/post', doc('<h1>Post</h1><p>Body only.</p>', head));
    expect((await contentAuthorEeat.run(mpCtx([p]))).status).toBe('fail');
  });
  it('does not count a sentence opener like "By Friday, ..." as a byline', async () => {
    const head = articleHead({ headline: 'Post' }); // no structured author
    const p = pageRes('/blog/post',
      doc('<h1>Post</h1><p>By Friday, the ovens are full and the shelves are stocked with fresh bread.</p>', head));
    const r = await contentAuthorEeat.run(mpCtx([p]));
    expect(r.status).toBe('fail'); // no structured author AND no genuine byline -> fail, not warn
  });
});

// ---------------------------------------------------------------------------
// outbound-citations (MP)
// ---------------------------------------------------------------------------

describe('outbound-citations', () => {
  it('passes when a substantial page cites an external source', async () => {
    const p = contentPage('/a', 'A', 170, '<p>See <a href="https://source.org/ref">the primary source</a>.</p>');
    expect((await outboundCitations.run(mpCtx([p]))).status).toBe('pass');
  });
  it('fails on long content with zero outbound citations', async () => {
    expect((await outboundCitations.run(mpCtx([contentPage('/a', 'A', 420)]))).status).toBe('fail');
  });
  it('ignores self-links and social links', async () => {
    const p = contentPage('/a', 'A', 420,
      '<p><a href="/internal">self</a> <a href="https://facebook.com/x">social</a></p>');
    expect((await outboundCitations.run(mpCtx([p]))).status).toBe('fail');
  });
  it('skips when no page is substantial', async () => {
    const thin = pageRes('/', doc('<h1>Thin</h1><p>A few words only.</p>'));
    expect((await outboundCitations.run(mpCtx([thin]))).status).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// content-uniqueness (MP)
// ---------------------------------------------------------------------------

describe('content-uniqueness', () => {
  const dup = 'Our family bakery in Springfield bakes fresh sourdough bread and butter croissants and custom cakes every single morning for the whole neighbourhood.';
  it('passes when pages are distinct', async () => {
    const a = pageRes('/a', doc(`<h1>A</h1><p>${dup}</p>`));
    const b = pageRes('/b', doc('<h1>B</h1><p>Completely different words about weather, mountains, rivers, code, music, travel and science today.</p>'));
    expect((await contentUniqueness.run(mpCtx([a, b]))).status).toBe('pass');
  });
  it('warns on one near-duplicate pair', async () => {
    const a = pageRes('/a', doc(`<h1>A</h1><p>${dup}</p>`));
    const b = pageRes('/b', doc(`<h1>B</h1><p>${dup}</p>`));
    expect((await contentUniqueness.run(mpCtx([a, b]))).status).toBe('warn');
  });
  it('fails on several near-duplicates', async () => {
    const pages = ['/a', '/b', '/c'].map((p) => pageRes(p, doc(`<h1>${p}</h1><p>${dup}</p>`)));
    expect((await contentUniqueness.run(mpCtx(pages))).status).toBe('fail');
  });
  it('skips with fewer than 2 pages', async () => {
    expect((await contentUniqueness.run(mpCtx([pageRes('/', doc(`<p>${dup}</p>`))]))).status).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// about-contact (MP)
// ---------------------------------------------------------------------------

describe('about-contact', () => {
  it('passes only when About, Contact and a contact method are all present', async () => {
    const body = doc('<h1>Home</h1><nav><a href="/about">About</a> <a href="/contact">Contact</a></nav><footer><a href="tel:+15550100">Call us</a></footer>');
    expect((await aboutContact.run(mpCtx([pageRes('/', body)]))).status).toBe('pass');
  });
  it('does NOT pass (warns) when About is linked and a contact method exists but there is no Contact page', async () => {
    const body = doc('<h1>Home</h1><nav><a href="/about">About</a></nav><footer><a href="tel:+15550100">Call us</a></footer>');
    const r = await aboutContact.run(mpCtx([pageRes('/', body)]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Contact page');
  });
  it('fails when neither About/Contact nor a contact method exists', async () => {
    const body = doc('<h1>Home</h1><p>Nothing useful here.</p>');
    const r = await aboutContact.run(mpCtx([pageRes('/', body)]));
    expect(r.status).toBe('fail');
    expect(r.message).toContain('not found');
  });
  it('warns when a contact method exists but no About page', async () => {
    const body = doc('<h1>Home</h1><footer><a href="tel:+15550100">Call us</a></footer>');
    expect((await aboutContact.run(mpCtx([pageRes('/', body)]))).status).toBe('warn');
  });
});
