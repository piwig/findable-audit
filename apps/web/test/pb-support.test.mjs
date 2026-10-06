import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderHtml } from '../../../packages/cli/dist/report/html.js';
import { t } from '../lib/i18n.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'findable-pb-support-'));
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

function assertSupport(html, lang, source) {
  const section = /<section class="[^"]*pb-support"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
  assert.ok(section, 'optional support section is present');
  const anchor = /<a ([^>]+)>([^<]+)<\/a>/.exec(section);
  assert.ok(anchor);
  assert.equal(anchor[2], t(lang).support.cta);
  assert.notEqual(t('en').support.cta, t('fr').support.cta);
  assert.match(anchor[1], /referrerpolicy="no-referrer"/);
  assert.match(anchor[1], /rel="noreferrer"/);
  const href = /href="([^"]+)"/.exec(anchor[1])[1].replaceAll('&amp;', '&');
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, 'https://pb-ot.fr/contact/');
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams], [
    ['service', 'presence-numerique'], ['utm_source', 'findable'],
    ['utm_medium', 'referral'], ['utm_content', source],
  ]);
  return section;
}

test('landing and archived example offer the translated PB path with static context', async () => {
  for (const lang of ['en', 'fr']) {
    for (const [route, source] of [['', 'landing'], ['example-report/', 'example_report']]) {
      const response = await fetch(`${base}/${lang}/${route}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assertSupport(html, lang, source);
      if (source === 'example_report') {
        assert.ok(html.includes(fixture.generatedAt.slice(0, 10)));
        assert.ok(html.includes(lang === 'fr' ? 'Rapport archivé' : 'Archived report'));
      }
    }
  }
});

test('completed audit offers PB without passing the job, audited URL or visitor questions', async () => {
  for (const lang of ['en', 'fr']) {
    const report = { ...fixture, url: 'https://private-customer.example/?customer=distinctive' };
    const job = jobs.create({ url: report.url, lang, priorityQuestions: ['Confidential visitor question'] });
    jobs.finish(job.id, { report, html: renderHtml(report, undefined, lang) });
    const response = await fetch(`${base}/audit/result?job=${job.id}&lang=${lang}`);
    assert.equal(response.status, 200);
    const section = assertSupport(await response.text(), lang, 'audit_report');
    for (const value of [job.id, report.url, 'private-customer', 'Confidential visitor question']) {
      assert.ok(!section.includes(value), `support does not include ${value}`);
    }
    const exported = await (await fetch(`${base}/audit/export?job=${job.id}&format=html&lang=${lang}`)).text();
    assert.doesNotMatch(exported, /pb-support|utm_source=findable/);
  }
});

test('failed and expired audit pages do not show the completed-report invitation', async () => {
  const job = jobs.create({ url: fixture.url, lang: 'fr' });
  jobs.fail(job.id, 'timeout', 'timeout');
  for (const id of [job.id, 'expired-support-report']) {
    const html = await (await fetch(`${base}/audit/result?job=${id}&lang=fr`)).text();
    assert.doesNotMatch(html, /class="[^"]*pb-support"/);
  }
});
