# Spec — always write md + html reports by default

Date : 2026-07-20
Statut : en revue (validation utilisateur — design approuvé en conversation)
Portée : `packages/cli` (surtout `src/index.ts`) + docs

## 1. Objectif

Aujourd'hui le CLI n'écrit un fichier rapport que si `--report <file>` est passé.
Décision produit : **par défaut, chaque audit réussi écrit toujours DEUX fichiers**
— un rapport Markdown et un rapport HTML imprimable — dans le dossier courant,
en plus de la sortie terminal/JSON sur stdout.

## 2. Comportement

Après un audit **réussi** (le site répond ; un audit avorté en exit 2 n'écrit
rien), l'ensemble des fichiers à écrire est déterminé ainsi :

1. **`--report <path>` fourni (répétable)** → on écrit exactement ces fichiers,
   format choisi par extension (`.html`/`.htm` → HTML, sinon Markdown). Le
   comportement par défaut ci-dessous est **supprimé** (contrôle explicite).
2. **Sinon, `--no-report` fourni** → on n'écrit **aucun** fichier.
3. **Sinon (défaut)** → on écrit deux fichiers dans le dossier courant :
   - `<base>.md` (Markdown)
   - `<base>.html` (HTML imprimable)
   où `<base> = <hostname assaini>-<YYYY-MM-DD>`.

`--no-report` n'affecte que l'écriture par défaut ; combiné à `--report`
explicite, il est sans effet (les `--report` explicites priment). Il n'y a donc
jamais de contradiction bloquante à gérer.

La sortie stdout (terminal ou `--json`) est **inchangée** dans tous les cas.
Chaque fichier écrit est signalé sur stderr (`report written to <file>`, déjà en
place). Un échec d'écriture d'un fichier → `process.exitCode = 2` (règle
existante ; jamais de `process.exit()` après l'audit — contrainte Windows/libuv).

### 2.1 Nom de base par défaut

```ts
function defaultReportBase(url: string, now: Date): string {
  let host = 'report';
  try { host = new URL(url).hostname || 'report'; } catch { /* garde 'report' */ }
  const safeHost = host.replace(/[^a-z0-9.-]/gi, '-');
  return `${safeHost}-${now.toISOString().slice(0, 10)}`;
}
```

Exemples : `https://pb-ot.fr/` → `pb-ot.fr-2026-07-20.md` / `.html` ;
`http://127.0.0.1:5051/` → `127.0.0.1-2026-07-20.md` / `.html` (le port n'entre
pas dans le hostname). Un re-run le même jour écrase — comportement voulu.

### 2.2 Cohérence de la date

Le CLI calcule un seul `now = new Date()` et le passe à `renderMarkdown(report,
now)` et `renderHtml(report, now)` **et** à `defaultReportBase`, pour que la date
dans le nom de fichier soit identique à la date affichée dans le rapport.

## 3. CLI (`src/index.ts`)

- Nouvelle option `'no-report': { type: 'boolean', default: false }`.
- Le bloc d'écriture des rapports est remplacé par la logique §2 (calcul de la
  liste `targets` puis boucle d'écriture inchangée, format par extension).
- USAGE mis à jour : documenter le défaut (deux fichiers `<host>-<date>.md/.html`),
  `--no-report`, et que `--report` prend le dessus.

## 4. Tests (`test/cli.test.ts`)

Le binaire est lancé avec un `cwd` temporaire (`execFile(..., { cwd: tmpDir })`)
pour capturer les fichiers écrits par défaut, puis le dossier est nettoyé.

- **Défaut** : sans `--report`, deux fichiers sont créés dans le cwd temporaire —
  un `*.md` (commence par `# findable-audit — `) et un `*.html` (commence par
  `<!doctype html`) ; leurs noms contiennent le hostname (`127.0.0.1`) et se
  terminent par `.md` / `.html`.
- **`--no-report`** : sans `--report` mais avec `--no-report`, **aucun** fichier
  n'est créé dans le cwd temporaire ; stdout/exit code inchangés.
- **`--report` prime** : `--report out.md` (chemin explicite) écrit `out.md` et
  **n'écrit pas** de fichier par défaut dans le cwd.
- Les tests `--report` existants (Markdown, both-formats, non-writable) restent
  verts.

## 5. Docs

- `README.md` : documenter le nouveau défaut (deux rapports `<host>-<date>.md` et
  `.html` écrits automatiquement), `--no-report` (les supprimer), et le fait que
  `--report` explicite reprend la main. Ajuster tout passage qui laissait
  entendre qu'aucun fichier n'est écrit sans `--report`.

## 6. Contraintes

- Node ≥ 20, ESM (`.js` aux imports). Zéro nouvelle dépendance.
- Jamais de `process.exit()` après l'audit (échec d'écriture → `exitCode = 2`).
- Rétro-compatibilité : `--report` explicite se comporte comme aujourd'hui.
- e2e `perfect-site` 100/100 inchangé (aucun check touché).

## 7. Self-review

- ✔ Défaut non contradictoire : priorité `--report` > `--no-report` > défaut.
- ✔ `--json`/CI : `--no-report` fournit l'échappatoire pour ne pas polluer le cwd.
- ✔ Date unique partagée nom-de-fichier ↔ contenu.
- ✔ Site injoignable (exit 2 avant écriture) → aucun fichier.
- ⚠ Point ouvert : faut-il écrire dans un sous-dossier plutôt que le cwd ?
  Décision : **cwd** (attendu « à côté de moi »), pas de sous-dossier (YAGNI).
- ⚠ Overwrite same-day : accepté (le schéma domaine+date le documente comme voulu).
