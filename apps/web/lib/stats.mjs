// Pure aggregation over store events for the admin dashboard. No I/O.
//
// Only kind:'audit' events feed the audit KPIs (avg/median/grade/recent/top);
// kind:'compare' events are counted separately and otherwise excluded.

const GRADES = ['A', 'B', 'C', 'D', 'F'];

function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeStats(events, now = new Date()) {
  const nowMs = now.getTime();
  const audits = events.filter((e) => e.kind === 'audit');
  const compares = events.filter((e) => e.kind === 'compare').length;

  const within = (e, days) => nowMs - new Date(e.ts).getTime() < days * 86_400_000;
  const scores = audits.map((e) => e.score).filter((s) => typeof s === 'number');
  const sortedScores = [...scores].sort((a, b) => a - b);

  const gradeDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const e of audits) if (GRADES.includes(e.grade)) gradeDist[e.grade]++;

  // Per-domain rollup: count + latest audit (by ts).
  const byDomain = new Map();
  for (const e of audits) {
    const cur = byDomain.get(e.domain);
    if (!cur) byDomain.set(e.domain, { domain: e.domain, count: 1, lastTs: e.ts, lastScore: e.score, lastGrade: e.grade });
    else {
      cur.count++;
      if (new Date(e.ts).getTime() >= new Date(cur.lastTs).getTime()) { cur.lastTs = e.ts; cur.lastScore = e.score; cur.lastGrade = e.grade; }
    }
  }
  const topDomains = [...byDomain.values()]
    .sort((a, b) => b.count - a.count || new Date(b.lastTs) - new Date(a.lastTs))
    .slice(0, 20);

  const recent = [...audits]
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 50);

  return {
    totalAudits: audits.length,
    audits7d: audits.filter((e) => within(e, 7)).length,
    audits30d: audits.filter((e) => within(e, 30)).length,
    compares,
    uniqueDomains: byDomain.size,
    uniqueVisitors: new Set(audits.map((e) => e.ipHash).filter(Boolean)).size,
    avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    medianScore: median(sortedScores),
    gradeDist,
    topDomains,
    recent,
  };
}

/** Full chronological history for one domain, with score deltas vs the previous audit. */
export function domainHistory(events, domain) {
  const rows = events
    .filter((e) => e.domain === domain)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  let prev = null;
  return rows.map((e) => {
    const delta = prev === null ? null : e.score - prev;
    prev = e.score;
    return { ts: e.ts, score: e.score, grade: e.grade, delta, durationMs: e.durationMs, cwv: e.cwv, lang: e.lang };
  });
}
