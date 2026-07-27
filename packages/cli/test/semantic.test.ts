import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../src/types.js';
import {
  foldDiacritics, topicTokens, boilerplateTitleTokens, readTopic, focusScore, isJudgeable,
  twinPairs, topicalFocus, keywordCannibalization,
} from '../src/checks/semantic.js';

const BASE = 'https://stub.example/';

/** ~112 words of neutral text: lets a fixture clear the prose floor without adding topic words. */
const FILLER = Array.from({ length: 112 }, (_, i) => `filler${i % 9}`).join(' ');

interface PageSpec {
  title: string;
  h1?: string;
  desc?: string;
  /** Paragraphs of main-content prose. */
  prose?: string[];
  /** Append FILLER so the page clears the 100-word prose floor. */
  pad?: boolean;
  /** `<html lang>` value (default "en"). */
  lang?: string;
  /** Paths declared as hreflang alternates of this page. */
  alternates?: string[];
}

function page(pathname: string, spec: PageSpec): FetchedResource {
  const paragraphs = [...(spec.prose ?? []), ...(spec.pad ? [FILLER] : [])];
  const body = [
    `<!doctype html><html lang="${spec.lang ?? 'en'}"><head><meta charset="utf-8">`,
    `<title>${spec.title}</title>`,
    spec.desc ? `<meta name="description" content="${spec.desc}">` : '',
    (spec.alternates ?? []).map((a) => `<link rel="alternate" hreflang="x" href="${a}">`).join(''),
    '</head><body><main>',
    spec.h1 ? `<h1>${spec.h1}</h1>` : '',
    paragraphs.map((p) => `<p>${p}</p>`).join(''),
    '</main></body></html>',
  ].join('');
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

function makeCtx(pages: FetchedResource[] | null): CrawlContext {
  const byPath = new Map((pages ?? []).map((p) => [new URL(p.finalUrl).pathname, p]));
  const ctx: CrawlContext = {
    baseUrl: new URL(BASE),
    async fetch(p: string) {
      const url = new URL(p, BASE);
      return byPath.get(url.pathname)
        ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
  };
  if (pages) ctx.sample = { pages, source: 'links' };
  return ctx;
}

// ---------------------------------------------------------------------------
// text primitives
// ---------------------------------------------------------------------------

describe('topicTokens', () => {
  it('keeps French words whole instead of letting the ASCII tokenizer mangle them', () => {
    // Without folding, `tokenize` reads "réparation" as "paration" and "vélos" as "los".
    expect(foldDiacritics('Réparation de vélos à Lyon')).toBe('Reparation de velos a Lyon');
    expect(topicTokens('Réparation de vélos à Lyon')).toEqual(['reparation', 'velos', 'lyon']);
  });
  it('drops French function words the English stopword list lets through', () => {
    expect(topicTokens('Les meilleures adresses pour une tarte')).toEqual(['meilleures', 'adresses', 'tarte']);
  });
  it('keeps French function words that are ordinary English nouns', () => {
    expect(topicTokens('Used car dealership')).toContain('car');
  });
  it('leaves English text alone', () => {
    expect(topicTokens('Sourdough bread in Springfield')).toEqual(['sourdough', 'bread', 'springfield']);
  });
});

describe('boilerplateTitleTokens', () => {
  it('treats a trailing segment repeated across titles as the brand', () => {
    const brand = boilerplateTitleTokens([
      'Sourdough bread — Example Bakery',
      'Croissants — Example Bakery',
    ]);
    expect([...brand].sort()).toEqual(['bakery', 'example']);
  });
  it('leaves a lone trailing segment alone — it is as likely a subtitle as a brand', () => {
    const brand = boilerplateTitleTokens([
      'Sourdough bread — Example Bakery',
      'About us — our story since 1998',
    ]);
    expect(brand.size).toBe(0); // "story" survives: it is what the page is about
  });
  it('catches a brand placed first, once the sample is big enough', () => {
    const brand = boilerplateTitleTokens([
      'Example Bakery sourdough', 'Example Bakery croissants',
      'Example Bakery tarts', 'Example Bakery cakes',
    ]);
    expect([...brand].sort()).toEqual(['bakery', 'example']);
  });
  it('does not apply the frequency rule below 4 sampled titles', () => {
    expect(boilerplateTitleTokens(['Example Bakery sourdough', 'Example Bakery croissants']).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// topical-focus (#30)
// ---------------------------------------------------------------------------

const ON_TOPIC = page('/sourdough', {
  title: 'Sourdough bread baking classes in Springfield',
  h1: 'Sourdough bread baking classes',
  desc: 'Learn to bake sourdough bread at our Springfield classes, from starter to crust.',
  prose: [
    'Our Springfield classes teach sourdough bread from the starter up: you feed it, mix it, shape it and bake it.',
    'Each class runs for one morning. You learn to read the dough, judge the rise, and bake a crust that cracks.',
    'Every baking session ends with a loaf you take home, plus the starter jar that produced it.',
  ],
  pad: true,
});

const OFF_TOPIC = page('/sourdough', {
  title: 'Sourdough bread baking classes in Springfield',
  h1: 'Sourdough bread baking classes',
  desc: 'Learn to bake sourdough bread at our Springfield classes, from starter to crust.',
  prose: ['Filing a quarterly tax return requires care.', 'Our accountants reconcile ledgers and payroll.'],
  pad: true,
});

describe('focusScore', () => {
  it('rewards prose that reinforces the declared topic', () => {
    const topic = readTopic(ON_TOPIC, new Set());
    expect(isJudgeable(topic)).toBe(true);
    expect(focusScore(topic)).toBeGreaterThan(0.8);
  });
  it('collapses when the body is about something else', () => {
    expect(focusScore(readTopic(OFF_TOPIC, new Set()))).toBeLessThan(0.2);
  });
  it('ignores headings, so a page cannot deliver on its promise by repeating its own label', () => {
    const headingsOnly = page('/x', {
      title: 'Sourdough bread baking classes in Springfield',
      h1: 'Sourdough bread baking classes in Springfield',
      prose: [FILLER],
    });
    expect(focusScore(readTopic(headingsOnly, new Set()))).toBe(0);
  });
});

describe('topical-focus', () => {
  it('skips when no page is reachable', async () => {
    const r = await topicalFocus.run(makeCtx(null));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('no page reachable');
  });
  it('skips a page too thin to judge rather than blaming it', async () => {
    const thin = page('/', { title: 'Sourdough bread in Springfield', h1: 'Sourdough bread', prose: ['Fresh daily.'] });
    const r = await topicalFocus.run(makeCtx([thin]));
    expect(r.status).toBe('skip');
  });
  it('skips a page whose title declares too few words to measure', async () => {
    const bare = page('/', { title: 'Contact', h1: 'Contact', prose: [FILLER], pad: true });
    const r = await topicalFocus.run(makeCtx([bare]));
    expect(r.status).toBe('skip');
  });
  it('passes when the main content reinforces the declared topic', async () => {
    const r = await topicalFocus.run(makeCtx([ON_TOPIC]));
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/lowest \d+%/);
  });
  it('warns — never fails — when the body drifts from the title', async () => {
    const r = await topicalFocus.run(makeCtx([OFF_TOPIC]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/sourdough');
    expect(r.fix).toBeDefined();
  });
  it('names only the offending page when part of the sample is on topic', async () => {
    const r = await topicalFocus.run(makeCtx([ON_TOPIC, { ...OFF_TOPIC, finalUrl: `${BASE}drift` }]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/drift');
    expect(r.message).not.toContain('/sourdough');
  });
  it('passes a French page written on its own subject', async () => {
    const fr = page('/reparation', {
      title: 'Réparation de vélos à Lyon — Atelier Dupont',
      h1: 'Réparation de vélos',
      desc: 'Atelier de réparation de vélos à Lyon : révision complète, freins et roues.',
      prose: [
        "L'atelier Dupont répare les vélos à Lyon depuis 2004, du dérailleur grippé à la roue voilée.",
        'Une révision complète comprend les freins, les roues et la transmission, rendue le jour même.',
        'Chaque réparation est garantie trois mois, pièces comprises.',
      ],
      pad: true,
    });
    const r = await topicalFocus.run(makeCtx([fr]));
    expect(r.status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// keyword-cannibalization (#31)
// ---------------------------------------------------------------------------

const TWIN_A = page('/sourdough-springfield', {
  title: 'Sourdough bread in Springfield',
  h1: 'Sourdough bread in Springfield',
  prose: ['We bake a slow loaf every morning and sell it at the counter until it runs out.'],
});
const TWIN_B = page('/best-sourdough', {
  title: 'Best sourdough bread Springfield bakery',
  h1: 'Sourdough bread Springfield',
  prose: ['Choosing a loaf is a matter of crust, crumb and how long the dough was left to rest.'],
});

describe('keyword-cannibalization', () => {
  it('skips below 2 sampled pages', async () => {
    const r = await keywordCannibalization.run(makeCtx([TWIN_A]));
    expect(r.status).toBe('skip');
    expect(r.message).toBe('fewer than 2 sampled pages');
  });
  it('skips when the titles declare too few words to compare', async () => {
    const a = page('/contact', { title: 'Contact', h1: 'Contact', prose: ['Call us.'] });
    const b = page('/contact-us', { title: 'Contact us', h1: 'Contact', prose: ['Write to us.'] });
    const r = await keywordCannibalization.run(makeCtx([a, b]));
    expect(r.status).toBe('skip');
  });
  it('passes when each page targets a distinct intent', async () => {
    const other = page('/croissants-chicago', {
      title: 'Croissant baking classes in Chicago',
      h1: 'Croissant baking classes',
      prose: ['Butter, lamination and patience are the whole of the craft.'],
    });
    const r = await keywordCannibalization.run(makeCtx([TWIN_A, other]));
    expect(r.status).toBe('pass');
    expect(r.message).toContain('distinct intent');
  });
  it('warns — never fails — on two distinct pages promising the same thing', async () => {
    const r = await keywordCannibalization.run(makeCtx([TWIN_A, TWIN_B]));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('/sourdough-springfield');
    expect(r.message).toContain('/best-sourdough');
  });
  it('leaves byte-identical titles to unique-titles', async () => {
    const clone = { ...TWIN_A, finalUrl: `${BASE}sourdough-copy` };
    expect(twinPairs([readTopic(TWIN_A, new Set()), readTopic(clone, new Set())])).toEqual([]);
  });
  it('leaves near-duplicate bodies to content-uniqueness', async () => {
    const sameBody = page('/best-sourdough', {
      title: 'Best sourdough bread Springfield bakery',
      h1: 'Sourdough bread in Springfield', // same H1 and same prose: a copy, not a twin
      prose: ['We bake a slow loaf every morning and sell it at the counter until it runs out.'],
    });
    const r = await keywordCannibalization.run(makeCtx([TWIN_A, sameBody]));
    expect(r.status).toBe('pass');
  });
  it('never reads a translation as a competitor (differing <html lang>)', async () => {
    // Cognates, proper nouns and diacritic folding leave a French title looking much
    // like its English twin — our own /en/about/ vs /fr/about/ scored 80 %.
    const en = page('/en/about', {
      title: 'About the findable audit engine', h1: 'About findable',
      prose: ['The engine crawls a site once and reports what an AI crawler can read.'],
    });
    const fr = page('/fr/about', {
      lang: 'fr',
      title: 'À propos du moteur d’audit findable', h1: 'À propos de findable',
      prose: ['Le moteur explore un site une fois et rapporte ce qu’un robot IA peut lire.'],
    });
    const r = await keywordCannibalization.run(makeCtx([en, fr]));
    expect(r.status).toBe('pass');
  });
  it('never reads a declared hreflang alternate as a competitor', async () => {
    const a = page('/us/sourdough-bread-springfield', {
      title: 'Sourdough bread in Springfield', h1: 'Sourdough bread in Springfield',
      alternates: ['/gb/sourdough-bread-springfield/'],
      prose: ['We bake a slow loaf every morning.'],
    });
    const b = page('/gb/sourdough-bread-springfield', {
      title: 'Sourdough bread Springfield bakery', h1: 'Sourdough bread in Springfield',
      alternates: ['/us/sourdough-bread-springfield/'],
      prose: ['Choosing a loaf is a matter of crust and crumb.'],
    });
    const r = await keywordCannibalization.run(makeCtx([a, b]));
    expect(r.status).toBe('pass');
  });
  it('reports the pair with its similarity, worst first', () => {
    const pairs = twinPairs([TWIN_A, TWIN_B].map((p) => readTopic(p, new Set())));
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(0.6);
  });
});
