# Contributing

Issues and pull requests are welcome. The rules below are what the codebase already
enforces — following them is mostly a matter of not fighting the tests.

## Getting the repo running

```bash
npm ci
npm run build --workspaces          # tsc; apps/web has no build step
npm test --workspaces               # vitest (packages/cli)
cd apps/web && node --test          # node:test, real HTTP servers on loopback
node packages/cli/dist/index.js https://example.com --max-pages 3
```

Always build before running the CLI or the web tests: `apps/web` imports from
`packages/cli/dist/`, so a stale build silently tests old code.

Node ≥ 20.3. CI runs ubuntu + windows × Node 20/22, so a change that only works on one
platform will be caught — but it is faster to not write it.

## Non-negotiables

- **No new runtime dependency** without a deliberate decision. The CLI has three
  (`fast-xml-parser`, `node-html-parser`, `picocolors`); `apps/web` has none, and that is
  advertised on the README.
- **Cross-platform.** No POSIX shell in shipped code, `path.join` everywhere, native
  `fetch`.
- **`process.exitCode`, never `process.exit`** anywhere a fetch may still be in flight:
  exiting while undici holds sockets crashes on Windows.
- **Commit subjects**: one line, `type(scope): description`.

## Proposing a check

Read [`.claude/skills/findable-new-check/SKILL.md`](.claude/skills/findable-new-check/SKILL.md)
first — it is the real procedure, including the count propagation that no test catches.
The short version:

1. **Spec before code**, in `docs/superpowers/specs/`, including the verdict policy.
2. **Decide what the check may do**, and be strict about it:
   - an unambiguous, verifiable defect (blocked crawler, broken canonical, hidden
     injection payload) may **fail**;
   - a content-shaping heuristic (phrasing, structure, style) may **warn at most** — the
     research in `docs/research/` says effectiveness varies by domain, and a heuristic
     that fails a site claims more than we know;
   - a missing precondition must **skip**, never pass and never fail. A site is not
     penalized for lacking something it does not need.
3. **Bilingual lexicons** for anything matching text. Two checks once shipped
   English-only regexes and silently ignored every French page.
4. **Tests for every branch, including skip**, plus an entry in
   `packages/cli/src/report/check-i18n.ts` (why + fix, EN and FR) and a French entry in
   `report/message-i18n.ts` for each message template. Three gates fail loudly if you
   forget: the count assertion, the i18n coverage test, and the `perfect-site` fixture,
   which must keep scoring exactly **100**.

## Dogfooding is a gate, not a ritual

`apps/web/test/dogfooding.test.mjs` boots the web app and runs the **real engine** against
it. It has caught three genuine product bugs, and it will happily fail your PR because
your new check dislikes our own pages. When that happens, fix the site or fix the check —
do not weaken the assertion. Two findings are deliberately left as warnings rather than
papered over; the reasoning is in `apps/web/README.md`.

## Honesty rules for user-facing copy

- Never promise a citation-rate uplift. The "+40 % with GEO" figure was checked and
  refuted; we sell the *probability* of being citable, never a guarantee.
- `llms.txt` is documented as a signal of unproven value. Keep it that way.
- If a claim cannot be backed by something in `docs/research/`, do not put it in the
  README, the guide or the site.

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md).
