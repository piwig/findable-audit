import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'findable-aube-test-'));
process.env.PORT = '0';
process.env.DATA_DIR = dataDir;
const { server, jobs } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const fixture = JSON.parse(readFileSync(new URL('../fixtures/example-report.json', import.meta.url), 'utf8'));
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test('the preview is sourced from the dated report, without invented scores or gains', async () => {
  for (const lang of ['en', 'fr']) {
    const html = await (await fetch(`${base}/${lang}/`)).text();
    assert.match(html, new RegExp(`class="pv-score">${fixture.score}<`));
    assert.ok(html.includes(fixture.generatedAt.slice(0, 10)));
    assert.ok(html.includes(fixture.toolVersion));
    assert.doesNotMatch(html, /\+10 pts|\+2 pts|class="pv-score">76</);
    assert.doesNotMatch(html, /is invisible in AI answers|est invisible dans les réponses IA/);
    assert.match(html, /#e0569e/);
    assert.match(html, /prefers-reduced-motion/);
  }
});

test('the grade range remains a single readable unit in both hero translations', async () => {
  for (const lang of ['en', 'fr']) {
    const html = await (await fetch(`${base}/${lang}/`)).text();
    assert.match(html, /<span class="grade-range">A–F\.<\/span>/);
    assert.match(html, /\.grade-range \{ white-space: nowrap; \}/);
  }
});

test('explicit language wins for expired results and download errors, with a recovery link', async () => {
  for (const lang of ['en', 'fr']) {
    for (const route of ['audit/result', 'audit/export', 'audit/generate', 'compare/result', 'compare/export']) {
      const response = await fetch(`${base}/${lang}/${route}?job=expired-review&format=html&file=robots.txt`, {
        headers: { 'accept-language': lang === 'fr' ? 'en' : 'fr' },
      });
      assert.equal(response.status, 404);
      const html = await response.text();
      assert.match(html, new RegExp(`<html lang="${lang}"`));
      assert.ok(html.includes(lang === 'fr' ? 'Rapport expiré' : 'Report expired'));
      assert.match(html, new RegExp(`href="/${lang}/"`));
    }
  }
});

test('URL rejection messages are translated without changing the shared SSRF rules', async () => {
  const before = jobs.size;
  for (const [url, message] of [
    ['ftp://example.com', 'Seules les adresses HTTP et HTTPS sont acceptées'],
    ['http://127.0.0.1/', 'réseau privé ou réservé'],
    ['https://user:password@example.com/', 'Retirez l’identifiant et le mot de passe'],
  ]) {
    for (const route of ['audit', 'compare/start']) {
      const response = await fetch(`${base}/fr/${route}?url=${encodeURIComponent(url)}`);
      assert.equal(response.status, 400);
      const html = await response.text();
      assert.ok(html.includes(message));
      assert.doesNotMatch(html, /Unsupported scheme|Only http and https|user:password/);
    }
  }
  assert.equal(jobs.size, before, 'URL rejection still happens before job creation');
});

test('download links retain the selected language after a real report expires', async () => {
  const job = jobs.create({ url: fixture.url, lang: 'fr' });
  jobs.finish(job.id, { report: fixture, html: '<html><body>REPORT</body></html>' });
  const report = await (await fetch(`${base}/audit/result?job=${job.id}`)).text();
  const link = /href="(\/audit\/export[^"]+format=json[^"]*)"/.exec(report)?.[1];
  assert.ok(link, 'JSON export link is present');
  jobs.get(job.id, job.completedAt + 30 * 60_000);
  const response = await fetch(new URL(link, base), { headers: { 'accept-language': 'en' } });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /<html lang="fr"/);
});

test('explicit language also translates failed audit and compare results', async () => {
  for (const [kind, code, status, message] of [
    ['audit', 'busy', 429, 'Serveur occupé'],
    ['compare', 'needMore', 400, 'concurrent joignable'],
  ]) {
    const job = jobs.create({ url: fixture.url, lang: 'en', kind });
    jobs.fail(job.id, code, 'Original English error');
    const response = await fetch(`${base}/fr/${kind}/result?job=${job.id}`);
    assert.equal(response.status, status);
    const html = await response.text();
    assert.match(html, /<html lang="fr"/);
    assert.doesNotMatch(html, /Original English error/);
    assert.ok(html.includes(message));
  }
});

test('URL fields accept bare hosts and competitors have separate visible labels', async () => {
  const html = await (await fetch(`${base}/fr/`)).text();
  assert.match(html, /type="text"[^>]*name="url"/);
  assert.match(html, /name="compare"/);
  assert.match(html, /name="compare2"/);
  assert.match(html, /<label[^>]*for="compare-url-1"/);
  const res = await fetch(`${base}/fr/compare/start?url=93.184.216.34&compare=1.1.1.1&compare2=8.8.8.8`);
  assert.equal(res.status, 200);
  const page = await res.text();
  const id = /var job = "([^"]+)"/.exec(page)?.[1];
  assert.deepEqual(jobs.get(id).urls, ['https://93.184.216.34/', 'https://1.1.1.1', 'https://8.8.8.8']);
  assert.match(page, /role="status"[^>]*aria-live="polite"/);
  assert.match(page, /aria-valuenow="0"/);
});

test('a JSON file can be imported with the existing bounded baseline endpoint', async () => {
  const job = jobs.create({ url: fixture.url, lang: 'fr' });
  jobs.finish(job.id, { report: fixture, html: '<html><head></head><body>REPORT</body></html>' });
  const html = await (await fetch(`${base}/audit/result?job=${job.id}`)).text();
  assert.match(html, /type="file"[^>]*name="baselineFile"/);
  assert.match(html, /30 minutes/);
  assert.match(html, /class="result-actions"/);
  const form = new FormData();
  form.set('baselineFile', new Blob([JSON.stringify(fixture)], { type: 'application/json' }), 'previous.json');
  const response = await fetch(`${base}/fr/audit/diff?job=${job.id}`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html lang="fr"/);
});

test('invalid uploaded JSON is rejected without replacing the report', async () => {
  const job = jobs.create({ url: fixture.url, lang: 'fr' });
  jobs.finish(job.id, { report: fixture, html: '<html><body>REPORT</body></html>' });
  const form = new FormData();
  form.set('baselineFile', new Blob(['not JSON']), 'report.json');
  const response = await fetch(`${base}/fr/audit/diff?job=${job.id}`, { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.equal(jobs.get(job.id).report, fixture);
});

test('the actual server keeps finished reports for 30 minutes and running jobs for 3', () => {
  const done = jobs.create({ url: fixture.url, lang: 'fr' });
  jobs.finish(done.id, { report: fixture, html: '<html></html>' });
  assert.ok(jobs.get(done.id, done.completedAt + 30 * 60_000 - 1));
  assert.equal(jobs.get(done.id, done.completedAt + 30 * 60_000), undefined);
  const running = jobs.create({ url: fixture.url, lang: 'fr' });
  assert.ok(jobs.get(running.id, running.createdAt + 180_000 - 1));
  assert.equal(jobs.get(running.id, running.createdAt + 180_000), undefined);
});
