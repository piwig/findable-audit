import { describe, it, expect } from 'vitest';
import { approxTokens, type Chunk } from '../../src/checks/chunker.js';
import type { FetchedResource } from '../../src/types.js';
import { PREDICATES, type PredicateInput } from '../../src/answers/predicates.js';

function windowOf(text: string): Chunk {
  return { index: 1, headings: [], blocks: [text], text, tokens: approxTokens(text) };
}

function res(body: string): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: 'https://stub.example/', headers: {},
  };
}

function input(text: string, pageBody = ''): PredicateInput {
  return {
    chunk: windowOf(text),
    page: res(pageBody || `<html><body><main>${text}</main></body></html>`),
    pageText: text,
    subject: 'plomberie',
  };
}

const ld = (json: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body><main>x</main></body></html>`;

/**
 * A page that says "price" without stating an amount does not answer "what does it cost?".
 * Each predicate below looks for the evidence, never for the word — and every lexical one
 * is tested in French AND English, because assuming one language is the defect class that
 * has already reached production four times on this repository.
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
    const accepted = ['Callout fee is $89.', 'From £120 per job.', 'Tarif horaire : 65 EUR.', 'Hourly rate: USD 95.'];
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

describe('PREDICATES.hours', () => {
  it('recognises an opening range written in either language', () => {
    const accepted = [
      'Ouvert du lundi au vendredi, 8h - 18h.',
      'Horaires : 9h30 à 12h00 et 14h00 à 19h00.',
      'Open Monday to Friday, 8:00 - 18:00.',
    ];
    expect(accepted.filter((t) => !PREDICATES.hours(input(t)))).toEqual([]);
  });

  it('accepts openingHoursSpecification markup even when the prose says nothing', () => {
    const page = ld({ '@type': 'LocalBusiness', openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', opens: '08:00', closes: '18:00' }] });
    expect(PREDICATES.hours(input('Nous intervenons rapidement.', page))).toBe(true);
  });

  it('does not read a single clock time, or a price, as opening hours', () => {
    const rejected = ['Intervention en 2h chrono.', 'Forfait 49,90 €.', 'Nous sommes joignables.'];
    expect(rejected.filter((t) => PREDICATES.hours(input(t)))).toEqual([]);
  });
});

describe('PREDICATES.location', () => {
  it('finds the zone regardless of case and diacritics', () => {
    for (const [text, zone] of [
      ['Nous intervenons sur Orgères et alentours.', 'orgeres'],
      ['Dépannage à RENNES en moins d une heure.', 'Rennes'],
      ['Serving the whole of Ille-et-Vilaine.', 'ille-et-vilaine'],
    ] as const) {
      expect(PREDICATES.location({ ...input(text), zone })).toBe(true);
    }
  });

  it('is false when the zone is simply absent', () => {
    expect(PREDICATES.location({ ...input('Nous intervenons rapidement.'), zone: 'Rennes' })).toBe(false);
  });

  it('is false when the intent carries no zone at all', () => {
    expect(PREDICATES.location(input('Rennes'))).toBe(false);
  });
});

describe('PREDICATES.contact', () => {
  it('accepts a telephone or mail link anywhere on the page', () => {
    expect(PREDICATES.contact(input('x', '<html><body><a href="tel:+33123456789">Appelez</a></body></html>'))).toBe(true);
    expect(PREDICATES.contact(input('x', '<html><body><a href="mailto:a@b.fr">Écrire</a></body></html>'))).toBe(true);
  });

  it('accepts a form that can actually be submitted without JavaScript', () => {
    const page = '<html><body><form action="/contact" method="post"><input name="email"><button>Envoyer</button></form></body></html>';
    expect(PREDICATES.contact(input('x', page))).toBe(true);
  });

  it('rejects a page that only says the word contact', () => {
    expect(PREDICATES.contact(input('x', '<html><body><p>Contactez-nous vite !</p></body></html>'))).toBe(false);
  });
});

describe('PREDICATES.process', () => {
  it('accepts an ordered list of steps in the prose, in either language', () => {
    const accepted = [
      '1. Vous appelez. 2. Nous diagnostiquons. 3. Nous réparons.',
      'Étape 1 : le diagnostic. Étape 2 : le devis.',
      'Step 1: you call. Step 2: we quote.',
    ];
    expect(accepted.filter((t) => !PREDICATES.process(input(t)))).toEqual([]);
  });

  it('accepts HowTo markup even when the prose is not enumerated', () => {
    const page = ld({ '@type': 'HowTo', step: [{ '@type': 'HowToStep', name: 'Appeler' }] });
    expect(PREDICATES.process(input('Nous nous occupons de tout.', page))).toBe(true);
  });

  it('rejects prose that merely mentions a number', () => {
    expect(PREDICATES.process(input('Nous avons 3 agences en Bretagne.'))).toBe(false);
  });
});

describe('PREDICATES.identity', () => {
  it('accepts an entity anchored by sameAs', () => {
    const page = ld({ '@type': 'Organization', name: 'Acme', sameAs: ['https://fr.wikipedia.org/wiki/Acme'] });
    expect(PREDICATES.identity(input('x', page))).toBe(true);
  });

  it('accepts a named Person or a declared author', () => {
    expect(PREDICATES.identity(input('x', ld({ '@type': 'Person', name: 'Jeanne Martin' })))).toBe(true);
    expect(PREDICATES.identity(input('x', ld({ '@type': 'Article', author: { '@type': 'Person', name: 'Jeanne Martin' } })))).toBe(true);
  });

  it('rejects a page whose markup names no one', () => {
    expect(PREDICATES.identity(input('x', ld({ '@type': 'WebPage', name: 'Accueil' })))).toBe(false);
  });
});
