import type { HTMLElement } from 'node-html-parser';

export interface AnswerProof {
  kind: 'prose' | 'markup' | 'affordance';
  excerpt: string;
  heading?: string;
}

/** Display cap only: not an SEO target or a model retrieval requirement. */
export function boundedText(text: string, max = 320): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + '…';
}

/** Heading at the evidence block, rather than at its wider chunk's start. */
export function evidenceHeading(root: HTMLElement, text: string): string | undefined {
  let heading: string | undefined;
  for (const el of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dt,dd,figcaption,tr')) {
    if (/^H[1-6]$/i.test(el.tagName)) heading = boundedText(el.textContent);
    else if (el.textContent.replace(/\s+/g, ' ').includes(text)) return heading;
  }
  return undefined;
}
