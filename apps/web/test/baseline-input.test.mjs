import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineInput } from '../lib/baseline-input.mjs';

const part = (name, value, filename = '') => `--audit-boundary\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n\r\n${value}\r\n`;
const type = 'multipart/form-data; boundary=audit-boundary';

test('the original paste contract is retained', () => {
  const json = '{"url":"https://exemple.fr/équipe"}';
  assert.equal(baselineInput(new URLSearchParams({ baseline: json }).toString(), 'application/x-www-form-urlencoded'), json);
});

test('multipart preserves UTF-8 and selects file content without trusting its filename', () => {
  const json = '{"url":"https://exemple.fr/équipe","message":"cité"}';
  const body = part('baseline', 'unused') + part('baselineFile', json, '../../report.json') + '--audit-boundary--\r\n';
  assert.equal(baselineInput(body, type), json);
});

test('an empty file field falls back to pasted JSON', () => {
  const body = part('baseline', '{"score":90}') + part('baselineFile', '') + '--audit-boundary--\r\n';
  assert.equal(baselineInput(body, type), '{"score":90}');
});

test('ambiguous or incomplete multipart cannot choose an arbitrary baseline', () => {
  const body = part('baselineFile', 'first') + part('baselineFile', 'second') + '--audit-boundary--\r\n';
  assert.equal(baselineInput(body, type), '');
  assert.equal(baselineInput(part('baselineFile', '{}'), type), '');
  assert.equal(baselineInput(body, 'multipart/form-data; boundary="bad\r\nboundary"'), '');
});
