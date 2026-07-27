import { describe, it, expect } from 'vitest';
import type { FetchedResource } from '../../src/types.js';
import { extractSubjects, MAX_SUBJECTS, MAX_ZONES } from '../../src/answers/subjects.js';

function page(body: string, pathname = '/'): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: `https://stub.example${pathname}`, headers: {},
  };
}

const ld = (json: unknown, extra = '') =>
  `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body>${extra}</body></html>`;

describe('extractSubjects — services', () => {
  it('prefers what the markup declares over what the navigation says', () => {
    const body = ld(
      { '@type': 'LocalBusiness', name: 'Acme', hasOfferCatalog: { '@type': 'OfferCatalog', itemListElement: [{ '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Dépannage plomberie' } }] } },
      '<nav><a href="/x">Autre chose</a></nav>',
    );
    const { subjects } = extractSubjects([page(body)]);
    expect(subjects.map((s) => s.label)).toContain('Dépannage plomberie');
    expect(subjects.find((s) => s.label === 'Dépannage plomberie')?.source).toBe('markup');
  });

  it('falls back to navigation labels and H1 when nothing is declared in JSON-LD', () => {
    const body = '<html><body><nav><a href="/plomberie">Plomberie</a><a href="/chauffage">Chauffage</a></nav><h1>Rénovation de salle de bain</h1></body></html>';
    const { subjects } = extractSubjects([page(body)]);
    const labels = subjects.map((s) => s.label);
    expect(labels).toContain('Plomberie');
    expect(labels).toContain('Rénovation de salle de bain');
    expect(subjects.find((s) => s.label === 'Plomberie')?.source).toBe('nav');
  });

  it('drops navigation chrome that names no service', () => {
    const body = '<html><body><nav><a href="/">Accueil</a><a href="/contact">Contact</a><a href="/mentions-legales">Mentions légales</a><a href="/plomberie">Plomberie</a></nav></body></html>';
    const { subjects } = extractSubjects([page(body)]);
    expect(subjects.map((s) => s.label)).toEqual(['Plomberie']);
  });

  it('returns nothing at all when the site declares nothing', () => {
    const { subjects, zones } = extractSubjects([page('<html><body><p>Bienvenue.</p></body></html>')]);
    expect(subjects).toEqual([]);
    expect(zones).toEqual([]);
  });
});

describe('extractSubjects — zones', () => {
  it('reads areaServed, locality and postal code from the markup', () => {
    const body = ld({
      '@type': 'LocalBusiness',
      areaServed: [{ '@type': 'City', name: 'Rennes' }, 'Ille-et-Vilaine'],
      address: { '@type': 'PostalAddress', addressLocality: 'Orgères', postalCode: '35230' },
    });
    // Compared in NFC: an accented literal can be composed or decomposed depending on how
    // the file was edited, and a byte-equality assertion on "Orgères" fails for a reason
    // that has nothing to do with the code under test.
    const nfc = (s: string) => s.normalize('NFC');
    const { zones } = extractSubjects([page(body)]);
    expect(zones.map((z) => nfc(z.label))).toEqual(expect.arrayContaining(['Rennes', 'Ille-et-Vilaine', 'Orgères'].map(nfc)));
    expect(zones.find((z) => nfc(z.label) === nfc('Orgères'))?.kind).toBe('locality');
  });

  // A postal code is another name for a town, not a place of its own. Making it a zone
  // generated "Plomberie à 35230 : quel prix ?" — a question nobody asks and that prose
  // naming the town can never satisfy, so it came back missing on every real site.
  it('attaches the postal code to its town rather than inventing a zone for it', () => {
    const body = ld({ '@type': 'LocalBusiness', address: { '@type': 'PostalAddress', addressLocality: 'Orgères', postalCode: '35230' } });
    const { zones } = extractSubjects([page(body)]);
    expect(zones.map((z) => z.label)).toEqual(['Orgères']);
    expect(zones[0].aliases).toEqual(['35230']);
  });

  // A city named in a customer testimonial is not an area served. Guessing zones from
  // prose would poison a whole column of the matrix, and a matrix that lies once is
  // never read again.
  it('never invents a zone from prose', () => {
    const body = '<html><body><p>Nos clients de Nantes et de Brest nous recommandent.</p></body></html>';
    expect(extractSubjects([page(body)]).zones).toEqual([]);
  });
});

describe('extractSubjects — bounds', () => {
  it('caps subjects and zones so the matrix cannot blow up on a large site', () => {
    const services = Array.from({ length: 30 }, (_, i) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: `Service ${i}` } }));
    const areas = Array.from({ length: 20 }, (_, i) => ({ '@type': 'City', name: `Ville ${i}` }));
    const body = ld({ '@type': 'LocalBusiness', areaServed: areas, hasOfferCatalog: { '@type': 'OfferCatalog', itemListElement: services } });
    const { subjects, zones } = extractSubjects([page(body)]);
    expect(subjects.length).toBe(MAX_SUBJECTS);
    expect(zones.length).toBe(MAX_ZONES);
  });
});
