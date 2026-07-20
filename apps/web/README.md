# findable-audit web app

A tiny, dependency-free HTTP server that puts [findable-audit](https://github.com/piwig/findable-audit)
on the web: a visitor enters a URL and gets the audit report (SEO + GEO /
AI-search visibility) rendered as HTML or JSON.

It imports the CLI's built library modules directly, so there is **no build step
for the web app itself** and **zero runtime npm dependencies** (Node built-ins
only). It is designed to run on `127.0.0.1` behind nginx on a shared VPS, so
SSRF protection and abuse limits are first-class.

## Prerequisites

Build the CLI once so its `dist/` exists (the server imports from
`../../packages/cli/dist/*`):

```sh
cd packages/cli
npm install
npm run build
```

## Run

```sh
node apps/web/server.mjs
# or, from apps/web:  npm start
```

Environment:

| Var    | Default   | Meaning                                  |
| ------ | --------- | ---------------------------------------- |
| `PORT` | `3021`    | TCP port. The server always binds `127.0.0.1`. |

Put nginx in front to terminate TLS and forward to `http://127.0.0.1:3021`.

**This app trusts its reverse proxy and MUST NOT be exposed directly.** It
derives the rate-limit client IP from `X-Real-IP` (falling back to the last
`X-Forwarded-For` hop, then the socket address). Configure nginx to set
`proxy_set_header X-Real-IP $remote_addr;` and to append the real client to
`X-Forwarded-For`. Without such a proxy in front, a client can forge both
headers and spoof the rate-limit key.

## Endpoints

| Method | Path                 | Response                                             |
| ------ | -------------------- | --------------------------------------------------- |
| GET    | `/`                  | Landing page with the audit form.                   |
| GET    | `/audit?url=<url>`   | HTML audit report (200), or a safe HTML error page. |
| GET    | `/audit.json?url=<url>` | JSON audit report (200), or a JSON error.        |
| GET    | `/healthz`           | `200 ok` (for systemd / nginx health checks).       |
| *      | anything else        | `404`.                                              |

A bare host such as `example.com` is accepted and treated as `https://example.com`.

## Security & abuse protection

### SSRF (`lib/ssrf.mjs`)

Before any audit runs, the target URL must pass `assertPublicUrl()`:

- Scheme must be `http` or `https`.
- No embedded credentials (`user:pass@`).
- Port must be `80`, `443`, or the scheme default.
- `localhost`, `*.localhost` and `*.local` hostnames are refused.
- The host (literal IP, or **every** address it resolves to via
  `dns.promises.lookup(host, { all: true })`) must not be internal.

`isBlockedAddress(ip)` rejects these ranges:

| Family | Blocked ranges |
| ------ | -------------- |
| IPv4   | `0.0.0.0/8` (unspecified), `10.0.0.0/8`, `100.64.0.0/10` (CGNAT), `127.0.0.0/8` (loopback), `169.254.0.0/16` (link-local incl. `169.254.169.254` cloud metadata), `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved incl. broadcast) |
| IPv6   | `::` (unspecified), `::1` (loopback), `fc00::/7` (unique-local), `fe80::/10` (link-local), `ff00::/8` (multicast) |
| IPv6→IPv4 | IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96` and deprecated IPv4-compatible `::a.b.c.d` are unwrapped and their embedded IPv4 re-checked, so `::ffff:127.0.0.1` etc. are blocked. |

Any value that is not a valid IP literal is treated as blocked (defensive default).

`isBlockedAddress` is the **single source of truth** for the IP-range table: it
is defined once in the CLI (`packages/cli/src/ssrf.ts`) and imported here from
`packages/cli/dist/ssrf.js`, and it is the same predicate the crawler's
fetch-layer guard uses. There is no second copy of the ranges.

### Fetch-layer SSRF guard (redirect / hreflang / rebinding)

`assertPublicUrl()` validates the *initial* URL only. The deeper vectors are
closed one layer down, in the crawler, which the web app runs with
`blockPrivateHosts: true` (`runAudit(..., { blockPrivateHosts: true })`):

- **Redirects** are followed *manually* (`redirect: 'manual'`, max 5 hops); the
  host/port/IP guard re-runs on every hop, so a public host cannot 3xx-bounce
  the crawler to `http://169.254.169.254/`.
- **Discovered URLs** (sitemap entries, sampled pages, and cross-origin
  `hreflang` alternates) all go through the same guard — an hreflang `<link>`
  pointing at loopback is not fetched.
- **DNS rebinding / TOCTOU** is closed by pinning: after the guard resolves and
  validates the host, the connection is pinned to that exact IP (node:http(s)
  `lookup`), so it cannot be re-resolved to an internal address between check
  and connect. TLS SNI/cert validation still uses the hostname, so HTTPS stays
  valid.

A rejected hop makes the fetch return `null` (the checks treat that as
unreachable) and logs nothing sensitive.

### Abuse / resource limits

- **Concurrency cap:** at most 3 audits run at once; over that → `429` "busy".
- **Per-IP rate limit:** ~6 audits per rolling minute (keyed on `X-Real-IP`, else
  the last `X-Forwarded-For` hop, else the socket address) → `429`. The key map
  is bounded (`maxKeys`, default 10000; oldest evicted) so rotating/spoofed keys
  cannot grow memory without bound.
- **Per-audit hard timeout:** ~25s wall-clock (plus a 10s per-request timeout
  inside the crawler). The timeout aborts in-flight fetches via an
  `AbortController`, so the concurrency slot is freed promptly rather than after
  the remaining requests drain → `504`.
- **Page cap:** at most 8 pages sampled per audit.
- **Result cache:** identical URLs are served from a 60s in-memory cache, bounded
  to 500 entries (TTL sweep + oldest-eviction) so it cannot grow without bound.
- **CSP:** HTML responses carry a `Content-Security-Policy`
  (`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; …`)
  as defense-in-depth over the already-escaped output.

## Tests

```sh
node --test apps/web/test/
```

The SSRF tests are hermetic: `isBlockedAddress()` is pure and tested directly,
and `assertPublicUrl()` is tested with an injected DNS resolver, so no real
network access is required.
