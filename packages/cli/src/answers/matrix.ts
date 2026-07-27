import type { FetchedResource } from '../types.js';
import { parsePage } from '../checks/dom.js';
import { mainContent } from '../checks/content.js';
import { chunkContent, type Chunk } from '../checks/chunker.js';
import { hasFactAnchor, opensWithoutBackreference } from '../checks/content.js';
import { INTENT_GRID, type Bucket, type IntentDef, type IntentId } from './grid.js';
import { PREDICATES, type PredicateInput } from './predicates.js';
import { extractSubjects, type Subject, type Zone } from './subjects.js';
import { extractJsonLd, flatten, typesOf, NAP_REQUIRED_TYPES, isOrganizationType } from '../checks/jsonld.js';
import type { Lang } from '../report/i18n.js';

// ---------------------------------------------------------------------------
// The matrix: for every question the site's own declarations imply, does the crawled
// corpus hold a passage that answers it and survives being retrieved on its own?
//
// Three states, and `weak` is the one that carries the product: the answer exists but
// is not extractable. Design: 2026-07-27-matrice-de-reponses-design.md §7
// ---------------------------------------------------------------------------

export type CellState = 'covered' | 'weak' | 'missing';

/**
 * What settled the cell. Rendered per cell so a reader can see that "price covered" rests
 * on a currency pattern in prose while "hours covered" rests on `openingHoursSpecification`
 * — and so the calibration gate can compare only the cells where extractability is even
 * in play (markup and affordances are identical between twin corpora by construction).
 */
export type CellEvidence = 'markup' | 'prose' | 'affordance' | 'none';

export interface Cell {
  subject: Subject;
  zone?: Zone;
  intent: IntentId;
  question: string;
  state: CellState;
  evidence: CellEvidence;
  /** Path of the page carrying the best evidence found, when there is any. */
  path?: string;
}

export interface AnswerMatrix {
  subjects: Subject[];
  zones: Zone[];
  bucket: Bucket;
  lang: Lang;
  cells: Cell[];
}

const CHUNK_TOKENS = 512;

/** Order used to keep the best state found across pages. */
const RANK: Record<CellState, number> = { missing: 0, weak: 1, covered: 2 };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The schema.org family the site falls into, which decides the intents that apply.
 *
 * Reuses `NAP_REQUIRED_TYPES` — the LocalBusiness subtree the structured-data checks already
 * agree on — rather than a second, narrower list. A real audited site declaring
 * `ProfessionalService` plus an address and an `areaServed` was falling through to
 * `unknown`, which silently dropped the entire local-business grid: price, hours, location
 * and process were never even asked.
 */
export function bucketOf(pages: FetchedResource[]): Bucket {
  const nodes = pages.flatMap((p) => flatten(extractJsonLd(p.body)));
  const types = new Set(nodes.flatMap(typesOf));

  if ([...types].some((t) => NAP_REQUIRED_TYPES.has(t) || t === 'Store' || t.endsWith('Business'))) return 'local-business';
  // An organisation that publishes a postal address or an area served is a local business
  // in everything but its @type.
  const local = nodes.some((n) => (isOrganizationType(typesOf(n)[0] ?? '') || typesOf(n).includes('Organization'))
    && (n.address !== undefined || n.areaServed !== undefined));
  if (local) return 'local-business';

  if (types.has('Product') || types.has('Offer')) return 'product';
  if (types.has('Article') || types.has('BlogPosting') || types.has('NewsArticle')) return 'article';
  return 'unknown';
}

/**
 * The language to generate questions in — that of the SITE, not of the report. A French
 * site audited with `--lang en` must still be searched with French wording, or the whole
 * matrix comes back empty for the wrong reason.
 */
export function langOf(pages: FetchedResource[]): Lang {
  for (const p of pages) {
    const lang = parsePage(p).querySelector('html')?.getAttribute('lang') ?? '';
    if (lang.toLowerCase().startsWith('fr')) return 'fr';
    if (lang.toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

function pathOf(res: FetchedResource): string {
  try { return new URL(res.finalUrl).pathname; } catch { return '/'; }
}

export function renderQuestion(intent: IntentDef, lang: Lang, subject: string, zone?: string): string {
  return intent.question[lang].replace('{subject}', subject).replace('{zone}', zone ?? '');
}

/** Sentences of a block. Naive on purpose — a dependency-free split is enough to tell a
 *  quotable sentence from a paragraph that only holds the answer somewhere inside it. */
function sentencesOf(block: string): string[] {
  return block.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Does this window talk about the subject at all? Cheap gate before the predicate. */
function mentions(chunk: Chunk, label: string): boolean {
  return fold(chunk.text).includes(fold(label));
}

/**
 * Is the answer quotable, or merely present?
 *
 * The judgement is made on the BLOCK that carries the evidence, not on the retrieval
 * window around it. `chunkSurvives` only inspects a window's lead block, so a long
 * paragraph opening on a clean sentence "survives" no matter how anaphoric the sentence
 * carrying the actual answer is — the §12.1 separation gate caught exactly that, scoring
 * a buried corpus identically to a well-structured one.
 *
 * Page-scoped intents are exempt: "how do I reach a human" is answered by a `tel:` link,
 * not by a quotable sentence, so extractability does not apply to them.
 */
function gradeExtractability(intent: IntentDef, chunk: Chunk, args: PredicateInput): { state: CellState; evidence: CellEvidence } {
  if (intent.scope === 'page') return { state: 'covered', evidence: 'affordance' };

  const holds = (text: string) => PREDICATES[intent.id]({ ...args, chunk: { ...chunk, blocks: [text], text } });

  // If the predicate is still satisfied with no prose at all, the answer lives in the
  // markup. It is machine-readable by construction, so extractability does not apply.
  if (holds('')) return { state: 'covered', evidence: 'markup' };

  /**
   * An answer has to hold together in ONE unit: the evidence, the subject and — when the
   * question carries one — the area. Co-occurrence anywhere inside a 512-token window is
   * not an answer, and treating it as one produced a real false positive on a live site:
   * "do you cover Val d'Izé for Services?" came back covered because a hero block happened
   * to contain both words, three hundred tokens apart, asserting nothing.
   */
  const qualifies = (text: string) => holds(text)
    && fold(text).includes(fold(args.subject))
    && (!intent.zoned || !args.zone || fold(text).includes(fold(args.zone)));

  const blocks = chunk.blocks.filter((b) => !chunk.headings.includes(b));
  // Sentence first — that is the unit a model quotes. Block as a fallback, because some
  // evidence legitimately spans sentences (an enumeration of steps is one answer, not
  // three), and splitting it would report a well-written passage as unquotable.
  const evidence = blocks.flatMap(sentencesOf).find(qualifies) ?? blocks.find(qualifies);
  // Nothing holds it together: the question is unanswered, not answered-but-unquotable.
  if (!evidence) return { state: 'missing', evidence: 'none' };

  const anchored = hasFactAnchor([...chunk.headings, evidence].join(' '));
  const quotable = anchored && opensWithoutBackreference(evidence);
  return { state: quotable ? 'covered' : 'weak', evidence: 'prose' };
}

function evaluate(
  intent: IntentDef, subject: Subject, zone: Zone | undefined, pages: FetchedResource[],
): { state: CellState; evidence: CellEvidence; path?: string } {
  let best: CellState = 'missing';
  let bestEvidence: CellEvidence = 'none';
  let bestPath: string | undefined;

  for (const page of pages) {
    const mc = mainContent(page);
    const chunks = chunkContent(mc.root, { targetTokens: CHUNK_TOKENS });
    const pageText = mc.root.textContent;

    for (const chunk of chunks) {
      if (!mentions(chunk, subject.label)) continue;
      if (intent.zoned && zone && ![zone.label, ...zone.aliases].some((l) => mentions(chunk, l))) continue;
      const args = { chunk, page, pageText, subject: subject.label, zone: zone?.label };
      if (!PREDICATES[intent.id](args)) continue;

      const graded = gradeExtractability(intent, chunk, args);
      if (RANK[graded.state] > RANK[best]) {
        best = graded.state; bestEvidence = graded.evidence; bestPath = pathOf(page);
      }
      if (best === 'covered') return { state: best, evidence: bestEvidence, path: bestPath };
    }
  }
  return { state: best, evidence: bestEvidence, path: bestPath };
}

/**
 * Build the matrix for a crawled sample.
 *
 * A site that declares nothing produces no cells — it is not punished for promises it
 * never made, which is also what keeps the check honest enough to skip rather than fail.
 */
export function buildAnswerMatrix(pages: FetchedResource[]): AnswerMatrix {
  const { subjects, zones } = extractSubjects(pages);
  const bucket = bucketOf(pages);
  const lang = langOf(pages);
  const intents = INTENT_GRID.filter((i) => i.buckets.includes(bucket));
  const cells: Cell[] = [];

  for (const subject of subjects) {
    for (const intent of intents) {
      const targets: (Zone | undefined)[] = intent.zoned ? (zones.length ? zones : []) : [undefined];
      for (const zone of targets) {
        const { state, evidence, path } = evaluate(intent, subject, zone, pages);
        cells.push({
          subject,
          zone,
          intent: intent.id,
          question: renderQuestion(intent, lang, subject.label, zone?.label),
          state,
          evidence,
          path,
        });
      }
    }
  }

  return { subjects, zones, bucket, lang, cells };
}

/** Share of cells that are answered by a passage able to stand on its own. */
export function coverageRatio(matrix: Pick<AnswerMatrix, 'cells'>): number {
  if (matrix.cells.length === 0) return 0;
  return matrix.cells.filter((c) => c.state === 'covered').length / matrix.cells.length;
}
