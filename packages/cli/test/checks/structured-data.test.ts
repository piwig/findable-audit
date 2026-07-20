import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixture } from '../helpers/server.js';
import { Crawler } from '../../src/crawler.js';
import { extractJsonLd, jsonLd, jsonLdEntity } from '../../src/checks/structured-data.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
async function ctx(name: string) {
  const srv = await serveFixture(path.join(fixtures, name));
  closers.push(srv.close);
  return new Crawler(srv.url);
}

describe('extractJsonLd', () => {
  it('parses valid blocks and skips broken ones', () => {
    const html = `<script type="application/ld+json">{"@type":"Bakery","name":"X"}</script>
      <script type="application/ld+json">{broken</script>`;
    const blocks = extractJsonLd(html);
    expect(blocks).toHaveLength(1);
  });
});

describe('structured-data checks', () => {
  it('json-ld fails without any block', async () => {
    const c = await ctx('blocked-ai');
    expect((await jsonLd.run(c)).status).toBe('fail');
  });
  it('json-ld-entity warns on incomplete NAP', async () => {
    const c = await ctx('jsonld-bad'); // Bakery without telephone
    expect((await jsonLdEntity.run(c)).status).toBe('warn');
  });
});
