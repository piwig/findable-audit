import { describe, expect, it } from 'vitest';
import { evaluatePriorityQuestions } from '../../src/local/questions.js';
import type { FetchedResource } from '../../src/types.js';

const page = (body: string, path = '/services'): FetchedResource => ({ status: 200, ok: true, contentType: 'text/html', headers: {}, finalUrl: `https://example.org${path}`, body: `<main>${body}</main>` });

describe('supplied priority questions', () => {
  it('bounds direct API question input and leaves truncated questions for review', () => {
    const row = evaluatePriorityQuestions([], ['x'.repeat(501)])[0];
    expect(row.question.length).toBeLessThanOrEqual(500);
    expect(row.status).toBe('review');
  });
  const question = 'Réparez-vous les vélos électriques ?';
  it('finds accessible FAQ disclosure answers without borrowing outside an empty disclosure or form', () => {
    const answer = 'Oui, notre atelier répare les vélos électriques Bosch sur rendez-vous.';
    expect(evaluatePriorityQuestions([page(`<details><summary>${question}</summary><p>${answer}</p></details>`)], [question])[0]).toMatchObject({ status: 'found', proof: { excerpt: answer, heading: question } });
    expect(evaluatePriorityQuestions([page(`<details><summary>${question}</summary></details><p>${answer}</p>`)], [question])[0].status).toBe('review');
    expect(evaluatePriorityQuestions([page(`<details><summary><h3>${question}</h3></summary></details><p>${answer}</p>`)], [question])[0].status).toBe('review');
    expect(evaluatePriorityQuestions([page(`<form><details><summary>${question}</summary><p>${answer}</p><input></details></form>`)], [question])[0].status).toBe('not-found');
  });
  it('finds an explicit question and its actual following answer', () => {
    const result = evaluatePriorityQuestions([page('<h2>Réparez-vous les vélos électriques ?</h2><p>Oui, notre atelier répare les vélos électriques Bosch sur rendez-vous.</p>')], [question]);
    expect(result[0]).toMatchObject({ question, status: 'found', proof: { kind: 'prose', path: '/services', excerpt: 'Oui, notre atelier répare les vélos électriques Bosch sur rendez-vous.', heading: question } });
  });
  it('does not confuse an empty matching heading, a related mention and an absent answer', () => {
    const rows = evaluatePriorityQuestions([page('<h2>Réparez-vous les vélos électriques ?</h2><h2>Autres services</h2><p>Nous vendons des vélos électriques.</p>')], [question, 'Quel prix pour les vélos électriques ?', 'Livrez-vous des repas ?']);
    expect(rows.map(r => r.status)).toEqual(['review', 'review', 'not-found']);
    expect(rows[2].proof).toBeUndefined();
  });
  it('prefers a real answer over an earlier partial match and bounds evidence', () => {
    const rows = evaluatePriorityQuestions([page('<p>Nos vélos électriques sont exposés au magasin.</p>'), page(`<h2>${question}</h2><p>${'Notre atelier répare les vélos électriques. '.repeat(40)}</p>`, '/faq')], [question]);
    expect(rows[0].status).toBe('found');
    expect(rows[0].proof?.path).toBe('/faq');
    expect(rows[0].proof!.excerpt.length).toBeLessThanOrEqual(320);
  });
  it('ignores navigation, scripts and a heading echoed as its own answer', () => {
    const rows = evaluatePriorityQuestions([page(`<nav>${question}</nav><script>${question}</script><h2>${question}</h2><p>${question}</p>`)], [question]);
    expect(rows[0].status).toBe('review');
  });
  it('ignores hidden, aria-hidden and inert question-answer subtrees', () => {
    for (const attr of ['hidden', 'aria-hidden="true"', 'inert']) {
      expect(evaluatePriorityQuestions([page(`<section ${attr}><h2>${question}</h2><p>Our workshop repairs electric bicycles every day.</p></section><p>Welcome to our workshop.</p>`)], [question])[0].status).toBe('not-found');
    }
    const hiddenMain = page(`<h2>${question}</h2><p>Our workshop repairs electric bicycles every day.</p>`);
    hiddenMain.body = hiddenMain.body.replace('<main>', '<main aria-hidden="TRUE">');
    expect(evaluatePriorityQuestions([hiddenMain], [question])[0].status).toBe('not-found');
  });
});
