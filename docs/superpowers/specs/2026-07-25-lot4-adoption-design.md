# LOT 4 « Adoption » — design : npm prêt-à-publier, GitHub Action composite, sortie JUnit XML

> Réfs : `docs/competitive-analysis-and-roadmap.md` §7, item #15.
> Périmètre : (A) package npm prêt à publier — **sans publier** ; (B) `action.yml`
> composite + workflow exemple de gate CI ; (C) format de rapport JUnit XML branché
> sur `--report <file>`. Hors périmètre : `npm publish`, `git push`, deploy/VPS,
> poids/décomptes des familles (aucun nouveau check), toute nouvelle dépendance.

## A. Préparation npm (sans publier)

### Constat

`packages/cli/package.json` est presque prêt : `name` `findable-audit` libre de
conflit, `bin` `findable`, `engines >= 20.3`, `repository`, `publishConfig.access
public`, `files: ["dist"]`. Manquent : `homepage`/`bugs`, keywords CI, un `README.md`
et un `LICENSE` **à la racine du package** (npm n'embarque pas ceux du repo parent
dans le tarball d'un workspace).

### Design

- `packages/cli/package.json` : `files: ["dist", "README.md", "LICENSE"]` (whitelist
  stricte — `dist/` ne contient que la compilation de `src/` : `rootDir: src`,
  `include: [src]`, donc aucun test/fixture/spec possible) ; ajouter `homepage`,
  `bugs`, keywords étendus (`junit`, `sarif`, `ci`, `github-actions`,
  `structured-data`, `json-ld`, `geo-audit`). Version `0.2.0` conservée (c'est elle
  que `index.ts` recopie dans `report.toolVersion` et que `sarif.ts` embarque).
- `packages/cli/LICENSE` : copie conforme du `LICENSE` racine (MIT).
- `packages/cli/README.md` : README npm-ready en anglais — pitch, quick start,
  flags essentiels, formats de rapport (dont `.sarif`/`.junit.xml`), snippets CI,
  lien vers le repo pour la doc complète. Aucun secret, aucune URL interne.
- Validation : `npm pack --dry-run` dans `packages/cli` — le tarball ne doit lister
  que `package.json`, `README.md`, `LICENSE` et `dist/**` (js + d.ts). Zéro fixture,
  zéro test, zéro secret.
- Publication (action **utilisateur**, hors mission) :
  `cd packages/cli && npm publish` (`--access public` déjà via `publishConfig` ;
  npm exigera l'OTP 2FA).

## B. GitHub Action composite (`action.yml` racine)

### Constat

`README.md` §« GitHub Action & CI » documente déjà `uses: piwig/findable-audit@main`
avec `url`/`min-score`/`max-pages`, un SARIF par défaut `findable-audit.sarif` et
des outputs `score`/`grade` — mais **l'action n'existe pas encore**. Le design suit
donc le contrat déjà publié dans le README.

### Design

- `action.yml` composite à la racine (l'action = ce repo ; `$GITHUB_ACTION_PATH`
  pointe sur son checkout).
- **inputs** : `url` (required), `min-score` (déf. `0`), `max-pages`, `baseline`,
  `fail-on-regression` (`'true'`/`'false'`, déf. `'false'`), `regression-tolerance`,
  `report` (liste de fichiers séparés par espaces, format par extension), `sarif`
  (déf. `findable-audit.sarif`, vide = pas de SARIF), `lang`, `version`
  (déf. `local`).
- **`version`** : `local` → `npm ci && npm run build` dans `$GITHUB_ACTION_PATH`
  puis `node $GITHUB_ACTION_PATH/packages/cli/dist/index.js` (fallback officiel tant
  que le package n'est pas publié) ; toute autre valeur → `npx -y
  findable-audit@<version>`.
- **outputs** : `score`, `grade`, `json` (chemin du rapport JSON complet, écrit dans
  `$RUNNER_TEMP/findable.json`).
- Un seul step `bash` : inputs passés **par `env:`** (jamais interpolés dans le
  script — anti-injection), construction du tableau d'arguments, exécution avec
  `set +e` pour capturer le code retour, extraction `score`/`grade` du JSON via
  `node -p`, écriture dans `$GITHUB_OUTPUT`, puis `exit <code CLI>` (le gate reste
  porté par l'exit code du CLI : `--min-score` / `--fail-on-regression`).
- `.github/workflows/findable-gate.yml` : exemple d'usage en gate —
  `workflow_dispatch` (jamais de run non sollicité), `security-events: write`,
  `uses: ./`, baseline commitée + `fail-on-regression` + tolérance, rapport
  `.junit.xml`, upload SARIF `github/codeql-action/upload-sarif@v3`, echo des
  outputs. Commentaires : comment capturer la baseline, passer à `push`/`schedule`,
  et remplacer `version: local` par la version npm une fois publiée.

## C. Sortie JUnit XML (`--report *.xml`)

### Constat

Le dispatch de `--report` (index.ts) choisit le format par extension :
`.sarif` → SARIF, `.json` → JSON, `.html`/`.htm` → HTML, sinon Markdown. GitLab CI
(`artifacts:reports:junit`) et Jenkins (`junit` step) consomment du JUnit XML —
format manquant pour l'item #15.

### Design

- Extension : **`.xml`** (donc `findable.junit.xml` *et* `report.xml`) → JUnit.
  Ordre du dispatch : `.sarif` → `.json` → `.xml` → `.html?` → défaut Markdown.
- `packages/cli/src/report/junit.ts`, `renderJunit(report)` :
  - déclaration `<?xml version="1.0" encoding="UTF-8"?>` ;
  - racine `<testsuites name="findable-audit — <url> — score S/100 (G)" tests
    failures skipped errors="0" time="0">` ;
  - **un `<testsuite>` par famille** (ordre d'apparition = ordre canonique du
    runner), attrs `tests/failures/skipped/errors="0"/time="0"`, `hostname` = host
    de l'URL auditée, `timestamp` = `generatedAt` si présent, `<properties>` avec le
    sous-score famille si présent ;
  - **un `<testcase>` par check** : `classname="findable-audit.<family>"`,
    `name="<check id>"`, `time="0"` ;
  - mapping : `fail` → `<failure type="fail">`, `warn` → `<failure type="warn">`
    (visible dans l'onglet tests ; le pipeline n'échoue **que** via l'exit code du
    CLI, jamais via ce fichier), `skip` → `<skipped message>`, `pass` → testcase
    auto-fermant ;
  - corps du `<failure>` : message + `Fix:` + `Docs:` (docUrl) + `Points: p/max` ;
  - échappement XML complet (`& < > " '`) sur attributs **et** texte.
- Zéro dépendance : concaténation de chaînes (comme `sarif.ts`/`html.ts`) ;
  `fast-xml-parser` (dépendance existante) sert **uniquement dans les tests** pour
  valider/parser le XML produit.
- Aide `--usage` : `<file.md|file.html|file.json|file.sarif|file.xml>` + ligne
  d'explication `.xml -> JUnit (GitLab CI / Jenkins)`.

## D. Intégration docs

1. `README.md` : Install (note « tant que non publié → from source ») ; tableau des
   flags l.137 (liste complète des extensions) ; §Report files ; §GitHub Action & CI
   (input `version: local`, snippet GitLab `artifacts:reports:junit`, note JUnit).
2. `docs/guide.md` + `docs/guide.fr.md` : section « Reports in CI » (JUnit/SARIF,
   snippets GitLab + GitHub) EN/FR.
3. `plugin/skills/geo-audit/SKILL.md` l.20 : `.sarif` → `.sarif`, `.junit.xml`.
4. Roadmap : item #15 LOT 4 coché (publication npm elle-même = action utilisateur,
   commande documentée).

## E. Plan de test (RED d'abord)

- `packages/cli/test/junit.test.ts` (unit, rapport factice) : déclaration XML +
  validation `XMLValidator` ; comptes `tests/failures/skipped` (warn compte en
  failure) ; un testcase par check, classname/name ; mapping fail/warn/skip/pass ;
  échappement (`<&>"'` dans message/fix) vérifié par round-trip `XMLParser` ;
  suites par famille avec comptes locaux + hostname ; corps failure (Fix/Docs/
  Points) ; score famille en `<property>`.
- `packages/cli/test/cli-report-dispatch.test.ts` (append) : `--report
  tmp.junit.xml` écrit un fichier `<?xml` + `<testsuites` (exit 0).
- Gates : `npx tsc --noEmit`, `npx vitest run`, `npm run build`,
  `npm pack --dry-run` (liste du tarball inspectée).
