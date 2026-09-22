import { expect, it } from 'vitest';
import http from 'node:http';
import { runAudit } from '../src/runner.js';

it('attaches actual sample coverage and supplied-question evidence without changing score', async () => {
  const question = 'Do you repair electric bicycles?';
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<main><h1>${question}</h1><p>Yes, our workshop repairs electric bicycles every working day.</p></main>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const plain = await runAudit(url, [], { maxPages: 1 });
    const report = await runAudit(url, [], { maxPages: 1, priorityQuestions: [question] });
    expect(report.score).toBe(plain.score);
    expect(report.sampleCoverage).toEqual({ sampled: 1, maxPages: 1, limitReached: true, source: 'homepage-only', exhaustive: false });
    expect(report.priorityAnswers?.[0]).toMatchObject({ question, status: 'found', proof: { path: '/', kind: 'prose' } });
    expect(plain.priorityAnswers).toBeUndefined();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
