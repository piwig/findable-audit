// Task 3 — pure stats aggregation for the admin dashboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, domainHistory } from '../lib/stats.mjs';

const NOW = new Date('2026-07-24T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function audit(over = {}) {
  return { ts: daysAgo(0), kind: 'audit', domain: 'a.com', url: 'https://a.com/', lang: 'en', score: 70, grade: 'C', familyScores: [], ipHash: 'h1', durationMs: 100, cwv: false, ...over };
}

test('empty events → zeros and null averages', () => {
  const s = computeStats([], NOW);
  assert.equal(s.totalAudits, 0);
  assert.equal(s.avgScore, null);
  assert.equal(s.medianScore, null);
  assert.deepEqual(s.gradeDist, { A: 0, B: 0, C: 0, D: 0, F: 0 });
  assert.deepEqual(s.topDomains, []);
  assert.deepEqual(s.recent, []);
  assert.equal(s.uniqueDomains, 0);
  assert.equal(s.uniqueVisitors, 0);
});

test('7d/30d windows and unique counts', () => {
  const events = [
    audit({ ts: daysAgo(0), domain: 'a.com', ipHash: 'h1' }),
    audit({ ts: daysAgo(3), domain: 'b.com', ipHash: 'h2' }),
    audit({ ts: daysAgo(10), domain: 'a.com', ipHash: 'h1' }),
    audit({ ts: daysAgo(40), domain: 'c.com', ipHash: 'h3' }),
  ];
  const s = computeStats(events, NOW);
  assert.equal(s.totalAudits, 4);
  assert.equal(s.audits7d, 2);
  assert.equal(s.audits30d, 3);
  assert.equal(s.uniqueDomains, 3);
  assert.equal(s.uniqueVisitors, 3);
});

test('median: odd and even counts', () => {
  const odd = computeStats([audit({ score: 10 }), audit({ score: 30 }), audit({ score: 80 })], NOW);
  assert.equal(odd.medianScore, 30);
  const even = computeStats([audit({ score: 10 }), audit({ score: 20 }), audit({ score: 30 }), audit({ score: 40 })], NOW);
  assert.equal(even.medianScore, 25); // (20+30)/2
  assert.equal(even.avgScore, 25);
});

test('grade distribution counts by grade', () => {
  const s = computeStats([audit({ grade: 'A' }), audit({ grade: 'A' }), audit({ grade: 'F' })], NOW);
  assert.deepEqual(s.gradeDist, { A: 2, B: 0, C: 0, D: 0, F: 1 });
});

test('compares are counted separately and excluded from audit stats', () => {
  const events = [
    audit({ score: 60, grade: 'D' }),
    { ...audit(), kind: 'compare', score: 99, grade: 'A', domain: 'z.com' },
  ];
  const s = computeStats(events, NOW);
  assert.equal(s.totalAudits, 1);
  assert.equal(s.compares, 1);
  assert.equal(s.avgScore, 60); // compare's 99 excluded
  assert.deepEqual(s.gradeDist, { A: 0, B: 0, C: 0, D: 1, F: 0 });
  assert.equal(s.recent.length, 1); // compare excluded from recent audits
});

test('topDomains caps at 20, sorted by count desc', () => {
  const events = [];
  for (let i = 0; i < 21; i++) for (let j = 0; j <= i; j++) events.push(audit({ domain: `d${i}.com`, score: 50 + i }));
  const s = computeStats(events, NOW);
  assert.equal(s.topDomains.length, 20);
  assert.equal(s.topDomains[0].domain, 'd20.com'); // most audited
  assert.equal(s.topDomains[0].count, 21);
  assert.equal(s.topDomains[0].lastScore, 70);
  assert.equal(s.topDomains[0].lastGrade, 'C');
});

test('recent caps at 50, newest first', () => {
  const events = [];
  for (let i = 0; i < 60; i++) events.push(audit({ ts: daysAgo(60 - i), domain: `r${i}.com` }));
  const s = computeStats(events, NOW);
  assert.equal(s.recent.length, 50);
  assert.equal(s.recent[0].domain, 'r59.com'); // newest
});

test('domainHistory computes deltas vs previous audit, ascending', () => {
  const events = [
    audit({ ts: daysAgo(2), domain: 'x.com', score: 70 }),
    audit({ ts: daysAgo(1), domain: 'x.com', score: 75 }),
    audit({ ts: daysAgo(0), domain: 'x.com', score: 73 }),
    audit({ ts: daysAgo(0), domain: 'other.com', score: 10 }),
  ];
  const h = domainHistory(events, 'x.com');
  assert.equal(h.length, 3);
  assert.deepEqual(h.map((e) => e.score), [70, 75, 73]);
  assert.deepEqual(h.map((e) => e.delta), [null, 5, -2]);
});
