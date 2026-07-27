import { describe, it, expect } from 'vitest';
import { approxTokens, type Chunk } from '../../src/checks/chunker.js';
import { PREDICATES, type PredicateInput } from '../../src/answers/predicates.js';

function windowOf(text: string): Chunk {
  return { index: 1, headings: [], blocks: [text], text, tokens: approxTokens(text) };
}

function input(text: string): PredicateInput {
  return { chunk: windowOf(text), pageText: text, subject: 'plomberie' };
}

/**
 * A page that says "price" without ever stating an amount does not answer "what does it
 * cost?". The predicate therefore looks for the amount, never for the word — and it has to
 * do so in both typographic conventions, because a French page writes "49,90 €" where an
 * English one writes "$49.90". Assuming one convention is the defect class that has already
 * reached production three times on this repository.
 */
describe('PREDICATES.price', () => {
  it('recognises a euro amount in both typographic conventions', () => {
    const accepted = [
      'Dépannage à partir de 49 €.',
      'Forfait : 49,90 € TTC.',
      'Flat fee of €49.90 per visit.',
      'Remplacement complet : 1 200 € en moyenne.',
    ];
    expect(accepted.filter((t) => !PREDICATES.price(input(t)))).toEqual([]);
  });

  it('recognises the other common currencies, by symbol or by code', () => {
    const accepted = [
      'Callout fee is $89.',
      'From £120 per job.',
      'Tarif horaire : 65 EUR.',
      'Hourly rate: USD 95.',
    ];
    expect(accepted.filter((t) => !PREDICATES.price(input(t)))).toEqual([]);
  });

  it('does not mistake a bare number for a price', () => {
    const rejected = [
      'Nous avons réalisé 49 interventions le mois dernier.',
      'Artisan plombier depuis 2019.',
      'Appelez le 01 23 45 67 89.',
      'Nos tarifs sont étudiés au cas par cas.',
    ];
    expect(rejected.filter((t) => PREDICATES.price(input(t)))).toEqual([]);
  });
});
