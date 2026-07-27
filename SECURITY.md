# Security policy

## Reporting a vulnerability

Please open a [security advisory](https://github.com/piwig/findable-audit/security/advisories/new)
on this repository, or a regular issue if the problem is not sensitive.

The same address is published machine-readably at
<https://findable.bordebat.fr/.well-known/security.txt> (RFC 9116) — the tool audits that
file on other people's sites, so it publishes its own.

Expect a first answer within a few days. This is a small open-source project, not a
staffed security team; please say so plainly if a finding is time-sensitive.

## Scope

Two things ship, and they have different risk profiles.

**The CLI** fetches URLs you point it at. It is same-origin by construction, never
executes JavaScript from the audited site, and parses everything as untrusted data. The
interesting failure modes are parser denial-of-service and anything that would make it
follow a redirect off the audited origin.

**The hosted web app** (<https://findable.bordebat.fr>) takes a URL from an anonymous
visitor and fetches it, which makes SSRF the central concern. The guard is enforced at the
fetch layer rather than once at the entrance, so every hop of a redirect chain is
re-validated, private and reserved address ranges are refused, and DNS-rebinding between
validation and connection is covered. `apps/web/README.md` documents the model, and
`apps/web/test/ssrf.test.mjs` is where the claims are asserted.

If you find a way to make either component reach a host the caller does not control, that
is the report we most want.

## Out of scope

- Findings against a site that findable-audit merely *audited* — report those to that
  site's owner.
- Rate-limit exhaustion of the public demo. It is bounded on purpose; if you can get past
  the bounds, that *is* in scope.
- Missing security headers on the demo site: run the audit, it will tell you, and the
  result is public.
