import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stubCtx } from '../helpers/stub.js';
import { llmsTxt as llmsTxtCheck, llmsFullTxt as llmsFullTxtCheck } from '../../src/checks/llm-content.js';
import { TRAINING_BOTS, CITATION_BOTS } from '../../src/robots.js';
import { parseRobots, robotsWellformed } from '../../src/robots.js';
import type { AuditReport } from '../../src/runner.js';
import type { EntityGraph } from '../../src/report/entity-graph.js';
import {
  generateRobotsTxt, generateLlmsTxt, generateLlmsFullTxt, generateAiJson,
  generateSitemapXml, generateJsonLdStubs, EMITTED_FILES, emitFiles,
} from '../../src/generate/index.js';

function makeReport(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://example.com/',
    score: 80,
    grade: 'B',
    familyScores: [],
    sampledPages: ['/', '/about', '/blog/post-1', '/blog/post-2', '/contact', '/pricing'],
    results: [],
    ...over,
  };
}

function graphWith(types: string[]): EntityGraph {
  return {
    nodes: types.map((t, i) => ({ id: `#${t}${i}`, types: [t], name: t, pages: ['/'], synthetic: false })),
    edges: [],
    stats: { nodes: types.length, edges: 0, danglingRefs: 0, components: types.length },
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// generateRobotsTxt
// ---------------------------------------------------------------------------

describe('generateRobotsTxt', () => {
  const report = makeReport();

  it('names every training and citation bot with its own User-agent group', () => {
    const txt = generateRobotsTxt(report, { lang: 'en' });
    for (const bot of [...TRAINING_BOTS, ...CITATION_BOTS]) {
      expect(txt).toContain(`User-agent: ${bot}`);
    }
  });

  it('includes a Sitemap line pointing at the report origin', () => {
    const txt = generateRobotsTxt(report, { lang: 'en' });
    expect(txt).toContain('Sitemap: https://example.com/sitemap.xml');
  });

  it('is well-formed robots.txt (parses cleanly, only known directives)', () => {
    const txt = generateRobotsTxt(report, { lang: 'en' });
    const wf = robotsWellformed({ status: 200, ok: true, body: txt, contentType: 'text/plain', finalUrl: 'https://example.com/robots.txt', headers: {} });
    expect(wf.status).toBe('pass');
    const groups = parseRobots(txt);
    expect(groups['gptbot']).toBeDefined();
    expect(groups['gptbot'].some((r) => r.allow && r.path === '/')).toBe(true);
  });

  it('shows the bilingual warning in English by default', () => {
    const txt = generateRobotsTxt(report, { lang: 'en' });
    expect(txt).toMatch(/review before deploying/i);
  });

  it('shows the bilingual warning in French when lang is fr', () => {
    const txt = generateRobotsTxt(report, { lang: 'fr' });
    expect(txt).toMatch(/relire avant de déployer/i);
    expect(txt).not.toMatch(/review before deploying/i);
  });
});

// ---------------------------------------------------------------------------
// generateLlmsTxt
// ---------------------------------------------------------------------------

describe('generateLlmsTxt', () => {
  const report = makeReport();

  it('has an H1, a summary blockquote, a ## section and >=5 descriptive same-origin links', () => {
    const txt = generateLlmsTxt(report, { lang: 'en' });
    expect(txt).toMatch(/^# example\.com/m);
    expect(txt).toMatch(/^>\s+\S/m);
    expect(txt).toMatch(/^##\s+\S/m);
    const links = [...txt.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)];
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const [, , url] of links) expect(new URL(url).origin).toBe('https://example.com');
  });

  it('round-trips through our own llms-txt check as a pass', async () => {
    const txt = generateLlmsTxt(report, { lang: 'en' });
    const ctx = stubCtx({ '/llms.txt': { body: txt } }, 'https://example.com/');
    const result = await llmsTxtCheck.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('uses the French warning when lang is fr', () => {
    const txt = generateLlmsTxt(report, { lang: 'fr' });
    expect(txt).toMatch(/relire avant de déployer/i);
  });
});

// ---------------------------------------------------------------------------
// generateLlmsFullTxt
// ---------------------------------------------------------------------------

describe('generateLlmsFullTxt', () => {
  const report = makeReport();

  it('has a title and one heading per sampled page, without fabricating content', () => {
    const txt = generateLlmsFullTxt(report, { lang: 'en' });
    expect(txt).toMatch(/^#\s+\S/m);
    const headings = txt.match(/^#{1,6}\s+\S/gm) ?? [];
    expect(headings.length).toBeGreaterThanOrEqual(report.sampledPages.length);
    expect(txt.toLowerCase()).toMatch(/todo|paste|compl/);
  });

  it('is recognized as thin (not fabricated) by our own llms-full-txt check', async () => {
    const txt = generateLlmsFullTxt(report, { lang: 'en' });
    const ctx = stubCtx({ '/llms-full.txt': { body: txt } }, 'https://example.com/');
    const result = await llmsFullTxtCheck.run(ctx);
    expect(result.status).not.toBe('pass'); // structural stub only, real content still missing
  });
});

// ---------------------------------------------------------------------------
// generateAiJson
// ---------------------------------------------------------------------------

describe('generateAiJson', () => {
  const report = makeReport();

  it('produces valid JSON listing training/citation bots with an allow policy', () => {
    const txt = generateAiJson(report, { lang: 'en' });
    const obj = JSON.parse(txt);
    expect(obj.ai_access.training_bots).toEqual(TRAINING_BOTS);
    expect(obj.ai_access.citation_bots).toEqual(CITATION_BOTS);
    expect(obj.ai_access.policy).toBe('allow');
    expect(typeof obj._note).toBe('string');
    expect(obj._note.length).toBeGreaterThan(0);
  });

  it('localizes the _note to French', () => {
    const obj = JSON.parse(generateAiJson(report, { lang: 'fr' }));
    expect(obj._note).toMatch(/relire avant de déployer/i);
  });
});

// ---------------------------------------------------------------------------
// generateSitemapXml
// ---------------------------------------------------------------------------

describe('generateSitemapXml', () => {
  it('contains an absolute <loc> for every sampled page', () => {
    const report = makeReport();
    const xml = generateSitemapXml(report);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    for (const p of report.sampledPages) {
      const abs = new URL(p, report.url).toString();
      expect(xml).toContain(`<loc>${abs}</loc>`);
    }
  });

  it('carries a review-before-deploying comment', () => {
    const xml = generateSitemapXml(makeReport());
    expect(xml).toMatch(/<!--.*review before deploying.*-->/is);
  });
});

// ---------------------------------------------------------------------------
// generateJsonLdStubs
// ---------------------------------------------------------------------------

describe('generateJsonLdStubs', () => {
  it('emits an Organization stub when the site has no entityGraph', () => {
    const report = makeReport();
    const graph = JSON.parse(generateJsonLdStubs(report, { lang: 'en' }));
    const types = graph['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('FAQPage');
  });

  it('omits Organization when it is already present in the entity graph', () => {
    const report = makeReport({ entityGraph: graphWith(['Organization', 'WebSite']) });
    const graph = JSON.parse(generateJsonLdStubs(report, { lang: 'en' }));
    const types = graph['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).not.toContain('Organization');
    expect(types).not.toContain('WebSite');
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('FAQPage');
  });

  it('links WebSite.publisher to the Organization @id when both are stubbed (stays connected)', () => {
    const report = makeReport();
    const graph = JSON.parse(generateJsonLdStubs(report, { lang: 'en' }));
    const org = graph['@graph'].find((n: { '@type': string }) => n['@type'] === 'Organization');
    const site = graph['@graph'].find((n: { '@type': string }) => n['@type'] === 'WebSite');
    expect(site.publisher['@id']).toBe(org['@id']);
  });

  it('always includes a bilingual _note', () => {
    const fr = JSON.parse(generateJsonLdStubs(makeReport(), { lang: 'fr' }));
    expect(fr._note).toMatch(/relire avant de déployer/i);
  });
});

// ---------------------------------------------------------------------------
// EMITTED_FILES / emitFiles
// ---------------------------------------------------------------------------

describe('EMITTED_FILES', () => {
  it('lists exactly the six indexing files with filename/mime/build', () => {
    const names = EMITTED_FILES.map((f) => f.filename).sort();
    expect(names).toEqual([
      '.well-known/ai.json', 'jsonld-stubs.json', 'llms-full.txt', 'llms.txt', 'robots.txt', 'sitemap.xml',
    ].sort());
    for (const f of EMITTED_FILES) {
      expect(typeof f.mime).toBe('string');
      expect(typeof f.build(makeReport(), { lang: 'en' })).toBe('string');
    }
  });
});

describe('emitFiles', () => {
  function mkTmp(): string {
    const d = mkdtempSync(path.join(os.tmpdir(), 'findable-emit-'));
    tmpDirs.push(d);
    return d;
  }

  it('writes every EMITTED_FILES entry plus GENERATED-README.md and returns their paths', () => {
    const dir = mkTmp();
    const written = emitFiles(makeReport(), dir, { lang: 'en' });
    expect(existsSync(path.join(dir, 'robots.txt'))).toBe(true);
    expect(existsSync(path.join(dir, '.well-known', 'ai.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'jsonld-stubs.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'GENERATED-README.md'))).toBe(true);
    expect(written).toContain(path.join(dir, 'robots.txt'));
    expect(written).toContain(path.join(dir, '.well-known', 'ai.json'));
    expect(written).toContain(path.join(dir, 'GENERATED-README.md'));
    expect(written.length).toBe(EMITTED_FILES.length + 1);
  });

  it('writes a French README when lang is fr', () => {
    const dir = mkTmp();
    emitFiles(makeReport(), dir, { lang: 'fr' });
    const readme = readFileSync(path.join(dir, 'GENERATED-README.md'), 'utf8');
    expect(readme).toMatch(/relire avant de déployer/i);
  });
});
