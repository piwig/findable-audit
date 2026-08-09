import { describe, it, expect } from 'vitest';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import {
  agentStandardsSignals, looksLikeJson, AGENT_MANIFEST_PATHS,
} from '../../src/checks/agent-standards.js';

const BASE = 'https://stub.example/';

function res(pathname: string, body: string, status = 200): FetchedResource {
  return {
    status, ok: status >= 200 && status < 300, body,
    contentType: 'application/json',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

function makeCtx(resources: FetchedResource[]): CrawlContext {
  const byPath = new Map(resources.map((r) => [new URL(r.finalUrl).pathname, r]));
  return {
    baseUrl: new URL(BASE),
    async fetch(p: string) {
      const url = new URL(p, BASE);
      return byPath.get(url.pathname)
        ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
  } as CrawlContext;
}

describe('looksLikeJson', () => {
  it('accepts objects and arrays, with leading whitespace', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true);
    expect(looksLikeJson('  \n[1,2]')).toBe(true);
  });
  it('rejects HTML error pages and plain text', () => {
    expect(looksLikeJson('<!doctype html><html>')).toBe(false);
    expect(looksLikeJson('not found')).toBe(false);
    expect(looksLikeJson('')).toBe(false);
  });
});

describe('agentStandardsSignals', () => {
  it('is opt-in metadata: never scored', () => {
    expect(agentStandardsSignals.maxPoints).toBe(0);
    expect(agentStandardsSignals.id).toBe('agent-standards-signals');
  });

  it('skips (informational) when no manifest exists', async () => {
    const r = await agentStandardsSignals.run(makeCtx([]));
    expect(r.status).toBe('skip');
    expect(r.message).toMatch(/experimental/);
    expect(r.message).toMatch(/not scored/);
  });

  it('passes and lists every manifest path found', async () => {
    const ctx = makeCtx([
      res('/.well-known/agents.json', '{"name":"stub"}'),
      res('/.well-known/ucp.json', '{"ucp":true}'),
    ]);
    const r = await agentStandardsSignals.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toContain('/.well-known/agents.json');
    expect(r.message).toContain('/.well-known/ucp.json');
    expect(r.message).toMatch(/not scored/);
  });

  it('ignores 200 responses whose body is not JSON (HTML fallback pages)', async () => {
    const ctx = makeCtx([
      res('/agents.json', '<!doctype html><html>SPA fallback</html>'),
    ]);
    const r = await agentStandardsSignals.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('probes the canonical well-known path first', () => {
    expect(AGENT_MANIFEST_PATHS[0]).toBe('/.well-known/agents.json');
  });
});
