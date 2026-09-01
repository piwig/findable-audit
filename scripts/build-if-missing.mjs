// Rebuild les workspaces dont la sortie de build (dist) est absente OU perimee.
// Utilise par `npm test` pour eviter un rebuild complet a chaque boucle de dev,
// sans jamais laisser les tests tourner contre un binaire plus vieux que les sources.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { buildDecision } from './build-staleness.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const dirs = [];
for (const pattern of rootPkg.workspaces ?? []) {
  const base = pattern.replace(/\/\*$/, '');
  for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(join(root, base, entry.name));
  }
}

for (const dir of dirs) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts?.build) continue;

  const { stale, reason } = buildDecision(dir);
  if (!stale) {
    console.log(`[build-if-missing] ${pkg.name}: dist a jour, skip`);
    continue;
  }
  const why = reason === 'absent' ? 'dist absent' : 'sources plus recentes que dist';
  console.log(`[build-if-missing] ${pkg.name}: ${why}, build...`);
  execSync('npm run build', { cwd: dir, stdio: 'inherit' });
}
