// In-memory job store for asynchronous audits (no dependencies).
//
// Single-process, behind nginx: state lives in memory and resets on restart.
// Bounded two ways so it cannot grow without limit under abuse:
//   - TTL: running work expires quickly; finished reports get ttlMs to be read.
//   - maxJobs: on overflow the oldest (Map insertion order) job is evicted.
//
// Job shape (contract): { id, url, lang, kind, urls, ipHash, maxPages, reports,
//                         status, progress, report, html, error, createdAt }.
//   status  : 'running' | 'done' | 'error'
//   kind    : 'audit' (default) | 'compare'
//   urls    : the compare URL list (main first), or null for a plain audit
//   ipHash  : the hashed client IP for stats, or null
//   maxPages: crawl depth chosen on the form (#60), or null for the default
//   reports : the compare AuditReport[] once done (empty for a plain audit)
//   progress: the latest AuditProgress snapshot, or null before the first event
//   report  : the AuditReport once done, else null
//   html    : the pre-rendered report HTML once done, else null
//   error   : { code, message } once failed, else null

import { randomUUID } from 'node:crypto';

export function createJobStore(opts = {}) {
  const ttlMs = opts.ttlMs ?? 30 * 60_000;
  const runningTtlMs = opts.runningTtlMs ?? opts.ttlMs ?? 180_000;
  const maxJobs = opts.maxJobs ?? 500;
  /** @type {Map<string, any>} */
  const jobs = new Map();

  function create({ url, lang, kind = 'audit', urls = null, ipHash = null, maxPages = null, priorityQuestions = [] }) {
    const job = {
      id: randomUUID(),
      url,
      lang,
      kind,
      urls,
      ipHash,
      maxPages,
      priorityQuestions: [...priorityQuestions],
      reports: [],
      status: 'running',
      progress: null,
      report: null,
      html: null,
      error: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    jobs.set(job.id, job);
    prune();
    return job;
  }

  function get(id, now = Date.now()) {
    const job = jobs.get(id);
    if (!job) return undefined;
    if (expired(job, now)) { jobs.delete(id); return undefined; }
    return job;
  }

  function setProgress(id, progress) { const j = jobs.get(id); if (j) j.progress = progress; }
  function finish(id, { report, html, reports }) { const j = jobs.get(id); if (j) { j.status = 'done'; j.completedAt = Date.now(); j.report = report; j.html = html; if (reports !== undefined) j.reports = reports; } }
  function fail(id, code, message) { const j = jobs.get(id); if (j) { j.status = 'error'; j.completedAt = Date.now(); j.error = { code, message }; } }

  function expired(job, now) {
    return job.completedAt === null
      ? now - job.createdAt >= runningTtlMs
      : now - job.completedAt >= ttlMs;
  }

  function prune(now = Date.now()) {
    for (const [id, j] of jobs) if (expired(j, now)) jobs.delete(id);
    while (jobs.size > maxJobs) {
      const oldest = jobs.keys().next().value;
      if (oldest === undefined) break;
      jobs.delete(oldest);
    }
  }

  return { create, get, setProgress, finish, fail, prune, get size() { return jobs.size; } };
}
