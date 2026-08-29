// A106 — Les compteurs de checks annoncés (README, guides) sont générés depuis
// le registre plutôt que maintenus à la main. Deux casses du même type (137 vs
// 138 le 2026-08-02, puis 148 vs 149 avec A98/content-signals) : un humain — ou
// un agent — ajoute un check et oublie un compteur. Ce script réécrit tous les
// compteurs depuis les déclarations `id/family/evidence` de src/checks, la même
// source de vérité que docs-checks.test.ts qui, lui, continue de vérifier.
//
// Usage :
//   node scripts/sync-check-counts.mjs           # réécrit les fichiers
//   node scripts/sync-check-counts.mjs --check   # vérifie sans écrire (CI), exit 1 si décalage
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS_DIR = path.join(ROOT, 'packages', 'cli', 'src', 'checks');
const TARGETS = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'packages', 'cli', 'README.md'),
  path.join(ROOT, 'docs', 'guide.md'),
  path.join(ROOT, 'docs', 'guide.fr.md'),
];

// Même regex que declarations() dans packages/cli/test/docs-checks.test.ts.
function counts() {
  const seen = new Map();
  for (const file of fs.readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(CHECKS_DIR, file), 'utf8');
    for (const m of source.matchAll(
      /id: '([a-z0-9-]+)', family: '[a-z-]+', evidence: '(measured|heuristic)'/g,
    )) {
      if (seen.has(m[1])) throw new Error(`check déclaré deux fois : ${m[1]}`);
      seen.set(m[1], m[2]);
    }
  }
  const total = seen.size;
  const measured = [...seen.values()].filter((e) => e === 'measured').length;
  if (total < 100) throw new Error(`seulement ${total} checks trouvés — regex morte ?`);
  return { total, measured, heuristic: total - measured };
}

const { total, measured, heuristic } = counts();
const checkOnly = process.argv.includes('--check');
let drift = 0;

for (const target of TARGETS) {
  const before = fs.readFileSync(target, 'utf8');
  const after = before
    // « NNN checks grade against … » annonce le sous-total mesuré.
    .replace(/\d+(?= checks grade against)/g, String(measured))
    // Tout autre « NNN checks » à 3 chiffres et plus est le total du catalogue.
    .replace(/\d{3,}(?= checks\b(?!\s+grade\s+against))/g, String(total))
    .replace(/\d+(?= (?:are measured|sont mesurés))/g, String(measured))
    .replace(/\d+(?= (?:are heuristics?\b|heuristics?\b|heuristiques?\b))/g, String(heuristic));
  if (after !== before) {
    drift += 1;
    if (checkOnly) {
      console.error(`décalage de compteur dans ${path.relative(ROOT, target)}`);
    } else {
      fs.writeFileSync(target, after);
      console.log(`réécrit ${path.relative(ROOT, target)}`);
    }
  }
}

console.log(`registre : ${total} checks (${measured} mesurés, ${heuristic} heuristiques) — ${drift} fichier(s) ${checkOnly ? 'en décalage' : 'réécrit(s)'}`);
if (checkOnly && drift > 0) process.exit(1);
