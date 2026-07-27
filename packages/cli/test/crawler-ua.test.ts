import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { DEFAULT_UA } from '../src/crawler.js';

/**
 * Every site we audit records this string in its access log. It said `findable-audit/0.1`
 * for ten releases — found on 2026-07-27 in our own nginx logs, where 4019 hits from our
 * crawler were all attributed to a version that had not existed since the first tag.
 *
 * A tool that grades other sites on the accuracy of what they declare about themselves
 * does not get to misdeclare its own version to every site it touches.
 */

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

describe('the crawler announces itself honestly', () => {
  it('carries the real package version, not a frozen literal', () => {
    expect(DEFAULT_UA).toContain(`findable-audit/${pkg.version}`);
  });

  it('still points at the repository so an admin can find out who we are', () => {
    expect(DEFAULT_UA).toContain('https://github.com/piwig/findable-audit');
  });
});
