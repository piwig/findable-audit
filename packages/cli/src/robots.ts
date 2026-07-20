export function parseRobots(body: string): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  let currentAgents: string[] = [];
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
    if (!m) { lastWasAgent = false; continue; }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) currentAgents = [];
      const agent = value.toLowerCase();
      groups[agent] ??= [];
      currentAgents.push(agent);
      lastWasAgent = true;
    } else {
      for (const a of currentAgents) groups[a].push(value);
      lastWasAgent = false;
    }
  }
  return groups;
}

export function isBlocked(groups: Record<string, string[]>, agent: string): boolean {
  const rules = groups[agent.toLowerCase()] ?? groups['*'] ?? [];
  return rules.includes('/');
}
