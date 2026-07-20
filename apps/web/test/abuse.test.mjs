// Abuse-hardening tests: rate-limit key selection (clientIp) and the bounded
// rate-limit + result-cache maps. All pure/hermetic (no server, no network).

import test from 'node:test';
import assert from 'node:assert/strict';

import { clientIp } from '../lib/client-ip.mjs';
import { createRateLimiter } from '../lib/rate-limit.mjs';
import { createResultCache } from '../lib/cache.mjs';

// --- clientIp -------------------------------------------------------------

test('clientIp prefers X-Real-IP (set by nginx to the socket peer)', () => {
  const req = {
    headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '5.5.5.5, 203.0.113.7' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(clientIp(req), '203.0.113.7');
});

test('clientIp uses the LAST X-Forwarded-For hop when X-Real-IP is absent', () => {
  // nginx appends the real client last; earlier hops are attacker-controlled.
  const req = {
    headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(clientIp(req), '203.0.113.9');
});

test('clientIp does NOT trust the first (spoofable) XFF hop', () => {
  const req = {
    headers: { 'x-forwarded-for': '66.66.66.66, 203.0.113.9' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.notEqual(clientIp(req), '66.66.66.66');
  assert.equal(clientIp(req), '203.0.113.9');
});

test('clientIp falls back to the socket address with no proxy headers', () => {
  const req = { headers: {}, socket: { remoteAddress: '198.51.100.4' } };
  assert.equal(clientIp(req), '198.51.100.4');
});

// --- rate limiter is bounded ---------------------------------------------

test('rate-limit map is bounded by maxKeys (spoofed keys cannot grow it)', () => {
  const rl = createRateLimiter({ limit: 100, windowMs: 60_000, maxKeys: 3 });
  for (let i = 0; i < 50; i++) rl.take(`ip-${i}`);
  assert.ok(rl.size <= 3, `expected size <= 3, got ${rl.size}`);
});

// --- result cache is bounded ---------------------------------------------

test('result cache honours TTL', () => {
  const c = createResultCache({ ttlMs: 1000, maxEntries: 100 });
  c.set('k', 'v', 0);
  assert.equal(c.get('k', 500), 'v'); // fresh
  assert.equal(c.get('k', 2000), undefined); // expired
});

test('result cache is bounded by maxEntries (evicts oldest)', () => {
  const c = createResultCache({ ttlMs: 60_000, maxEntries: 3 });
  for (let i = 0; i < 20; i++) c.set(`k-${i}`, i);
  assert.ok(c.size <= 3, `expected size <= 3, got ${c.size}`);
  // The newest entries survive; the oldest were evicted.
  assert.equal(c.get('k-19'), 19);
  assert.equal(c.get('k-0'), undefined);
});
