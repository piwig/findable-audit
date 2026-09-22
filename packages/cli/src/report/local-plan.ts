import type { LocalPlan } from '../local/plan.js';
import { markdownText } from './safe-text.js';

export function renderLocalPlanJson(plan: LocalPlan): string {
  return JSON.stringify(plan, null, 2) + '\n';
}

const esc = markdownText;

export function renderLocalPlanMarkdown(plan: LocalPlan): string {
  const fr = plan.language === 'fr';
  const out = [fr ? '# Plan de trouvabilité locale' : '# Local readiness plan', '', plan.disclosure, '', fr ? '## Périmètre' : '## Scope', '',
    `- Audit: ${esc(plan.audit.url)} — ${plan.audit.score}/100 (${plan.audit.grade})`,
    fr
      ? `- Contexte métier : ${esc(plan.context.businessName)} (${plan.context.services} services, ${plan.context.areas} zones, ${plan.context.priorityQuestions} questions prioritaires)`
      : `- Business context: ${esc(plan.context.businessName)} (${plan.context.services} services, ${plan.context.areas} areas, ${plan.context.priorityQuestions} priority questions)`,
    fr ? `- Pages crawlées : ${plan.audit.sampledPages.map(esc).join(', ')}` : `- Pages crawled: ${plan.audit.sampledPages.map(esc).join(', ')}`,
    '', '## Actions', '',
    fr ? '| Priorité | Volet | Base | Action |' : '| Priority | Lane | Basis | Action |', '|---|---|---|---|'];
  for (const item of plan.actions) out.push(`| ${item.priority} | ${item.lane} | ${item.basis} | **${esc(item.title)}** — ${esc(item.detail)} |`);
  out.push('');
  if (plan.questions?.length) {
    out.push(fr ? '## Questions prioritaires' : '## Priority questions', '', plan.questionDisclosure ?? '', '');
    const labels = fr ? { found: 'Trouvé', review: 'À vérifier', 'not-found': 'Absent de l’échantillon' }
      : { found: 'Found', review: 'Needs review', 'not-found': 'Not found in sample' };
    for (const row of plan.questions) {
      out.push(`- **${esc(row.question)}** — ${labels[row.status]}`);
      if (row.proof) out.push(`  ${esc(row.proof.path)}${row.proof.heading ? ' — ' + esc(row.proof.heading) : ''}`, `  ${esc(row.proof.excerpt)}`);
      out.push('');
    }
  }
  return out.join('\n');
}

export type LocalPlanRenderer = (plan: LocalPlan) => string;

export function pickLocalPlanRenderer(file: string): LocalPlanRenderer | null {
  const value = file.trim().toLowerCase();
  if (value.endsWith('.json')) return renderLocalPlanJson;
  if (value.endsWith('.md') || value.endsWith('.markdown') || value.endsWith('.txt')) return renderLocalPlanMarkdown;
  return null;
}
