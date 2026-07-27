// Discovery surfaces: the files and links that let the CLI, the plugin and the
// site be found at all. They are cheap to break silently, so they are asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.PORT = '0';
const { server, INDEXNOW_KEY } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

test('the IndexNow key file is served, as exactly the key and nothing else', async () => {
  const res = await fetch(`${BASE}/${INDEXNOW_KEY}.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.equal((await res.text()).trim(), INDEXNOW_KEY);
});

test('a wrong key path is not served, so the proof means something', async () => {
  const res = await fetch(`${BASE}/deadbeefdeadbeefdeadbeefdeadbeef.txt`);
  assert.notEqual(res.status, 200);
});

for (const lang of ['en', 'fr']) {
  test(`the ${lang} landing points at the package, the Action and the plugin`, async () => {
    const html = await (await fetch(`${BASE}/${lang}/`)).text();
    assert.match(html, /npmjs\.com\/package\/findable-audit/, 'npm link');
    assert.match(html, /npx findable-audit/, 'the install command a reader can copy');
    assert.match(html, /github\.com\/piwig\/findable-audit\/tree\/main\/plugin/, 'plugin link');
    assert.match(html, /id="cli"/, 'the developer section has a stable anchor');
  });
}
