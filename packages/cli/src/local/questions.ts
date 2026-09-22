import type { FetchedResource } from '../types.js';
import { mainContent } from '../checks/content.js';
import { boundedText, type AnswerProof } from '../answers/evidence.js';
import type { HTMLElement } from 'node-html-parser';

export interface PriorityAnswer {
  question: string;
  status: 'found' | 'review' | 'not-found';
  proof?: AnswerProof & { path: string };
}

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set('que quel quels quelle quelles est sont les des une dans pour vous nous votre vos notre nos avec comment combien what which where when does your ours the and for are this that with'.split(' '));
const words = (text: string) => new Set(fold(text).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,dt,dd';
const hidden = (el: HTMLElement) => el.hasAttribute('hidden') || el.hasAttribute('inert') || el.getAttribute('aria-hidden')?.toLowerCase() === 'true';

/** Lexical evidence only; found means an explicit heading has answer text, not that it is correct. */
export function evaluatePriorityQuestions(pages: FetchedResource[], questions: string[]): PriorityAnswer[] {
  const corpus = pages.flatMap(page => {
    const root = mainContent(page).root;
    for (let ancestor: HTMLElement | null = root; ancestor; ancestor = ancestor.parentNode) if (hidden(ancestor)) return [];
    for (const el of root.querySelectorAll('[hidden], [aria-hidden], [inert]')) if (hidden(el)) el.remove();
    const elements = root.querySelectorAll(BLOCKS).filter(el => el.querySelectorAll(BLOCKS).length === 0);
    let path = '/';
    try { path = new URL(page.finalUrl).pathname; } catch { /* supplied fixtures */ }
    return [{ path, blocks: elements.map(el => ({ text: el.textContent.replace(/\s+/g, ' ').trim(), heading: /^H[1-6]$/i.test(el.tagName) })) }];
  });
  return questions.slice(0, 50).map(rawQuestion => {
    const question = boundedText(rawQuestion, 500);
    if (rawQuestion.length > 500) return { question, status: 'review' as const };
    let best: PriorityAnswer = { question, status: 'not-found' };
    const target = fold(question);
    const tokens = words(question);
    for (const page of corpus) {
      let heading: string | undefined;
      for (let i = 0; i < page.blocks.length; i++) {
        const block = page.blocks[i];
        if (block.heading) heading = block.text;
        const exact = block.heading && fold(block.text) === target;
        if (exact) {
          const next = page.blocks[i + 1];
          const answered = next && !next.heading && fold(next.text) !== target && next.text.split(/\s+/).length >= 4;
          const proof = { kind: 'prose' as const, excerpt: boundedText(answered ? next.text : block.text), heading: boundedText(block.text), path: page.path };
          if (answered) return { question, status: 'found' as const, proof };
          best = { question, status: 'review', proof };
        } else if (best.status === 'not-found' && tokens.size >= 2) {
          const present = words(block.text);
          const overlap = [...tokens].filter(token => present.has(token)).length;
          if (overlap >= 2 && overlap / tokens.size >= 0.5) best = { question, status: 'review', proof: {
            kind: 'prose', excerpt: boundedText(block.text), heading: heading ? boundedText(heading) : undefined, path: page.path,
          } };
        }
      }
    }
    return best;
  });
}
