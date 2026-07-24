# LOT 1 — Trio durcissement : plan d'exécution (subagent-driven, TDD)

Spec : `docs/superpowers/specs/2026-07-24-lot1-durcissement-design.md`. Contraintes : `.superpowers/sdd/lot1/constraints.md`. Cartes : `.superpowers/sdd/lot1/explore-{web,cli-55,checks}.md`.

Branche `feat/lot1-durcissement` (base `main`, HEAD c25dad3, baseline 655 CLI + web verts).
**Un seul writer à la fois** (arbre partagé). Chaque tâche : TDD RED→GREEN, suite complète + `tsc` verts avant commit, 1 commit/tâche.

Tests : CLI = `cd packages/cli && npx vitest run` (+ `npm run build -w packages/cli` pour tsc). Web = `npm test -w apps/web` (node:test). Racine `npm test --workspaces`.

---

## Tâche 1 — #55 module `generate` (CLI, fonctions pures)
**Fichiers** : nouveau `packages/cli/src/generate/index.ts` ; tests `packages/cli/test/generate/generate.test.ts`.
**Contenu** : fonctions pures `(report, {lang}) => string` : `generateRobotsTxt`, `generateLlmsTxt`, `generateLlmsFullTxt`, `generateAiJson`, `generateSitemapXml`, `generateJsonLdStubs` ; table `EMITTED_FILES = [{filename, mime, build}]` (source unique) ; `emitFiles(report, dir, {lang})` (écrit chaque fichier + `.well-known/ai.json` via `mkdirSync recursive` + `GENERATED-README.md` bilingue ; `writeFileSync`, jamais `process.exit`).
**Réutilise** : `TRAINING_BOTS`/`CITATION_BOTS` (`src/robots.ts`), `report.sampledPages`+`report.url` (absolutiser `new URL(path, report.url)`), `report.entityGraph.nodes[].types` (types absents seulement), `ENTITY_ROOT_TYPES` (`report/entity-graph.ts`), modèles `llmsTxt()`/`sitemapXml()`/`landingMeta()` de `apps/web/server.mjs` (à porter en TS pur). Avertissement bilingue « relire avant de déployer, surtout robots.txt » dans chaque fichier (commentaire `#`/XML/`_note` JSON) + le README.
**TDD** : RED tests d'abord — sorties contiennent le bon host/URLs, groupes de bots nommés, l'avertissement bilingue ; `generateJsonLdStubs` n'émet que les types manquants (report avec Organization vs sans) ; `generateLlmsTxt` a H1+`>`+`##`+liens ; `emitFiles` écrit dans `os.tmpdir()`, crée `.well-known/`, README présent. Pas de dépendance réseau.
**Vérif** : `npx vitest run test/generate` vert, `npm run build -w packages/cli` propre.
**Contrainte** : ne modifie PAS `index.ts`/`runner.ts` (tâche 2). Module isolé, importable.

## Tâche 2 — #55 CLI `--emit <dir>` (wiring)
**Fichiers** : `packages/cli/src/index.ts` ; test `packages/cli/test/cli-emit.test.ts` (ou étendre `cli.test.ts`).
**Contenu** : ajouter `'emit': { type: 'string' }` aux options `parseArgs` (48-68) + validation (non vide, comme les autres). Quand présent : forcer `auditOpts.includeEntityGraph = true`, exécuter l'audit, puis `emitFiles(report, values.emit, {lang})` dans le bloc d'écriture (215-257) ; `console.error('generated indexing files in <dir>')` + avertissement bilingue en stderr. N'interfère pas avec `--report`/`--no-report`. Ajouter `--emit` au USAGE (17-35).
**TDD** : RED — exécuter le binaire (comme `cli.test.ts`/`cli-report-dispatch.test.ts`) contre un serveur fixture local avec `--emit <tmpdir>` → fichiers présents, exit 0, stderr contient l'avertissement ; sans `--emit` → aucun fichier généré (inchangé).
**Vérif** : `npx vitest run` complet vert, tsc propre. `process.exitCode` respecté (pas de `process.exit`).

## Tâche 3 — #7 lib `turnstile.mjs` (web, module isolé)
**Fichiers** : nouveau `apps/web/lib/turnstile.mjs` ; test `apps/web/test/turnstile.test.mjs`.
**Contenu** : `turnstileEnabled(env=process.env)` (les 2 clés présentes), `turnstileSiteKey(env)`, `async verifyTurnstile(token, remoteip, {secret, fetchImpl=globalThis.fetch, timeoutMs=5000})` → `{ok}`. POST form-encoded vers `https://challenges.cloudflare.com/turnstile/v0/siteverify` (`secret`,`response`,`remoteip`), `AbortSignal.timeout`. Token vide → `{ok:false}` sans réseau. Erreur/timeout/JSON invalide → `{ok:false}` (fail-closed). Le secret n'apparaît jamais dans le retour ni un log. Endpoint fixe de confiance → PAS de garde SSRF.
**TDD** : RED — `turnstileEnabled` 0/1/2 clés ; `verifyTurnstile` avec `fetchImpl` stub : success:true→ok, success:false→!ok, token vide→!ok sans appel, throw/timeout→!ok, le retour ne contient pas le secret.
**Vérif** : `npm test -w apps/web` vert. Zéro dép.

## Tâche 4 — #7 landing widget + CSP (web)
**Fichiers** : `apps/web/server.mjs` (`landingPage`, chemin de service de la landing), `apps/web/lib/i18n.mjs` (clés) ; test `apps/web/test/turnstile-landing.test.mjs`.
**Contenu** : quand `turnstileEnabled()`, injecter dans le formulaire d'audit `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer>` + `<div class="cf-turnstile" data-sitekey="${turnstileSiteKey()}">` + repli `noscript`. Servir la landing avec CSP relâchée explicite **seulement quand activé** (script-src/frame-src/connect-src + `https://challenges.cloudflare.com`, cf. spec) ; sinon CSP par défaut inchangée. Pas de nonce (allowlist d'hôte). i18n : nouvelle clé (ex. `landing.captchaHint` ou `error.captchaFailed`) en/fr — parité préservée.
**TDD** : RED — avec env clés stub, la landing contient le div `cf-turnstile` + le script + la CSP relâchée (assert header) ; sans clés, aucun des deux et CSP `script-src 'none'` inchangée. Parité i18n en/fr.
**Vérif** : `npm test -w apps/web` vert (incl. `i18n.test.mjs`, `seo.test.mjs`).
**Contrainte** : ne touche PAS `handleAuditStart`/`handleCompareStart` (tâche 5).

## Tâche 5 — #7 server gate (web)
**Fichiers** : `apps/web/server.mjs` (`handleAuditStart`, `handleCompareStart`), `apps/web/lib/i18n.mjs` (si clé d'erreur pas déjà posée) ; test `apps/web/test/turnstile-gate.test.mjs`.
**Contenu** : dans `handleAuditStart` (avant `jobs.create` ~763) et `handleCompareStart` (avant `jobs.create` ~937), après le rate-limit : si `turnstileEnabled()`, lire `parsed.searchParams.get('cf-turnstile-response')`, `verifyTurnstile(token, ip, {secret})`. `!ok` → `errorPage(t(lang).error.captchaFailed.title, ...message, {status:400, lang})`. Injecter `verifyTurnstile`/`fetchImpl` de façon testable (module importable, ou paramètre d'injection interne). Flux inchangé si non activé. `/audit.json` NON gardé (documenté). Ne loggue jamais le secret.
**TDD** : RED — env clés stub + verify stubé : `/en/audit?url=https://example.com` sans token → 400 captcha ; avec token valide → job créé (302/progress) ; sans clés → job créé sans token (inchangé). Idem `/compare/start`.
**Vérif** : `npm test -w apps/web` complet vert.

## Tâche 6 — #55 web « générer les fichiers » (download)
**Fichiers** : `apps/web/server.mjs` (nouvelle route `/audit/generate`, section page result), `apps/web/lib/i18n.mjs` ; test `apps/web/test/generate.test.mjs`. Import des `generate*`/`EMITTED_FILES` depuis `packages/cli/dist`.
**Contenu** : route `GET /audit/generate?job=<id>&file=<name>` → reconstruit le fichier depuis le `report` du job terminé via `EMITTED_FILES`, sert en `content-disposition: attachment; filename="..."` (mime adéquat) ; 404 si job inconnu/expiré ou `file` non listé. Sur la page result, section i18n « Générer les fichiers d'indexation » avec un lien par fichier + note d'avertissement bilingue. Réutilise le pattern d'import CLI-dist (comme `ssrf.mjs`).
**TDD** : RED — job terminé (via le flux existant en test) → `/audit/generate?job&file=robots.txt` renvoie contenu + content-disposition ; job inconnu → 404 ; `file` non listé → 404. La page result contient la section + les liens quand un rapport existe.
**Vérif** : `npm test -w apps/web` vert. Nécessite `packages/cli` buildé (`npm run build -w packages/cli`) avant les tests web (comme aujourd'hui pour `ssrf`).

## Tâche 7 — #8 garde de longueur d'entrée + npm audit
**Fichiers** : `apps/web/server.mjs` (garde `req.url.length`), test `apps/web/test/limits.test.mjs`. Rapport `npm audit` dans le report de tâche (pas de fichier committé).
**Contenu** : rejeter tôt (avant traitement) `req.url.length > 2048` dans le handler principal → réponse générique localisée (400/414), sans fuite. Lancer `npm audit` (monorepo) ; corriger l'corrigeable sans upgrade cassant ; consigner le reste dans le report. Vérifier (et documenter dans le report) que job ids restent `randomUUID`, timeouts en place, secrets non loggés, `/audit.json` = rate-limit only by design.
**TDD** : RED — une requête avec une query > 2048 chars → statut d'erreur, pas de crash, message générique ; requête normale inchangée.
**Vérif** : `npm test -w apps/web` vert. `npm audit` reporté.

## Tâche 8 — Docs + revue finale
**Fichiers** : `README.md` (mention `--emit`, section Turnstile env), `docs/guide.md` + `docs/guide.fr.md` (`--emit`, génération de fichiers), `packages/cli/src/index.ts` USAGE (déjà tâche 2 — vérifier). Pas de nouveau check ⇒ **compte de checks inchangé** (109). 
**Contenu** : documenter `--emit <dir>` (EN+FR), la config Turnstile (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`, env-gated), et l'avertissement « fichiers à relire ». Mettre à jour la mémoire projet après validation.
**Revue finale** : `/security-review` sur le diff complet du LOT 1 + revue whole-branch multi-lentilles (workflow) → corriger Critical/Important. Présenter le diff à l'utilisateur ; push + déploiement VPS = **go explicite** (l'utilisateur crée le widget Turnstile + pose les clés sur le VPS).
**Vérif** : `npm test --workspaces` vert, `tsc` propre, invariant perfect-site=100.

---

## Global constraints (rappel pour reviewers)
- Zéro nouvelle dép ; `apps/web` zéro-dép ; cross-platform ; `process.exitCode` jamais `process.exit`.
- Turnstile env-gated (2 clés → ON, sinon OFF, comportement inchangé) ; secret jamais loggé/retourné ; siteverify hors garde SSRF (hôte fixe) ; token via query GET (pas de POST).
- Fichiers générés = génériques, avertissement bilingue obligatoire.
- Admin privé intact/gitignoré ; roadmap.md untracked ; ask-before-push/deploy.
- i18n : parité en/fr (web) obligatoire ; toute chaîne utilisateur via i18n.
