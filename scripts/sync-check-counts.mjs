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
import { buildDecision } from './build-staleness.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS_DIR = path.join(ROOT, 'packages', 'cli', 'src', 'checks');
// Read the real registry only after a fresh build: optional diagnostics are not
// part of the default audit even though they belong in the documentation catalogue.
if (buildDecision(path.join(ROOT, 'packages', 'cli')).stale) {
  throw new Error('Rebuild first: npm run build --workspaces --if-present');
}
const { buildChecks } = await import('../packages/cli/dist/checks/index.js');
const active = buildChecks().length;
const TARGETS = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'packages', 'cli', 'README.md'),
  path.join(ROOT, 'docs', 'guide.md'),
  path.join(ROOT, 'docs', 'guide.fr.md'),
  // A111 — les deux surfaces que voit un prospect (page npm, Marketplace GitHub)
  // portaient un compteur figé, invisible du garde-fou tant qu'il ne listait que
  // la documentation. Elles comptent autant que le README.
  path.join(ROOT, 'packages', 'cli', 'package.json'),
  path.join(ROOT, 'action.yml'),
];

// Même regex que declarations() dans packages/cli/test/docs-checks.test.ts.
function counts() {
  const seen = new Map();
  const families = {};
  for (const file of fs.readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(CHECKS_DIR, file), 'utf8');
    for (const m of source.matchAll(
      /id: '([a-z0-9-]+)', family: '([a-z-]+)', evidence: '(measured|heuristic)'/g,
    )) {
      if (seen.has(m[1])) throw new Error(`check déclaré deux fois : ${m[1]}`);
      seen.set(m[1], m[3]);
      families[m[2]] = (families[m[2]] ?? 0) + 1;
    }
  }
  const total = seen.size;
  const measured = [...seen.values()].filter((e) => e === 'measured').length;
  if (total < 100) throw new Error(`seulement ${total} checks trouvés — regex morte ?`);
  return { total, measured, heuristic: total - measured, families };
}

const { total, measured, heuristic, families } = counts();
if (buildChecks({ agentStandards: true }).length !== total) throw new Error('Source declarations and compiled registry disagree');
const familyNames = {
  'AI crawler access': 'ai-access', 'Accès crawlers IA': 'ai-access',
  'Answer-engine content': 'llm-content', 'Contenu pour moteurs de réponse': 'llm-content',
  'Structured data & metadata': 'structured-data', 'Données structurées et métadonnées': 'structured-data',
  'Technical SEO': 'technical-seo', 'SEO technique': 'technical-seo',
  'On-page & content': 'on-page', 'On-page et contenu': 'on-page',
  'Performance & Core Web Vitals': 'performance', 'Performance et Core Web Vitals': 'performance',
  'Accessibility': 'accessibility', 'Accessibilité': 'accessibility',
  'Security & trust': 'security', 'Sécurité et confiance': 'security',
};
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
    .replace(/\d+(?= (?:are heuristics?\b|heuristics?\b|heuristiques?\b))/g, String(heuristic))
    .replace(/\d+(?= are \*measured\*)/g, String(measured))
    .replace(/\d+(?= are \*heuristic\*)/g, String(heuristic))
    .replace(/\*\*\d+\*\*(?= run by default)/g, `**${active}**`)
    .replace(/(default audit runs \*\*|default run includes \*\*|par défaut en comprend \*\*)\d+/g, `$1${active}`)
    .replace(/^(\| (?:\*\*)?)([^|*]+?)(?:\*\*)?( \| [\d.,]+ \| )\d+( \|)/gm, (row, start, name, middle, end) => {
      const family = familyNames[name];
      return family ? `${start}${name}${start.includes('**') ? '**' : ''}${middle}${families[family]}${end}` : row;
    });
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

console.log(`registre : ${total} checks (${measured} mesurés, ${heuristic} heuristiques), ${active} actifs par défaut — ${drift} fichier(s) ${checkOnly ? 'en décalage' : 'réécrit(s)'}`);
if (checkOnly && drift > 0) process.exitCode = 1;
