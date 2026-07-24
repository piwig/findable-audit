// Task 12 — findable-audit applies its own SEO/GEO best practices.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

test('/sitemap.xml lists about + contact and carries valid lastmod dates', async () => {
  const body = await (await fetch(`${base}/sitemap.xml`)).text();
  for (const p of ['/en/about/', '/fr/about/', '/en/contact/', '/fr/contact/']) {
    assert.ok(body.includes(`https://findable.example${p}`), p);
  }
  const lastmods = [...body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  assert.ok(lastmods.length >= 6, 'every URL has a lastmod');
  for (const d of lastmods) {
    assert.ok(!Number.isNaN(Date.parse(d)), `parseable lastmod: ${d}`);
    assert.ok(Date.parse(d) <= Date.now(), `lastmod not in the future: ${d}`);
  }
});

test('/llms-full.txt is substantial (>= 2000 words) and lists the check catalogue', async () => {
  const res = await fetch(`${base}/llms-full.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const body = await res.text();
  const words = (body.match(/\S+/g) ?? []).length;
  assert.ok(words >= 2000, `word count ${words} >= 2000`);
  assert.match(body, /## Check catalogue \(\d+ checks\)/);
  assert.match(body, /## Version française/);
});

test('/llms.txt links at least 5 same-origin pages with descriptions', async () => {
  const body = await (await fetch(`${base}/llms.txt`)).text();
  const links = body.match(/\]\(https:\/\/findable\.example[^)]*\):/g) ?? [];
  assert.ok(links.length >= 5, `${links.length} described same-origin links`);
});

test('/og.png and /apple-touch-icon.png are real PNGs', async () => {
  for (const p of ['/og.png', '/apple-touch-icon.png']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /image\/png/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${p} PNG magic`);
  }
});

test('the landing carries og:image + summary_large_image twitter card', async () => {
  const html = await (await fetch(`${base}/en/`)).text();
  assert.match(html, /<meta property="og:image" content="https:\/\/findable\.example\/og\.png"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
});

test('meta descriptions stay within 70-160 chars on every indexable page', async () => {
  for (const p of ['/en/', '/fr/', '/en/about/', '/fr/about/', '/en/contact/', '/fr/contact/']) {
    const html = await (await fetch(`${base}${p}`)).text();
    const m = /<meta name="description" content="([^"]*)"/.exec(html);
    assert.ok(m, `${p} has a meta description`);
    assert.ok(m[1].length >= 70 && m[1].length <= 160, `${p}: ${m[1].length} chars`);
  }
});

test('about + contact JSON-LD graphs are connected and dangling-free', async () => {
  for (const p of ['/en/about/', '/fr/contact/']) {
    const html = await (await fetch(`${base}${p}`)).text();
    const g = buildEntityGraph([{ path: p, html }]);
    assert.equal(g.stats.danglingRefs, 0, p);
    assert.equal(g.stats.components, 1, p);
  }
});

test('www.<host> is 301-bounced to the apex origin, path + query preserved', async () => {
  const { status, location } = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: '/en/?x=1',
      headers: { host: 'www.findable.example' },
    }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 301);
  assert.equal(location, 'https://findable.example/en/?x=1');
});
