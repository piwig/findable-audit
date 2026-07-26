import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import type { CrawlContext, FetchedResource } from '../../src/types.js';
import {
  agentUsability, classifyForm, hasMachineContactPath, jsonLdDeclaresContact,
} from '../../src/checks/agentic.js';

const BASE = 'https://stub.example/';

function page(pathname: string, body: string): FetchedResource {
  return {
    status: 200, ok: true, body, contentType: 'text/html',
    finalUrl: new URL(pathname, BASE).toString(), headers: {},
  };
}

function makeCtx(pages: FetchedResource[]): CrawlContext {
  const byPath = new Map(pages.map((p) => [new URL(p.finalUrl).pathname, p]));
  const ctx: CrawlContext = {
    baseUrl: new URL(BASE),
    async fetch(p: string) {
      const url = new URL(p, BASE);
      return byPath.get(url.pathname)
        ?? { status: 404, ok: false, body: 'not found', contentType: 'text/plain', finalUrl: url.toString(), headers: {} };
    },
  };
  ctx.sample = { pages, source: 'links' };
  return ctx;
}

const form = (html: string) => parse(html).querySelector('form')!;

// ---------------------------------------------------------------------------
// classifyForm
// ---------------------------------------------------------------------------

describe('classifyForm', () => {
  it('passes a plain POST form with a named field and a submit button', () => {
    expect(classifyForm(form(
      '<form method="post" action="/contact"><input name="email"><button type="submit">Send</button></form>',
    ))).toEqual({ status: 'pass' });
  });

  it('accepts a missing action — HTML posts such a form to the current URL', () => {
    expect(classifyForm(form(
      '<form method="post"><input name="q"><button>Go</button></button></form>',
    )).status).toBe('pass');
  });

  it('treats a bare <button> as a submit control (type defaults to submit)', () => {
    expect(classifyForm(form('<form action="/s"><input name="q"><button>Go</button></form>')).status).toBe('pass');
  });

  it('fails a form whose submit button is disabled', () => {
    const v = classifyForm(form(
      '<form><input name="email"><button type="submit" disabled>Send</button></form>',
    ));
    expect(v.status).toBe('fail');
    expect(v.reason).toMatch(/disabled/);
  });

  it('fails a form with no submit control at all', () => {
    const v = classifyForm(form('<form action="/x"><input name="email"><div onclick="go()">Send</div></form>'));
    expect(v.status).toBe('fail');
    expect(v.reason).toMatch(/no submit control/);
  });

  it('does not count type="button" or type="reset" as submit controls', () => {
    expect(classifyForm(form(
      '<form action="/x"><input name="e"><button type="button">Go</button><button type="reset">Clear</button></form>',
    )).status).toBe('fail');
  });

  it('warns on a javascript: action', () => {
    const v = classifyForm(form(
      '<form action="javascript:send()"><input name="e"><button>Send</button></form>',
    ));
    expect(v.status).toBe('warn');
    expect(v.reason).toMatch(/JavaScript-only/);
  });

  it('warns on action="#"', () => {
    expect(classifyForm(form('<form action="#"><input name="e"><button>Send</button></form>')).status).toBe('warn');
  });

  it('warns when a field has no name (its value never reaches the server)', () => {
    const v = classifyForm(form(
      '<form action="/c"><input name="email"><textarea></textarea><button>Send</button></form>',
    ));
    expect(v.status).toBe('warn');
    expect(v.reason).toMatch(/without a name/);
  });

  it('does not require a name on submit/reset/button inputs', () => {
    expect(classifyForm(form(
      '<form action="/c"><input name="email"><input type="submit" value="Send"></form>',
    )).status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// contact path
// ---------------------------------------------------------------------------

describe('hasMachineContactPath', () => {
  const check = (html: string) => hasMachineContactPath(parse(html), html);

  it('accepts a mailto: link', () => {
    expect(check('<a href="mailto:hi@example.com">Write us</a>')).toBe(true);
  });
  it('accepts a tel: link', () => {
    expect(check('<a href="tel:+15550100">Call</a>')).toBe(true);
  });
  it('accepts a targetable form', () => {
    expect(check('<form action="/contact"><button>Send</button></form>')).toBe(true);
  });
  it('rejects a JavaScript-only form as the sole affordance', () => {
    expect(check('<form action="javascript:go()"><button>Send</button></form>')).toBe(false);
  });
  it('rejects a page whose only link is an ordinary page link', () => {
    expect(check('<a href="/contact">Contact</a>')).toBe(false);
  });
});

describe('jsonLdDeclaresContact', () => {
  it('accepts a telephone on an Organization', () => {
    expect(jsonLdDeclaresContact(
      '<script type="application/ld+json">{"@type":"Organization","telephone":"+1-555-0100"}</script>',
    )).toBe(true);
  });
  it('accepts a ContactPoint node inside a @graph', () => {
    expect(jsonLdDeclaresContact(
      '<script type="application/ld+json">{"@graph":[{"@type":"ContactPoint","url":"https://x/issues"}]}</script>',
    )).toBe(true);
  });
  it('rejects JSON-LD with no contact data', () => {
    expect(jsonLdDeclaresContact(
      '<script type="application/ld+json">{"@type":"WebSite","name":"X"}</script>',
    )).toBe(false);
  });
  it('ignores an unparseable block rather than throwing', () => {
    expect(jsonLdDeclaresContact('<script type="application/ld+json">{oops</script>')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

describe('agent-usability', () => {
  it('skips when no page is reachable', async () => {
    const ctx = makeCtx([]);
    const r = await agentUsability.run(ctx);
    expect(r.status).toBe('skip');
  });

  it('passes a site with a submittable form and a mailto:', async () => {
    const ctx = makeCtx([
      page('/', '<a href="mailto:hi@example.com">Mail</a>'),
      page('/contact', '<form method="post" action="/send"><input name="email"><button>Send</button></form>'),
    ]);
    const r = await agentUsability.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/1 form\(s\) submittable/);
    expect(r.points).toBe(agentUsability.maxPoints);
  });

  it('passes a form-less site that still exposes a phone number', async () => {
    const ctx = makeCtx([page('/', '<footer><a href="tel:+15550100">Call us</a></footer>')]);
    const r = await agentUsability.run(ctx);
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/no form to submit/);
  });

  it('fails when a quote form has a disabled submit button', async () => {
    const ctx = makeCtx([
      page('/', '<a href="tel:+15550100">Call</a>'),
      page('/contact', '<a href="tel:+15550100">Call</a>'
        + '<form><input name="email"><button type="submit" disabled>Send my request</button></form>'),
    ]);
    const r = await agentUsability.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('/contact');
    expect(r.message).toMatch(/disabled/);
    expect(r.points).toBe(0);
  });

  it('warns — not fails — when the only problem is a JavaScript-only action', async () => {
    const ctx = makeCtx([
      page('/', '<a href="mailto:hi@example.com">Mail</a>'
        + '<form action="javascript:send()"><input name="e"><button>Send</button></form>'),
    ]);
    const r = await agentUsability.run(ctx);
    expect(r.status).toBe('warn');
  });

  it('warns when nothing on the site is a machine-readable contact path', async () => {
    const ctx = makeCtx([page('/', '<h1>Blog</h1><p>Posts only.</p><a href="/about">About</a>')]);
    const r = await agentUsability.run(ctx);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/no machine-readable contact path/);
  });

  it('reports the worst form on a page, not the first', async () => {
    const ctx = makeCtx([
      page('/', '<a href="tel:+1">Call</a>'
        + '<form action="#"><input name="q"><button>Search</button></form>'
        + '<form><input name="e"><button disabled>Send</button></form>'),
    ]);
    const r = await agentUsability.run(ctx);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/disabled/);
  });
});
