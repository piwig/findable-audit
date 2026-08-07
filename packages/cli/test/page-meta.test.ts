import { describe, it, expect } from 'vitest';
import { extractPageMeta } from '../src/page-meta.js';

const LONG = 'Findable Audit inspects how well a site is understood and cited by AI systems, page by page.';

function page(body: string, finalUrl = 'https://example.com/about'): { finalUrl: string; body: string } {
  return { finalUrl, body };
}

describe('extractPageMeta — excerpt (#A27)', () => {
  it('extracts visible body text verbatim', () => {
    const [meta] = extractPageMeta([page(`<html><body><p>${LONG}</p><p>${LONG}</p></body></html>`)]);
    expect(meta.excerpt).toBe(`${LONG} ${LONG}`);
    expect(meta.path).toBe('/about');
  });

  it('prefers <main> content and drops nav/header/footer/script boilerplate', () => {
    const html = `<html><body>
      <nav>Home About Pricing Contact</nav>
      <header>Site chrome words</header>
      <main><h2>Section</h2><p>${LONG}</p></main>
      <footer>Legal notice</footer>
      <script>var tracking = 'noise';</script>
    </body></html>`;
    const [meta] = extractPageMeta([page(html)]);
    expect(meta.excerpt).toContain(LONG);
    expect(meta.excerpt).not.toContain('Pricing Contact');
    expect(meta.excerpt).not.toContain('Legal notice');
    expect(meta.excerpt).not.toContain('tracking');
  });

  it('omits the excerpt when there is too little real text', () => {
    const [meta] = extractPageMeta([page('<html><body><p>Short.</p></body></html>')]);
    expect(meta.excerpt).toBeUndefined();
  });

  it('caps the excerpt at 2000 chars, cutting on a word boundary', () => {
    const body = `<body><p>${'word '.repeat(1000)}</p></body>`;
    const [meta] = extractPageMeta([page(body)]);
    expect(meta.excerpt).toBeDefined();
    expect(meta.excerpt!.length).toBeLessThanOrEqual(2000);
    expect(meta.excerpt!.endsWith('word')).toBe(true);
  });

  it('decodes entities and collapses whitespace', () => {
    const [meta] = extractPageMeta([page(`<body><p>Fish &amp; Chips &#233;t&eacute;\n\n  ${LONG}</p></body>`)]);
    expect(meta.excerpt).toContain('Fish & Chips');
    expect(meta.excerpt).not.toMatch(/\s{2}/);
  });
});
