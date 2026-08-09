// Layer 1 of the report redesign: the eight scoring families regrouped into
// three axes a reader understands without a glossary, plus the natural-language
// verdict sentence and the exact score projection used by the action plan.
//
// The eight families remain the scoring model — nothing here feeds `computeScore`.
// This module only decides what is shown FIRST.

import type { CheckResult, Family } from '../types.js';
import type { FamilyScore } from '../scoring.js';
import type { Lang } from './i18n.js';
import type { Recommendation } from './recommendations.js';

export type AxisKey = 'reachable' | 'understood' | 'usable';

/** Which families roll up into each axis. Every family belongs to exactly one. */
export const AXIS_FAMILIES: Record<AxisKey, Family[]> = {
  reachable: ['ai-access', 'technical-seo'],
  understood: ['llm-content', 'structured-data', 'on-page'],
  usable: ['performance', 'accessibility', 'security'],
};

export const AXIS_ORDER: AxisKey[] = ['reachable', 'understood', 'usable'];

export interface AxisScore {
  key: AxisKey;
  /** Weighted subscore 0-100 over the axis' included families, or null if all skipped. */
  score: number | null;
  /** Families that actually contributed (a family with only skips is absent). */
  families: Family[];
}

/**
 * Axis score = the same weighted blend the overall score uses, restricted to the
 * axis' families and renormalized over them. An axis whose families were all
 * skipped scores null rather than 0 — "not applicable" is not "failing".
 */
export function axisScores(familyScores: FamilyScore[]): AxisScore[] {
  const byFamily = new Map(familyScores.map((fs) => [fs.family, fs]));
  return AXIS_ORDER.map((key) => {
    const present = AXIS_FAMILIES[key].filter((f) => byFamily.has(f));
    if (present.length === 0) return { key, score: null, families: [] };
    let weighted = 0;
    let total = 0;
    for (const family of present) {
      const fs = byFamily.get(family)!;
      weighted += fs.weight * (fs.earned / fs.max);
      total += fs.weight;
    }
    return { key, score: Math.round((100 * weighted) / total), families: present };
  });
}

// ---------------------------------------------------------------------------
// A37 — the trust/authority reading lens (E-E-A-T).
//
// Not a fourth axis: the three axes above partition the eight families exactly,
// and this deliberately does not touch that. It is a cross-family lens over
// checks the audit already runs — identifiable author, date freshness, verified
// sameAs profiles, outbound citations — regrouped so a reader sees "how much
// would an assistant trust this source" in one number. Nothing here feeds
// `computeScore` either; like the axes, it only decides what is SHOWN.

/** The already-measured checks that carry trust/authority signals. */
export const TRUST_CHECK_IDS: readonly string[] = [
  'content-author-eeat',   // llm-content: identifiable author / byline
  'content-freshness',     // llm-content: dates present and recent
  'freshness-coherence',   // llm-content: claimed vs served dates agree
  'sameas-verified',       // structured-data: sameAs profiles that resolve
  'outbound-citations',    // llm-content: the page cites its sources
];

export interface TrustLens {
  /** 0-100 over the trust checks that ran, or null when none of them did. */
  score: number | null;
  /** Trust checks that actually contributed (skips are absent). */
  ids: string[];
}

/**
 * Points-weighted ratio over the trust checks that ran, same arithmetic family
 * scores use. All-skipped scores null rather than 0 — "not measured" is not
 * "untrustworthy".
 */
export function trustLens(results: CheckResult[]): TrustLens {
  const ran = results.filter((r) => TRUST_CHECK_IDS.includes(r.id) && r.status !== 'skip');
  let earned = 0;
  let max = 0;
  for (const r of ran) {
    earned += r.points;
    max += r.maxPoints;
  }
  if (max === 0) return { score: null, ids: [] };
  return { score: Math.round((100 * earned) / max), ids: ran.map((r) => r.id) };
}

/**
 * Exact overall score if every recommendation in `recs` were fixed in full —
 * same formula as `computeScore`, with each fix adding its recoverable points
 * to its family's earned total. Used for the action plan's "these 6 quick wins:
 * 76 → 88 (B)" projection, so the number has to be the real one, not a guess.
 */
export function projectScore(familyScores: FamilyScore[], recs: Recommendation[]): number {
  const gain = new Map<Family, number>();
  for (const r of recs) gain.set(r.family, (gain.get(r.family) ?? 0) + r.impact);
  let weighted = 0;
  let total = 0;
  for (const fs of familyScores) {
    const earned = Math.min(fs.max, fs.earned + (gain.get(fs.family) ?? 0));
    weighted += fs.weight * (earned / fs.max);
    total += fs.weight;
  }
  return total === 0 ? 0 : Math.round((100 * weighted) / total);
}

/**
 * The verdict sentence. Deterministic, like every other number in the report:
 * a fixed rule ladder over the axis scores, never a generated paraphrase.
 *
 * Order matters. A blocked citation-time crawler outranks everything else,
 * because no other finding changes anything while an assistant cannot fetch
 * the page at all.
 */
export function verdictSentence(
  axes: AxisScore[],
  score: number,
  blockedFromCitation: boolean,
  lang: Lang,
): string {
  if (blockedFromCitation) return VERDICT_TEXT[lang].blocked;
  const scored = axes.filter((a): a is AxisScore & { score: number } => a.score !== null);
  if (scored.length === 0) return VERDICT_TEXT[lang].nothingMeasured;
  if (score >= 90) return VERDICT_TEXT[lang].excellent;
  const weakest = scored.reduce((a, b) => (b.score < a.score ? b : a));
  const band = weakest.score < 60 ? 'weak' : 'mid';
  return VERDICT_TEXT[lang][weakest.key][band];
}

type Band = 'weak' | 'mid';

const VERDICT_TEXT: Record<Lang, {
  blocked: string;
  nothingMeasured: string;
  excellent: string;
} & Record<AxisKey, Record<Band, string>>> = {
  en: {
    blocked:
      'An assistant that tries to read you is turned away at the door: robots.txt blocks a crawler that fetches pages at citation time. Until that is lifted, nothing else on this page can help.',
    nothingMeasured: 'Nothing measurable was returned for this site.',
    excellent:
      'Crawlers reach your pages, understand what they read, and the page holds up on its own — nothing structural stands in the way of being cited.',
    reachable: {
      weak: 'Crawlers struggle to reach your pages at all: access rules and technical SEO are the bottleneck. Start there — every other finding assumes the page can be fetched.',
      mid: 'Crawlers get in, but not everywhere: a few access and technical-SEO signals still send them down the wrong path.',
    },
    understood: {
      weak: 'Search engines read your site, but an AI assistant finds neither a structured identity nor an orientation file: it can describe you, it cannot cite you.',
      mid: 'Your pages are readable, but the facts an assistant would quote are not stated plainly enough to be lifted as they are.',
    },
    usable: {
      weak: 'The content is there and it is understandable — the page itself is what holds it back: speed, accessibility or security signals fall short, for humans and agents alike.',
      mid: 'Nothing blocks a crawler; a handful of speed, accessibility and security signals still cost you points.',
    },
  },
  fr: {
    blocked:
      'Un assistant qui essaie de vous lire est refusé à la porte : le robots.txt bloque un robot qui va chercher les pages au moment de citer. Tant que ce point n’est pas levé, rien d’autre sur cette page ne peut aider.',
    nothingMeasured: 'Aucune mesure exploitable n’a été obtenue pour ce site.',
    excellent:
      'Les robots atteignent vos pages, comprennent ce qu’ils lisent, et la page tient la route toute seule — rien de structurel ne s’oppose à ce que vous soyez cité.',
    reachable: {
      weak: 'Les robots peinent simplement à atteindre vos pages : les règles d’accès et le SEO technique sont le goulot. Commencez par là — tout le reste suppose que la page puisse être récupérée.',
      mid: 'Les robots entrent, mais pas partout : quelques signaux d’accès et de SEO technique les envoient encore sur la mauvaise piste.',
    },
    understood: {
      weak: 'Les moteurs lisent votre site, mais un assistant IA n’y trouve ni fiche d’identité structurée ni fichier d’orientation : il peut vous décrire, pas vous citer.',
      mid: 'Vos pages sont lisibles, mais les faits qu’un assistant citerait n’y sont pas énoncés assez nettement pour être repris tels quels.',
    },
    usable: {
      weak: 'Le contenu est là et il est compréhensible — c’est la page elle-même qui freine : vitesse, accessibilité ou sécurité restent en dessous, pour les humains comme pour les agents.',
      mid: 'Rien ne bloque un robot ; une poignée de signaux de vitesse, d’accessibilité et de sécurité vous coûtent encore des points.',
    },
  },
};
