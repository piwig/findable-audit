// Branding: favicon route + inline logomark in the page chrome (#6).
// Against a real local HTTP server. Requires `npm run build` in packages/cli first.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '31099'; // distinct from the other test files' ports.

const { server } = await import('../server.mjs');
if (!server.listening) {
  await new Promise((resolve) => server.once('listening', resolve));
}
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
});

test('GET /favicon.svg serves an inline SVG logomark', async () => {
  const res = await fetch(`${base}/favicon.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
  const svg = await res.text();
  assert.match(svg, /<svg[^>]*viewBox="0 0 32 32"/);
  assert.match(svg, /<linearGradient id="faGrad"/);
  assert.match(svg, /#3bbf6b/); // Aube-verte gradient
  assert.match(res.headers.get('cache-control') ?? '', /max-age=86400/); // cached a day
});

test('GET /favicon.ico also serves the SVG (browsers request .ico by default)', async () => {
  const res = await fetch(`${base}/favicon.ico`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
  const svg = await res.text();
  assert.match(svg, /<linearGradient id="faGrad"/);
});

test('the site chrome is responsive (mobile media query: reduced padding + full-width CTA)', async () => {
  const html = await (await fetch(`${base}/en/`)).text();
  assert.match(html, /@media \(max-width: 560px\)/);
  assert.match(html, /body \{ padding: 1\.5rem 1rem 3rem; \}/); // tighter top padding on phones
  assert.match(html, /button \{ width: 100%; \}/);              // full-width stacked CTA
});

test('the landing head references the favicon and shows the inline brand logomark', async () => {
  const res = await fetch(`${base}/en/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  // brand: inline SVG (self-contained, not an <img>) + wordmark, linking to the home
  assert.match(html, /<a class="brand" href="\/en\/"[^>]*>\s*<svg[^>]*viewBox="0 0 32 32"/);
  assert.match(html, /class="brand-name">findable<span class="g-dash">-<\/span>audit/);
  assert.doesNotMatch(html, /<img\b/i); // logo is inline SVG, never a raster asset
});

test('the brand links to the language-scoped home on the French landing', async () => {
  const res = await fetch(`${base}/fr/`);
  const html = await res.text();
  assert.match(html, /<a class="brand" href="\/fr\/"/);
});
