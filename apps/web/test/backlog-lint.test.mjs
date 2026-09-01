// A115 — Le linter de backlog n'a de valeur que s'il detecte vraiment.
// Vit dans apps/web comme build-staleness.test.mjs : c'est le seul lanceur de
// tests du depot pour les scripts de la racine (voir l'en-tete de ce dernier).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lignesNonConformes, verdictFichier, conforme, manques, DETTE_TOLEREE } from '../../../scripts/backlog-lint.mjs';

test('backlog-lint : accepte les formes historiques des que ID et date sont la', () => {
  // La regle est de fond, pas de cosmetique : ces trois formes coexistent dans
  // le fichier reel et disent toutes les deux choses qui comptent.
  assert.equal(conforme('- [ ] A116 [2026-09-01] **titre**'), true);
  assert.equal(conforme('- [x] A50 [2026-08-18, livre] **titre**'), true);
  assert.equal(conforme('- [x] A80 [livré 2026-08-25] **titre**'), true);
  assert.equal(conforme('- [x] A39 (fait 2026-08-09 - source) — titre'), true);
});

test('backlog-lint : refuse un item sans identifiant, et le dit', () => {
  const ligne = '- [2026-08-10] **Separer test du build**';
  assert.equal(conforme(ligne), false);
  assert.deepEqual(manques(ligne), ['identifiant']);
});

test('backlog-lint : refuse un item sans date, et le dit', () => {
  const ligne = '- [ ] A999 **un item non date**';
  assert.equal(conforme(ligne), false);
  assert.deepEqual(manques(ligne), ['date']);
});

test('backlog-lint : ignore le texte courant, ne lint que les items', () => {
  const contenu = ['## Titre', 'Une phrase de prose.', '- une puce ordinaire', '- [ ] A1 [2026-01-01] **ok**'].join('\n');
  assert.deepEqual(lignesNonConformes(contenu), []);
});

test('backlog-lint : signale la ligne exacte du fautif', () => {
  const contenu = ['- [ ] A1 [2026-01-01] **ok**', '- [2026-08-10] **orphelin**'].join('\n');
  const p = lignesNonConformes(contenu);
  assert.equal(p.length, 1);
  assert.equal(p[0].ligne, 2);
});

test('backlog-lint : la dette ne peut que descendre', () => {
  const contenu = '- [2026-08-10] **orphelin**';
  assert.equal(verdictFichier('x.md', contenu, { 'x.md': 1 }).ok, true, 'dette toleree');
  assert.equal(verdictFichier('x.md', contenu, { 'x.md': 0 }).ok, false, 'au-dela de la tolerance, echec');
  assert.equal(verdictFichier('x.md', '', { 'x.md': 3 }).resorbe, 3, 'la resorption est signalee');
});

test('backlog-lint : le backlog reel est conforme et sa dette est nulle', () => {
  const chemin = 'docs/backlog-geo-avance.md';
  const abs = new URL(`../../../${chemin}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const v = verdictFichier(chemin, readFileSync(abs, 'utf8'));
  assert.equal(v.ok, true, `${v.problemes.length} item(s) sans ID ou sans date`);
  assert.equal(DETTE_TOLEREE[chemin], 0, 'la dette est resorbee : elle ne doit pas etre reintroduite');
});

test('backlog-lint : l identifiant compte meme place apres un autre crochet', () => {
  // Forme reelle du fichier : `- [LIVRE 2026-08-17] A48 **titre**`.
  assert.equal(conforme('- [LIVRE 2026-08-17] A48 **titre**'), true);
});
