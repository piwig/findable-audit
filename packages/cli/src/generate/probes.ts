// A99 — suggested vigie-seo AI probes derived from the audit's weak families.
//
// Inverse of vigie-seo's V17 bridge (vigie alerts -> findable remediation):
// here a one-shot audit seeds the CONTINUOUS monitoring side. Each family
// scoring below the bar contributes one question a buyer might ask an
// assistant — built only from words the site itself uses (hostname, homepage
// title/h1), never fabricated prose — so vigie-seo can measure whether the
// models actually cite the site where the audit found it weakest.
//
// Output is a JSON block whose `aiProbes` array is paste-ready for
// vigie.config.json: vigie-seo's normalizeProject keeps `prompt`, `mode`
// ('rag' | 'memory'), `locale`, `active` and ignores the extra `reason` key,
// which exists for the human deciding what to keep.

import type { AuditReport } from '../runner.js';
import type { Lang } from '../report/i18n.js';
import type { Family } from '../types.js';

export const PROBES_SCHEMA = 'findable.probes-suggestion/1';

/** One suggested probe — a superset of a vigie.config.json aiProbes entry. */
export interface SuggestedProbe {
  prompt: string;
  mode: 'rag' | 'memory';
  locale: string;
  active: boolean;
  /** Why this probe exists (family + subscore). Ignored by vigie-seo. */
  reason: string;
}

export interface ProbesSuggestion {
  schema: typeof PROBES_SCHEMA;
  url: string;
  score: number;
  generatedAt?: string;
  /** Localized "review before use" warning — suggestions, not configuration. */
  note: string;
  aiProbes: SuggestedProbe[];
}

/** A family is probe-worthy below this subscore (mirrors the report's amber bar). */
const WEAK_BELOW = 80;

/** Hostname without a leading www. — the brand handle the probes mention. */
function brandOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * The site's own subject line: homepage title (or h1) with the brand suffix
 * cut at the last separator — "Acme — invoices for freelancers" gives
 * "Acme — invoices for freelancers" minus nothing when no separator, and the
 * FIRST segment otherwise, because titles put the subject before the brand.
 * Empty when the crawl captured neither: callers fall back to the brand.
 */
export function topicOf(report: AuditReport): string {
  const home = report.pageMeta?.find((p) => p.path === '/');
  const raw = (home?.title || home?.h1 || '').trim();
  if (!raw) return '';
  const first = raw.split(/\s*[|–—·:]\s*/)[0]?.trim() ?? '';
  return first.length >= 8 ? first : raw;
}

type Template = (topic: string, brand: string) => { prompt: string; mode: 'rag' | 'memory' };

// One angle per family, phrased as a real user question. `ai-access` probes
// model MEMORY (a site invisible to crawlers can only live in trained
// knowledge); every other family probes retrieval ('rag').
const TEMPLATES: Record<Lang, Partial<Record<Family, Template>>> = {
  en: {
    'ai-access': (_t, brand) => ({ prompt: `What do you know about ${brand}?`, mode: 'memory' }),
    'llm-content': (topic) => ({ prompt: `What are the best resources on ${topic}?`, mode: 'rag' }),
    'structured-data': (topic) => ({ prompt: `Who offers ${topic}?`, mode: 'rag' }),
    'technical-seo': (topic) => ({ prompt: `Which reliable sites cover ${topic}?`, mode: 'rag' }),
    'on-page': (topic) => ({ prompt: `Where can I find ${topic} online?`, mode: 'rag' }),
  },
  fr: {
    'ai-access': (_t, brand) => ({ prompt: `Que sais-tu de ${brand} ?`, mode: 'memory' }),
    'llm-content': (topic) => ({ prompt: `Quelles sont les meilleures ressources sur ${topic} ?`, mode: 'rag' }),
    'structured-data': (topic) => ({ prompt: `Qui propose ${topic} ?`, mode: 'rag' }),
    'technical-seo': (topic) => ({ prompt: `Quels sites fiables traitent de ${topic} ?`, mode: 'rag' }),
    'on-page': (topic) => ({ prompt: `Où trouver ${topic} en ligne ?`, mode: 'rag' }),
  },
};

/**
 * Build the suggestion block. Deterministic: same report + lang => same JSON
 * (no timestamp inside — the caller may add `generatedAt`). Families at or
 * above WEAK_BELOW contribute nothing; a spotless report yields an empty
 * `aiProbes` array rather than invented weaknesses.
 */
export function suggestProbes(report: AuditReport, lang: Lang): ProbesSuggestion {
  const brand = brandOf(report.url);
  const topic = topicOf(report) || brand;
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const templates = TEMPLATES[lang];

  const seen = new Set<string>();
  const aiProbes: SuggestedProbe[] = [];
  for (const fs of report.familyScores) {
    if (fs.score >= WEAK_BELOW) continue;
    const tpl = templates[fs.family];
    if (!tpl) continue; // performance/accessibility/security: no citation angle
    const { prompt, mode } = tpl(topic, brand);
    const key = `${prompt}|${mode}`;
    if (seen.has(key)) continue; // same topic can collapse two families into one question
    seen.add(key);
    aiProbes.push({
      prompt, mode, locale, active: true,
      reason: lang === 'fr'
        ? `famille « ${fs.family} » à ${fs.score}/100 dans l'audit findable`
        : `family "${fs.family}" scored ${fs.score}/100 in the findable audit`,
    });
  }

  return {
    schema: PROBES_SCHEMA,
    url: report.url,
    score: report.score,
    note: lang === 'fr'
      ? 'Suggestions générées par findable-audit — relire et adapter avant de coller dans aiProbes de vigie.config.json.'
      : 'Suggestions generated by findable-audit — review and adapt before pasting into aiProbes in vigie.config.json.',
    aiProbes,
  };
}

/** Serialize for --emit-probes: pretty JSON, trailing newline, POSIX-friendly. */
export function renderProbesJson(report: AuditReport, lang: Lang, generatedAt?: string): string {
  const block = suggestProbes(report, lang);
  if (generatedAt !== undefined) block.generatedAt = generatedAt;
  return JSON.stringify(block, null, 2) + '\n';
}
