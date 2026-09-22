import type { AuditReport, SampleCoverage } from '../runner.js';
import type { PriorityAnswer } from './questions.js';
import type { Lang } from '../report/i18n.js';
import type { CheckResult } from '../types.js';
import { LOCAL_CONTEXT_SCHEMA, type LocalContext } from './context.js';

export const LOCAL_PLAN_SCHEMA = 'findable.local-plan/1';

export interface LocalPlanAction {
  id: string;
  priority: 'now' | 'next';
  lane: 'site' | 'profile' | 'content' | 'measurement';
  basis: 'audit finding' | 'provided context' | 'manual verification';
  title: string;
  detail: string;
}

export interface LocalPlan {
  schema: typeof LOCAL_PLAN_SCHEMA;
  language: Lang;
  audit: { url: string; score: number; grade: string; sampledPages: string[]; coverage?: SampleCoverage };
  questions?: PriorityAnswer[];
  questionDisclosure?: string;
  context: {
    schema: typeof LOCAL_CONTEXT_SCHEMA;
    businessName: string;
    hasAddress: boolean;
    hasPhone: boolean;
    hasHours: boolean;
    hasGoogleBusinessProfile: boolean;
    services: number;
    areas: number;
    priorityQuestions: number;
    competitorsWithWebsite: number;
    verifiedAt?: string;
  };
  disclosure: string;
  actions: LocalPlanAction[];
}

function finding(report: AuditReport, id: string): CheckResult | undefined {
  const result = report.results.find((item) => item.id === id);
  return result && result.status !== 'pass' && result.status !== 'skip' ? result : undefined;
}

function action(
  actions: LocalPlanAction[], id: string, priority: LocalPlanAction['priority'], lane: LocalPlanAction['lane'],
  basis: LocalPlanAction['basis'], title: string, detail: string,
): void {
  actions.push({ id, priority, lane, basis, title, detail });
}

function copy(lang: Lang) {
  return lang === 'fr'
    ? {
        disclosure: 'Ce plan croise un crawl technique avec des informations fournies localement. Findable ne se connecte pas à Google, Search Console, Semrush ni à un compte concurrent ; aucune ligne ne prouve une position, une visibilité ou le contenu actuel d’une fiche externe.',
        nap: 'Rendre l’identité locale cohérente',
        napDetail: 'Corriger les divergences signalées entre le site et ses données structurées, puis comparer manuellement nom, adresse et téléphone aux informations validées par le client.',
        localSchema: 'Compléter l’entité locale du site',
        localSchemaDetail: 'Le crawl signale des données LocalBusiness incomplètes. Publier seulement les coordonnées, horaires et géolocalisation réellement affichés et validés.',
        answers: 'Répondre aux questions locales prioritaires',
        answersDetail: 'Créer ou renforcer des réponses directes, sourcées et utiles aux clients — pas des pages répétées par commune. Vérifier ensuite leur couverture avec --answers.',
        services: 'Rapprocher services, site et fiche Google',
        servicesDetail: 'Vérifier manuellement que les services réellement proposés apparaissent avec la même formulation sur le site et, si le client en possède une, dans sa fiche Google. Les services et catégories doivent décrire l’activité réelle.',
        areas: 'Traiter les zones comme des besoins réels',
        areasDetail: 'Ne créer une page locale que si elle apporte une information, une preuve ou un parcours propre à cette zone. Sinon, expliquer la zone desservie sur les pages de service existantes.',
        profile: 'Contrôler la fiche Google avec son propriétaire',
        profileDetail: 'Depuis le compte que le client contrôle, vérifier catégorie principale, attributs disponibles, services, horaires et liens. Ce contrôle est humain : Findable ne lit ni ne modifie la fiche.',
        profileMissing: 'Prévoir le contrôle de la fiche Google',
        profileMissingDetail: 'Aucune URL de fiche Google n’a été fournie. Consigner son absence ou son URL validée avant de faire des recommandations sur catégories, attributs ou services.',
        competitors: 'Comparer les sites concurrents fournis',
        competitorsDetail: 'Exécuter --compare avec les URLs publiques validées, puis ne retenir que les écarts techniquement vérifiés. Une meilleure note ne prouve pas une meilleure position locale.',
        measure: 'Mesurer sans confondre les signaux',
        measureDetail: 'Utiliser un export Search Console détenu par le client pour prioriser les pages déjà visibles, puis comparer des audits Findable à périmètre identique. Classements, citations IA et conversions restent des mesures distinctes.',
      }
    : {
        disclosure: 'This plan combines a technical crawl with locally supplied information. Findable does not sign in to Google, Search Console, Semrush, or a competitor account; no line proves a ranking, visibility, or the current contents of an external profile.',
        nap: 'Make the local identity consistent',
        napDetail: 'Fix the divergences the audit found between the site and its structured data, then manually compare name, address and phone against client-validated information.',
        localSchema: 'Complete the site’s local entity',
        localSchemaDetail: 'The crawl found incomplete LocalBusiness data. Publish only contact details, hours and geo information that are visibly displayed and validated.',
        answers: 'Answer priority local questions',
        answersDetail: 'Create or strengthen direct, sourced, useful customer answers — not repeated city pages. Then check their coverage with --answers.',
        services: 'Align services, site and Google Profile',
        servicesDetail: 'Manually verify that services actually offered use the same wording on the site and, if the client owns one, on its Google Business Profile. Services and categories must describe the real business.',
        areas: 'Treat areas as real customer needs',
        areasDetail: 'Create a local page only when it adds zone-specific information, evidence or a journey. Otherwise explain the served area on existing service pages.',
        profile: 'Review the Google Business Profile with its owner',
        profileDetail: 'In the account the client controls, verify primary category, available attributes, services, hours and links. This is a human review: Findable neither reads nor changes the profile.',
        profileMissing: 'Plan the Google Business Profile review',
        profileMissingDetail: 'No Google Business Profile URL was supplied. Record either its absence or a client-validated URL before making recommendations about categories, attributes or services.',
        competitors: 'Compare supplied competitor sites',
        competitorsDetail: 'Run --compare with the validated public URLs, then retain only technically verified gaps. A higher score does not prove a better local ranking.',
        measure: 'Measure without mixing signals',
        measureDetail: 'Use a client-owned Search Console export to prioritize already-visible pages, then compare Findable audits with the same scope. Rankings, AI citations and conversions remain separate measures.',
      };
}

/** Build a deterministic plan; profile facts remain explicitly human-verified. */
export function buildLocalPlan(report: AuditReport, context: LocalContext, lang: Lang): LocalPlan {
  const t = copy(lang);
  const actions: LocalPlanAction[] = [];
  if (finding(report, 'nap-consistency')) action(actions, 'nap-consistency', 'now', 'site', 'audit finding', t.nap, t.napDetail);
  if (finding(report, 'sd-localbusiness') || finding(report, 'json-ld-entity')) {
    action(actions, 'localbusiness-data', 'now', 'site', 'audit finding', t.localSchema, t.localSchemaDetail);
  }
  if ((context.priorityQuestions?.length ?? 0) > 0 || finding(report, 'content-lead-answer')) {
    action(actions, 'local-answers', 'now', 'content', context.priorityQuestions?.length ? 'provided context' : 'audit finding', t.answers, t.answersDetail);
  }
  if ((context.services?.length ?? 0) > 0) action(actions, 'service-alignment', 'next', 'content', 'provided context', t.services, t.servicesDetail);
  if ((context.areas?.length ?? 0) > 0) action(actions, 'area-usefulness', 'next', 'content', 'provided context', t.areas, t.areasDetail);
  if (context.business.googleBusinessProfile) action(actions, 'profile-review', 'next', 'profile', 'manual verification', t.profile, t.profileDetail);
  else action(actions, 'profile-location', 'next', 'profile', 'manual verification', t.profileMissing, t.profileMissingDetail);
  const competitorsWithWebsite = context.competitors?.filter((competitor) => competitor.website).length ?? 0;
  if (competitorsWithWebsite > 0) action(actions, 'competitor-compare', 'next', 'measurement', 'provided context', t.competitors, t.competitorsDetail);
  action(actions, 'separate-measures', 'next', 'measurement', 'manual verification', t.measure, t.measureDetail);

  return {
    schema: LOCAL_PLAN_SCHEMA,
    language: lang,
    audit: { url: report.url, score: report.score, grade: report.grade, sampledPages: report.sampledPages, coverage: report.sampleCoverage },
    ...(context.priorityQuestions?.length ? {
      questions: context.priorityQuestions.map(question => report.priorityAnswers?.find(row => row.question === question) ?? { question, status: 'review' as const }),
      questionDisclosure: lang === 'fr'
        ? 'Rapprochement lexical dans les seules pages échantillonnées. « Trouvé » signifie qu’un titre reprend la question et possède un texte de réponse ; cela ne vérifie ni sa justesse ni sa visibilité. Les rapprochements partiels restent à vérifier. « Absent de l’échantillon » ne signifie pas absent du site. Aucune demande de recherche ni citation IA n’est mesurée.'
        : 'Lexical matching within sampled pages only. “Found” means a heading repeats the question and has answer text; neither correctness nor visibility is verified. Partial matches need review. “Not found in sample” does not mean absent from the site. Search demand and AI citations are not measured.',
    } : {}),
    context: {
      schema: context.schema,
      businessName: context.business.name,
      hasAddress: Boolean(context.business.address), hasPhone: Boolean(context.business.phone), hasHours: Boolean(context.business.hours),
      hasGoogleBusinessProfile: Boolean(context.business.googleBusinessProfile), services: context.services?.length ?? 0,
      areas: context.areas?.length ?? 0, priorityQuestions: context.priorityQuestions?.length ?? 0,
      competitorsWithWebsite, verifiedAt: context.verifiedAt,
    },
    disclosure: t.disclosure,
    actions,
  };
}
