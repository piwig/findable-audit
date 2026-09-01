import { describe, it, expect } from 'vitest';
import {
  AI_BOTS,
  TRAINING_BOTS,
  CITATION_BOTS,
  AI_ROSTER_REVIEWED,
  AI_ROSTER_SOURCES,
} from '../src/robots.js';

// Un roster de crawlers se perime en silence. Ces tests ne peuvent pas verifier
// que le monde n'a pas bouge — ils garantissent seulement que le millesime est
// lisible, plausible et sourcé, pour qu'une revue reste possible sans archeologie.
// Volontairement AUCUNE assertion du type « revu il y a moins de N mois » : elle
// ferait rougir la suite par le seul passage du temps, sans changement de code.
describe('roster de crawlers IA : datation et re-verifiabilite (A118)', () => {
  it('porte une date de revue au format ISO, ni future ni anterieure au projet', () => {
    expect(AI_ROSTER_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reviewed = new Date(`${AI_ROSTER_REVIEWED}T00:00:00Z`);
    expect(Number.isNaN(reviewed.getTime())).toBe(false);
    expect(reviewed.getTime()).toBeLessThanOrEqual(Date.now());
    expect(reviewed.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('cite des sources officielles en https, sans doublon', () => {
    expect(AI_ROSTER_SOURCES.length).toBeGreaterThanOrEqual(4);
    for (const url of AI_ROSTER_SOURCES) expect(url).toMatch(/^https:\/\/\S+$/);
    expect(new Set(AI_ROSTER_SOURCES).size).toBe(AI_ROSTER_SOURCES.length);
  });

  it('ne contient ni doublon ni entree vide, et ne melange pas les deux niveaux', () => {
    expect(new Set(AI_BOTS).size).toBe(AI_BOTS.length);
    for (const bot of AI_BOTS) expect(bot.trim()).toBe(bot), expect(bot.length).toBeGreaterThan(1);
    const training = new Set(TRAINING_BOTS.map((b) => b.toLowerCase()));
    for (const bot of CITATION_BOTS) expect(training.has(bot.toLowerCase())).toBe(false);
  });

  it("couvre les agents d'entrainement des grands acteurs, Meta compris", () => {
    const lower = AI_BOTS.map((b) => b.toLowerCase());
    // Meta-ExternalAgent etait soupconne absent (A118) : il est bien la, en minuscules.
    for (const expected of ['gptbot', 'claudebot', 'ccbot', 'meta-externalagent', 'google-extended']) {
      expect(lower).toContain(expected);
    }
  });

  it('couvre les recupérateurs au moment de la citation', () => {
    const lower = CITATION_BOTS.map((b) => b.toLowerCase());
    for (const expected of ['oai-searchbot', 'perplexitybot', 'claude-user', 'chatgpt-user']) {
      expect(lower).toContain(expected);
    }
  });
});
