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
      'The robots.txt rules restrict at least one crawler used for AI search. Review the affected robot and paths against your publishing policy; this does not establish whether your site is cited elsewhere.',
    nothingMeasured: 'Nothing measurable was returned for this site.',
    excellent:
      'The sampled pages show strong results on the checks performed. This does not guarantee indexing, rankings or AI citations; review the remaining findings and the sample scope.',
    reachable: {
      weak: 'Access and technical SEO have the lowest results in this sample. Review the affected rules and pages first; the score alone does not establish that every crawler is blocked.',
      mid: 'Access or technical SEO checks need attention. Use the findings and page evidence to identify the remaining issues.',
    },
    understood: {
      weak: 'Content and metadata checks have low results in this sample. Review missing facts, markup and editorial advice separately; these checks do not measure whether an AI assistant understands or cites your site.',
      mid: 'Some content or metadata checks need review. Inspect the supporting passages before making changes; no AI citation outcome is measured.',
    },
    usable: {
      weak: 'Performance, accessibility or security has the lowest results in this sample. Review the specific findings; this automated audit is not a complete accessibility or security assessment.',
      mid: 'Some performance, accessibility or security checks need attention. The report identifies the measured issues and their scope.',
    },
  },
  fr: {
    blocked:
      'Le robots.txt restreint au moins un robot utilisé pour la recherche IA. Vérifiez le robot et les chemins concernés selon votre politique de publication ; cela ne prouve pas l’absence de citations de votre site ailleurs.',
    nothingMeasured: 'Aucune mesure exploitable n’a été obtenue pour ce site.',
    excellent:
      'Les pages échantillonnées obtiennent de bons résultats sur les contrôles réalisés. Cela ne garantit ni indexation, ni classement, ni citation IA ; examinez les constats restants et le périmètre de l’échantillon.',
    reachable: {
      weak: 'L’accès et le SEO technique obtiennent les résultats les plus faibles de cet échantillon. Examinez d’abord les règles et pages concernées ; la note seule ne prouve pas que tous les robots sont bloqués.',
      mid: 'Des contrôles d’accès ou de SEO technique demandent votre attention. Appuyez-vous sur les constats et les pages concernées pour identifier les points restants.',
    },
    understood: {
      weak: 'Les contrôles de contenu et de métadonnées obtiennent des résultats faibles dans cet échantillon. Distinguez faits manquants, balisage et conseils éditoriaux ; ces contrôles ne mesurent ni la compréhension ni les citations de votre site par une IA.',
      mid: 'Certains contrôles de contenu ou de métadonnées sont à revoir. Relisez les passages justificatifs avant toute modification ; aucune citation IA n’est mesurée.',
    },
    usable: {
      weak: 'La performance, l’accessibilité ou la sécurité obtient les résultats les plus faibles de cet échantillon. Examinez les constats précis ; cet audit automatique ne constitue pas une évaluation complète d’accessibilité ou de sécurité.',
      mid: 'Certains contrôles de performance, d’accessibilité ou de sécurité demandent votre attention. Le rapport précise les points mesurés et leur périmètre.',
    },
  },
};
