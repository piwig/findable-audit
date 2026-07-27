// Bounded-concurrency probing for the checks that fan out over a list of URLs.
//
// Why this exists: several checks verify a bounded list of targets — up to 30
// internal links, the sampled sitemap URLs, the declared canonicals — and they
// did it strictly one at a time. On a site that answers in ~1s, that is ~30s
// spent waiting, and it was the bulk of a 41s fixed cost measured against a
// real production site whose homepage returns in 0.9s. The page count barely
// mattered; the sequential probes did.
//
// Concurrency is deliberately small. Firing thirty requests at once at a small
// site would be rude, and this tool audits other people's servers: a browser
// opens about six connections per host, and we stay at or under that.
//
// Results come back in input order, so a check's message lists offenders in the
// same order it always did — the speed-up must not change a single verdict.

/** Simultaneous probes per check. Polite by design; see the note above. */
export const PROBE_CONCURRENCY = 5;

export async function mapProbes<T, R>(
  items: readonly T[],
  probe: (item: T, index: number) => Promise<R>,
  limit: number = PROBE_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await probe(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
