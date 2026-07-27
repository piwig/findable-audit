import type { AnswerMatrix, Cell, CellState } from '../answers/matrix.js';
import type { Lang } from './i18n.js';

// ---------------------------------------------------------------------------
// The answer matrix as a file artifact: `--answers <file>`, .json or anything else
// for Markdown. Same shape as --entity-graph — an artifact the audit produces on
// request, never a scored check (see §8 of the design: the measurement did not
// support any threshold, so the claim was withdrawn rather than the bar lowered).
//
// The two disclosures below are not decoration. A matrix that lets a reader believe
// these questions were *searched for*, or that a two-page sample is the whole site,
// is a matrix that lies — and one that lies once is never read again.
// ---------------------------------------------------------------------------

interface Copy {
  title: string;
  provenance: string;
  sample: (n: number, paths: string) => string;
  capped: string;
  legend: string;
  colSubject: string;
  colState: Record<CellState, string>;
  missingTitle: string;
  none: string;
  nothing: string;
}

const COPY: Record<Lang, Copy> = {
  en: {
    title: 'Answer matrix',
    provenance: '**These questions come from what this site declares about itself** — its own services, '
      + 'areas and markup — not from measured search demand. The matrix asks whether the site keeps its '
      + 'own promises in a passage a model could quote. It says nothing about what people search for.',
    sample: (n, paths) => `Built from the ${n} page(s) actually crawled: ${paths}.`,
    capped: '⚠️ The crawl stopped at its page limit, so pages that answer some of these questions may '
      + 'simply not have been visited. Re-run with a larger `--max-pages` before treating a gap as real.',
    legend: '`covered` = a passage answers it and stands on its own · `weak` = the answer is there but '
      + 'cannot be quoted alone · `missing` = nothing answers it.',
    colSubject: 'Subject',
    colState: { covered: 'covered', weak: 'weak', missing: 'missing' },
    missingTitle: 'Questions with no answer',
    none: 'None — every generated question found a passage.',
    nothing: 'This site declares no service or area the matrix could build questions from. '
      + 'That is not a defect on its own, but it does mean an engine has nothing to go on.',
  },
  fr: {
    title: 'Matrice de réponses',
    provenance: '**Ces questions viennent de ce que le site déclare de lui-même** — ses propres services, '
      + 'zones et balisage — et non d\'une demande de recherche mesurée. La matrice regarde si le site tient '
      + 'ses propres promesses dans un passage qu\'un modèle pourrait citer. Elle ne dit rien de ce que les '
      + 'gens cherchent.',
    sample: (n, paths) => `Établie sur les ${n} page(s) réellement crawlées : ${paths}.`,
    capped: '⚠️ Le crawl s\'est arrêté à sa limite de pages : celles qui répondent à certaines de ces '
      + 'questions n\'ont peut-être simplement pas été visitées. Relancez avec un `--max-pages` plus grand '
      + 'avant de considérer un trou comme réel.',
    legend: '`couvert` = un passage y répond et tient seul · `faible` = la réponse existe mais ne peut pas '
      + 'être citée isolément · `absent` = rien n\'y répond.',
    colSubject: 'Sujet',
    colState: { covered: 'couvert', weak: 'faible', missing: 'absent' },
    missingTitle: 'Questions sans réponse',
    none: 'Aucune — chaque question générée a trouvé un passage.',
    nothing: 'Ce site ne déclare ni service ni zone à partir desquels bâtir des questions. '
      + 'Ce n\'est pas un défaut en soi, mais cela veut dire qu\'un moteur n\'a rien sur quoi s\'appuyer.',
  },
};

export interface AnswersContext {
  /** Pathnames actually crawled, homepage first. */
  sampledPages: string[];
  /** True when the crawl stopped because it hit --max-pages, so gaps may be sampling artefacts. */
  capped: boolean;
  lang: Lang;
}

/** JSON is the machine-readable form: the whole matrix plus the sample it rests on. */
export function renderAnswersJson(matrix: AnswerMatrix, ctx: AnswersContext): string {
  return `${JSON.stringify({
    generatedFrom: { sampledPages: ctx.sampledPages, capped: ctx.capped },
    disclosure: COPY[ctx.lang].provenance.replace(/\*\*/g, ''),
    bucket: matrix.bucket,
    language: matrix.lang,
    subjects: matrix.subjects,
    zones: matrix.zones,
    cells: matrix.cells,
  }, null, 2)}\n`;
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/** Best state a subject reached for an intent, collapsing the zone variants of one question. */
function collapse(cells: Cell[]): Map<string, CellState> {
  const rank: Record<CellState, number> = { missing: 0, weak: 1, covered: 2 };
  const out = new Map<string, CellState>();
  for (const c of cells) {
    const k = `${c.subject.id}|${c.intent}`;
    const cur = out.get(k);
    if (cur === undefined || rank[c.state] > rank[cur]) out.set(k, c.state);
  }
  return out;
}

export function renderAnswersMarkdown(matrix: AnswerMatrix, ctx: AnswersContext): string {
  const t = COPY[ctx.lang];
  const out: string[] = [`# ${t.title}`, '', t.provenance, ''];
  out.push(t.sample(ctx.sampledPages.length, ctx.sampledPages.join(', ')), '');
  if (ctx.capped) out.push(t.capped, '');

  if (matrix.cells.length === 0) {
    out.push(t.nothing, '');
    return out.join('\n');
  }

  out.push(t.legend, '');

  // One row per subject, one column per intent — the zone variants of a question are
  // collapsed, because "do you cover X" asked at five zoom levels is one question.
  const intents = [...new Set(matrix.cells.map((c) => c.intent))];
  const best = collapse(matrix.cells);
  out.push(`| ${t.colSubject} | ${intents.join(' | ')} |`);
  out.push(`|---|${intents.map(() => '---').join('|')}|`);
  for (const s of matrix.subjects) {
    const row = intents.map((i) => {
      const state = best.get(`${s.id}|${i}`);
      return state ? t.colState[state] : '—';
    });
    out.push(`| ${escapePipes(s.label)} | ${row.join(' | ')} |`);
  }
  out.push('');

  const missing = matrix.cells.filter((c) => c.state === 'missing');
  out.push(`## ${t.missingTitle}`, '');
  if (missing.length === 0) out.push(t.none, '');
  else for (const c of missing) out.push(`- ${c.question}`);
  out.push('');

  return out.join('\n');
}

export type AnswersRenderer = (matrix: AnswerMatrix, ctx: AnswersContext) => string;

/** Format by extension, exactly like --entity-graph and --report. */
export function pickAnswersRenderer(file: string): AnswersRenderer | null {
  const f = file.trim().toLowerCase();
  if (f === '') return null;
  if (f.endsWith('.json')) return renderAnswersJson;
  if (f.endsWith('.md') || f.endsWith('.markdown') || f.endsWith('.txt')) return renderAnswersMarkdown;
  return null;
}
