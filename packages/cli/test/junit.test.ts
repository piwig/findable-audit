import { describe, it, expect } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { renderJunit } from '../src/report/junit.js';
import type { AuditReport } from '../src/runner.js';
import type { CheckResult } from '../src/types.js';

function chk(
  id: string,
  status: CheckResult['status'],
  family: CheckResult['family'] = 'ai-access',
  over: Partial<CheckResult> = {},
): CheckResult {
  const maxPoints = over.maxPoints ?? 10;
  const points = status === 'pass' ? maxPoints : status === 'warn' ? Math.floor(maxPoints / 2) : 0;
  return { id, family, status, points, maxPoints, message: `${id} is ${status}`, ...over };
}

function report(over: Partial<AuditReport> = {}): AuditReport {
  return {
    url: 'https://ex.com/',
    score: 70,
    grade: 'C',
    familyScores: [{ family: 'ai-access', score: 70, weight: 0.2, earned: 14, max: 20 }],
    sampledPages: ['/'],
    results: [],
    ...over,
  };
}

/** Parse attributes too; keep entity decoding on (the default) to verify escaping round-trips. */
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

describe('renderJunit', () => {
  it('emits an XML declaration and well-formed XML', () => {
    const xml = renderJunit(report({ results: [chk('a', 'pass'), chk('b', 'fail')] }));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(XMLValidator.validate(xml)).toBe(true);
  });

  it('counts tests/failures/skipped on the root (warn counts as a failure)', () => {
    const xml = renderJunit(report({
      results: [chk('p', 'pass'), chk('f', 'fail'), chk('w', 'warn'), chk('s', 'skip')],
    }));
    const root = parser.parse(xml).testsuites;
    expect(root['@_tests']).toBe('4');
    expect(root['@_failures']).toBe('2');
    expect(root['@_skipped']).toBe('1');
    expect(root['@_errors']).toBe('0');
    expect(root['@_name']).toContain('score 70/100 (C)');
    expect(root['@_name']).toContain('https://ex.com/');
  });

  it('writes one testcase per check with classname findable-audit.<family> and name <id>', () => {
    const xml = renderJunit(report({ results: [chk('robots-exists', 'pass'), chk('llms-txt', 'fail', 'llm-content')] }));
    expect(xml).toContain('<testcase classname="findable-audit.ai-access" name="robots-exists" time="0"/>');
    expect(xml).toContain('<testcase classname="findable-audit.llm-content" name="llms-txt" time="0">');
  });

  it('maps fail/warn to <failure type> and skip to <skipped>; pass has no children', () => {
    const xml = renderJunit(report({
      results: [chk('p', 'pass'), chk('f', 'fail'), chk('w', 'warn'), chk('s', 'skip')],
    }));
    expect(xml).toContain('<failure type="fail" message="f is fail">');
    expect(xml).toContain('<failure type="warn" message="w is warn">');
    expect(xml).toContain('<skipped message="s is skip"/>');
    expect(xml).toContain('<testcase classname="findable-audit.ai-access" name="p" time="0"/>');
  });

  it('groups checks into one testsuite per family, in encounter order, with local counts and hostname', () => {
    const xml = renderJunit(report({
      results: [
        chk('a1', 'pass', 'ai-access'), chk('a2', 'fail', 'ai-access'),
        chk('t1', 'skip', 'technical-seo'), chk('t2', 'warn', 'technical-seo'), chk('t3', 'pass', 'technical-seo'),
      ],
    }));
    const suites = parser.parse(xml).testsuites.testsuite;
    expect(suites).toHaveLength(2);
    expect(suites[0]['@_name']).toBe('ai-access');
    expect(suites[0]['@_tests']).toBe('2');
    expect(suites[0]['@_failures']).toBe('1');
    expect(suites[0]['@_skipped']).toBe('0');
    expect(suites[1]['@_name']).toBe('technical-seo');
    expect(suites[1]['@_tests']).toBe('3');
    expect(suites[1]['@_failures']).toBe('1');
    expect(suites[1]['@_skipped']).toBe('1');
    expect(suites[0]['@_hostname']).toBe('ex.com');
  });

  it('escapes XML special characters in attributes and text, round-tripping intact', () => {
    const msg = `broken <a> & "quotes" 'apostrophe'`;
    const xml = renderJunit(report({
      results: [chk('esc', 'fail', 'ai-access', { message: msg, fix: 'use <link rel="canonical"> & friends' })],
    }));
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).not.toContain('<a>');
    const suite = parser.parse(xml).testsuites.testsuite;
    const failure = suite.testcase.failure;
    expect(failure['@_message']).toBe(msg);
    expect(failure['#text']).toContain('use <link rel="canonical"> & friends');
  });

  it('includes Fix, Docs and Points in the failure body', () => {
    const xml = renderJunit(report({
      results: [chk('f', 'fail', 'ai-access', { fix: 'do the thing', docUrl: 'https://ex.com/docs' })],
    }));
    const failure = parser.parse(xml).testsuites.testsuite.testcase.failure;
    expect(failure['#text']).toContain('Fix: do the thing');
    expect(failure['#text']).toContain('Docs: https://ex.com/docs');
    expect(failure['#text']).toContain('Points: 0/10');
  });

  it('attaches the family subscore as a suite property and the timestamp when generatedAt is set', () => {
    const xml = renderJunit(report({
      generatedAt: '2026-07-25T10:00:00.000Z',
      results: [chk('a', 'pass')],
    }));
    const suite = parser.parse(xml).testsuites.testsuite;
    expect(suite['@_timestamp']).toBe('2026-07-25T10:00:00.000Z');
    expect(suite.properties.property['@_name']).toBe('score');
    expect(suite.properties.property['@_value']).toBe('70');
  });

  it('omits the properties block for a family without a subscore (all-skip)', () => {
    const xml = renderJunit(report({
      familyScores: [],
      results: [chk('s', 'skip', 'performance')],
    }));
    const suite = parser.parse(xml).testsuites.testsuite;
    expect(suite.properties).toBeUndefined();
    expect(suite['@_skipped']).toBe('1');
  });
});
