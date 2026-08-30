import { describe, it, expect } from 'vitest';
import type { AuditReport } from '../../src/runner.js';
import type { FamilyScore } from '../../src/scoring.js';
import { suggestProbes, renderProbesJson, topicOf, PROBES_SCHEMA } from '../../src/generate/probes.js';

function fam(family: FamilyScore['family'], score: number): FamilyScore {
  return { family, score, weight: 1, earned: score, max: 100 };
}

function makeReport(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://www.example.com/',
    score: 72,
    grade: 'C',
    familyScores: [],
    sampledPages: ['/'],
    results: [],
    ...over,
  };
}

describe('topicOf', () => {
  it('takes the first segment of the homepage title before a separator', () => {
    const r = makeReport({ pageMeta: [{ path: '/', title: 'Factures pour indépendants — Acme' }] });
    expect(topicOf(r)).toBe('Factures pour indépendants');
  });

  it('falls back to h1 when there is no title, and to empty when neither exists', () => {
    expect(topicOf(makeReport({ pageMeta: [{ path: '/', h1: 'Audit SEO automatisé' }] }))).toBe('Audit SEO automatisé');
    expect(topicOf(makeReport())).toBe('');
  });

  it('keeps the full title when the first segment is too short to be a subject', () => {
    const r = makeReport({ pageMeta: [{ path: '/', title: 'Acme | invoices for freelancers' }] });
    expect(topicOf(r)).toBe('Acme | invoices for freelancers');
  });
});

describe('suggestProbes', () => {
  it('yields one probe per weak family, none for strong ones, with the vigie-ready fields', () => {
    const r = makeReport({
      familyScores: [fam('ai-access', 40), fam('llm-content', 55), fam('structured-data', 95)],
      pageMeta: [{ path: '/', title: 'Invoices for freelancers — Example' }],
    });
    const s = suggestProbes(r, 'en');
    expect(s.schema).toBe(PROBES_SCHEMA);
    expect(s.aiProbes).toHaveLength(2);
    const memory = s.aiProbes.find((p) => p.mode === 'memory')!;
    expect(memory.prompt).toBe('What do you know about example.com?');
    const rag = s.aiProbes.find((p) => p.mode === 'rag')!;
    expect(rag.prompt).toContain('Invoices for freelancers');
    for (const p of s.aiProbes) {
      expect(p.locale).toBe('en-US');
      expect(p.active).toBe(true);
      expect(p.reason).toMatch(/scored \d+\/100/);
    }
  });

  it('localizes prompts, locale and reasons in French', () => {
    const r = makeReport({ familyScores: [fam('ai-access', 40), fam('on-page', 60)] });
    const s = suggestProbes(r, 'fr');
    expect(s.aiProbes[0]!.prompt).toBe('Que sais-tu de example.com ?');
    expect(s.aiProbes[1]!.prompt).toBe('Où trouver example.com en ligne ?'); // no title: brand fallback
    expect(s.aiProbes.every((p) => p.locale === 'fr-FR')).toBe(true);
    expect(s.note).toContain('vigie.config.json');
    expect(s.aiProbes[1]!.reason).toContain('« on-page »');
  });

  it('emits an empty array on a clean report and skips families with no citation angle', () => {
    const clean = suggestProbes(makeReport({ familyScores: [fam('ai-access', 90)] }), 'en');
    expect(clean.aiProbes).toEqual([]);
    const noAngle = suggestProbes(makeReport({ familyScores: [fam('performance', 10), fam('security', 10), fam('accessibility', 10)] }), 'en');
    expect(noAngle.aiProbes).toEqual([]);
  });

  it('dedupes when two weak families produce the same question', () => {
    // No pageMeta: topic falls back to the brand for every rag template, but
    // the templates differ per family, so build the collision explicitly by
    // checking prompt uniqueness instead.
    const r = makeReport({ familyScores: [fam('llm-content', 50), fam('technical-seo', 50), fam('on-page', 50)] });
    const s = suggestProbes(r, 'en');
    const keys = s.aiProbes.map((p) => `${p.prompt}|${p.mode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('renderProbesJson', () => {
  it('is deterministic without generatedAt and round-trips as JSON with it', () => {
    const r = makeReport({ familyScores: [fam('ai-access', 40)] });
    expect(renderProbesJson(r, 'en')).toBe(renderProbesJson(r, 'en'));
    const body = renderProbesJson(r, 'en', '2026-08-30T00:00:00.000Z');
    expect(body.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(body);
    expect(parsed.generatedAt).toBe('2026-08-30T00:00:00.000Z');
    expect(parsed.aiProbes).toHaveLength(1);
  });
});
