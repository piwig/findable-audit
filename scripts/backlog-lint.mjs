// A115 — Refuse un item de backlog sans identifiant ni date.
//
// POURQUOI. `docs/backlog-geo-avance.md` melange trois formats de ligne et trois
// marqueurs de livraison, si bien qu'aucun comptage automatique n'est juste et
// que des items ouverts sans identifiant echappent au dedoublonnage. Le cout se
// paie a chaque session : trier coute plus cher que lire.
//
// STRATEGIE : une ligne de base, pas une reecriture. Normaliser 110 items d'un
// coup, c'est risquer d'en denaturer le sens pour un gain cosmetique. Ce linter
// fige donc le nombre de lignes non conformes existantes et refuse toute
// AUGMENTATION : les nouveaux items sont tenus au format, l'ancien fonds se
// resorbe au fil des passages. Baisser le compteur ci-dessous quand on nettoie.
//
// Usage : node scripts/backlog-lint.mjs [chemin...]   (defaut : docs/backlog-geo-avance.md)

import { readFileSync } from 'node:fs';

/**
 * La regle est de FOND, pas de cosmetique : un item doit porter un identifiant
 * (sinon il echappe au dedoublonnage) et une date (sinon il ne peut pas etre
 * priorise). La forme exacte des crochets — `[2026-08-18, livre]`,
 * `[livré 2026-08-25]`, `(fait 2026-08-09 - …)` — est libre : uniformiser 110
 * lignes existantes serait un gain d'apparence pour un risque de sens.
 */
// L'identifiant suit le premier groupe entre crochets, quel que soit son
// contenu : `- [ ] A116 …` comme `- [LIVRE 2026-08-17] A48 …`. On exige sa
// PRESENCE, pas sa position — c'est le dedoublonnage qui compte, pas la mise en page.
export const IDENTIFIANT = /^- \[[^\]]*\]\s*[A-Z]\d+\b/;
export const DATE_ISO = /\d{4}-\d{2}-\d{2}/;

export function conforme(ligne) {
  return IDENTIFIANT.test(ligne) && DATE_ISO.test(ligne);
}

/** Ce qui manque a une ligne, pour un message utile plutot qu'un « non conforme ». */
export function manques(ligne) {
  const m = [];
  if (!IDENTIFIANT.test(ligne)) m.push('identifiant');
  if (!DATE_ISO.test(ligne)) m.push('date');
  return m;
}

/** Une ligne qui se veut un item de backlog (case a cocher en debut de ligne). */
// Volontairement large : `- [` attrape aussi bien `- [ ] A1 …` que la forme
// `- [2026-08-10] **titre**` des 7 items orphelins trouves le 01/09/2026. Un
// filet qui ne verrait que les cases a cocher laisserait passer exactement les
// items qui echappaient deja au dedoublonnage.
export const LIGNE_ITEM = /^- \[/;

/**
 * Dette figee au 2026-09-01, par fichier. Ne JAMAIS augmenter ces nombres :
 * ils ne peuvent que descendre. Un nouvel item doit naitre conforme.
 */
export const DETTE_TOLEREE = {
  'docs/backlog-geo-avance.md': 0,
};

/** Analyse un contenu et rend les lignes d'items non conformes. */
export function lignesNonConformes(contenu) {
  const problemes = [];
  contenu.split(/\r?\n/).forEach((ligne, i) => {
    if (!LIGNE_ITEM.test(ligne)) return;
    if (conforme(ligne)) return;
    problemes.push({ ligne: i + 1, manque: manques(ligne).join(' et '), texte: ligne.slice(0, 110) });
  });
  return problemes;
}

/** Verdict pour un fichier : conforme si la dette n'a pas augmente. */
export function verdictFichier(chemin, contenu, dette = DETTE_TOLEREE) {
  const problemes = lignesNonConformes(contenu);
  const toleree = dette[chemin.replace(/\\/g, '/')] ?? 0;
  return {
    chemin,
    problemes,
    toleree,
    ok: problemes.length <= toleree,
    resorbe: toleree - problemes.length,
  };
}

const estPrincipal = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (estPrincipal) {
  const cibles = process.argv.slice(2);
  const fichiers = cibles.length ? cibles : ['docs/backlog-geo-avance.md'];
  for (const chemin of fichiers) {
    const v = verdictFichier(chemin, readFileSync(chemin, 'utf8'));
    if (v.ok) {
      console.log(`[backlog-lint] ${chemin} : ${v.problemes.length} ligne(s) hors format, tolerance ${v.toleree} — OK`);
      if (v.resorbe > 0) {
        console.log(`[backlog-lint] ${v.resorbe} ligne(s) resorbee(s) : abaissez DETTE_TOLEREE a ${v.problemes.length}.`);
      }
      continue;
    }
    console.log(`[backlog-lint] ${chemin} : ${v.problemes.length} ligne(s) hors format pour une tolerance de ${v.toleree}.`);
    for (const p of v.problemes) console.log(`  l.${p.ligne} : ${p.manque} manquant(e) — ${p.texte}`);
    console.log('\nFormat attendu : - [ ] A123 [AAAA-MM-JJ] **titre**');
    console.log('Un item sans identifiant echappe au dedoublonnage ; un item sans date ne peut pas etre priorise.');
    process.exitCode = 1;
  }
}
