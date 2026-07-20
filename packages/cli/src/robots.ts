export interface RobotsRule {
  allow: boolean;
  path: string;
}

export type RobotsGroups = Record<string, RobotsRule[]>;

/** Product token of a user-agent value: part before '/', lower-cased ("GPTBot/1.0" -> "gptbot"). */
function agentToken(value: string): string {
  return value.split('/')[0].trim().toLowerCase();
}

export function parseRobots(body: string): RobotsGroups {
  const groups: RobotsGroups = {};
  let currentAgents: string[] = [];
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) { lastWasAgent = false; continue; }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) currentAgents = [];
      const agent = agentToken(value);
      groups[agent] ??= [];
      currentAgents.push(agent);
      lastWasAgent = true;
    } else {
      // An empty Allow/Disallow value carries no rule (RFC 9309).
      if (value !== '') {
        for (const a of currentAgents) groups[a].push({ allow: key === 'allow', path: value });
      }
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Compile a robots path pattern: '*' matches any sequence, trailing '$' anchors the end. */
function ruleRegex(pattern: string): RegExp {
  let anchored = false;
  if (pattern.endsWith('$')) { anchored = true; pattern = pattern.slice(0, -1); }
  const escaped = pattern
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/**
 * RFC 9309 evaluation: pick the matching rule with the longest path;
 * on a length tie, Allow wins. No matching rule means allowed.
 */
export function isBlocked(groups: RobotsGroups, agent: string, path = '/'): boolean {
  const rules = groups[agentToken(agent)] ?? groups['*'] ?? [];
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!ruleRegex(rule.path).test(path)) continue;
    if (
      best === null ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best !== null && !best.allow;
}
