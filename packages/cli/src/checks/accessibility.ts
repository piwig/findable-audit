import type { Check } from '../types.js';
import { makeResult } from '../types.js';
import { pagesOf, pathOf, aggregate } from './aggregate.js';
import {
  parsePage, isValidBcp47, detectLandmarks, accessibleLinkName, formControlHasName,
} from './dom.js';

/** Truncate an offender path list to 3 entries + "(+N more)", matching the other MP checks. */
function offenderList(paths: string[]): string {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` (+${paths.length - 3} more)` : '');
}

// ---------------------------------------------------------------------------
// html-lang (MP): <html lang> present + valid BCP-47 on every sampled page
// ---------------------------------------------------------------------------

export const htmlLang: Check = {
  id: 'html-lang', family: 'accessibility', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const absent: string[] = [];
    const malformed: string[] = [];
    for (const p of pages) {
      const lang = (parsePage(p).querySelector('html')?.getAttribute('lang') ?? '').trim();
      if (!lang) absent.push(pathOf(p));
      else if (!isValidBcp47(lang)) malformed.push(pathOf(p));
    }
    if (absent.length === 0 && malformed.length === 0) {
      return makeResult(this, 'pass', `valid <html lang> on ${pages.length} sampled page(s)`);
    }
    // Absent is the worst case (screen readers cannot announce the language); grade it
    // by conformance ratio. A page with only a malformed code is a warn regardless.
    if (absent.length > 0) {
      const agg = aggregate(pages.length, [...absent, ...malformed]);
      return makeResult(this, agg.status, `html lang missing/invalid on: ${agg.detail}`,
        'Add <html lang="…"> with a valid BCP-47 code (e.g. "en", "fr-CA") to every page.');
    }
    return makeResult(this, 'warn', `html lang malformed on: ${offenderList(malformed)}`,
      'Use a valid BCP-47 language code in <html lang="…"> (e.g. "en", "en-US").');
  },
};

// ---------------------------------------------------------------------------
// alt-descriptive (MP): non-empty alts are genuinely descriptive
// ---------------------------------------------------------------------------

/** Placeholder alt words that convey nothing (spec §3.7 alt-descriptive). */
const PLACEHOLDER_ALT = /^(image|images|photo|photos|picture|pic|img|graphic|untitled|thumbnail|spacer)$/i;

/** true when an alt looks like a filename (has an image extension, or an IMG_1234/DSC0001 shape). */
function isFilenameAlt(alt: string): boolean {
  if (/\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i.test(alt)) return true;
  return /^(img|dsc|image|photo|screenshot|scan)[-_ ]?\d{2,}$/i.test(alt.trim());
}

/** true when a non-empty alt is a real description, not a filename/placeholder/too-short stub. */
export function isDescriptiveAlt(alt: string): boolean {
  const t = alt.trim();
  if (t.length < 3) return false;
  if (PLACEHOLDER_ALT.test(t)) return false;
  if (isFilenameAlt(t)) return false;
  return true;
}

export const altDescriptive: Check = {
  id: 'alt-descriptive', family: 'accessibility', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let descriptive = 0;
    for (const p of pages) {
      for (const img of parsePage(p).querySelectorAll('img')) {
        const alt = img.getAttribute('alt');
        if (alt === undefined) continue;    // missing alt is the images-alt check's concern
        if (alt.trim() === '') continue;    // decorative alt="" is intentional, not judged here
        total += 1;
        if (isDescriptiveAlt(alt)) descriptive += 1;
      }
    }
    if (total === 0) return makeResult(this, 'skip', 'no non-empty alt text to assess');
    const ratio = descriptive / total;
    const pct = Math.round(ratio * 100);
    if (ratio >= 0.9) return makeResult(this, 'pass', `${descriptive}/${total} non-empty alts are descriptive (${pct}%)`);
    return makeResult(this, ratio >= 0.7 ? 'warn' : 'fail', `non-descriptive alt text (${pct}% descriptive)`,
      'Replace filename/placeholder alt text ("image", "IMG_1234.jpg") with a real description of the image.');
  },
};

// ---------------------------------------------------------------------------
// landmarks (MP): single <main> + >=2 of header/nav/footer
// ---------------------------------------------------------------------------

type LandmarkVerdict = 'pass' | 'warn' | 'fail';

function landmarkVerdict(root: ReturnType<typeof parsePage>): LandmarkVerdict {
  const { hasMain, regions } = detectLandmarks(root);
  if (hasMain && regions.size >= 2) return 'pass';
  if (hasMain || regions.size >= 1) return 'warn';
  return 'fail';
}

export const landmarks: Check = {
  id: 'landmarks', family: 'accessibility', maxPoints: 4,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    const failing: string[] = [];
    const incomplete: string[] = [];
    for (const p of pages) {
      const v = landmarkVerdict(parsePage(p));
      if (v === 'fail') failing.push(pathOf(p));
      else if (v === 'warn') incomplete.push(pathOf(p));
    }
    if (failing.length > 0) {
      const agg = aggregate(pages.length, failing);
      return makeResult(this, agg.status, `no semantic landmarks on: ${agg.detail}`,
        'Wrap page content in a single <main> and use <header>/<nav>/<footer> landmark regions.');
    }
    if (incomplete.length > 0) {
      return makeResult(this, 'warn', `incomplete landmarks (main only / no main) on: ${offenderList(incomplete)}`,
        'Provide both a <main> and at least two of <header>/<nav>/<footer>.');
    }
    return makeResult(this, 'pass', `semantic landmarks on ${pages.length} sampled page(s)`);
  },
};

// ---------------------------------------------------------------------------
// form-labels (MP, skip if no forms): every control has an accessible name
// ---------------------------------------------------------------------------

/** input types that carry no user-facing value and need no label. */
const UNLABELLED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export const formLabels: Check = {
  id: 'form-labels', family: 'accessibility', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let unlabelled = 0;
    for (const p of pages) {
      const root = parsePage(p);
      const labelForIds = new Set<string>();
      for (const l of root.querySelectorAll('label[for]')) {
        const forId = l.getAttribute('for');
        if (forId) labelForIds.add(forId);
      }
      for (const el of root.querySelectorAll('input, select, textarea')) {
        if (el.tagName.toLowerCase() === 'input'
          && UNLABELLED_INPUT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase())) continue;
        total += 1;
        if (!formControlHasName(el, labelForIds)) unlabelled += 1;
      }
    }
    if (total === 0) return makeResult(this, 'skip', 'no labelable form controls on sampled pages');
    if (unlabelled === 0) return makeResult(this, 'pass', `all ${total} form control(s) have an accessible name`);
    const ratio = unlabelled / total;
    const status = unlabelled > 2 || ratio > 0.2 ? 'fail' : 'warn';
    return makeResult(this, status, `${unlabelled}/${total} form control(s) without an accessible name`,
      'Associate every input/select/textarea with a <label>, aria-label, or aria-labelledby.');
  },
};

// ---------------------------------------------------------------------------
// link-text (MP): links have an accessible name
// ---------------------------------------------------------------------------

export const linkText: Check = {
  id: 'link-text', family: 'accessibility', maxPoints: 3,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let nameless = 0;
    const offenders = new Set<string>();
    for (const p of pages) {
      for (const a of parsePage(p).querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') ?? '';
        if (!href || href.startsWith('#')) continue;
        total += 1;
        if (!accessibleLinkName(a)) { nameless += 1; offenders.add(pathOf(p)); }
      }
    }
    if (total === 0) return makeResult(this, 'pass', 'no links to evaluate on sampled pages');
    if (nameless === 0) return makeResult(this, 'pass', `all ${total} link(s) have an accessible name`);
    const status = nameless <= 2 ? 'warn' : 'fail';
    return makeResult(this, status, `${nameless} link(s) without an accessible name on: ${offenderList([...offenders])}`,
      'Give icon/image links an accessible name via link text, aria-label, or a child <img alt>.');
  },
};

// ---------------------------------------------------------------------------
// viewport-zoom (SH): viewport does not disable pinch-zoom (WCAG 1.4.4)
// ---------------------------------------------------------------------------

export const viewportZoom: Check = {
  id: 'viewport-zoom', family: 'accessibility', maxPoints: 3,
  async run(ctx) {
    const res = await ctx.fetch('/');
    if (res?.status !== 200) return makeResult(this, 'fail', 'homepage not reachable');
    const content = parsePage(res).querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    if (!content.trim()) return makeResult(this, 'pass', 'no viewport meta restricting zoom');
    const props = new Map<string, string>();
    for (const part of content.split(',')) {
      const [k, v] = part.split('=');
      if (k && v !== undefined) props.set(k.trim().toLowerCase(), v.trim().toLowerCase());
    }
    const userScalable = props.get('user-scalable');
    if (userScalable === 'no' || userScalable === '0') {
      return makeResult(this, 'fail', 'zoom disabled (user-scalable=no) — fails WCAG 1.4.4',
        'Remove user-scalable=no and any maximum-scale below 2 from the viewport meta.');
    }
    const maxScale = Number.parseFloat(props.get('maximum-scale') ?? '');
    if (!Number.isNaN(maxScale) && maxScale < 2) {
      if (maxScale <= 1) {
        return makeResult(this, 'fail', `zoom disabled (maximum-scale=${maxScale}) — fails WCAG 1.4.4`,
          'Remove the maximum-scale restriction (or set it to at least 2).');
      }
      return makeResult(this, 'warn', `zoom limited (maximum-scale=${maxScale})`,
        'Allow zoom up to at least 2x; prefer omitting maximum-scale entirely.');
    }
    return makeResult(this, 'pass', 'viewport allows pinch-zoom');
  },
};

// ---------------------------------------------------------------------------
// iframe-title (MP, skip if no iframes): every iframe has a title/aria-label
// ---------------------------------------------------------------------------

export const iframeTitle: Check = {
  id: 'iframe-title', family: 'accessibility', maxPoints: 2,
  async run(ctx) {
    const pages = await pagesOf(ctx);
    if (pages.length === 0) return makeResult(this, 'fail', 'no page reachable');
    let total = 0;
    let untitled = 0;
    for (const p of pages) {
      for (const f of parsePage(p).querySelectorAll('iframe')) {
        total += 1;
        const title = (f.getAttribute('title') ?? '').trim();
        const aria = (f.getAttribute('aria-label') ?? '').trim();
        if (!title && !aria) untitled += 1;
      }
    }
    if (total === 0) return makeResult(this, 'skip', 'no iframes on sampled pages');
    if (untitled === 0) return makeResult(this, 'pass', `all ${total} iframe(s) have a title`);
    return makeResult(this, untitled >= 2 ? 'fail' : 'warn', `${untitled}/${total} iframe(s) untitled`,
      'Add a descriptive title="…" to every <iframe>.');
  },
};
