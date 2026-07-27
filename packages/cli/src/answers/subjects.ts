import type { HTMLElement } from 'node-html-parser';
import type { FetchedResource } from '../types.js';
import { parsePage } from '../checks/dom.js';
import { extractJsonLd, flatten, typesOf, str } from '../checks/jsonld.js';

// ---------------------------------------------------------------------------
// What the site DECLARES about itself: the services it offers and the areas it
// serves. Nothing here is inferred from prose — a city named in a testimonial is
// not an area served, and a matrix that invents one column is never read twice.
//
// Design: docs/superpowers/specs/2026-07-27-matrice-de-reponses-design.md §5
// ---------------------------------------------------------------------------

/** Where a subject was found. Rendered per cell, so the reader knows what it rests on. */
export type SubjectSource = 'markup' | 'nav' | 'h1';

export interface Subject { id: string; label: string; source: SubjectSource }
export interface Zone {
  id: string;
  label: string;
  kind: 'area-served' | 'locality';
  /**
   * Other strings naming the same place. A postal code is an alias of its town, not an
   * area of its own: treating it as a zone generated "Plomberie à 35000 : quel prix ?" —
   * a question nobody asks, and one that prose naming the town can never satisfy, so it
   * came back missing on every site.
   */
  aliases: string[];
}

/** Hard caps from the spec: 12 x 6 x 6 intents is 432 cells, which is already a lot to read. */
export const MAX_SUBJECTS = 12;
export const MAX_ZONES = 6;

/**
 * Navigation labels that name a page, not a service. Bilingual, because a
 * French-only or English-only list would let half of them through as subjects and
 * generate questions like "Mentions légales à Rennes : quel prix ?".
 */
const NAV_CHROME = new Set([
  'accueil', 'home', 'contact', 'nous contacter', 'contactez-nous', 'a propos', 'à propos',
  'about', 'about us', 'qui sommes-nous', 'mentions legales', 'mentions légales', 'legal',
  'legal notice', 'cgv', 'cgu', 'politique de confidentialite', 'politique de confidentialité',
  'privacy', 'privacy policy', 'cookies', 'plan du site', 'sitemap', 'blog', 'actualites',
  'actualités', 'news', 'faq', 'connexion', 'login', 'panier', 'cart', 'recherche', 'search',
  'menu', 'retour', 'back', 'devis', 'quote',
]);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const key = (s: string) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function isServiceLabel(label: string): boolean {
  const k = key(label);
  if (k.length < 3 || k.length > 60) return false;
  return !NAV_CHROME.has(k);
}

/** Service names the markup declares, in the order schema.org nests them. */
function markupServices(nodes: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  const push = (v: unknown) => { const s = str(v); if (s) out.push(norm(s)); };

  for (const n of nodes) {
    const types = typesOf(n);
    if (types.includes('Service') || types.includes('Product')) push(n.name);

    for (const offer of [n.makesOffer, n.itemOffered].flatMap((v) => (Array.isArray(v) ? v : [v]))) {
      if (offer && typeof offer === 'object') push((offer as Record<string, unknown>).name);
    }

    const catalog = n.hasOfferCatalog as Record<string, unknown> | undefined;
    const items = catalog?.itemListElement;
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const offered = rec.itemOffered as Record<string, unknown> | undefined;
      push(offered?.name ?? rec.name);
    }
  }
  return out;
}

function navLabels(root: HTMLElement): string[] {
  const nav = root.querySelector('nav');
  if (!nav) return [];
  return nav.querySelectorAll('a').map((a) => norm(a.textContent));
}

function headings(root: HTMLElement): string[] {
  return root.querySelectorAll('h1').map((h) => norm(h.textContent));
}

/** Areas the markup declares. `areaServed` may be a string, a Place node, or a list of either. */
function markupZones(nodes: Record<string, unknown>[]): { zones: Zone[]; postal: string[] } {
  const zones: Zone[] = [];
  const postal: string[] = [];
  const add = (label: string | undefined, kind: Zone['kind']) => {
    const l = label ? norm(label) : '';
    if (l) zones.push({ id: key(l), label: l, kind, aliases: [] });
  };

  for (const n of nodes) {
    const served = Array.isArray(n.areaServed) ? n.areaServed : [n.areaServed];
    for (const a of served) {
      if (typeof a === 'string') add(a, 'area-served');
      else if (a && typeof a === 'object') add(str((a as Record<string, unknown>).name), 'area-served');
    }
    const address = n.address as Record<string, unknown> | undefined;
    if (address && typeof address === 'object') {
      add(str(address.addressLocality), 'locality');
      const code = str(address.postalCode);
      if (code) postal.push(norm(code));
    }
  }
  return { zones, postal };
}

function dedupe<T extends { id: string }>(items: T[], cap: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (!it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length === cap) break;
  }
  return out;
}

/**
 * The declared subjects and zones of a crawled sample.
 *
 * Markup wins over navigation, and navigation over an H1 — that order is also the
 * truncation order when a large site overflows the caps, so the strongest evidence
 * is never the part that gets dropped.
 */
export function extractSubjects(pages: FetchedResource[]): { subjects: Subject[]; zones: Zone[] } {
  const fromMarkup: Subject[] = [];
  const fromNav: Subject[] = [];
  const fromH1: Subject[] = [];
  const zones: Zone[] = [];
  const postal: string[] = [];

  for (const p of pages) {
    const nodes = flatten(extractJsonLd(p.body));
    const root = parsePage(p);

    for (const label of markupServices(nodes)) {
      if (isServiceLabel(label)) fromMarkup.push({ id: key(label), label, source: 'markup' });
    }
    for (const label of navLabels(root)) {
      if (isServiceLabel(label)) fromNav.push({ id: key(label), label, source: 'nav' });
    }
    for (const label of headings(root)) {
      if (isServiceLabel(label)) fromH1.push({ id: key(label), label, source: 'h1' });
    }
    const z = markupZones(nodes);
    zones.push(...z.zones);
    postal.push(...z.postal);
  }

  // Postal codes ride along on the town they belong to: a passage that writes "35000"
  // instead of "Rennes" still answers a question about Rennes.
  const deduped = dedupe(zones, MAX_ZONES);
  for (const code of postal) {
    const target = deduped.find((z) => z.kind === 'locality') ?? deduped[0];
    if (target && !target.aliases.includes(code)) target.aliases.push(code);
  }

  return {
    subjects: dedupe([...fromMarkup, ...fromNav, ...fromH1], MAX_SUBJECTS),
    zones: deduped,
  };
}
