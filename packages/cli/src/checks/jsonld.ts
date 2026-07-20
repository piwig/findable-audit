import { parse } from 'node-html-parser';
import type { FetchedResource } from '../types.js';

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface JsonLdBlock {
  raw: string;
  parsed?: unknown;
  /** Set (and `parsed` absent) when JSON.parse failed on this block. */
  parseError?: string;
}

/** Every `application/ld+json` <script> block on the page, parsed or carrying a parseError. */
export function extractJsonLdBlocks(html: string): JsonLdBlock[] {
  const out: JsonLdBlock[] = [];
  for (const node of parse(html).querySelectorAll('script[type="application/ld+json"]')) {
    const raw = node.textContent;
    try {
      out.push({ raw, parsed: JSON.parse(raw) });
    } catch (err) {
      out.push({ raw, parseError: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** Parsed JSON-LD blocks only; blocks that failed to parse are silently dropped (v0.1 behavior). */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const b of extractJsonLdBlocks(html)) {
    if (b.parseError === undefined) out.push(b.parsed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// @type / @graph walking
// ---------------------------------------------------------------------------

/** `@type` values of an entity as a string array (handles both string and array forms). */
export function typesOf(entity: Record<string, unknown>): string[] {
  const t = entity['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Flattens parsed JSON-LD blocks (top-level arrays and `@graph` wrappers) into a flat node list. */
export function flatten(blocks: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const b of blocks) {
    if (Array.isArray(b)) out.push(...(b as Record<string, unknown>[]));
    else if (b && typeof b === 'object') {
      const o = b as Record<string, unknown>;
      out.push(o);
      if (Array.isArray(o['@graph'])) out.push(...(o['@graph'] as Record<string, unknown>[]));
    }
  }
  return out;
}

/** Map `@type` -> nodes, across every sampled page's JSON-LD (spec §6 Batch 3). */
export function indexByType(pages: FetchedResource[]): Map<string, Record<string, unknown>[]> {
  const index = new Map<string, Record<string, unknown>[]>();
  for (const page of pages) {
    for (const node of flatten(extractJsonLd(page.body))) {
      for (const t of typesOf(node)) {
        const list = index.get(t) ?? [];
        list.push(node);
        index.set(t, list);
      }
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// @id resolution
// ---------------------------------------------------------------------------

/** true when `value` is a single-key `{"@id": "..."}` reference object. */
export function isRef(value: unknown): value is { '@id': string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length === 1 && keys[0] === '@id' && typeof (value as Record<string, unknown>)['@id'] === 'string';
}

/** Map of every node's own declared `@id` -> the node, across a flattened node list. */
export function byId(nodes: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const n of nodes) {
    const id = n['@id'];
    if (typeof id === 'string' && id) map.set(id, n);
  }
  return map;
}

/**
 * Resolves a JSON-LD property value: a bare `{"@id":...}` reference is replaced by its
 * target node (or left as-is when unresolved). Arrays are resolved element-wise.
 */
export function resolveValue(value: unknown, ids: Map<string, Record<string, unknown>>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ids));
  if (isRef(value)) return ids.get(value['@id']) ?? value;
  return value;
}

// ---------------------------------------------------------------------------
// NAP / phone normalizers
// ---------------------------------------------------------------------------

/** Digits-and-leading-plus normal form of a phone number, for cross-page/JSON-LD comparison. */
export function normalizePhone(phone: string): string {
  const cleaned = phone.trim().replace(/[^\d+]/g, '');
  return cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
}

/** A flattened, lower-cased, comparable string for a (possibly structured) postal address. */
export function addressString(address: unknown): string {
  if (typeof address === 'string') return address.trim().toLowerCase().replace(/\s+/g, ' ');
  if (address && typeof address === 'object') {
    const a = address as Record<string, unknown>;
    return ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry']
      .map((k) => (typeof a[k] === 'string' ? (a[k] as string).trim() : ''))
      .filter(Boolean)
      .join(', ')
      .toLowerCase();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Shared type sets
// ---------------------------------------------------------------------------

/** schema.org types for which NAP (name/address/phone) markup is expected. */
export const NAP_REQUIRED_TYPES = new Set([
  'LocalBusiness', 'OnlineBusiness', 'Store', 'Restaurant', 'Bakery', 'Cafe', 'CafeOrCoffeeShop',
]);

const ORGANIZATION_TYPE_HINTS = new Set([
  'Organization', 'Corporation', 'NGO', 'GovernmentOrganization', 'EducationalOrganization', 'OnlineBusiness',
  'LocalBusiness', 'Store', 'Restaurant', 'Bakery', 'Cafe', 'CafeOrCoffeeShop', 'Hotel', 'LodgingBusiness',
  'MedicalBusiness', 'ProfessionalService', 'FinancialService', 'HomeAndConstructionBusiness', 'FoodEstablishment',
]);

/** true for Organization and the common LocalBusiness-hierarchy subtypes. */
export function isOrganizationType(t: string): boolean {
  return ORGANIZATION_TYPE_HINTS.has(t) || t.endsWith('Business') || t.endsWith('Store');
}

// ---------------------------------------------------------------------------
// Severity rollup for MP checks with per-item pass/warn/fail nuance
// ---------------------------------------------------------------------------

export interface SeverityItem {
  path: string;
  status: 'pass' | 'warn' | 'fail';
  reason?: string;
}

export interface SeverityRollup {
  status: 'pass' | 'warn' | 'fail';
  /** Up to 3 offenders (with reason when given), then "(+N more)". Empty string on pass. */
  detail: string;
}

/**
 * Rolls up per-page severity into one status: pass when every item passes; fail when
 * any item is critically 'fail'; warn otherwise. Mirrors aggregate()'s offender-list
 * formatting (spec §7) while honoring per-check pass/warn/fail item semantics (§3.3).
 */
export function rollupBySeverity(items: SeverityItem[]): SeverityRollup {
  const offenders = items.filter((i) => i.status !== 'pass');
  if (offenders.length === 0) return { status: 'pass', detail: '' };
  const shown = offenders.slice(0, 3).map((o) => (o.reason ? `${o.path} (${o.reason})` : o.path)).join(', ');
  const more = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
  const status = offenders.some((o) => o.status === 'fail') ? 'fail' : 'warn';
  return { status, detail: `${shown}${more}` };
}

/** Trimmed string value, or '' when not a string. */
export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
