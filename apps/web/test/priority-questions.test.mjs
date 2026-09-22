import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventFromReport } from '../lib/store.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'findable-questions-test-'));
process.env.PORT = '0';
process.env.DATA_DIR = dataDir;
const { server, jobs, recordAuditEvent, setRunAuditForTest, setVerifyTurnstileForTest } = await import('../server.mjs');
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const fixture = JSON.parse(await readFile(new URL('../fixtures/example-report.json', import.meta.url), 'utf8'));
const publicUrl = 'https://93.184.216.34/questions';
let client = 0;
const headers = () => ({ 'x-real-ip': `192.0.2.${++client}`, 'content-type': 'application/x-www-form-urlencoded' });
const post = (fields, path = '/fr/audit', extra = {}) => fetch(base + path, {
  method: 'POST', headers: { ...headers(), ...extra }, body: new URLSearchParams({ url: publicUrl, ...fields }),
});
const jobId = html => /job=([0-9a-f-]{36})/.exec(html)?.[1];
function stubAudit(seen = []) {
  setRunAuditForTest(async (url, checks, opts) => {
    seen.push(opts.priorityQuestions ? [...opts.priorityQuestions] : null);
    return { ...structuredClone(fixture), url,
      ...(opts.priorityQuestions?.length ? { priorityAnswers: opts.priorityQuestions.map(question => ({ question, status: 'review', proof: { kind: 'prose', path: '/', excerpt: '<em>Visible evidence</em>' } })) } : {}),
    };
  });
}
async function complete(fields = {}) {
  const response = await post(fields);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const progress = await response.text();
  const id = jobId(progress);
  assert.ok(id);
  const result = await fetch(`${base}/fr/audit/result?job=${id}`);
  assert.equal(result.status, 200);
  return { id, result, progress };
}
test.afterEach(() => { setRunAuditForTest(undefined); setVerifyTurnstileForTest(undefined); });
test.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });

test('both landing forms expose optional questions through POST, with accessible help', async () => {
  for (const lang of ['en', 'fr']) {
    const html = await (await fetch(`${base}/${lang}/`)).text();
    assert.match(html, new RegExp(`<form[^>]+method="post"[^>]+action="/${lang}/audit"`));
    assert.match(html, /<details class="visitor-questions">/);
    assert.match(html, /<textarea[^>]+name="priorityQuestions"[^>]+aria-describedby="questions-help questions-privacy"/);
    assert.match(html, /id="questions-help"/);
    assert.match(html, /id="questions-privacy"/);
    assert.doesNotMatch(html, /localStorage|sessionStorage/);
  }
});

test('POST trims and deduplicates questions, preserving depth and escaped evidence in the report', async () => {
  const seen = []; stubAudit(seen);
  const question = '<img src=x onerror=alert(1)> Price?';
  const { id, result, progress } = await complete({ priorityQuestions: `  ${question}  \r\n\n${question}\nWhere are you?`, pages: '1' });
  assert.deepEqual(seen, [[question, 'Where are you?']]);
  assert.deepEqual(jobs.get(id).priorityQuestions, seen[0]);
  assert.equal(jobs.get(id).maxPages, 1);
  assert.ok(!progress.includes(question), 'question text is absent from progress URLs and markup');
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  const html = await result.text();
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; Price?'));
  assert.doesNotMatch(html, /<img src=x|<em>Visible evidence<\/em>|name="baseline"/);
  const exported = await fetch(`${base}/audit/export?job=${id}&format=json`);
  assert.equal(exported.headers.get('cache-control'), 'private, no-store');
  assert.equal((await exported.json()).priorityAnswers[0].question, question);
});

test('personalized jobs bypass both cache directions and do not alter a normal cached report', async () => {
  const seen = []; stubAudit(seen);
  const target = publicUrl + '-cache';
  const first = await complete({ url: target }); await first.result.text();
  const alice = await complete({ url: target, priorityQuestions: 'Private Alice question?' }); await alice.result.text();
  const bob = await complete({ url: target, priorityQuestions: 'Private Bob question?' }); await bob.result.text();
  const last = await complete({ url: target }); await last.result.text();
  assert.deepEqual(seen, [null, ['Private Alice question?'], ['Private Bob question?']]);
  assert.notEqual(jobs.get(alice.id).report, jobs.get(bob.id).report);
  assert.equal(jobs.get(first.id).report.priorityAnswers, undefined);
  assert.equal(jobs.get(last.id).report.priorityAnswers, undefined);
  const freshTarget = publicUrl + '-personal-first';
  const custom = await complete({ url: freshTarget, priorityQuestions: 'Never cache this question?' }); await custom.result.text();
  const ordinary = await complete({ url: freshTarget }); await ordinary.result.text();
  assert.equal(seen.at(-1), null, 'ordinary audit ran after a personalized audit of the same URL');
  assert.equal(jobs.get(ordinary.id).report.priorityAnswers, undefined);
});

test('question count and length are bounded without silently truncating', async () => {
  for (const priorityQuestions of [Array.from({ length: 6 }, (_, i) => `Question ${i}`).join('\n'), 'a'.repeat(301)]) {
    const before = jobs.size;
    const response = await post({ priorityQuestions });
    assert.equal(response.status, 400);
    assert.equal(jobs.size, before);
    assert.match(await response.text(), /5 questions|300 caractères/);
  }
  const boundary = await post({ priorityQuestions: 'é'.repeat(300) });
  assert.equal(boundary.status, 200);
  const unicodeBoundary = await post({ priorityQuestions: '🌍'.repeat(150) });
  assert.equal(unicodeBoundary.status, 200);
  const unicodeOver = await post({ priorityQuestions: '🌍'.repeat(151) });
  assert.equal(unicodeOver.status, 400);
  const duplicates = await post({ priorityQuestions: 'Question?\n'.repeat(8) });
  assert.equal(duplicates.status, 200);
});

test('POST body and media type are bounded; errors contain no submitted text', async () => {
  const huge = await post({ priorityQuestions: 'private-input'.repeat(8000) });
  assert.equal(huge.status, 413);
  assert.ok(!(await huge.text()).includes('private-input'));
  const json = await fetch(base + '/en/audit', { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: '{}' });
  assert.equal(json.status, 415);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('priorityQuestions=' + 'x'.repeat(70_000))); controller.close(); } });
  const chunked = await fetch(base + '/fr/audit', { method: 'POST', headers: headers(), body: stream, duplex: 'half' });
  assert.equal(chunked.status, 413, 'undeclared bodies obey the same limit');
  await chunked.text();
});

test('historical GET remains available without questions; questions in URLs are refused', async () => {
  const plain = await fetch(`${base}/en/audit?url=${encodeURIComponent(publicUrl)}`, { headers: headers() });
  assert.equal(plain.status, 200);
  const personalized = await fetch(`${base}/en/audit?url=${encodeURIComponent(publicUrl)}&priorityQuestions=PrivateQuestion`, { headers: headers() });
  assert.equal(personalized.status, 400);
  assert.ok(!(await personalized.text()).includes('PrivateQuestion'));
  const json = await fetch(`${base}/audit.json?url=${encodeURIComponent(publicUrl)}&priorityQuestions=PrivateQuestion`, { headers: headers() });
  assert.equal(json.status, 400);
  assert.equal((await json.json()).error, 'questions-require-form');
});

test('comparison and baseline cannot silently ignore custom questions', async () => {
  for (const method of ['GET', 'POST']) {
    const fields = new URLSearchParams({ url: publicUrl, compare: 'https://1.1.1.1/', priorityQuestions: 'Question?' });
    const response = await fetch(base + '/fr/compare/start' + (method === 'GET' ? '?' + fields : ''), {
      method, headers: headers(), ...(method === 'POST' ? { body: fields } : {}),
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /audit simple/);
  }
  stubAudit();
  const { id, result } = await complete({ priorityQuestions: 'Custom baseline?' }); await result.text();
  const response = await post({ baseline: JSON.stringify(fixture) }, `/fr/audit/diff?job=${id}`);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /questions/);
  const ordinary = await complete({ url: publicUrl + '-baseline' }); await ordinary.result.text();
  const customReport = { ...fixture, url: publicUrl + '-baseline', priorityAnswers: [{ question: 'Imported private question?', status: 'not-found' }] };
  const imported = await post({ baseline: JSON.stringify(customReport) }, `/fr/audit/diff?job=${ordinary.id}`);
  assert.equal(imported.status, 400);
});

test('personalized reports expire through the existing job retention and are excluded from statistics', async () => {
  stubAudit();
  const secret = 'Private business question';
  const { id, result } = await complete({ priorityQuestions: secret }); await result.text();
  const job = jobs.get(id);
  assert.ok(!JSON.stringify(eventFromReport(job.report, { kind: 'audit', lang: 'fr' })).includes(secret));
  assert.ok(!JSON.stringify(eventFromReport(job.report, { kind: 'audit', lang: 'fr' })).includes('priority'));
  await recordAuditEvent(job.report, { kind: 'audit', lang: 'fr' });
  const journal = await readFile(join(dataDir, 'events.jsonl'), 'utf8');
  assert.ok(!journal.includes(secret));
  assert.doesNotMatch(journal, /priorityQuestions|priorityAnswers|Private Alice|Private Bob/);
  jobs.get(id, job.completedAt + 30 * 60_000);
  for (const route of ['result', 'export']) {
    const response = await fetch(`${base}/fr/audit/${route}?job=${id}&format=json`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.ok(!(await response.text()).includes(secret));
  }
});

test('POST still enforces the SSRF and Turnstile gates before job creation', async () => {
  const before = jobs.size;
  const blocked = await post({ url: 'http://127.0.0.1/', priorityQuestions: 'Question?' });
  assert.equal(blocked.status, 400);
  assert.equal(jobs.size, before);
  const oldSite = process.env.TURNSTILE_SITE_KEY, oldSecret = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SITE_KEY = 'test'; process.env.TURNSTILE_SECRET_KEY = 'test';
  let token;
  setVerifyTurnstileForTest(async value => { token = value; return { ok: false }; });
  try {
    const denied = await post({ priorityQuestions: 'Question?', 'cf-turnstile-response': 'body-token' });
    assert.equal(denied.status, 400);
    assert.equal(token, 'body-token');
    assert.equal(jobs.size, before);
  } finally {
    if (oldSite === undefined) delete process.env.TURNSTILE_SITE_KEY; else process.env.TURNSTILE_SITE_KEY = oldSite;
    if (oldSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = oldSecret;
  }
});

test('POST audits consume the existing per-client rate limit', async () => {
  const ip = '198.51.100.201';
  for (let i = 0; i < 20; i++) assert.equal((await post({ priorityQuestions: 'Question?' }, '/en/audit', { 'x-real-ip': ip })).status, 200);
  const limited = await post({ priorityQuestions: 'Question?' }, '/en/audit', { 'x-real-ip': ip });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.has('retry-after'));
});
