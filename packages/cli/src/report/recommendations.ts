import type { CheckResult, Evidence, Family } from '../types.js';
import type { AuditReport } from '../runner.js';
import { FAMILY_WEIGHTS } from '../scoring.js';
import { effortOf, type Effort } from './effort.js';
import { checkFix } from './check-i18n.js';
import { localizeMessage } from './message-i18n.js';
import type { Lang } from './i18n.js';

export type ActionKind = 'fix' | 'review' | 'conditional';
export const ACTION_KINDS: ActionKind[] = ['fix', 'review', 'conditional'];

export interface Recommendation {
  id: string;
  family: Family;
  status: 'fail' | 'warn';
  fix: string;
  docUrl?: string;
  /** Check points, not a projected change in the overall score. */
  impact: number;
  /** Legacy value retained for callers; never used as a priority or score projection. */
  weighted: number;
  effort: Effort;
  offenders: string[];
  kind: ActionKind;
  evidence: Evidence | 'unknown';
  finding: string;
  source: CheckResult;
}

type Corpus = Pick<AuditReport, 'url' | 'sampledPages'>;
const OPTIONAL = new Set([
  'sd-entity-grounding', 'sd-organization', 'rsl-license', 'llms-txt', 'llms-full-txt',
  'llms-txt-lint', 'well-known-ai-json', 'agent-standards-signals',
]);
const KIND_ORDER: Record<ActionKind, number> = { fix: 0, review: 1, conditional: 2 };
const EFFORT_ORDER: Record<Effort, number> = { quick: 0, moderate: 1, involved: 2 };

function kindOf(r: CheckResult): ActionKind {
  const message = r.messageTemplate ?? r.message;
  if (r.id === 'sd-website-searchaction') {
    return message === 'SearchAction present but incomplete (target/query-input)' ? 'fix' : 'conditional';
  }
  if (r.id === 'sd-speakable') {
    return message === 'SpeakableSpecification present without cssSelector or xpath' ? 'fix' : 'conditional';
  }
  if (OPTIONAL.has(r.id)) return 'conditional';
  if (r.id === 'sameas-verified') return 'review';
  return r.evidence === 'measured' && r.status === 'fail' ? 'fix' : 'review';
}

/** Exact corpus membership only. Old reports without a corpus do not invent locations. */
export function offendersOf(message: string, corpus?: Corpus): string[] {
  if (!corpus) return [];
  let base: URL;
  try { base = new URL(corpus.url); } catch { return []; }
  const known = new Map<string, string>();
  for (const page of corpus.sampledPages ?? []) {
    try {
      const url = new URL(page, base);
      if (url.origin === base.origin) known.set(url.pathname + url.search, page);
    } catch { /* An invalid legacy sample entry is not evidence. */ }
  }
  const tokens = message.replace(/<[^>]*>/g, ' ').match(/https?:\/\/[^\s<>"'`]+|(?<![\p{L}\p{N}_./:-])\/[^\s<>"'`]*/gu) ?? [];
  const found = new Set<string>();
  for (const token of tokens) {
    try {
      const url = new URL(token.replace(/[.,;:)\]}]+$/, ''), base);
      if (url.origin !== base.origin) continue;
      const page = known.get(url.pathname + url.search);
      if (page !== undefined) found.add(page);
    } catch { /* Ignore text that is not a URL. */ }
    if (found.size >= 6) break;
  }
  return [...found];
}

function compareActions(a: Recommendation, b: Recommendation): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1)
    || EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]
    || a.id.localeCompare(b.id, 'en');
}

/** A single ordering shared by full reports and summaries; scoring remains untouched. */
export function collectRecommendations(input: CheckResult[] | Pick<AuditReport, 'results' | 'url' | 'sampledPages'>): Recommendation[] {
  const results = Array.isArray(input) ? input : input.results;
  const corpus = Array.isArray(input) ? undefined : input;
  return results
    .filter((r): r is CheckResult & { fix: string } => !!r.fix && (r.status === 'fail' || r.status === 'warn'))
    .map((r): Recommendation => ({
      id: r.id, family: r.family, status: r.status as 'fail' | 'warn', fix: r.fix,
      docUrl: r.docUrl, impact: r.maxPoints - r.points,
      weighted: (r.maxPoints - r.points) * FAMILY_WEIGHTS[r.family],
      effort: effortOf(r.id, r.family), offenders: offendersOf(r.message, corpus),
      kind: kindOf(r), evidence: r.evidence ?? 'unknown', finding: r.message, source: r,
    }))
    .sort(compareActions);
}

export function topFixes(recs: Recommendation[], n = 5): Recommendation[] {
  return recs.filter((r) => r.kind !== 'conditional').sort(compareActions).slice(0, n);
}

export function recommendationFinding(r: Recommendation, lang: Lang): string {
  return localizeMessage(r.source, lang);
}

/** Conditions belong to the action, including when old check copy is more prescriptive. */
export function recommendationAdvice(r: Recommendation, lang: Lang): string {
  const fr = lang === 'fr';
  if (r.id === 'sd-website-searchaction') return r.kind === 'fix'
    ? (fr ? 'Corrigez la SearchAction déclarée : sa cible doit correspondre à une recherche interne existante, avec urlTemplate et query-input cohérents.'
      : 'Correct the declared SearchAction: its target must match an existing internal search, with consistent urlTemplate and query-input.')
    : (fr ? 'Seulement si le site propose une recherche interne réelle : envisagez une SearchAction fidèle à ce service. La searchbox Google a été retirée ; son absence ne constitue pas une correction obligatoire ni un levier de classement.'
      : 'Only if the site offers a real internal search: consider a SearchAction that describes it accurately. Google retired its searchbox; absence is neither a required fix nor a ranking lever.');
  if (r.id === 'sd-speakable') return r.kind === 'fix'
    ? (fr ? 'Vérifiez la déclaration Speakable existante. Si vous la conservez, ses cssSelector ou xpath doivent désigner les passages réels concernés.'
      : 'Check the existing Speakable declaration. If retained, its cssSelector or xpath must identify the actual relevant passages.')
    : (fr ? 'À envisager uniquement pour un usage compatible : la fonctionnalité Google documentée concerne les actualités vocales en anglais aux États-Unis. Une absence seule ne justifie pas une modification.'
      : 'Consider only for a supported use: the documented Google feature concerns English news voice answers in the United States. Absence alone does not justify a change.');
  if (r.id === 'sd-entity-grounding' || r.id === 'sd-organization') return fr
    ? 'Renseignez uniquement les faits et profils officiels existants qui identifient réellement votre organisation. Google ne rend aucune propriété Organization obligatoire ; ne créez ni profil ni lien Wikidata pour remplir un quota.'
    : 'Describe only existing facts and official profiles that truly identify your organization. Google makes no Organization property mandatory; do not create profiles or Wikidata links to fill a quota.';
  if (r.id === 'sameas-verified') return fr
    ? 'Vérifiez manuellement que chaque profil représente bien la même organisation et, si disponible, son lien de retour. Un refus du robot ne prouve pas une fausse identité.'
    : 'Manually check that each profile represents the same organization and, where available, its return link. A crawler refusal does not prove a false identity.';
  if (r.id === 'rsl-license') return fr
    ? 'Facultatif : uniquement si vous souhaitez publier des conditions de licence pour des robots compatibles, après validation de leur portée. RSL ne garantit ni leur application ni une visibilité accrue.'
    : 'Optional: only if you wish to publish licensing terms for compatible crawlers, after validating their scope. RSL guarantees neither enforcement nor increased visibility.';
  if (r.id.startsWith('llms-')) return fr
    ? 'Facultatif : publiez ou entretenez ce fichier seulement pour un usage identifié. Google ne demande aucun fichier llms.txt spécial pour ses fonctions IA ; aucun gain de citation ou de classement n’est établi.'
    : 'Optional: publish or maintain this file only for an identified use. Google requires no special llms.txt file for its AI features; no citation or ranking gain is established.';
  if (r.kind === 'conditional') return fr
    ? 'Facultatif : vérifiez d’abord qu’un outil que vous utilisez prend en charge ce signal et que sa publication correspond à votre besoin. Aucun gain de visibilité n’est garanti.'
    : 'Optional: first check that a tool you use supports this signal and that publishing it meets your needs. No visibility gain is guaranteed.';
  const fix = checkFix(r.id, lang, r.fix) ?? r.fix;
  return r.kind === 'review' ? (fr ? 'Vérifiez la pertinence avant de modifier le site. ' : 'Check relevance before changing the site. ') + fix : fix;
}
