// Dogfooding gate: this site must PASS the checks it ships.
//
// Every assertion below corresponds to a finding the 2026-07-26 production audit
// raised against findable.bordebat.fr. Rather than re-implement the checks'
// heuristics here (which would drift), the suite runs the REAL engine against a
// live local instance and asserts on the check results themselves.
//
// PUBLIC_ORIGIN is pinned to the test origin so canonicals, the sitemap and the
// JSON-LD all point at the server being crawled — otherwise the host-sensitive
// checks (freshness-coherence in particular) would silently skip instead of
// verifying anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAudit } from '../../../packages/cli/dist/runner.js';
import { buildChecks } from '../../../packages/cli/dist/checks/index.js';

const PORT = '31121'; // fixed (PUBLIC_ORIGIN must be known before import) and distinct from the other test files' ports.
process.env.PORT = PORT;
process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${PORT}`;

const { server } = await import('../server.mjs');
if (!server.listening) await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

// One crawl, reused by every assertion: the fetches are the slow part.
const report = await runAudit(`${base}/`, buildChecks(), { maxPages: 6 });
const byId = new Map(report.results.map((r) => [r.id, r]));
const check = (id) => byId.get(id) ?? { status: 'MISSING', message: `no result for ${id}` };
const why = (id) => `${id}: ${check(id).status} — ${check(id).message}`;

const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
async function graphOf(url) {
  const html = await (await fetch(url)).text();
  const m = LD_RE.exec(html);
  assert.ok(m, `${url} carries JSON-LD`);
  return { html, graph: JSON.parse(m[1])['@graph'] };
}
const typesOf = (node) => [].concat(node['@type'] ?? []);

test('the crawl reaches the interior pages, so the content checks mean something', () => {
  assert.ok(report.sampledPages.length >= 4, `sampled ${report.sampledPages.length} page(s)`);
  assert.ok(report.sampledPages.some((p) => p.includes('/about/')), 'about page sampled');
});

test('/.well-known/ai.json serves a real JSON object manifest (well-known-ai-json)', async () => {
  const res = await fetch(`${base}/.well-known/ai.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(typeof body, 'object');
  assert.ok(!Array.isArray(body), 'manifest root is an object, not an array');
  assert.equal(body.ai_access.policy, 'allow');
  // Roster comes from the CLI's single source of truth, so it cannot drift from robots.txt.
  assert.ok(body.ai_access.citation_bots.includes('PerplexityBot'));
  assert.ok(body.ai_access.training_bots.includes('GPTBot'));
  assert.equal(check('well-known-ai-json').status, 'pass', why('well-known-ai-json'));
});

test('/.well-known/security.txt is published, contactable and unexpired (security-txt)', async () => {
  // LOT 9. We audit other sites on this signal, so ours has to hold — including
  // the Expires date, which is the part that rots silently.
  const res = await fetch(`${base}/.well-known/security.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const body = await res.text();
  assert.match(body, /^Contact:/mi, 'the one required RFC 9116 field');
  const expires = /^Expires:\s*(.+)$/mi.exec(body);
  assert.ok(expires, 'Expires field present');
  assert.ok(Date.parse(expires[1]) > Date.now(), `security.txt expired on ${expires[1]} — renew it`);
  assert.equal(check('security-txt').status, 'pass', why('security-txt'));
});

test('every sampled page opens with a direct answer (content-lead-answer)', () => {
  assert.equal(check('content-lead-answer').status, 'pass', why('content-lead-answer'));
});

test('main content carries real lists or tables (extractable-structure)', () => {
  assert.equal(check('extractable-structure').status, 'pass', why('extractable-structure'));
});

test('main content cites outbound primary sources (outbound-citations)', () => {
  assert.equal(check('outbound-citations').status, 'pass', why('outbound-citations'));
});

test('the on-page FAQ is backed by FAQPage schema (sd-faq)', () => {
  assert.equal(check('sd-faq').status, 'pass', why('sd-faq'));
});

test('sitemap lastmod and JSON-LD dateModified agree (freshness-coherence)', () => {
  assert.equal(check('freshness-coherence').status, 'pass', why('freshness-coherence'));
});

test('every retrieval window still stands on its own (chunk-retrieval-sim)', () => {
  assert.equal(check('chunk-retrieval-sim').status, 'pass', why('chunk-retrieval-sim'));
});

test('nothing is hidden from readers but fed to assistants (injection-hygiene)', () => {
  assert.equal(check('injection-hygiene').status, 'pass', why('injection-hygiene'));
});

// Both landing forms are plain GET forms with a real action and named inputs, and
// /contact declares a ContactPoint — so an agent can run an audit here without JS.
test('an agent can actually submit our own forms (agent-usability)', () => {
  assert.equal(check('agent-usability').status, 'pass', why('agent-usability'));
});

test('the landing keeps semantic list markup for families and steps', async () => {
  const html = await (await fetch(`${base}/en/`)).text();
  assert.match(html, /<ul class="ld-chips">/);
  assert.match(html, /<ol class="ld-steps">/);
  assert.match(html, /<li class="ld-chip">/);
});

test('the About FAQ schema stays in step with the on-page FAQ, in both languages', async () => {
  for (const lang of ['en', 'fr']) {
    const { html, graph } = await graphOf(`${base}/${lang}/about/`);
    const faq = graph.find((n) => typesOf(n).includes('FAQPage'));
    assert.ok(faq, `${lang}: a FAQPage node is present`);
    assert.ok(faq.mainEntity.length >= 2, `${lang}: ${faq.mainEntity.length} Question(s)`);
    for (const q of faq.mainEntity) {
      assert.equal(typesOf(q)[0], 'Question', `${lang}: node typed Question`);
      assert.ok(q.name?.length > 0, `${lang}: Question has a name`);
      assert.ok(q.acceptedAnswer?.text?.length > 0, `${lang}: Question has an answer`);
    }
    // Same source object drives both, so a count mismatch means the renderer drifted.
    const headings = (html.match(/<h3 class="ld-q">/g) ?? []).length;
    assert.equal(headings, faq.mainEntity.length, `${lang}: on-page questions vs schema`);
  }
});

test('every indexable page declares dateModified equal to its sitemap lastmod', async () => {
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  const entries = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)];
  assert.ok(entries.length >= 6, `${entries.length} sitemap entries`);
  for (const [, loc, lastmod] of entries) {
    const { graph } = await graphOf(loc);
    const page = graph.find((n) => typesOf(n).includes('WebPage'));
    assert.ok(page, `${loc}: WebPage node`);
    assert.equal(page.dateModified, lastmod, `${loc}: dateModified matches lastmod`);
  }
});

// The two findings we deliberately did NOT paper over. If either ever starts
// passing (a real second profile / Wikidata entity, or a real site search), this
// test fails and tells whoever changed it to update the honesty note in README.
test('the two knowingly-unfixed findings are still warn, and still only warn', () => {
  assert.equal(check('sd-entity-grounding').status, 'warn', why('sd-entity-grounding'));
  assert.equal(check('sd-website-searchaction').status, 'warn', why('sd-website-searchaction'));
});

/**
 * The landing now states a number in plain text ("This site scores 99/100 (A)").
 * That number is measured against PRODUCTION (https, gzip, the real origin) and
 * cannot be reproduced here: this suite crawls a plain-http local server, so a
 * handful of checks fail for reasons that exist only in the test environment.
 *
 * What CAN be locked, and is stronger than a number, is the exact set of checks
 * that do not pass — every entry justified below. A redesign that quietly breaks
 * a check shows up here as a new id, not as a score that drifted three points
 * while nobody looked. (It is how the landing's `chunk-boundary` regression was
 * caught: a families list left with nothing but a <summary> above it.)
 */
const LOCAL_ONLY = new Set([
  'open-graph',        // og:image must be an absolute https URL; the test origin is http
  'twitter-card',      // same absolute-https image requirement
  'sd-organization',   // logo must be an absolute https URL
  'text-compression',  // gzip is nginx's job in production, not the bare node server's
]);
const KNOWN_WARNS = new Set([
  'sd-entity-grounding',      // documented in README: no second official profile yet
  'sd-website-searchaction',  // documented in README: no internal search to declare
]);

test('nothing but the documented exceptions falls short against our own engine', () => {
  const notPassing = report.results
    .filter((r) => r.status === 'warn' || r.status === 'fail')
    .map((r) => r.id)
    .sort();
  const unexpected = notPassing.filter((id) => !LOCAL_ONLY.has(id) && !KNOWN_WARNS.has(id));
  assert.deepEqual(unexpected, [], `unexpected findings: ${unexpected.map(why).join(' | ')}`);
});

test('both languages claim the same score, in the same words', async () => {
  const claims = [];
  for (const lang of ['en', 'fr']) {
    const html = await (await fetch(`${base}/${lang}/`)).text();
    const m = /(\d{1,3})\/100 \(([A-F])\)/.exec(html);
    assert.ok(m, `${lang}: the landing states a score`);
    claims.push(`${m[1]}/${m[2]}`);
  }
  assert.equal(claims[0], claims[1], `en claims ${claims[0]}, fr claims ${claims[1]}`);
});
