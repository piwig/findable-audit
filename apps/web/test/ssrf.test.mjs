// Hermetic tests for the SSRF guard. isBlockedAddress() is pure (no I/O) so
// the IP-range logic is tested directly; assertPublicUrl() is tested with an
// injected DNS resolver so no real network lookups happen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isBlockedAddress, assertPublicUrl, BlockedUrlError } from '../lib/ssrf.mjs';

test('isBlockedAddress blocks loopback', () => {
  assert.equal(isBlockedAddress('127.0.0.1'), true);
  assert.equal(isBlockedAddress('127.9.9.9'), true);
  assert.equal(isBlockedAddress('::1'), true);
});

test('isBlockedAddress blocks RFC1918 private ranges', () => {
  assert.equal(isBlockedAddress('10.0.0.1'), true);
  assert.equal(isBlockedAddress('10.255.255.255'), true);
  assert.equal(isBlockedAddress('172.16.0.1'), true);
  assert.equal(isBlockedAddress('172.31.255.255'), true);
  assert.equal(isBlockedAddress('192.168.0.1'), true);
  assert.equal(isBlockedAddress('192.168.255.255'), true);
});

test('isBlockedAddress does NOT block 172.15/172.32 (outside 172.16/12)', () => {
  assert.equal(isBlockedAddress('172.15.0.1'), false);
  assert.equal(isBlockedAddress('172.32.0.1'), false);
});

test('isBlockedAddress blocks link-local incl. cloud metadata 169.254.169.254', () => {
  assert.equal(isBlockedAddress('169.254.0.1'), true);
  assert.equal(isBlockedAddress('169.254.169.254'), true);
  assert.equal(isBlockedAddress('fe80::1'), true);
});

test('isBlockedAddress blocks unspecified addresses', () => {
  assert.equal(isBlockedAddress('0.0.0.0'), true);
  assert.equal(isBlockedAddress('::'), true);
});

test('isBlockedAddress blocks carrier-grade NAT 100.64/10', () => {
  assert.equal(isBlockedAddress('100.64.0.1'), true);
  assert.equal(isBlockedAddress('100.127.255.255'), true);
  // 100.63 and 100.128 are outside the /10
  assert.equal(isBlockedAddress('100.63.255.255'), false);
  assert.equal(isBlockedAddress('100.128.0.1'), false);
});

test('isBlockedAddress blocks IPv6 unique-local and multicast', () => {
  assert.equal(isBlockedAddress('fc00::1'), true);
  assert.equal(isBlockedAddress('fd12:3456::1'), true);
  assert.equal(isBlockedAddress('ff02::1'), true);
});

test('isBlockedAddress unwraps IPv4-mapped / NAT64 IPv6 to catch internal targets', () => {
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedAddress('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedAddress('::ffff:10.0.0.1'), true);
  assert.equal(isBlockedAddress('64:ff9b::127.0.0.1'), true);
  // A mapped *public* address is still allowed.
  assert.equal(isBlockedAddress('::ffff:93.184.216.34'), false);
});

test('isBlockedAddress allows normal public addresses', () => {
  assert.equal(isBlockedAddress('93.184.216.34'), false); // example.com
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('1.1.1.1'), false);
  assert.equal(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('isBlockedAddress treats non-IP input as blocked (defensive)', () => {
  assert.equal(isBlockedAddress('not-an-ip'), true);
  assert.equal(isBlockedAddress(''), true);
});

// --- assertPublicUrl ------------------------------------------------------

// A resolver that must never be called (used where the URL is rejected before DNS).
const noLookup = () => {
  throw new Error('DNS lookup should not be reached for this input');
};

async function assertBlocked(rawUrl, code, opts) {
  await assert.rejects(
    () => assertPublicUrl(rawUrl, opts),
    (err) => {
      assert.ok(err instanceof BlockedUrlError, `expected BlockedUrlError, got ${err}`);
      if (code) assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
      return true;
    },
  );
}

test('assertPublicUrl blocks the ftp:// scheme', async () => {
  await assertBlocked('ftp://example.com/', 'bad-scheme', { lookup: noLookup });
});

test('assertPublicUrl blocks embedded credentials', async () => {
  await assertBlocked('http://user:pass@example.com/', 'credentials', { lookup: noLookup });
});

test('assertPublicUrl blocks non-80/443 ports', async () => {
  await assertBlocked('http://example.com:22/', 'bad-port', { lookup: noLookup });
  await assertBlocked('http://example.com:3010/', 'bad-port', { lookup: noLookup });
});

test('assertPublicUrl blocks literal internal IPs (no DNS needed)', async () => {
  await assertBlocked('http://127.0.0.1/', 'blocked-ip', { lookup: noLookup });
  await assertBlocked('http://10.0.0.5/', 'blocked-ip', { lookup: noLookup });
  await assertBlocked('http://169.254.169.254/', 'blocked-ip', { lookup: noLookup });
  await assertBlocked('http://0.0.0.0/', 'blocked-ip', { lookup: noLookup });
  await assertBlocked('http://[::1]/', 'blocked-ip', { lookup: noLookup });
});

test('assertPublicUrl rejects an internal IP on a bad port at the port check first', async () => {
  // Port is validated before the address, so this is bad-port, not blocked-ip.
  await assertBlocked('http://127.0.0.1:3010/', 'bad-port', { lookup: noLookup });
});

test('assertPublicUrl blocks localhost / *.localhost / *.local', async () => {
  await assertBlocked('http://localhost/', 'blocked-host', { lookup: noLookup });
  await assertBlocked('http://foo.localhost/', 'blocked-host', { lookup: noLookup });
  await assertBlocked('http://printer.local/', 'blocked-host', { lookup: noLookup });
});

test('assertPublicUrl blocks a hostname that resolves to a private IP', async () => {
  const lookup = async () => [{ address: '10.1.2.3', family: 4 }];
  await assertBlocked('http://sneaky.example.com/', 'blocked-ip', { lookup });
});

test('assertPublicUrl blocks when ANY resolved address is private', async () => {
  const lookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '192.168.1.1', family: 4 },
  ];
  await assertBlocked('http://mixed.example.com/', 'blocked-ip', { lookup });
});

test('assertPublicUrl allows a normal public https URL', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const url = await assertPublicUrl('https://example.com/', { lookup });
  assert.ok(url instanceof URL);
  assert.equal(url.hostname, 'example.com');
});

test('assertPublicUrl allows a literal public IP without DNS', async () => {
  const url = await assertPublicUrl('https://93.184.216.34/', { lookup: noLookup });
  assert.equal(url.hostname, '93.184.216.34');
});

test('assertPublicUrl surfaces DNS failure as a blocked error', async () => {
  const lookup = async () => { throw new Error('ENOTFOUND'); };
  await assertBlocked('http://does-not-exist.example/', 'dns-fail', { lookup });
});
