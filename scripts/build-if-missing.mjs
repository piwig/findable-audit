// Rebuild uniquement les workspaces dont la sortie de build (dist) est absente.
// Utilise par `npm test` pour eviter un rebuild complet a chaque boucle de dev.
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const dirs = [];
for (const pattern of rootPkg.workspaces ?? []) {
  const base = pattern.replace(/\/\*$/, '');
  const { readdirSync } = await import('node:fs');
  for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(join(root, base, entry.name));
  }
}

for (const dir of dirs) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts?.build) continue;
  if (existsSync(join(dir, 'dist'))) {
    console.log(`[build-if-missing] ${pkg.name}: dist present, skip`);
    continue;
  }
  console.log(`[build-if-missing] ${pkg.name}: dist absent, build...`);
  execSync('npm run build', { cwd: dir, stdio: 'inherit' });
}
