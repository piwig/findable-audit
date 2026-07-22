// Web /compare — hermetic checks (form presence + routing/validation).
// The full multi-audit flow is exercised manually; here we avoid slow live
// audits and only assert the parts that need no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEB_MESSAGES } from '../lib/i18n.mjs';

process.env.PORT = '31103'; // distinct from the other test files' ports.

const { server } = await import('../server.mjs');
if (!server.listening) {
  await new Promise((resolve) => server.once('listening', resolve));
}
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('the landing exposes a compare form posting to /<lang>/compare', async () => {
  const en = await (await fetch(`${base}/en/`)).text();
  assert.match(en, /action="\/en\/compare"/);
  assert.match(en, /name="compare"/); // competitor URLs field
  assert.match(en, /Compare against competitors/);
  const fr = await (await fetch(`${base}/fr/`)).text();
  assert.match(fr, /action="\/fr\/compare"/);
  assert.match(fr, /Comparer à des concurrents/);
});

test('GET /compare with no url returns a localized 400 (no audit run)', async () => {
  const res = await fetch(`${base}/fr/compare`);
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /<html lang="fr">/);
});

test('WEB_MESSAGES.compare is present and translated in both languages', () => {
  for (const lang of ['en', 'fr']) {
    const c = WEB_MESSAGES[lang].compare;
    for (const k of ['needMoreTitle', 'needMore', 'heading', 'lead', 'urlLabel', 'competitorsLabel', 'cta', 'hint']) {
      assert.equal(typeof c[k], 'string');
      assert.ok(c[k].length > 0, `compare.${k} filled in ${lang}`);
    }
  }
  assert.notEqual(WEB_MESSAGES.en.compare.cta, WEB_MESSAGES.fr.compare.cta);
});
