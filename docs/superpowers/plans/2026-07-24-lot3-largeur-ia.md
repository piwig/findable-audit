# LOT 3 implementation plan — roster IA 28 agents (#13) + `well-known-ai-json`

> Spec : `docs/superpowers/specs/2026-07-24-lot3-largeur-ia-design.md`
> Branche : `main`, commits locaux uniquement (PAS de push/deploy/VPS). TDD.
> git add CIBLÉ — jamais `audit-prod.*`, `findable.bordebat.fr-baseline.json`,
> `graphify-out/`, `docs/research/`.

## Gates (après chaque tâche)

```bash
cd packages/cli && npx tsc --noEmit && npx vitest run <fichier de la tâche>
# final : npx vitest run (tout), npm run build, tests apps/web (node --test explicites),
#         e2e perfect-site = 100
```

## Tâche A — roster 14 → 28 (`robots.ts`)

Fichiers : `packages/cli/src/robots.ts`, `packages/cli/src/checks/ai-access.ts`
(message fix), `packages/cli/test/checks/ai-access.test.ts` (étendre).

1. RED : describe « 2026 roster (LOT 3) » — invariants (`AI_BOTS.length >= 27`,
   Set sans doublon, citation ∩ training = ∅, union = AI_BOTS) ; `DuckAssistBot`
   bloqué → fail ; `Diffbot` + `PanguBot` seuls bloqués → warn ;
   `MistralAI-User` bloqué → fail (nouveaux noms matchés via `agentToken`).
2. GREEN : listes de la spec §A (13 citation / 15 training, commentaires par bot) ;
   fix de `ai-crawlers-allowed` généralisé (3 exemples + « any citation-time fetcher »).
3. tsc + `npx vitest run test/checks/ai-access.test.ts test/generate/generate.test.ts`.

## Tâche B — check `well-known-ai-json`

Fichiers : `packages/cli/src/checks/llm-content.ts` (append),
`packages/cli/src/checks/index.ts`, `packages/cli/test/checks/llm-content.test.ts`
(append), `packages/cli/test/fixtures/perfect-site/.well-known/ai.json` (nouveau),
`packages/cli/test/runner.test.ts` (112 → 113).

1. RED : (a) 404 → warn « missing » ; (b) 200 JSON objet → pass ; (c) 200 HTML
   (fallback SPA) → warn « not valid JSON » ; (d) 200 JSON non-objet (`[1,2]`) →
   warn « not a JSON object » ; (e) fixture perfect-site → pass.
2. GREEN : check per spec §B ; enregistrement après `llmsFullTxt` ; fixture ai.json.
3. tsc + `npx vitest run test/checks/llm-content.test.ts test/runner.test.ts test/e2e.test.ts`.

## Tâche C — intégration docs/décomptes (spec §C)

Fichiers : `report/check-i18n.ts` (entrée bilingue), `README.md` (11/85/90/100-110/310),
`docs/guide.md` + `docs/guide.fr.md` (l.3 + section du check), `plugin/skills/geo-audit/SKILL.md`
(8/89), `apps/web/lib/i18n.mjs`, `apps/web/server.mjs` (261), `packages/cli/src/index.ts`
(34), `packages/cli/src/report/i18n.ts` (12), roadmap (coche §7 P1 + note MàJ).

Gate : `npx vitest run` complet (dont `check-i18n.test.ts`), `npm run build`,
tests web.

## Commits (3 max, ciblés)

1. `docs(superpowers): spec + plan LOT 3 largeur IA`
2. `feat(robots): roster IA 14 → 28 agents (13 citation / 15 entraînement), tiering par intention conservé`
3. `feat(llm-content): check well-known-ai-json + décomptes 112 → 113 (README, guides, skill, web)`
