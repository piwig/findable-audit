import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { llmsTxt, llmsFullTxt, contentWithoutJs } from '../../src/checks/llm-content.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('llm-content checks', () => {
  it('llms-txt passes with structured file', async () => {
    const c = await ctx('llm-good');
    expect((await llmsTxt.run(c)).status).toBe('pass');
  });
  it('llms-txt fails when absent', async () => {
    const c = await ctx('mini');
    expect((await llmsTxt.run(c)).status).toBe('fail');
  });
  it('llms-full-txt passes when present', async () => {
    const c = await ctx('llm-good');
    expect((await llmsFullTxt.run(c)).status).toBe('pass');
  });
  it('content-without-js passes on text-rich page', async () => {
    const c = await ctx('llm-good');
    expect((await contentWithoutJs.run(c)).status).toBe('pass');
  });
  it('content-without-js fails on JS-wall page', async () => {
    const c = await ctx('blocked-ai'); // index.html has almost no text
    expect((await contentWithoutJs.run(c)).status).toBe('fail');
  });
});
