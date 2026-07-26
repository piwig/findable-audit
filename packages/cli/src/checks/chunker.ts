// Shared RAG-style chunker (LOT 5, spec 2026-07-26-lot5-chunker.md).
//
// Pure and ctx-free on purpose: it takes a parsed main-content root and returns
// the windows a retrieval pipeline would embed, so it can be unit-tested without
// a crawler and reused by any later retrieval-shaped check.
//
// It models SIZE, not boundary quality — chunk-boundary (QW4) already owns the
// question of whether the DOM splits cleanly.
import type { HTMLElement } from 'node-html-parser';

/** Block-level elements that carry text a retriever would keep, in document order. */
const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, dt, dd, figcaption, tr';
const HEADING_LEVEL: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

/** The ~4-characters-per-token rule of thumb. A real tokenizer would mean a dependency. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface Chunk {
  /** 1-based position in document order. */
  index: number;
  /** Heading trail (h1 › h2 › h3 …) in effect at the chunk's first block. */
  headings: string[];
  /** The chunk's block texts, in order. */
  blocks: string[];
  /** Blocks joined by a blank line — what would be embedded. */
  text: string;
  /** Approximate token count of `text` (see approxTokens). */
  tokens: number;
}

export interface ChunkOptions {
  /** Target window size in approximate tokens. Default 512 (the figure named in the backlog). */
  targetTokens?: number;
}

/** The chunk's first non-heading block, or its heading when it carries nothing else. */
export function leadBlock(chunk: Chunk): string {
  return chunk.blocks.find((b) => !chunk.headings.includes(b)) ?? chunk.blocks[0] ?? '';
}

function textOf(el: HTMLElement): string {
  if (el.tagName?.toUpperCase() === 'TR') {
    const cells = el.querySelectorAll('th, td').map((c) => c.textContent.replace(/\s+/g, ' ').trim());
    return cells.filter(Boolean).join(' | ');
  }
  return el.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Cut `root` into the windows a retrieval pipeline would embed.
 *
 * Blocks accumulate until adding the next one would exceed `targetTokens`; a block
 * that is on its own larger than the target becomes a single-block chunk rather than
 * being split mid-sentence. Headings never force a flush — they set the trail that
 * gets recorded on every chunk, the way pipelines prepend contextual chunk headers.
 */
export function chunkContent(root: HTMLElement, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? 512;
  const elements = root.querySelectorAll(BLOCK_SELECTOR);
  // Keep only the innermost carrier: a <li> wrapping a <p> must not emit both.
  const innermost = elements.filter((el) => el.querySelectorAll(BLOCK_SELECTOR).length === 0);

  const chunks: Chunk[] = [];
  let trail: string[] = [];
  let openTrail: string[] = [];
  let blocks: string[] = [];
  let tokens = 0;

  const flush = (): void => {
    if (blocks.length === 0) return;
    const text = blocks.join('\n\n');
    chunks.push({ index: chunks.length + 1, headings: [...openTrail], blocks: [...blocks], text, tokens: approxTokens(text) });
    blocks = [];
    tokens = 0;
  };

  for (const el of innermost) {
    const text = textOf(el);
    if (!text) continue;
    const level = HEADING_LEVEL[el.tagName?.toUpperCase() ?? ''];
    if (level !== undefined) {
      trail = [...trail.slice(0, level - 1), text];
    }
    const cost = approxTokens(text);
    // Oversized single block: close what is open, then let it stand alone.
    if (cost >= target && blocks.length > 0) flush();
    else if (tokens + cost > target && blocks.length > 0) flush();
    if (blocks.length === 0) openTrail = [...trail];
    blocks.push(text);
    tokens += cost;
    if (cost >= target) flush();
  }
  flush();
  return chunks;
}
