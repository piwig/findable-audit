// Decide si le `dist` d'un workspace doit etre rebati.
//
// Extrait de `build-if-missing.mjs` pour etre testable : la fraicheur du build
// n'est pas un detail de confort, c'est ce qui garantit que les tests qui
// importent `dist/` (apps/web/test/dogfooding*.test.mjs) mesurent bien le code
// source courant et non un binaire d'hier.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// mtime le plus recent trouve sous `path` (fichier ou dossier, recursif).
// Retourne 0 si le chemin n'existe pas.
export function newestMtimeMs(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const mtime = entry.isDirectory() ? newestMtimeMs(child) : statSync(child).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

// Entrees dont une modification invalide le build d'un workspace.
export const BUILD_INPUTS = ['src', 'package.json', 'tsconfig.json'];

// { stale, reason } pour le workspace `dir`.
// reason: 'absent' (pas de dist), 'outdated' (source plus recente), 'fresh'.
export function buildDecision(dir, { inputs = BUILD_INPUTS } = {}) {
  const dist = join(dir, 'dist');
  if (!existsSync(dist)) return { stale: true, reason: 'absent' };

  const distMtime = newestMtimeMs(dist);
  let srcMtime = 0;
  for (const input of inputs) {
    const mtime = newestMtimeMs(join(dir, input));
    if (mtime > srcMtime) srcMtime = mtime;
  }

  if (srcMtime > distMtime) return { stale: true, reason: 'outdated', srcMtime, distMtime };
  return { stale: false, reason: 'fresh', srcMtime, distMtime };
}
