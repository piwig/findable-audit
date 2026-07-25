# LOT 4 implementation plan — npm prêt-à-publier + GitHub Action + sortie JUnit (#15)

> Spec : `docs/superpowers/specs/2026-07-25-lot4-adoption-design.md`
> Branche : `main`, commits locaux uniquement (PAS de `npm publish`/push/deploy/VPS). TDD.
> git add CIBLÉ — jamais `audit-prod.*`, `findable.bordebat.fr-baseline.json`,
> `graphify-out/`, `docs/research/`, `extract_lantern.js`, `lantern_*.txt`,
> `pull_strings.js`, `final_quotes.js`, `quote_windows.js`.

## Gates (après chaque tâche)

```bash
cd packages/cli && npx tsc --noEmit && npx vitest run <fichier de la tâche>
# final : npx vitest run (tout), npm run build, npm pack --dry-run (liste inspectée)
```

## Tâche A — sortie JUnit XML (`--report *.xml`)

Fichiers : `packages/cli/src/report/junit.ts` (nouveau),
`packages/cli/src/index.ts` (dispatch + USAGE),
`packages/cli/test/junit.test.ts` (nouveau),
`packages/cli/test/cli-report-dispatch.test.ts` (append).

1. RED : unit `junit.test.ts` — validation `XMLValidator`, comptes
   tests/failures/skipped (warn = failure), un testcase par check, mapping
   fail/warn/skip/pass, échappement `<&>"'` (round-trip `XMLParser`), suites par
   famille + hostname, corps failure (Fix/Docs/Points), property score famille.
   RED : dispatch `--report tmp.junit.xml` → `<?xml` + `<testsuites`.
2. GREEN : `renderJunit` per spec §C ; dispatch `.xml` avant `.html?` ; USAGE.
3. tsc + `npx vitest run test/junit.test.ts` ; `npm run build` puis
   `npx vitest run test/cli-report-dispatch.test.ts` (le dispatch teste `dist/`).

## Tâche B — npm prêt-à-publier (sans publier)

Fichiers : `packages/cli/package.json` (files/homepage/bugs/keywords),
`packages/cli/LICENSE` (copie du LICENSE racine),
`packages/cli/README.md` (npm-ready, nouveau).

1. `files: ["dist", "README.md", "LICENSE"]`, homepage/bugs, keywords étendus.
2. Gate : `npm pack --dry-run` — uniquement `package.json`, `README.md`, `LICENSE`,
   `dist/**` ; zéro fixture/test/secret. Publication documentée (utilisateur) :
   `cd packages/cli && npm publish` (OTP 2FA ; `--access public` via publishConfig).

## Tâche C — GitHub Action composite + workflow exemple

Fichiers : `action.yml` (racine, nouveau),
`.github/workflows/findable-gate.yml` (nouveau, `workflow_dispatch` uniquement).

1. `action.yml` per spec §B : inputs url/min-score/max-pages/baseline/
   fail-on-regression/regression-tolerance/report/sarif/lang/version(`local`),
   outputs score/grade/json, un step bash (env-injection-safe), exit = code CLI.
2. `findable-gate.yml` : gate exemple — baseline + fail-on-regression + JUnit +
   upload SARIF code-scanning + outputs. Pas de trigger automatique.
3. Gate : lint visuel YAML + `node -e` sur le parsing des morceaux critiques (pas
   de runner local) ; cohérence stricte avec le contrat du README §GitHub Action.

## Tâche D — docs (spec §D)

Fichiers : `README.md` (Install l.67, flags l.137, §Report files, §GitHub Action &
CI), `docs/guide.md` + `docs/guide.fr.md` (section Reports in CI),
`plugin/skills/geo-audit/SKILL.md` (l.20), roadmap (item #15 + note MàJ LOT 4).

Gate finale : `npx vitest run` complet, `npx tsc --noEmit`, `npm run build`,
`npm pack --dry-run`.

## Commits (4 max, ciblés)

1. `docs(superpowers): spec + plan LOT 4 adoption`
2. `feat(report): sortie JUnit XML via --report *.xml (GitLab CI / Jenkins)`
3. `feat(ci): action.yml composite + workflow exemple gate (SARIF + baseline)`
4. `chore(npm): package prêt à publier (files/LICENSE/README npm) + docs adoption`
