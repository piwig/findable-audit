import type { AuditReport } from '../runner.js';
import type { Lang } from './i18n.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const priorityLabels = (lang: Lang) => lang === 'fr'
  ? { found: 'Passage retrouvé', review: 'À vérifier', 'not-found': 'Absent de l’échantillon' }
  : { found: 'Passage found', review: 'Review required', 'not-found': 'Absent from the sample' };
const priorityTitle = (lang: Lang) => lang === 'fr' ? 'Vos questions prioritaires' : 'Your priority questions';
const priorityScope = (lang: Lang) => lang === 'fr'
  ? 'Vos questions sont recherchées dans les pages examinées par simple repérage lexical. « Passage retrouvé » signifie qu’un titre correspondant est suivi de texte ; cela ne prouve ni la justesse ni la qualité de la réponse. Relisez les extraits. Une absence concerne uniquement cet échantillon. Ces résultats ne changent pas la note et ne prédisent aucune citation IA.'
  : 'Your questions are checked against the examined pages using lexical matching. “Passage found” means a matching heading is followed by text; it does not establish that the answer is correct or useful. Review the excerpts. Absence applies only to this sample. These results do not change the score or predict AI citations.';

/** Operator-supplied questions are deliberately separate from inferred demand. */
export function renderPriorityAnswers(report: AuditReport, lang: Lang): string {
  const answers = report.priorityAnswers;
  if (!answers?.length) return '';
  const labels = priorityLabels(lang);
  const rows = answers.map(answer => `<details class="answer-proof" open><summary><span class="answer-state ${answer.status}">${labels[answer.status]}</span> ${esc(answer.question)}</summary>`
    + (answer.proof ? `<p class="proof-source">${lang === 'fr' ? 'Page examinée' : 'Examined page'} : <code>${esc(answer.proof.path)}</code>${answer.proof.heading ? ` · ${esc(answer.proof.heading)}` : ''}</p><blockquote>${esc(answer.proof.excerpt)}</blockquote>`
      : `<p>${lang === 'fr' ? 'Aucun passage correspondant retrouvé. Vérifiez les autres pages ou reformulez la question avant de conclure.' : 'No matching passage found. Check other pages or rephrase the question before drawing a conclusion.'}</p>`)
    + '</details>').join('\n');
  return `<section id="priority-answers"><h2>${priorityTitle(lang)}</h2><p class="scope-note">${priorityScope(lang)}</p>${rows}</section>`;
}

export function renderPriorityAnswersMarkdown(report: AuditReport, lang: Lang): string {
  if (!report.priorityAnswers?.length) return '';
  const md = (value: string) => esc(value).replace(/([\\`*_[\]{}()#+!|])/g, '\\$1').replace(/\r?\n/g, ' ');
  const labels = priorityLabels(lang);
  const rows = report.priorityAnswers.map(answer => `### ${md(answer.question)}\n\n**${labels[answer.status]}**\n`
    + (answer.proof ? `\n${lang === 'fr' ? 'Page examinée' : 'Examined page'} : ${md(answer.proof.path)}${answer.proof.heading ? ` · ${md(answer.proof.heading)}` : ''}\n\n> ${md(answer.proof.excerpt)}\n` : ''));
  return [`## ${priorityTitle(lang)}`, '', priorityScope(lang), '', ...rows].join('\n');
}

/** Readable evidence only; no score, remote calls, or claim of semantic understanding. */
export function renderAnswerEvidence(report: AuditReport, lang: Lang): string {
  const fr = lang === 'fr';
  const cells = report.answerMatrix?.cells ?? [];
  const priority = renderPriorityAnswers(report, lang);
  if (!report.answerMatrix) return priority;
  const labels = fr
    ? { covered: 'Réponse détectée', weak: 'À vérifier', missing: 'Absent de l’échantillon' }
    : { covered: 'Answer detected', weak: 'Review required', missing: 'Absent from the sample' };
  const kinds = fr ? { prose: 'Texte visible', markup: 'Données structurées', affordance: 'Lien ou action' }
    : { prose: 'Visible text', markup: 'Structured data', affordance: 'Link or action' };
  const rows = cells.map((cell) => {
    const proof = cell.proof;
    return `<details class="answer-proof"><summary><span class="answer-state ${cell.state}">${labels[cell.state]}</span> ${esc(cell.question)}</summary>`
      + (cell.path ? `<p class="proof-source">${esc(fr ? 'Page examinée' : 'Examined page')} : <code>${esc(cell.path)}</code></p>` : '')
      + (proof ? `<p class="proof-source">${esc(kinds[proof.kind])}${proof.heading ? ` · ${esc(proof.heading)}` : ''}</p><blockquote>${esc(proof.excerpt)}</blockquote>`
        : `<p>${esc(fr ? 'Aucun extrait justificatif disponible dans ce rapport.' : 'No supporting excerpt is available in this report.')}</p>`)
      + '</details>';
  }).join('\n');
  return priority + `<section id="answer-evidence"><h2>${fr ? 'Questions et preuves' : 'Questions and evidence'}</h2>`
    + `<p class="scope-note">${fr
      ? 'Ces questions proviennent des services, zones et informations du site. Ce ne sont pas des recherches mesurées. Les détections sont des indices à relire ; une absence concerne seulement les pages examinées, sans prédiction de citation IA.'
      : 'These questions come from the site’s services, areas and information, not measured search demand. Detections are clues to review; absence refers only to the examined pages, with no AI citation prediction.'}</p>`
    + (cells.length ? `<details class="answer-all"><summary>${cells.length} ${fr ? 'questions examinées — ouvrir les preuves' : 'questions examined — open evidence'}</summary>${rows}</details>`
      : `<p>${fr ? 'Aucune question déduite des informations de cet échantillon.' : 'No questions inferred from this sample’s information.'}</p>`)
    + '</section>';
}

export function renderLinkOpportunities(report: AuditReport, lang: Lang): string {
  if (!report.linkOpportunities) return '';
  const fr = lang === 'fr';
  return `<section id="link-opportunities"><h2>${fr ? 'Liens internes à envisager' : 'Internal links to consider'}</h2>`
    + `<p class="scope-note">${fr ? 'Pistes issues de titres ou H1 retrouvés mot pour mot dans un passage sans lien. Seules les pages examinées sont comparées, avec au plus 20 propositions. Vérifiez la pertinence et la destination ; aucun lien n’est ajouté automatiquement et aucun gain de position n’est prédit.' : 'Candidates use titles or H1 text found verbatim in an unlinked passage. Only examined pages are compared, with at most 20 suggestions. Review relevance and destination; no links are inserted automatically and no ranking gain is predicted.'}</p>`
    + (report.linkOpportunities.length ? report.linkOpportunities.map(item => `<details class="answer-proof"><summary><code>${esc(item.sourcePath)}</code> → <code>${esc(item.targetPath)}</code></summary><p>${fr ? 'Ancre existante' : 'Existing anchor'} : <strong>${esc(item.anchor)}</strong></p><blockquote>${esc(item.excerpt)}</blockquote></details>`).join('\n')
      : `<p>${fr ? 'Aucune piste répondant à ces critères dans cet échantillon. Une revue humaine peut en trouver d’autres.' : 'No candidates met these criteria in this sample. Human review may find others.'}</p>`)
    + '</section>';
}

export function renderAuditScope(report: AuditReport, lang: Lang): string {
  const fr = lang === 'fr';
  const coverage = report.sampleCoverage;
  const count = report.sampledPages.length;
  return `<aside class="audit-scope"><h2>${fr ? 'Périmètre de cet audit' : 'Scope of this audit'}</h2><p>${count} ${fr ? 'page(s) examinée(s)' : 'page(s) examined'}`
    + (coverage ? ` · ${fr ? 'plafond demandé' : 'requested limit'} : ${coverage.maxPages}` : '')
    + `.</p><p>${fr ? 'Cet audit examine le HTML récupéré. Il ne mesure ni les positions dans les moteurs, ni les visites, ni les citations IA. Les pages non parcourues et le contenu ajouté uniquement par JavaScript peuvent manquer.'
      : 'This audit examines retrieved HTML. It does not measure search rankings, visits or AI citations. Pages outside the sample and content added only by JavaScript may be missing.'}</p>`
    + (coverage?.limitReached ? `<p><strong>${fr ? 'Limite de pages atteinte : élargissez l’échantillon avant de conclure à une absence.' : 'Page limit reached: widen the sample before concluding that content is absent.'}</strong></p>` : '')
    + '</aside>';
}

export function renderEvidenceFilters(lang: Lang): string {
  const fr = lang === 'fr';
  return `<fieldset class="evidence-filters"><legend>${fr ? 'Afficher les contrôles' : 'Show checks'}</legend>`
    + [['all', fr ? 'Tous' : 'All'], ['measured', fr ? 'Constats mesurés' : 'Measured findings'], ['heuristic', fr ? 'Conseils éditoriaux' : 'Editorial advice']]
      .map(([id, label]) => `<label><input type="radio" id="evidence-${id}" name="evidence-filter" value="${id}"${id === 'all' ? ' checked' : ''}> ${label}</label>`).join('')
    + `<p>${fr ? 'Les compteurs et la note portent toujours sur l’ensemble des contrôles. Sans filtre pris en charge, tous restent affichés.' : 'Counts and scores always cover all checks. If filtering is unsupported, every check remains visible.'}</p></fieldset>`;
}

export const ANSWER_EVIDENCE_STYLE = `
  .audit-scope { margin: 1.5rem 0; padding: 1rem 1.2rem; border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 12px 12px 0; }
  .audit-scope h2 { margin-top: 0; border: 0; } .audit-scope p,.scope-note { font-size: .9rem; color: var(--muted); }
  .answer-proof { padding: .8rem 0; border-bottom: 1px solid var(--line); }
  .answer-proof summary { cursor: pointer; font-weight: 600; }
  .answer-state { display: inline-block; font-size: .74rem; font-weight: 600; color: var(--muted); background: var(--chip-bg); padding: .15rem .5rem; border-radius: 5px; margin-right: .4rem; }
  .answer-proof blockquote { margin: .6rem 0; padding: .5rem 1rem; border-left: 2px solid var(--accent); background: var(--panel); }
  .answer-proof { overflow-wrap: anywhere; } .answer-proof code { white-space: normal; }
  #priority-answers { padding: 1rem 1.2rem; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
  #priority-answers h2 { margin-top: 0; } .answer-state.found { color: var(--good); background: var(--good-bg); }
  .answer-state.review { color: var(--warn); background: var(--warn-bg); }
  .proof-source { font-size: .82rem; color: var(--muted); margin: .4rem 0; }
  .evidence-filters { margin: 1rem 0; padding: .75rem 1rem; border: 1px solid var(--line); border-radius: 10px; }
  .evidence-filters legend { font-weight: 700; } .evidence-filters label { display: inline-flex; gap: .3rem; align-items: center; margin: .3rem .9rem .3rem 0; min-height: 36px; cursor: pointer; }
  .evidence-filters input { accent-color: var(--accent); } .evidence-filters p { font-size: .78rem; color: var(--muted); }
  #detail:has(#evidence-measured:checked) .row[data-evidence="heuristic"], #detail:has(#evidence-heuristic:checked) .row:not([data-evidence="heuristic"]) { display: none; }
  @media print { .evidence-filters { display: none; } #detail .row[data-evidence] { display: table-row !important; } }
`;
