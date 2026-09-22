import http from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from 'vitest';

const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const HTML = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Atelier Exemple</title></head><body><main><h1>Réparation vélo à Orgères</h1><h2>Réparez-vous les vélos électriques ?</h2><p>Notre atelier répare les vélos électriques sur rendez-vous.</p></main></body></html>';

function runCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ status: err ? (((err as NodeJS.ErrnoException).code as number) ?? 1) : 0, stdout, stderr });
    });
  });
}

test('--local-context + --local-plan writes a privacy-preserving plan', async () => {
  const server = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html'); res.end(HTML); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as import('node:net').AddressInfo;
  const context = path.join(process.cwd(), 'tmp-local-context.json');
  const plan = path.join(process.cwd(), 'tmp-local-plan.json');
  writeFileSync(context, JSON.stringify({
    schema: 'findable.local-context/1',
    business: { name: 'Atelier Exemple', address: '1 rue privée', phone: '0102030405' },
    services: ['Réparation vélo'], areas: ['Orgères'], priorityQuestions: ['Réparez-vous les vélos électriques ?'],
  }));
  rmSync(plan, { force: true });
  try {
    const result = await runCli([DIST, `http://127.0.0.1:${port}/`, '--local-context', context, '--local-plan', plan, '--no-report', '--lang', 'fr', '--min-score', '0']);
    expect(result.status).toBe(0);
    expect(existsSync(plan)).toBe(true);
    const body = readFileSync(plan, 'utf8');
    expect(body).toContain('findable.local-plan/1');
    expect(body).not.toContain('1 rue privée');
    expect(body).not.toContain('0102030405');
    expect(JSON.parse(body).questions[0]).toMatchObject({ status: 'found', proof: { path: '/' } });
    expect(JSON.parse(body).audit.coverage.exhaustive).toBe(false);
  } finally {
    server.close();
    rmSync(context, { force: true });
    rmSync(plan, { force: true });
  }
});

test('--local-plan refuses to run without explicit local context', async () => {
  const result = await runCli([DIST, 'https://example.com', '--local-plan', 'plan.json']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('--local-plan requires --local-context');
});
