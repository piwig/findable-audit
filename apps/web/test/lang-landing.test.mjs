// Integration tests for the localized landing page, hreflang tags, the
// mounted language selector, and the localized 404 — against a real local
// HTTP server. Requires `npm run build` in packages/cli first.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '31022'; // distinct from lang-routing.test.mjs's port.

const { server } = await import('../server.mjs');
if (!server.listening) {
  await new Promise((resolve) => server.once('listening', resolve));
}
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
});

test('/en/ has the correct lang attribute, reciprocal hreflang, English copy and selector', async () => {
  const res = await fetch(`${base}/en/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<html lang="en">/);
  // Indexable landing → absolute hreflang (Google requires fully-qualified URLs).
  assert.match(html, /<link rel="alternate" hreflang="en" href="https?:\/\/[^"]+\/en\/">/);
  assert.match(html, /<link rel="alternate" hreflang="fr" href="https?:\/\/[^"]+\/fr\/">/);
  assert.match(html, /<link rel="alternate" hreflang="x-default" href="https?:\/\/[^"]+\/en\/">/);
  assert.match(html, /Website URL/);
  assert.match(html, /<a href="\/fr\/" hreflang="fr" lang="fr">Français<\/a>/);
  assert.match(html, /action="\/en\/audit"/);
});

test('/fr/ has the correct lang attribute, reciprocal hreflang, French copy and selector', async () => {
  const res = await fetch(`${base}/fr/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<link rel="alternate" hreflang="en" href="https?:\/\/[^"]+\/en\/">/);
  assert.match(html, /<link rel="alternate" hreflang="fr" href="https?:\/\/[^"]+\/fr\/">/);
  assert.match(html, /URL du site/);
  assert.match(html, /<a href="\/en\/" hreflang="en" lang="en">English<\/a>/);
  assert.match(html, /action="\/fr\/audit"/);
});

test('/en/does-not-exist is a localized English 404', async () => {
  const res = await fetch(`${base}/en/does-not-exist`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Not found/);
});

test('/fr/does-not-exist is a localized French 404', async () => {
  const res = await fetch(`${base}/fr/does-not-exist`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Introuvable/);
});

test('an unsupported prefix falls through to a best-effort-localized 404 (Accept-Language)', async () => {
  const res = await fetch(`${base}/de/whatever`, { headers: { 'accept-language': 'fr' } });
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Introuvable/);
});

test('errorPage passes the language to the shell (a missing-url error on /fr/audit is a French page)', async () => {
  const res = await fetch(`${base}/fr/audit`); // handleAuditStart → missing-url → errorPage
  const html = await res.text();
  assert.equal(res.status, 400);
  assert.match(html, /<html lang="fr">/);       // was <html lang="en"> before the fix
  assert.match(html, /URL manquante/);          // FR missingUrl title
});
