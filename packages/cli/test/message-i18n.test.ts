import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_MESSAGES_FR, localizeMessage } from '../src/report/message-i18n.js';
import { makeResult, t, type CheckResult } from '../src/types.js';

const CHECKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'checks');

/**
 * Every message template a check can hand to a report, normalized exactly the way the
 * `t` tag and makeResult normalize it. Parsed from source rather than from a hand-kept
 * list, so a new check shows up here the moment it is written.
 */
function templatesInSource(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  /** Offsets of each argument of the call whose `(` closes just before `from`. */
  function argStarts(src: string, from: number): number[] {
    const starts = [from];
    let i = from;
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0 && c === ')') return starts;
        depth--;
      } else if (c === "'" || c === '"' || c === '`') {
        i = endOfLiteral(src, i);
      } else if (c === ',' && depth === 0) {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        starts.push(j);
      }
      i++;
    }
    return starts;
  }

  /** Index of the closing quote of the literal that starts at `at`. */
  function endOfLiteral(src: string, at: number): number {
    const quote = src[at];
    let i = at + 1;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === quote) return i;
      if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
        let depth = 1;
        i += 2;
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          else if (src[i] === "'" || src[i] === '"' || src[i] === '`') i = endOfLiteral(src, i);
          if (depth > 0) i++;
        }
        continue;
      }
      i++;
    }
    return i;
  }

  /** Source literal → the template makeResult would store. */
  function normalize(literal: string): string {
    const body = literal.slice(1, -1);
    if (literal[0] !== '`') return body.replace(/\\'/g, "'").replace(/\\"/g, '"');
    let out = '';
    let i = 0;
    let n = 0;
    while (i < body.length) {
      if (body[i] === '\\') { out += body[i + 1]; i += 2; continue; }
      if (body[i] === '$' && body[i + 1] === '{') {
        let depth = 1;
        i += 2;
        while (i < body.length && depth > 0) {
          if (body[i] === '{') depth++;
          else if (body[i] === '}') depth--;
          if (depth > 0) i++;
        }
        i++;
        out += `{${n++}}`;
        continue;
      }
      out += body[i++];
    }
    return out;
  }

  for (const file of fs.readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(CHECKS_DIR, file), 'utf8');
    const NEEDLE = 'makeResult(';
    for (let k = src.indexOf(NEEDLE); k !== -1; k = src.indexOf(NEEDLE, k + 1)) {
      const starts = argStarts(src, k + NEEDLE.length);
      if (starts.length < 3) continue;
      let at = starts[2];
      if (src[at] === 't' && src[at + 1] === '`') at += 1; // skip the tag
      const ch = src[at];
      if (ch !== '`' && ch !== "'" && ch !== '"') continue; // built from a variable: English fallback
      const template = normalize(src.slice(at, endOfLiteral(src, at) + 1));
      found.set(template, [...(found.get(template) ?? []), file]);
    }
  }
  return found;
}

const slots = (s: string): string[] => (s.match(/\{\d+\}/g) ?? []).sort();

describe('catalogue de messages localises', () => {
  const templates = templatesInSource();

  it('couvre en francais chaque gabarit litteral des checks', () => {
    const missing = [...templates.keys()].filter((tpl) => !(tpl in CHECK_MESSAGES_FR));
    expect(missing, `gabarits sans traduction :\n${missing.join('\n')}`).toEqual([]);
  });

  it('ne garde aucune traduction orpheline', () => {
    const orphans = Object.keys(CHECK_MESSAGES_FR).filter((tpl) => !templates.has(tpl));
    expect(orphans, `traductions sans gabarit correspondant :\n${orphans.join('\n')}`).toEqual([]);
  });

  it('conserve exactement les memes emplacements {n} dans chaque traduction', () => {
    const mismatched = Object.entries(CHECK_MESSAGES_FR)
      .filter(([en, fr]) => slots(en).join() !== slots(fr).join())
      .map(([en]) => en);
    expect(mismatched, `emplacements divergents :\n${mismatched.join('\n')}`).toEqual([]);
  });
});

describe('localizeMessage', () => {
  const check = { id: 'demo', family: 'on-page', maxPoints: 4 } as const;

  it('laisse le texte anglais intact', () => {
    const r = makeResult(check, 'warn', t`missing ${'alt'}`);
    expect(r.message).toBe('missing alt');
    expect(localizeMessage(r, 'en')).toBe('missing alt');
  });

  it('refait la phrase en francais avec les memes valeurs', () => {
    const r = makeResult(check, 'fail', t`homepage returned ${503}`);
    expect(r.messageTemplate).toBe('homepage returned {0}');
    expect(r.messageParams).toEqual([503]);
    expect(localizeMessage(r, 'fr')).toBe('la page d’accueil a renvoyé 503');
  });

  it('traduit aussi une chaine simple, sans interpolation', () => {
    const r = makeResult(check, 'fail', 'no page reachable');
    expect(localizeMessage(r, 'fr')).toBe('aucune page accessible');
  });

  it('retombe sur l anglais quand le gabarit est inconnu', () => {
    const r: CheckResult = {
      ...makeResult(check, 'warn', 'a message no catalogue knows'),
    };
    expect(localizeMessage(r, 'fr')).toBe('a message no catalogue knows');
  });

  it('retombe sur l anglais quand le resultat ne porte pas de gabarit', () => {
    const r: CheckResult = { ...makeResult(check, 'warn', 'no page reachable'), messageTemplate: undefined };
    expect(localizeMessage(r, 'fr')).toBe('no page reachable');
  });
});
