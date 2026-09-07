// A155 — `npx vitest run` a la racine du monorepo.
//
// Sans cette config, vitest lance depuis la racine ramasse `apps/web/test/*.test.mjs`
// (des suites node:test, pas vitest) et les fait echouer en bloc (30 FAIL le
// 07/09/2026), alors que `npm test` (workspaces) est vert. On delegue a la config de
// chaque paquet vitest — dont le globalSetup qui compile dist/ une seule fois —
// et on laisse apps/web a `node --test` via `npm test --workspaces`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
