# LOT 1 — Trio durcissement : design spec (2026-07-24)

Branche `feat/lot1-durcissement`. Trois items du roadmap §0/§11-§12 : **#7 CAPTCHA Turnstile**, **#8 revue de durcissement**, **#55 génération de fichiers d'indexation**.

## Contraintes globales (héritées, non négociables)
- Zéro nouvelle dépendance npm. `apps/web` reste zéro-dép (Node core only). CLI : pas de nouvelle dép runtime.
- Cross-platform strict (pas de shell POSIX dans le code, `path.join`, fetch natif). Node ≥20.3. CI ubuntu+windows × Node 20/22.
- `process.exitCode`, jamais `process.exit` (crash undici Windows).
- Additif : ne casse aucun des 655 tests CLI / tests web existants. `tsc` propre. Invariant perfect-site=100 préservé.
- Admin privé (`apps/web/admin.local.mjs`, `apps/web/data/`, `ADMIN.local.md`) gitignoré — jamais committé, jamais cassé.
- `docs/competitive-analysis-and-roadmap.md` reste untracked (jamais `git add`).
- Secrets uniquement en env (systemd drop-in sur le VPS) ; jamais en dur, jamais loggés, jamais dans une réponse client.
- Toute chaîne visible utilisateur passe par l'i18n existant (web `WEB_MESSAGES`/`t(lang)` ; CLI `report/i18n.ts` + `check-i18n.ts`).

---

## #7 — CAPTCHA Cloudflare Turnstile (web)

### Décision d'architecture : token via query string (pas de POST)
Le serveur `apps/web/server.mjs` est **GET/HEAD uniquement, sans body-parser**. Le widget Turnstile alimente automatiquement un `<input type="hidden" name="cf-turnstile-response">`. Comme le formulaire d'audit est `method="get"`, ce token arrive **naturellement dans la query string** — aucune route POST ni lecteur de body à introduire. Le serveur lit `searchParams.get('cf-turnstile-response')` puis appelle l'endpoint **siteverify** de Cloudflare côté serveur.

### Env-gating (fail-safe)
- `TURNSTILE_SITE_KEY` (publique) + `TURNSTILE_SECRET_KEY` (secrète), lues en env.
- **Les deux présentes** → CAPTCHA activé.
- **Une seule présente** → CAPTCHA désactivé + `console.warn('[turnstile] disabled: both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required')` (évite un demi-état cassé).
- **Aucune** → CAPTCHA désactivé, comportement actuel strictement inchangé (dev/local/tests verts sans config).
- Un helper `turnstileConfig()` (lib) centralise cette lecture ; testable en injectant l'env.

### Vérification serveur (avant création du job)
- Nouveau module `apps/web/lib/turnstile.mjs` exportant :
  - `turnstileEnabled(env = process.env)` → bool.
  - `turnstileSiteKey(env)` → string | null.
  - `async verifyTurnstile(token, remoteip, { secret, fetchImpl, timeoutMs })` → `{ ok: boolean }`. POST `application/x-www-form-urlencoded` vers `https://challenges.cloudflare.com/turnstile/v0/siteverify` avec `secret`, `response=token`, `remoteip`. Parse la réponse JSON `{ success }`. `AbortSignal.timeout(~5000ms)`. Token vide/absent → `{ ok: false }` sans appel réseau. Toute erreur réseau/timeout/JSON → `{ ok: false }` (fail-closed).
  - L'endpoint siteverify est un **hôte fixe de confiance** → ne passe **pas** par la garde SSRF (celle-ci protège les URL fournies par l'utilisateur). `fetchImpl` injectable pour les tests (défaut = `globalThis.fetch`).
  - Le secret n'apparaît jamais dans un message d'erreur ni un log.
- Dans `handleAuditStart` (server.mjs, avant `jobs.create` ligne ~763) **et** `handleCompareStart` (avant `jobs.create` ligne ~937), après le rate-limit :
  - Si `turnstileEnabled()` : lire le token dans la query ; `verifyTurnstile(...)`. Si `!ok` → `errorPage(t(lang).error.captchaFailed.title, ...message, {status:400, lang})`. Sinon continuer.
  - Si non activé : flux inchangé.
- `/audit.json` (handleAudit) — **endpoint programmatique/JSON sans widget** : reste protégé par rate-limit + SSRF uniquement (un CAPTCHA sur une API JSON n'a pas de sens). Documenté comme vecteur secondaire borné par le rate-limit 20/min/IP. (Décision explicite : le roadmap cible « le formulaire d'audit ».)

### Landing : widget + CSP
- `landingPage(lang)` : quand activé, injecter dans le formulaire d'audit le script `https://challenges.cloudflare.com/turnstile/v0/api.js` (async defer) + `<div class="cf-turnstile" data-sitekey="${siteKey}">`. Le CTA reste utilisable ; ajouter un repli `noscript` expliquant que JS est requis pour la vérification.
- CSP de la landing **uniquement quand activé** : servir avec un en-tête CSP explicite relâché :
  `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  Quand désactivé : CSP par défaut inchangée (`script-src 'none'`). Le nonce n'est nécessaire que si on ajoute un script inline ; l'API Turnstile se charge par `src` allowlisté → **pas de nonce requis** sur la landing (préférer l'allowlist d'hôte au nonce pour rester simple).
- i18n : nouvelles clés `error.captchaFailed {title,message}` (et un libellé de widget si besoin) dans `WEB_MESSAGES.en` **et** `.fr`. Parité en/fr préservée (test i18n).

### Tests (#7)
- `apps/web/test/turnstile.test.mjs` (node:test) : `turnstileEnabled` (0/1/2 clés), `verifyTurnstile` avec `fetchImpl` stub (success true/false, token vide → pas d'appel, timeout/erreur → ok:false, secret jamais dans le retour).
- `apps/web/test/server-async.test.mjs` (ou nouveau) : avec env clés stub + `verifyTurnstile` mockable, `/en/audit?url=...` sans token → 400 captcha ; avec token valide (stub) → job créé (302/progress). Sans clés → comportement inchangé (job créé sans token).
- i18n parité en/fr.

---

## #55 — Génération de fichiers d'indexation (CLI `--emit <dir>` + web download)

### Portée
Après un audit, produire des fichiers **prêts à poser**, pré-remplis d'après ce que l'audit a détecté. **Fichiers génériques à personnaliser** : chaque sortie porte un avertissement bilingue « relire avant de déployer, surtout robots.txt ».

### Module `packages/cli/src/generate/` (fonctions pures, testables)
Signature `(report: AuditReport, opts: { lang: Lang }) => string` (side-effect-free, comme `renderSarif`). `AuditReport.url` = origine résolue ; `sampledPages` = pathnames → absolutiser via `new URL(path, report.url)`.
- `generateRobotsTxt(report, {lang})` : groupes `User-agent:` explicites pour chaque bot IA (`TRAINING_BOTS` + `CITATION_BOTS` de `robots.ts`) avec `Allow: /` par défaut ; un commentaire indique que bloquer les bots d'entraînement est un choix de politique (à décommenter). `User-agent: *` / `Allow: /`. `Sitemap: <origin>/sitemap.xml`. En-tête commentaire d'avertissement bilingue.
- `generateLlmsTxt(report, {lang})` : `# <host>`, blockquote `>` résumé, `## Sections`, liens vers les pages échantillonnées (satisfait le check `llms-txt`). Modèle = `llmsTxt()` de server.mjs.
- `generateLlmsFullTxt(report, {lang})` : version d'amorce plus longue (scaffold sections + note « compléter » ; ne pas fabriquer de faux contenu).
- `generateAiJson(report, {lang})` : `.well-known/ai.json` minimal et documenté (name, description, contact = dépôt, politique bots autorisés, `_note` d'avertissement bilingue — les commentaires JSON n'existent pas).
- `generateSitemapXml(report)` : `<urlset>` depuis `sampledPages` absolutisées (+ commentaire XML d'avertissement).
- `generateJsonLdStubs(report, {lang})` : stubs `@graph` Organization/WebSite/BreadcrumbList/FAQPage — **uniquement les types absents** du `report.entityGraph` (forcer `includeEntityGraph`). Modèle = `landingMeta()` @graph connexe (passe `entity-graph-connectivity`). Champs pour satisfaire les checks (Organization: name/url/logo/sameAs ; WebSite: SearchAction ; etc.). Avertissement `_note`.
- `EMITTED_FILES` : table `{ filename, mime, build }` listant les fichiers (`robots.txt`, `llms.txt`, `llms-full.txt`, `.well-known/ai.json`, `sitemap.xml`, `jsonld-stubs.json`) — source unique partagée CLI + web.
- `emitFiles(report, dir, {lang})` : écrit chaque fichier via `writeFileSync` (crée `dir` + `dir/.well-known/` avec `mkdirSync recursive`), + un `GENERATED-README.md` bilingue expliquant chaque fichier et l'avertissement. Pattern `process.exitCode`, jamais `process.exit`.

### CLI `--emit <dir>`
- Ajouter `'emit': { type: 'string' }` à `parseArgs` (index.ts 48-68). Validation : chemin non vide.
- Quand présent : forcer `auditOpts.includeEntityGraph = true`, exécuter l'audit normalement, puis `emitFiles(report, dir, {lang})` dans le bloc d'écriture (index.ts 215-257), avec `console.error('generated indexing files in <dir>')`. N'interfère pas avec `--report`/`--no-report`.
- Avertissement bilingue affiché en stderr après émission.

### Web « générer les fichiers »
- Le job store conserve déjà le `report` du job terminé (page result). Ajouter une route `GET /audit/generate?job=<id>&file=<name>` : reconstruit le fichier demandé depuis le `report` stocké via `EMITTED_FILES`, le sert en `content-disposition: attachment` (mime adéquat), 404 si job inconnu/expiré ou `file` non listé.
- Sur la page result, ajouter une section « Générer les fichiers d'indexation » (i18n) avec un lien de téléchargement par fichier + la note d'avertissement bilingue.
- Réutilise les fonctions `generate*` compilées (`packages/cli/dist`) — même import que `isBlockedAddress` (`../../../packages/cli/dist/...`).

### Tests (#55)
- `packages/cli/test/generate/*.test.ts` : chaque `generate*` — sortie contient les bons hôtes/URLs, groupes de bots, avertissement bilingue ; `generateJsonLdStubs` n'émet que les types manquants (report avec/sans Organization) ; `generateLlmsTxt` satisfait le check llms-txt (round-trip via le check). `emitFiles` écrit dans un tmpdir (`os.tmpdir()`), crée `.well-known/`, README présent.
- `packages/cli` e2e/CLI : `--emit <tmpdir>` sur la perfect-site → fichiers écrits, exit 0, pas de `process.exit`.
- Web : `apps/web/test/generate.test.mjs` (node:test) — job terminé → `/audit/generate?job&file=robots.txt` renvoie le fichier + content-disposition ; job inconnu → 404 ; file non listé → 404.

---

## #8 — Revue de durcissement (web + CLI)

Acquis vérifiés (explorer) : SSRF (source unique partagée), rate-limit 20/min/IP, CSP, referrer-policy, nosniff, Permissions-Policy, HSTS (nginx), job ids `randomUUID` (non devinables), timeouts (fetch 10s / audit 45-90s / PSI 45s), secrets jamais loggés, IP hashées dans le store, erreurs génériques sans stack/chemin. **La plupart des cases sont déjà cochées.**

### Livrables concrets
1. **Garde de longueur d'entrée (défensif)** : rejeter tôt (avant tout traitement) une URL/query anormalement longue dans `handleAuditStart`/`handleCompareStart`/`handleAudit` (ex. `req.url.length > 2048` → 414/400 générique localisé). Cheap DoS hardening. Test.
2. **`npm audit`** sur le monorepo : relever les advisories, corriger ce qui est corrigeable sans upgrade cassant ; documenter le reste.
3. **`/security-review`** exécuté sur le diff complet du LOT 1 (Turnstile + generate sont les changements security-sensibles) → corriger Critical/Important.
4. **Documentation** : consigner dans la revue ce qui est déjà couvert (HSTS nginx, ids random, timeouts, no-leak) et le vecteur secondaire `/audit.json` (rate-limit only, by design).

Le gros du durcissement #8 **est** le travail #7 (anti-abus) ; #8 ajoute la garde de longueur + npm audit + la revue finale.

---

## Ordre d'exécution (un seul writer à la fois, arbre partagé)
1. #55 module generate (CLI, pur, isolé) — pas de conflit avec le web.
2. #55 CLI `--emit` wiring.
3. #7 lib turnstile (module isolé).
4. #7 landing widget + CSP.
5. #7 server gate + i18n.
6. #55 web download + result-page section.
7. #8 garde de longueur + npm audit.
8. Docs/count + revue finale (incl. /security-review) → présenter à l'utilisateur (push/deploy = go explicite).

Reviews read-only parallélisables. Chaque tâche : TDD (RED→GREEN), suite complète verte + tsc avant commit.
