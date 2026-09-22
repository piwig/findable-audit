/**
 * Client-supplied local-business context. This is deliberately an input file,
 * not a connector: an audit must not sign in to a client's Google account or
 * scrape a profile that the client did not provide.
 */
export const LOCAL_CONTEXT_SCHEMA = 'findable.local-context/1';

export interface LocalBusinessContext {
  name: string;
  address?: string;
  phone?: string;
  hours?: string;
  googleBusinessProfile?: string;
}

export interface LocalCompetitor {
  name: string;
  website?: string;
}

export interface LocalContext {
  schema: typeof LOCAL_CONTEXT_SCHEMA;
  business: LocalBusinessContext;
  services?: string[];
  areas?: string[];
  priorityQuestions?: string[];
  competitors?: LocalCompetitor[];
  /** ISO date supplied by the operator; it is never asserted by the audit. */
  verifiedAt?: string;
}

export class LocalContextError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LocalContextError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, label);
}

function textList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new LocalContextError(`${label} must be an array of strings`);
  if (value.length > 50) throw new LocalContextError(`${label} must contain at most 50 items`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = requiredText(item, `${label} item`);
    if (label === 'priorityQuestions' && text.length > 500) throw new LocalContextError('priorityQuestions items must contain at most 500 characters');
    const key = text.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

function optionalUrl(value: unknown, label: string): string | undefined {
  const text = optionalText(value, label);
  if (text === undefined) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme');
  } catch {
    throw new LocalContextError(`${label} must be an http(s) URL`);
  }
  return text;
}

/** Parse a small, explicit JSON file and reject unknown shapes before crawling. */
export function parseLocalContext(raw: string): LocalContext {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new LocalContextError('local context is not valid JSON');
  }
  const root = record(decoded);
  if (!root) throw new LocalContextError('local context must be a JSON object');
  if (root.schema !== LOCAL_CONTEXT_SCHEMA) {
    throw new LocalContextError(`local context schema must be "${LOCAL_CONTEXT_SCHEMA}"`);
  }
  const business = record(root.business);
  if (!business) throw new LocalContextError('business must be an object');

  const competitorsRaw = root.competitors;
  let competitors: LocalCompetitor[] | undefined;
  if (competitorsRaw !== undefined) {
    if (!Array.isArray(competitorsRaw)) throw new LocalContextError('competitors must be an array');
    if (competitorsRaw.length > 5) throw new LocalContextError('competitors must contain at most 5 items');
    competitors = competitorsRaw.map((item, i) => {
      const competitor = record(item);
      if (!competitor) throw new LocalContextError(`competitors item ${i + 1} must be an object`);
      return {
        name: requiredText(competitor.name, `competitors item ${i + 1}.name`),
        website: optionalUrl(competitor.website, `competitors item ${i + 1}.website`),
      };
    });
  }

  return {
    schema: LOCAL_CONTEXT_SCHEMA,
    business: {
      name: requiredText(business.name, 'business.name'),
      address: optionalText(business.address, 'business.address'),
      phone: optionalText(business.phone, 'business.phone'),
      hours: optionalText(business.hours, 'business.hours'),
      googleBusinessProfile: optionalUrl(business.googleBusinessProfile, 'business.googleBusinessProfile'),
    },
    services: textList(root.services, 'services'),
    areas: textList(root.areas, 'areas'),
    priorityQuestions: textList(root.priorityQuestions, 'priorityQuestions'),
    competitors,
    verifiedAt: optionalText(root.verifiedAt, 'verifiedAt'),
  };
}
