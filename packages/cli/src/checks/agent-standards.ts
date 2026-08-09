import type { Check } from '../types.js';
import { makeResult, t } from '../types.js';

// ---------------------------------------------------------------------------
// A38 — experimental agent-actionability standards (opt-in, NEVER scored).
//
// 2026 sees emerging "act on this site" manifests: `agents.json` and the UCP
// (Universal Commerce Protocol) discovery document. No engine or agent vendor
// has committed to either, so the repo rule — "no unstable standard in a
// scored check" (see agentic.ts) — holds: this check exists only behind
// `--experimental-agent-standards`, carries maxPoints 0, and its verdict is
// purely informational whatever it finds. Same-origin fetches only.
// ---------------------------------------------------------------------------

/** Discovery paths probed, most-canonical first. */
export const AGENT_MANIFEST_PATHS = [
  '/.well-known/agents.json',
  '/agents.json',
  '/.well-known/ucp.json',
] as const;

/** true when the body plausibly is a JSON document (we do not validate schemas of unstable standards). */
export function looksLikeJson(body: string): boolean {
  const head = body.trimStart();
  return head.startsWith('{') || head.startsWith('[');
}

export const agentStandardsSignals: Check = {
  id: 'agent-standards-signals', family: 'ai-access', evidence: 'measured', maxPoints: 0,
  async run(ctx) {
    const found: string[] = [];
    for (const path of AGENT_MANIFEST_PATHS) {
      const res = await ctx.fetch(path);
      if (res?.status === 200 && looksLikeJson(res.body)) found.push(path);
    }
    if (found.length > 0) {
      return makeResult(this, 'pass',
        t`experimental: agent manifest detected (${found.join(', ')}) — emerging standard, informational only, not scored`);
    }
    return makeResult(this, 'skip',
      'experimental: no agent manifest found (agents.json / UCP) — emerging standards with no engine commitment; informational only, not scored');
  },
};
