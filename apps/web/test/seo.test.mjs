// Task 12 — findable-audit applies its own SEO/GEO best practices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntityGraph } from '../../../packages/cli/dist/report/entity-graph.js';

process.env.PORT = '31107';
process.env.PUBLIC_ORIGIN = 'https://findable.example';

const { server } = await import('../server.mjs');
if (!server.listening) await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('/robots.txt is served with a Sitemap directive and welcomes AI bots', async () => {
  const res = await fetch(`${base}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const body = await res.text();
  assert.match(body, /Sitemap:\s*https:\/\/findable\.example\/sitemap\.xml/);
  assert.match(body, /GPTBot|ClaudeBot|PerplexityBot/);
});

test('/sitemap.xml lists the /en and /fr landings', async () => {
  const res = await fetch(`${base}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  const body = await res.text();
  assert.match(body, /https:\/\/findable\.example\/en\//);
  assert.match(body, /https:\/\/findable\.example\/fr\//);
});

test('/llms.txt is served as text/plain', async () => {
  const res = await fetch(`${base}/llms.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.match(await res.text(), /findable-audit/);
});

test('/.well-known/security.txt exposes a Contact and Expires', async () => {
  const res = await fetch(`${base}/.well-known/security.txt`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Contact:/);
  assert.match(body, /Expires:/);
});

test('the landing is indexable and carries canonical, OG and JSON-LD', async () => {
  const html = await (await fetch(`${base}/en/`)).text();
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/findable\.example\/en\/"/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /<meta name="robots" content="noindex">/);
});

test('the landing JSON-LD is a connected, dangling-free entity graph (dogfooding)', async () => {
  const html = await (await fetch(`${base}/en/`)).text();
  const g = buildEntityGraph([{ path: '/en/', html }]);
  assert.equal(g.stats.danglingRefs, 0);
  assert.equal(g.stats.components, 1);
  assert.ok(g.stats.nodes >= 3); // Organization + WebSite + WebApplication
});

test('an ephemeral page (unknown job result) stays noindex', async () => {
  const html = await (await fetch(`${base}/en/audit/result?job=nope`)).text();
  assert.match(html, /noindex/);
});
