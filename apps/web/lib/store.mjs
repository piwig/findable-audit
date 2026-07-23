// Append-only JSONL event store for usage stats (zero dependencies).
//
// One line of JSON per completed audit, under DATA_DIR/events.jsonl. The active
// file is rotated to events-<YYYYMM>.jsonl once it exceeds maxBytes so a single
// file never grows without bound. Reads aggregate every events*.jsonl.
//
// Privacy: client IPs are never stored in the clear — only sha256(salt+ip)
// truncated to 16 hex. The salt lives in DATA_DIR/salt (or the STATS_SALT env).
//
// Robustness: append() is best-effort and NEVER rejects — a disk error must not
// break an audit response. readEvents() tolerates corrupted lines (counted).

import { mkdir, stat, appendFile, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** sha256(salt + ip), 16 hex chars. */
export function ipHasher(salt) {
  return (ip) => createHash('sha256').update(salt + String(ip ?? '')).digest('hex').slice(0, 16);
}

/**
 * Resolve the hashing salt: STATS_SALT env wins (no file written), else read or
 * lazily create DATA_DIR/salt (mode 600).
 */
export async function loadOrCreateSalt(dataDir) {
  if (process.env.STATS_SALT && process.env.STATS_SALT.trim() !== '') return process.env.STATS_SALT;
  const file = join(dataDir, 'salt');
  try {
    const existing = await readFile(file, 'utf8');
    if (existing.trim() !== '') return existing.trim();
  } catch { /* not created yet */ }
  const salt = randomBytes(16).toString('hex');
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, salt, { encoding: 'utf8', mode: 0o600 });
  } catch { /* best-effort: fall back to an in-memory salt for this process */ }
  return salt;
}

/** Build a store event from an AuditReport plus per-request metadata. */
export function eventFromReport(report, { kind, lang, ipHash, durationMs, cwv, now = new Date() }) {
  let domain = '';
  try { domain = new URL(report.url).hostname; } catch { /* leave empty */ }
  return {
    ts: now.toISOString(),
    kind,
    domain,
    url: report.url,
    lang,
    score: report.score,
    grade: report.grade,
    familyScores: (report.familyScores ?? []).map((f) => ({ family: f.family, score: f.score })),
    ipHash: ipHash ?? null,
    durationMs: durationMs ?? null,
    cwv: Boolean(cwv),
  };
}

function monthStamp(now = new Date()) {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function createStore({ dataDir, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const active = join(dataDir, 'events.jsonl');
  // Serialize appends so concurrent fire-and-forget writes never interleave.
  let queue = Promise.resolve();

  async function rotateIfNeeded(incomingBytes) {
    let size = 0;
    try { size = (await stat(active)).size; } catch { return; /* no active file yet */ }
    if (size + incomingBytes <= maxBytes) return;
    // Archive as events-<YYYYMM>-<seq>.jsonl with a zero-padded, always-present
    // sequence so multiple rotations in one month sort lexicographically by age.
    const month = monthStamp();
    let maxSeq = 0;
    try {
      for (const f of await readdir(dataDir)) {
        const m = f.match(new RegExp(`^events-${month}-(\\d{4})\\.jsonl$`));
        if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
      }
    } catch { /* dir missing → seq stays 0 */ }
    const target = join(dataDir, `events-${month}-${String(maxSeq + 1).padStart(4, '0')}.jsonl`);
    await rename(active, target);
  }

  function append(event) {
    const line = JSON.stringify(event) + '\n';
    queue = queue.then(async () => {
      try {
        await mkdir(dataDir, { recursive: true });
        await rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(active, line, 'utf8');
      } catch (err) {
        console.error('[store] append failed:', err && err.message ? err.message : err);
      }
    });
    return queue;
  }

  async function readEvents() {
    const events = [];
    let ignored = 0;
    let files = [];
    try {
      files = (await readdir(dataDir))
        .filter((f) => /^events(-\d{6}-\d{4})?\.jsonl$/.test(f));
    } catch { return { events, ignored }; }
    // Archives (events-YYYYMM…) chronologically first, active file last.
    files.sort((a, b) => {
      if (a === 'events.jsonl') return 1;
      if (b === 'events.jsonl') return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const f of files) {
      let raw = '';
      try { raw = await readFile(join(dataDir, f), 'utf8'); } catch { continue; }
      for (const line of raw.split('\n')) {
        if (line.trim() === '') continue;
        try { events.push(JSON.parse(line)); } catch { ignored++; }
      }
    }
    return { events, ignored };
  }

  return { append, readEvents, dataDir };
}
