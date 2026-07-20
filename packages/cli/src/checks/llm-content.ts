import { parse } from 'node-html-parser';
import type { Check } from '../types.js';
import { makeResult, isPlainText } from '../types.js';

export const llmsTxt: Check = {
  id: 'llms-txt', family: 'llm-content', maxPoints: 10,
  async run(ctx) {
    const res = await ctx.fetch('/llms.txt');
    if (res?.status !== 200) {
      return makeResult(this, 'fail', 'llms.txt missing',
        'Add a /llms.txt file: an H1 title, a one-line summary, then a markdown list of key pages.');
    }
    if (!isPlainText(res)) {
      return makeResult(this, 'fail', `llms.txt served with content-type "${res.contentType}" (SPA fallback?)`,
        'Serve /llms.txt as text/plain, not an HTML fallback page.');
    }
    if (/^#\s+.+/m.test(res.body)) return makeResult(this, 'pass', 'llms.txt found and structured');
    return makeResult(this, 'warn', 'llms.txt found but has no markdown H1 title',
      'Start llms.txt with "# Site Name" followed by a short description.');
  },
};

export const llmsFullTxt: Check = {
  id: 'llms-full-txt', family: 'llm-content', maxPoints: 4,
  async run(ctx) {
    const res = await ctx.fetch('/llms-full.txt');
    if (res?.status === 200 && isPlainText(res)) return makeResult(this, 'pass', 'llms-full.txt found');
    if (res?.status === 200) {
      return makeResult(this, 'fail', `llms-full.txt served with content-type "${res.contentType}" (SPA fallback?)`,
        'Serve /llms-full.txt as text/plain, not an HTML fallback page.');
    }
    return makeResult(this, 'fail', 'llms-full.txt missing',
      'Add a /llms-full.txt containing the full text content of your key pages.');
  },
};

export const contentWithoutJs: Check = {
  id: 'content-without-js', family: 'llm-content', maxPoints: 6,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const root = parse(res.body);
    root.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
    const text = root.textContent.replace(/\s+/g, ' ').trim();
    if (text.length >= 200) return makeResult(this, 'pass', `homepage has ${text.length} chars of static text`);
    return makeResult(this, 'fail', `only ${text.length} chars of text without JavaScript`,
      'Server-render your main content: AI crawlers do not execute JavaScript.');
  },
};
