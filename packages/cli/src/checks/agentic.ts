import type { HTMLElement } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult, t } from '../types.js';
import { parsePage } from './dom.js';
import { pagesOf, pathOf } from './aggregate.js';
import { extractJsonLd, flatten, typesOf, str, rollupBySeverity, type SeverityItem } from './jsonld.js';

// ---------------------------------------------------------------------------
// LOT 6 — agent-usability (spec 2026-07-26-lot6-agent-usability.md).
// Every other check asks whether an engine can READ the site. This one asks
// whether an agent can ACT on it: submit the forms, and find a way to reach a
// human. Crawl-only — no extra fetch, no unstable standard.
// ---------------------------------------------------------------------------

/** Controls that submit a form without JavaScript. `<button>` defaults to type=submit. */
const SUBMIT_SELECTOR = 'button, input[type="submit"], input[type="image"]';

function isSubmitControl(el: HTMLElement): boolean {
  if (el.tagName?.toUpperCase() === 'INPUT') {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    return type === 'submit' || type === 'image';
  }
  // <button> with no type, or type="submit"; type="button"/"reset" submit nothing.
  const type = (el.getAttribute('type') ?? 'submit').toLowerCase();
  return type === 'submit';
}

/** Controls whose value only reaches the server when they carry a `name`. */
const NAMEABLE_SELECTOR = 'input, select, textarea';
const UNNAMEABLE_INPUT_TYPES = new Set(['submit', 'reset', 'button', 'image']);

export interface FormVerdict {
  status: 'pass' | 'warn' | 'fail';
  reason?: string;
}

/**
 * Whether a form can be completed by an agent (or by a visitor with JS off).
 *
 * A missing `action` is deliberately NOT penalized: HTML posts such a form to the
 * current URL, which works. What breaks an agent is a dead submit control, no
 * submit control at all, a `javascript:`/`#` action, or fields with no `name`.
 */
export function classifyForm(form: HTMLElement): FormVerdict {
  const submits = form.querySelectorAll(SUBMIT_SELECTOR).filter(isSubmitControl);
  if (submits.some((el) => el.hasAttribute('disabled'))) {
    return { status: 'fail', reason: 'submit button disabled' };
  }
  if (submits.length === 0) {
    return { status: 'fail', reason: 'no submit control' };
  }
  const action = (form.getAttribute('action') ?? '').trim();
  if (/^javascript:/i.test(action) || action === '#') {
    return { status: 'warn', reason: 'action is JavaScript-only' };
  }
  const unnamed = form.querySelectorAll(NAMEABLE_SELECTOR).filter((el) => {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (el.tagName?.toUpperCase() === 'INPUT' && UNNAMEABLE_INPUT_TYPES.has(type)) return false;
    return !(el.getAttribute('name') ?? '').trim();
  });
  if (unnamed.length > 0) {
    return { status: 'warn', reason: `${unnamed.length} field(s) without a name` };
  }
  return { status: 'pass' };
}

/** A form whose action an agent can actually target (i.e. not a JS-only hook). */
function isTargetableForm(form: HTMLElement): boolean {
  const action = (form.getAttribute('action') ?? '').trim();
  return !/^javascript:/i.test(action) && action !== '#';
}

const CONTACT_KEYS = ['email', 'telephone', 'contactPoint', 'faxNumber'];

/** true when the JSON-LD on the page states an email, phone or ContactPoint. */
export function jsonLdDeclaresContact(html: string): boolean {
  for (const node of flatten(extractJsonLd(html))) {
    if (typesOf(node).includes('ContactPoint')) return true;
    for (const key of CONTACT_KEYS) {
      const v = node[key];
      if (str(v)) return true;
      if (v && typeof v === 'object') return true;
    }
  }
  return false;
}

/**
 * Whether the page offers at least one machine-readable way to reach a human:
 * a mailto:/tel: link, a targetable form, or contact data in the JSON-LD.
 */
export function hasMachineContactPath(root: HTMLElement, html: string): boolean {
  if (root.querySelector('a[href^="mailto:"], a[href^="tel:"]')) return true;
  if (root.querySelectorAll('form').some(isTargetableForm)) return true;
  return jsonLdDeclaresContact(html);
}

export const agentUsability: Check = {
  id: 'agent-usability', family: 'llm-content', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'skip', 'no page reachable');

    const items: SeverityItem[] = [];
    let formCount = 0;
    let contactPages = 0;
    for (const p of pages) {
      const root = parsePage(p);
      const path = pathOf(p);
      if (hasMachineContactPath(root, p.body)) contactPages += 1;
      const verdicts = root.querySelectorAll('form').map(classifyForm);
      formCount += verdicts.length;
      const worst = verdicts.find((v) => v.status === 'fail') ?? verdicts.find((v) => v.status === 'warn');
      items.push(worst ? { path, status: worst.status, reason: worst.reason } : { path, status: 'pass' });
    }

    const roll = rollupBySeverity(items);
    if (roll.status !== 'pass') {
      return makeResult(this, roll.status, t`forms an agent cannot submit on: ${roll.detail}`,
        'Give every form a real submit button that is never disabled server-side, a non-JavaScript action, and a name on every field — an assistant acting for a visitor cannot run your click handlers.');
    }
    if (contactPages === 0) {
      return makeResult(this, 'warn', 'no machine-readable contact path (no mailto:/tel:, no submittable form, no JSON-LD contact)',
        'Expose at least one machine-readable way to reach you: a mailto: or tel: link, a submittable form, or email/telephone/contactPoint in your JSON-LD.');
    }
    const formNote = formCount > 0 ? `${formCount} form(s) submittable without JS` : 'no form to submit';
    return makeResult(this, 'pass', t`${formNote}; contact reachable on ${contactPages}/${pages.length} page(s)`);
  },
};
