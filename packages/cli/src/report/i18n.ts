import type { Grade } from '../scoring.js';
import type { Family } from '../types.js';
import type { AxisKey } from './axes.js';

export type Lang = 'en' | 'fr';

/** Bucket keys shared with cwv.ts (kept literal to avoid a runtime import cycle). */
type CwvBucketKey = 'good' | 'ni' | 'poor';
type CwvAssessKey = 'passed' | 'average' | 'slow' | 'inconclusive';
type CwvMetricKey = 'lcp' | 'inp' | 'cls' | 'ttfb';
type EffortKey = 'quick' | 'moderate' | 'involved';

/** Every report-chrome label. The 139 checks' own message/fix text is NOT here. */
export interface ReportMessages {
  // document chrome
  reportTitle: string;   // HTML <h1> + <title> prefix
  mdTitle: string;       // Markdown <h1> brand
  gradeLabel: string;    // grade badge / score line prefix
  outOf100: string;      // "/100" suffix in the hero
  categorySubscores: string;
  pagesAudited: string;  // HTML "Pages audited:" line label
  learnMore: string;     // doc-link anchor text
  footer: string;        // HTML footer line
  // hero stats + verdict
  stats: (passed: number, toFix: number, pages: number) => string;
  verdict: (grade: Grade, failCount: number) => string;
  // action plan
  actionPlan: string;
  fixFirst: string;      // fails group heading
  improve: string;       // warns group heading
  moreRecs: (n: number) => string;
  pts: string;           // impact unit
  // markdown-only chrome
  mdScore: string;                 // "Score:" label
  mdSubscoreHeader: string;        // subscore table header row
  mdCheckHeader: string;           // per-family check table header row
  mdRecommendedFixes: string;      // recommendations heading
  mdDoc: string;                   // "doc" link text
  mdFooter: string;                // footer line
  // Core Web Vitals chrome
  cwvTitle: string;
  cwvNotMeasured: string;          // HTML note (contains <code> markup)
  cwvBucket: Record<CwvBucketKey, string>;
  cwvMdStatus: Record<CwvBucketKey, string>;
  cwvAssess: Record<CwvAssessKey, string>;
  cwvSrcOrigin: string;            // HTML "CrUX origin"
  cwvSrcField: string;             // HTML "CrUX field"
  cwvMdHeader: string;             // CWV markdown table header row
  cwvMdSrcOrigin: string;          // CWV markdown source cell
  cwvMdSrcField: string;
  cwvLabPrefix: string;            // HTML lab line prefix
  cwvLabTag: string;               // HTML lab tag text
  cwvLabMdPrefix: string;          // markdown lab line prefix
  // CWV explainer + advice box (#5) — bilingual
  cwvIntro: string;                // one-paragraph what/why (field vs lab)
  cwvExplainTitle: string;         // "What these metrics mean"
  cwvAdviceTitle: string;          // "How to improve"
  cwvAllGood: string;              // shown when every measured metric is "good"
  cwvMetricInfo: Record<CwvMetricKey, { label: string; what: string; advice: string }>;
  cwvKpiHeader: { metric: string; value: string; rating: string; good: string; poor: string }; // KPI table (#2b)
  // action-plan effort estimate (#18)
  effortLabel: Record<EffortKey, string>;
  // competitive comparison (#36)
  compareTitle: string;
  compareYou: string;
  compareOverall: string;
  compareGapsTitle: string;
  compareNoGaps: string;
  compareBehind: string; // suffix on a gap line, e.g. "-12 behind the leader"
  compareCwvNote: string; // shown when the compared audits skipped Core Web Vitals (lightweight mode)
  // collapsible family summary status (accessible name for the color dot)
  famStatus: { bad: string; ok: string; good: string };
  // dataviz (server-rendered inline SVG: gauge, priority bars, compare chart)
  vizScoreLabel: (score: number, grade: string) => string; // gauge aria-label/<title>
  vizTitle: string;          // priority-bars panel heading + aria-label
  compareChartLabel: string; // compare grouped-bars aria-label/<title>
  // A48: impact/effort scatter (heading, + svg aria-label/<title> counting plotted checks)
  impactEffortTitle: string;
  impactEffortLabel: (n: number) => string;
  // JSON-LD entity graph drawn inline in the report (#58)
  // #64 — one-screen executive summary
  summaryTitle: string;
  summaryActions: string;
  summaryProjection: (from: number, to: number) => string;
  // #63 — evidence axis: what a verdict rests on
  evidenceHeuristic: string;   // badge shown next to a heuristic check
  evidenceTip: string;         // its tooltip, and the legend under the detail heading
  egTitle: string;                          // section heading
  egCaption: string;                        // one line: what the reader is looking at
  egLabel: (types: number, refs: number) => string;  // svg aria-label/<title>, counting what is DRAWN
  egBroken: string;                         // legend for a referenced-but-undeclared entity
  egIslands: (n: number) => string;         // note when the graph is not one connected whole
  egTooBig: (nodes: number, edges: number) => string; // above the draw cap: say so, don't truncate
  // ---- report redesign (three layers: verdict / plan / detail) ----
  /** Sticky nav anchors. */
  nav: { verdict: string; plan: string; cwv: string; detail: string };
  /** The three reader-facing axes of layer 1 (label + the question each answers). */
  axisLabel: Record<AxisKey, string>;
  axisQuestion: Record<AxisKey, string>;
  axisNotApplicable: string;      // shown instead of a score when every family in the axis skipped
  /** A37 — cross-family trust/authority (E-E-A-T) reading lens: label + question. */
  trustLabel: string;
  trustQuestion: string;
  /** Layer-2 effort lanes: heading + the time each implies. */
  laneTitle: Record<EffortKey, string>;
  laneHint: Record<EffortKey, string>;
  /** "the 6 quick wins: 76 → 88 (B)" */
  laneProjection: (count: number, from: number, to: number, grade: string) => string;
  /** Lane whose fixes move the /100 score by less than a whole point. */
  laneFlat: (count: number, score: number) => string;
  /** Heading of the "top N fixes" payoff strip shown before the lanes (backlog A3). */
  topFixesTitle: (n: number) => string;
  planEmpty: string;              // nothing to fix at all
  planWhere: string;              // label before the offending paths of an item
  planHow: string;                // <summary> of the per-item "how to do it" disclosure
  planRest: (n: number) => string; // <summary> of the folded tail beyond the first items
  /** Layer-3 detail. */
  detailTitle: string;
  familyBreakdown: string;        // <summary> of the folded 8-family breakdown
  trendsTitle: string;            // heading of the --history sparklines section
  trendsOverall: string;          // label of the overall-score sparkline
  trendsRuns: (n: number) => string; // caption: how many runs the series holds
  showPassed: (n: number) => string; // <summary> of the folded passing checks
  noIssues: string;               // family whose checks all pass
  /** A52: accessibility section note when performance/CWV also has open issues. */
  a11yPerfLink: (n: number) => string;
  /** A54: static, informational (not scored) crawl/referral ratio reference in the ai-access section. */
  crawlRatioNote: string;
  /** A59: static, informational (not scored) recommended re-audit cadence, shown once near the footer. */
  auditFrequencyNote: string;
  /** A61: informational (not scored) note shown in ai-access when robots.txt blocks a training bot while still allowing citation-time bots — a deliberate, sophisticated policy worth surfacing rather than leaving invisible. */
  trainingBotsBlockedNote: string;
  /** A65: static, informational (not scored) pointer to Google Search Console's "AI generative performance" report, shown once near the footer alongside auditFrequencyNote. */
  gscAiPerformanceNote: string;
}

export const MESSAGES: Record<Lang, ReportMessages> = {
  en: {
    reportTitle: 'findable-audit report',
    mdTitle: 'findable-audit',
    gradeLabel: 'Grade',
    outOf100: '/100',
    categorySubscores: 'Category subscores',
    pagesAudited: 'Pages audited:',
    learnMore: 'Learn more →',
    footer: 'Generated by findable-audit · https://github.com/piwig/findable-audit',
    stats: (passed, toFix, pages) =>
      `${passed} passed · ${toFix} to fix · ${pages} page${pages > 1 ? 's' : ''}`,
    verdict: (grade, n) => {
      switch (grade) {
        case 'A': return n === 0 ? 'Excellent — top-tier AI findability.' : `Very good — ${n} point(s) to polish.`;
        case 'B': return `Solid base — ${n} priority(ies) to reach an A.`;
        case 'C': return `Decent — ${n} priority issue(s) holding back findability.`;
        case 'D': return `Fragile — ${n} important fix(es) to address.`;
        default:  return `Foundations to fix — ${n} critical point(s).`;
      }
    },
    actionPlan: 'Action plan',
    fixFirst: '🔴 Fix first',
    improve: '🟠 Improve',
    moreRecs: (n) => `+${n} more — see the per-family detail below.`,
    pts: 'pts',
    mdScore: 'Score:',
    mdSubscoreHeader: '| Family | Subscore | Weight | Earned/Max |',
    mdCheckHeader: '| | Check | Points | Result |',
    mdRecommendedFixes: 'Recommended fixes',
    mdDoc: 'doc',
    mdFooter: '_Generated by [findable-audit](https://github.com/piwig/findable-audit)_',
    cwvTitle: 'Core Web Vitals',
    cwvNotMeasured: 'Core Web Vitals not measured — run with <code>--cwv --psi-key &lt;key&gt;</code>.',
    cwvBucket: { good: 'good', ni: 'needs improvement', poor: 'poor' },
    cwvMdStatus: { good: '✅ Good', ni: '⚠️ Needs improvement', poor: '❌ Poor' },
    cwvAssess: { passed: 'PASSED', average: 'NEEDS WORK', slow: 'FAILED', inconclusive: 'INCONCLUSIVE' },
    cwvSrcOrigin: 'CrUX origin',
    cwvSrcField: 'CrUX field',
    cwvMdHeader: '| Metric | p75 | Status | Source |',
    cwvMdSrcOrigin: 'origin',
    cwvMdSrcField: 'field',
    cwvLabPrefix: 'Lighthouse lab: Perf',
    cwvLabTag: 'lab',
    cwvLabMdPrefix: 'Lab (Lighthouse): Perf',
    cwvIntro: 'Core Web Vitals are Google’s user-experience signals (loading, interactivity, visual stability). They affect both search ranking and how real visitors perceive the site. Field data reflects real Chrome users (CrUX); lab data is a single controlled test.',
    cwvExplainTitle: 'What these metrics mean',
    cwvAdviceTitle: 'How to improve',
    cwvAllGood: 'Every measured metric is in the “good” range — nice work.',
    cwvMetricInfo: {
      lcp: { label: 'LCP — Largest Contentful Paint', what: 'time until the main content is visible', advice: 'Optimize the hero image (compress, size correctly, preload), cut render-blocking CSS/JS, and serve from a CDN.' },
      inp: { label: 'INP — Interaction to Next Paint', what: 'how quickly the page reacts to interactions', advice: 'Break up long JavaScript tasks, defer non-critical scripts, and avoid heavy work on click/input.' },
      cls: { label: 'CLS — Cumulative Layout Shift', what: 'visual stability (unexpected layout jumps)', advice: 'Set width/height on images and embeds, reserve space for ads/banners, and never inject content above existing content.' },
      ttfb: { label: 'TTFB — Time to First Byte', what: 'server response time (a diagnostic — not one of the three official Core Web Vitals)', advice: 'Speed up the backend, enable caching, use a CDN, and remove needless redirects.' },
    },
    cwvKpiHeader: { metric: 'Metric', value: 'Value (p75)', rating: 'Rating', good: 'Good', poor: 'Poor' },
    effortLabel: { quick: 'Quick win', moderate: 'Moderate', involved: 'Involved' },
    compareTitle: 'Competitive comparison',
    compareYou: 'You',
    compareOverall: 'Overall score',
    compareGapsTitle: 'Where you trail',
    compareNoGaps: 'You lead or match on every family — nice.',
    compareBehind: 'behind the leader',
    compareCwvNote: 'Core Web Vitals are not measured in comparison mode (lightweight audits).',
    famStatus: { bad: 'Needs fixes', ok: 'Warnings only', good: 'All passing' },
    vizScoreLabel: (score, grade) => `Overall score: ${score} out of 100 — grade ${grade}`,
    vizTitle: 'Where to regain points',
    compareChartLabel: 'Family scores by site',
    impactEffortTitle: 'Impact vs. effort',
    impactEffortLabel: (n) => `Impact vs. effort: ${n} check${n > 1 ? 's' : ''} to fix, plotted by recoverable points and estimated effort`,
    summaryTitle: 'Findability summary',
    summaryActions: 'What to do first',
    summaryProjection: (from, to) => `Doing these three: ${from} → ${to}/100.`,
    evidenceHeuristic: 'heuristic',
    evidenceTip: 'A bar we chose, not a standard: reasonable people can disagree, and effectiveness varies by site. Advice, not a defect.',
    egTitle: 'Entity graph',
    egCaption: 'The entity types your JSON-LD declares across the sampled pages, and the references between them — what an engine can assemble about you. Entities of the same type are grouped (×N); hover a box or an arrow for the detail. The uncapped per-entity graph is the --entity-graph export.',
    egLabel: (types, refs) => `JSON-LD entity graph: ${types} entity types, ${refs} references`,
    egBroken: 'referenced but never declared',
    egIslands: (n) => `${n} disconnected groups: an engine reads them as unrelated facts rather than one description.`,
    egTooBig: (nodes, edges) => `Too large to draw here (${nodes} entities, ${edges} references). Export it with --entity-graph graph.mmd (or .dot / .json), which has no cap.`,
    nav: { verdict: 'Verdict', plan: 'The plan', cwv: 'Core Web Vitals', detail: 'Detail' },
    axisLabel: { reachable: 'Reachable', understood: 'Understood', usable: 'Usable' },
    axisQuestion: {
      reachable: 'do crawlers get to the page?',
      understood: 'do they understand what they read?',
      usable: 'does the page hold up, for a human and for an agent?',
    },
    axisNotApplicable: 'n/a',
    trustLabel: 'Trusted',
    trustQuestion: 'would an assistant treat this page as a source worth citing?',
    laneTitle: { quick: 'Quick wins', moderate: 'Moderate', involved: 'Bigger projects' },
    laneHint: { quick: 'under an hour each', moderate: 'half a day each', involved: 'a project of its own' },
    laneProjection: (count, from, to, grade) =>
      `the ${count} of them: ${from} → ${to} (${grade})`,
    laneFlat: (count, score) => `the ${count} of them: ${score} → ${score} (under a point)`,
    topFixesTitle: (n) => `Top ${n} fixes — best payoff first`,
    planEmpty: 'Nothing to fix — every applicable check passes.',
    planWhere: 'Where:',
    planHow: 'How to do it',
    planRest: (n) => `Show the ${n} remaining items`,
    detailTitle: 'Every check, family by family',
    familyBreakdown: 'The detail of the 8 scoring families',
    trendsTitle: 'Score over time',
    trendsOverall: 'Overall',
    trendsRuns: (n) => `${n} audit${n > 1 ? 's' : ''} in this series`,
    showPassed: (n) => `Show the ${n} passing check${n > 1 ? 's' : ''}`,
    noIssues: 'Everything passes in this family.',
    a11yPerfLink: (n) =>
      `${n} performance/Core Web Vitals issue${n > 1 ? 's' : ''} below overlap with accessibility — slow devices and networks hit disabled users first, so fixing one chantier moves both.`,
    crawlRatioNote: 'For scale (Cloudflare Radar, informational only — not scored): major AI crawlers fetch far more than they ever send back as traffic — roughly 20,600 pages crawled per referral for ClaudeBot, about 1,300:1 for OpenAI’s bots. Worth weighing against the access choices below.',
    auditFrequencyNote: 'AI findability shifts as crawler policies, structured data and page content evolve — a quarterly re-audit is a reasonable cadence to catch drift early.',
    trainingBotsBlockedNote: 'Note: robots.txt here blocks at least one training-time AI crawler (e.g. GPTBot) while still allowing citation-time crawlers through — a deliberate, more advanced policy than an all-or-nothing block, already applied on this site.',
    gscAiPerformanceNote: 'Free complement worth checking: Google Search Console added an "AI generative performance" report in mid-2026 (impressions in AI Overviews, AI Mode and Discover, by page/country/device). Known limits: no click data, and a logging bug Google confirmed on 2026-08-13 can understate impressions — don\'t read a dip there as a real visibility loss on its own.',
  },
  fr: {
    reportTitle: 'Rapport findable-audit',
    mdTitle: 'findable-audit',
    gradeLabel: 'Note',
    outOf100: '/100',
    categorySubscores: 'Sous-scores par catégorie',
    pagesAudited: 'Pages auditées :',
    learnMore: 'En savoir plus →',
    footer: 'Généré par findable-audit · https://github.com/piwig/findable-audit',
    stats: (passed, toFix, pages) =>
      `${passed} réussis · ${toFix} à corriger · ${pages} page${pages > 1 ? 's' : ''}`,
    verdict: (grade, n) => {
      switch (grade) {
        case 'A': return n === 0 ? 'Excellent — findabilité IA au top.' : `Très bon — ${n} point(s) à polir.`;
        case 'B': return `Bonne base — ${n} priorité(s) pour viser A.`;
        case 'C': return `Correct — ${n} priorité(s) freinent la findabilité.`;
        case 'D': return `Fragile — ${n} correction(s) importantes à traiter.`;
        default:  return `Fondations à corriger : ${n} point(s) critique(s).`;
      }
    },
    actionPlan: "Plan d'action",
    fixFirst: '🔴 À corriger en priorité',
    improve: '🟠 À améliorer',
    moreRecs: (n) => `+${n} autre(s) — voir le détail par famille ci-dessous.`,
    pts: 'pts',
    mdScore: 'Score :',
    mdSubscoreHeader: '| Famille | Sous-score | Poids | Acquis/Max |',
    mdCheckHeader: '| | Contrôle | Points | Résultat |',
    mdRecommendedFixes: 'Corrections recommandées',
    mdDoc: 'doc',
    mdFooter: '_Généré par [findable-audit](https://github.com/piwig/findable-audit)_',
    cwvTitle: 'Core Web Vitals',
    cwvNotMeasured: 'Core Web Vitals non mesurés — lancez avec <code>--cwv --psi-key &lt;clé&gt;</code>.',
    cwvBucket: { good: 'bon', ni: 'à améliorer', poor: 'mauvais' },
    cwvMdStatus: { good: '✅ Bon', ni: '⚠️ À améliorer', poor: '❌ Mauvais' },
    cwvAssess: { passed: 'RÉUSSI', average: 'À AMÉLIORER', slow: 'ÉCHEC', inconclusive: 'NON CONCLUANT' },
    cwvSrcOrigin: 'CrUX origine',
    cwvSrcField: 'CrUX terrain',
    cwvMdHeader: '| Métrique | p75 | Statut | Source |',
    cwvMdSrcOrigin: 'origine',
    cwvMdSrcField: 'terrain',
    cwvLabPrefix: 'Labo Lighthouse : Perf',
    cwvLabTag: 'labo',
    cwvLabMdPrefix: 'Labo (Lighthouse) : Perf',
    cwvIntro: 'Les Core Web Vitals sont les signaux d’expérience utilisateur de Google (chargement, interactivité, stabilité visuelle). Ils influencent le référencement et la perception des vrais visiteurs. Les données terrain reflètent de vrais utilisateurs Chrome (CrUX) ; les données labo sont un test contrôlé unique.',
    cwvExplainTitle: 'Ce que mesurent ces indicateurs',
    cwvAdviceTitle: 'Comment améliorer',
    cwvAllGood: 'Tous les indicateurs mesurés sont au vert — beau travail.',
    cwvMetricInfo: {
      lcp: { label: 'LCP — Largest Contentful Paint', what: 'temps avant l’affichage du contenu principal', advice: 'Optimisez l’image principale (compression, dimensions, préchargement), réduisez le CSS/JS bloquant et servez via un CDN.' },
      inp: { label: 'INP — Interaction to Next Paint', what: 'rapidité de réaction de la page aux interactions', advice: 'Découpez les longues tâches JavaScript, différez les scripts non essentiels et évitez le travail lourd au clic/à la saisie.' },
      cls: { label: 'CLS — Cumulative Layout Shift', what: 'stabilité visuelle (sauts de mise en page)', advice: 'Fixez les dimensions des images/embeds, réservez l’espace des pubs/bannières et n’insérez jamais de contenu au-dessus de l’existant.' },
      ttfb: { label: 'TTFB — Time to First Byte', what: 'temps de réponse du serveur (un diagnostic — pas l’un des trois Core Web Vitals officiels)', advice: 'Accélérez le backend, activez le cache, utilisez un CDN et supprimez les redirections inutiles.' },
    },
    cwvKpiHeader: { metric: 'Métrique', value: 'Valeur (p75)', rating: 'Évaluation', good: 'Bon', poor: 'Mauvais' },
    effortLabel: { quick: 'Rapide', moderate: 'Modéré', involved: 'Conséquent' },
    compareTitle: 'Comparaison concurrentielle',
    compareYou: 'Vous',
    compareOverall: 'Score global',
    compareGapsTitle: 'Où vous êtes devancé',
    compareNoGaps: 'Vous êtes en tête ou à égalité sur chaque famille — beau travail.',
    compareBehind: 'sous le leader',
    compareCwvNote: 'Core Web Vitals non mesurés en mode comparaison (audits allégés).',
    famStatus: { bad: 'À corriger', ok: 'Avertissements', good: 'Tout passe' },
    vizScoreLabel: (score, grade) => `Score global : ${score} sur 100 — note ${grade}`,
    vizTitle: 'Où regagner des points',
    compareChartLabel: 'Scores par famille et par site',
    impactEffortTitle: 'Impact vs effort',
    impactEffortLabel: (n) => `Impact vs effort : ${n} contrôle${n > 1 ? 's' : ''} à corriger, positionnés selon les points récupérables et l'effort estimé`,
    summaryTitle: 'Synthèse de findabilité',
    summaryActions: 'Par quoi commencer',
    summaryProjection: (from, to) => `Ces trois actions : ${from} → ${to}/100.`,
    evidenceHeuristic: 'heuristique',
    evidenceTip: 'Une barre que nous avons choisie, pas une norme : on peut raisonnablement en discuter, et l\'effet varie selon les sites. Un conseil, pas un défaut.',
    egTitle: 'Graphe d\'entités',
    egCaption: 'Les types d\'entités déclarés par votre JSON-LD sur les pages échantillonnées et les références entre eux — ce qu\'un moteur peut assembler à votre sujet. Les entités de même type sont regroupées (×N) ; survolez une boîte ou une flèche pour le détail. Le graphe entité par entité, sans plafond, est l\'export --entity-graph.',
    egLabel: (types, refs) => `Graphe d'entités JSON-LD : ${types} types d'entités, ${refs} références`,
    egBroken: 'référencée mais jamais déclarée',
    egIslands: (n) => `${n} groupes déconnectés : un moteur y lit des faits sans rapport plutôt qu'une seule description.`,
    egTooBig: (nodes, edges) => `Trop grand pour être dessiné ici (${nodes} entités, ${edges} références). Exportez-le avec --entity-graph graph.mmd (ou .dot / .json), qui n'a pas de plafond.`,
    nav: { verdict: 'Verdict', plan: 'Le plan', cwv: 'Core Web Vitals', detail: 'Le détail' },
    axisLabel: { reachable: 'Trouvable', understood: 'Compréhensible', usable: 'Utilisable' },
    axisQuestion: {
      reachable: 'les robots arrivent-ils jusqu’à la page ?',
      understood: 'comprennent-ils ce qu’ils lisent ?',
      usable: 'la page tient-elle la route, pour un humain et pour un agent ?',
    },
    axisNotApplicable: 'n/a',
    trustLabel: 'Digne de confiance',
    trustQuestion: 'un assistant vous traiterait-il comme une source à citer ?',
    laneTitle: { quick: 'Rapide', moderate: 'Modéré', involved: 'Chantier' },
    laneHint: { quick: 'moins d’une heure chacun', moderate: 'une demi-journée chacun', involved: 'un projet à part entière' },
    laneProjection: (count, from, to, grade) =>
      `les ${count} : ${from} → ${to} (${grade})`,
    laneFlat: (count, score) => `les ${count} : ${score} → ${score} (moins d’un point)`,
    topFixesTitle: (n) => `Top ${n} corrections — meilleur rendement d’abord`,
    planEmpty: 'Rien à corriger — tous les contrôles applicables passent.',
    planWhere: 'Où :',
    planHow: 'Comment faire',
    planRest: (n) => `Afficher les ${n} points restants`,
    detailTitle: 'Tous les contrôles, famille par famille',
    familyBreakdown: 'Le détail des 8 familles de score',
    trendsTitle: 'Score dans le temps',
    trendsOverall: 'Global',
    trendsRuns: (n) => `${n} audit${n > 1 ? 's' : ''} dans cette série`,
    showPassed: (n) => `Afficher ${n === 1 ? 'le contrôle réussi' : `les ${n} contrôles réussis`}`,
    noIssues: 'Tout passe dans cette famille.',
    a11yPerfLink: (n) =>
      `${n} problème${n > 1 ? 's' : ''} de performance/Core Web Vitals ci-dessous recoupe${n > 1 ? 'nt' : ''} l'accessibilité — les appareils et réseaux lents pénalisent d'abord les utilisateurs en situation de handicap, corriger l'un fait avancer l'autre.`,
    crawlRatioNote: 'Pour donner un ordre de grandeur (Cloudflare Radar, à titre informatif uniquement — non noté) : les principaux robots IA explorent bien plus qu\'ils ne renvoient de trafic réel — environ 20 600 pages explorées par visite renvoyée pour ClaudeBot, environ 1 300:1 pour les robots d\'OpenAI. À mettre en balance avec les choix d\'accès ci-dessous.',
    auditFrequencyNote: 'La findabilité IA évolue avec les politiques des robots, les données structurées et le contenu des pages — un ré-audit trimestriel est une cadence raisonnable pour repérer une dérive tôt.',
    trainingBotsBlockedNote: 'Note : le robots.txt bloque ici au moins un robot IA d\'entraînement (par ex. GPTBot) tout en laissant passer les robots de citation — une politique délibérée et plus fine qu\'un blocage tout-ou-rien, déjà appliquée sur ce site.',
    gscAiPerformanceNote: 'Complément gratuit à surveiller : Google Search Console propose depuis mi-2026 un rapport « Performance IA générative » (impressions dans AI Overviews, AI Mode et Discover, par page/pays/appareil). Limites connues : pas de donnée de clics, et un bug de journalisation confirmé par Google le 13/08/2026 peut sous-estimer les impressions — ne pas interpréter seul un creux comme une vraie perte de visibilité.',
  },
};

export function messages(lang: Lang): ReportMessages {
  return MESSAGES[lang];
}

/**
 * Family display labels per language. Order is canonical (matches FAMILY_WEIGHTS
 * / renderers). EN values equal the Phase-1 terminal labels so terminal output
 * is unchanged when it re-derives from the EN entries.
 */
export const FAMILY_LABELS_I18N: Record<Lang, Record<Family, string>> = {
  en: {
    'ai-access': 'AI crawler access',
    'llm-content': 'Answer-engine content',
    'structured-data': 'Structured data & metadata',
    'technical-seo': 'Technical SEO',
    'on-page': 'On-page & content',
    performance: 'Performance & Core Web Vitals',
    accessibility: 'Accessibility',
    security: 'Security & trust',
  },
  fr: {
    'ai-access': 'Accès crawler IA',
    'llm-content': 'Contenu moteur de réponse',
    'structured-data': 'Données structurées & métadonnées',
    'technical-seo': 'SEO technique',
    'on-page': 'On-page & contenu',
    performance: 'Performance & Core Web Vitals',
    accessibility: 'Accessibilité',
    security: 'Sécurité & confiance',
  },
};

/** Short family chips for the action plan / compact UI. */
export const FAMILY_SHORT_I18N: Record<Lang, Record<Family, string>> = {
  en: {
    'ai-access': 'AI access',
    'llm-content': 'AI content',
    'structured-data': 'Data',
    'technical-seo': 'SEO',
    'on-page': 'On-page',
    performance: 'Perf',
    accessibility: 'A11y',
    security: 'Security',
  },
  fr: {
    'ai-access': 'Accès IA',
    'llm-content': 'Contenu IA',
    'structured-data': 'Données',
    'technical-seo': 'SEO',
    'on-page': 'On-page',
    performance: 'Perf',
    accessibility: 'A11y',
    security: 'Sécurité',
  },
};
