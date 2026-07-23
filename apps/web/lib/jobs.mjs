// In-memory job store for asynchronous audits (no dependencies).
//
// Single-process, behind nginx: state lives in memory and resets on restart.
// Bounded two ways so it cannot grow without limit under abuse:
//   - TTL: a job older than ttlMs is treated as absent and pruned.
//   - maxJobs: on overflow the oldest (Map insertion order) job is evicted.
//
// Job shape (contract): { id, url, lang, kind, urls, ipHash, reports, status,
//                         progress, report, html, error, createdAt }.
//   status  : 'running' | 'done' | 'error'
//   kind    : 'audit' (default) | 'compare'
//   urls    : the compare URL list (main first), or null for a plain audit
//   ipHash  : the hashed client IP for stats, or null
//   reports : the compare AuditReport[] once done (empty for a plain audit)
//   progress: the latest AuditProgress snapshot, or null before the first event
//   report  : the AuditReport once done, else null
//   html    : the pre-rendered report HTML once done, else null
//   error   : { code, message } once failed, else null

import { randomUUID } from 'node:crypto';

export function createJobStore(opts = {}) {
  const ttlMs = opts.ttlMs ?? 180_000;
  const maxJobs = opts.maxJobs ?? 500;
  /** @type {Map<string, any>} */
  const jobs = new Map();

  function create({ url, lang, kind = 'audit', urls = null, ipHash = null }) {
    const job = {
      id: randomUUID(),
      url,
      lang,
      kind,
      urls,
      ipHash,
      reports: [],
      status: 'running',
      progress: null,
      report: null,
      html: null,
      error: null,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    prune();
    return job;
  }

  function get(id, now = Date.now()) {
    const job = jobs.get(id);
    if (!job) return undefined;
    if (now - job.createdAt >= ttlMs) { jobs.delete(id); return undefined; }
    return job;
  }

  function setProgress(id, progress) { const j = jobs.get(id); if (j) j.progress = progress; }
  function finish(id, { report, html, reports }) { const j = jobs.get(id); if (j) { j.status = 'done'; j.report = report; j.html = html; if (reports !== undefined) j.reports = reports; } }
  function fail(id, code, message) { const j = jobs.get(id); if (j) { j.status = 'error'; j.error = { code, message }; } }

  function prune(now = Date.now()) {
    for (const [id, j] of jobs) if (now - j.createdAt >= ttlMs) jobs.delete(id);
    while (jobs.size > maxJobs) {
      const oldest = jobs.keys().next().value;
      if (oldest === undefined) break;
      jobs.delete(oldest);
    }
  }

  return { create, get, setProgress, finish, fail, prune, get size() { return jobs.size; } };
}
