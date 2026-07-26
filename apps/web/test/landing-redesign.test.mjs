// The landing redesign (L1-L8 of docs/proposition-refonte-design-2026-07-26.md):
// two-column hero, one form with two modes, green CTA, a visible preview of the
// deliverable, three axes instead of eight families, a proof line, a dark theme.
//
// The point of these tests is that the redesign cannot silently regress into
// the two-competing-forms, no-deliverable-shown layout it replaced.
// Requires `npm run build` in packages/cli first.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '31088'; // distinct from every other test file's port.

const { server } = await import('../server.mjs');
if (!server.listening) {
  await new Promise((resolve) => server.once('listening', resolve));
}
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, headers: res.headers, body: await res.text() };
};

test('the hero is two columns: promise + form on one side, a real report preview on the other', async () => {
  const { body } = await get('/en/');
  assert.match(body, /class="hero2"/);
  assert.match(body, /class="hero-left"/);
  assert.match(body, /class="hero-right"/);
  // The preview shows the same shapes as the report: a score, three axes, plan rows.
  assert.match(body, /class="pv-score"/);
  assert.match(body, /class="pv-ax"/);
  assert.match(body, /class="pv-row"/);
  // A wider shell than the 640px reading column the landing used to sit in.
  assert.match(body, /<main class="wide">/);
});

test('both audit and compare live in one form area with two modes, and no JavaScript', async () => {
  const { body } = await get('/en/');
  assert.match(body, /class="modes"/);
  assert.match(body, /href="#single"/);
  assert.match(body, /href="#compare"/);
  // The panes exist and the compare one is hidden until its anchor is targeted.
  assert.match(body, /id="single"/);
  assert.match(body, /id="compare"/);
  assert.match(body, /\.pane-compare \{ display: none; \}/);
  assert.match(body, /:has\(#compare:target\)/);
  // Still zero inline handlers and zero inline script (script-src 'none').
  assert.doesNotMatch(body, /\son[a-z]+\s*=/i);
});

test('both form contracts survive the redesign (action + field names)', async () => {
  for (const lang of ['en', 'fr']) {
    const { body } = await get(`/${lang}/`);
    assert.match(body, new RegExp(`action="/${lang}/audit"`));
    assert.match(body, new RegExp(`action="/${lang}/compare/start"`));
    assert.match(body, /name="url"/);
    assert.match(body, /name="compare"/);
  }
});

test('the primary CTA wears the brand green, not the near-black it used to', async () => {
  const { body } = await get('/en/');
  assert.match(body, /\.ld-cta \{[^}]*background: var\(--good\)/);
});

test('three axes lead; the eight families stay, one disclosure below', async () => {
  const { body } = await get('/en/');
  for (const axis of ['Reachable', 'Understood', 'Usable']) assert.match(body, new RegExp(axis));
  assert.match(body, /<ul class="ld-axes">/);
  // The families are folded, not deleted — and they keep their list markup.
  assert.match(body, /<details class="ld-fold">[\s\S]*?<ul class="ld-chips">/);
  assert.match(body, /Answer-engine content/);
});

test('the landing states the proof it never used to: its own score', async () => {
  const en = await get('/en/');
  assert.match(en.body, /class="ld-proof"/);
  assert.match(en.body, /99\/100 \(A\)/);
  const fr = await get('/fr/');
  assert.match(fr.body, /99\/100 \(A\)/);
});

test('a dark theme ships with the page, driven by the OS preference alone', async () => {
  const { body } = await get('/en/');
  assert.match(body, /color-scheme: light dark/);
  assert.match(body, /@media \(prefers-color-scheme: dark\)/);
});

test('the example report is a real, frozen report of our own site, and is noindex', async () => {
  for (const lang of ['en', 'fr']) {
    const { status, body } = await get(`/${lang}/example-report/`);
    assert.equal(status, 200);
    assert.match(body, /<html lang="/);
    // Real audit output: our own origin, our own grade, the three layers.
    assert.match(body, /findable\.bordebat\.fr/);
    assert.match(body, /class="viz-gauge"/);
    assert.match(body, /class="axes"/);
    assert.match(body, /class="action-plan"/);
    // Deliberately not indexable — see the comment on exampleReportPage.
    assert.match(body, /<meta name="robots" content="noindex, follow">/);
    // And it links back to the landing it was reached from.
    assert.match(body, new RegExp(`href="/${lang}/"`));
  }
});

test('the landing links to that example report in both languages', async () => {
  for (const lang of ['en', 'fr']) {
    const { body } = await get(`/${lang}/`);
    assert.match(body, new RegExp(`href="/${lang}/example-report/"`));
  }
});

test.after(() => server.close());
