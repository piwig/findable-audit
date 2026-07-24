// Dependency-free PNG generation for the two raster brand assets the SEO/GEO
// checks require as real files: the Open Graph card (og:image must be an
// absolute https URL, ~1200x630) and the apple-touch-icon (180x180).
//
// Everything is computed once at module init from pure math + node:zlib —
// no binary committed to the repo, no image library, fully deterministic.
// Visual language mirrors the inline SVG logomark in server.mjs: the
// "Aube verte" gradient (#3bbf6b → #1a7f37 → #0f766e) + white magnifier.

import zlib from 'node:zlib';

// --- Minimal PNG encoder (RGB, 8-bit, filter 0) ----------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode an RGB pixel buffer (3 bytes/px, row-major) as a PNG file. */
export function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Tiny raster canvas ----------------------------------------------------

const GRAD = [[0x3b, 0xbf, 0x6b], [0x1a, 0x7f, 0x37], [0x0f, 0x76, 0x6e]]; // brand stops at 0 / .55 / 1
const WHITE = [255, 255, 255];

function gradientAt(t) {
  const [a, b, c] = GRAD;
  if (t <= 0.55) {
    const k = t / 0.55;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }
  const k = (t - 0.55) / 0.45;
  return [b[0] + (c[0] - b[0]) * k, b[1] + (c[1] - b[1]) * k, b[2] + (c[2] - b[2]) * k];
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.px = Buffer.alloc(width * height * 3);
  }

  /** Diagonal brand gradient over the whole canvas. */
  fillGradient() {
    const span = this.width + this.height;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const [r, g, b] = gradientAt((x + y) / span);
        const i = (y * this.width + x) * 3;
        this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b;
      }
    }
  }

  blend(x, y, color, alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = Math.min(1, alpha);
    const i = (y * this.width + x) * 3;
    this.px[i] = this.px[i] * (1 - a) + color[0] * a;
    this.px[i + 1] = this.px[i + 1] * (1 - a) + color[1] * a;
    this.px[i + 2] = this.px[i + 2] * (1 - a) + color[2] * a;
  }

  /** Anti-aliased ring (magnifier lens): |dist(center) - r| <= w/2. */
  ring(cx, cy, r, w, color = WHITE) {
    const half = w / 2;
    const pad = Math.ceil(r + half + 2);
    for (let y = cy - pad; y <= cy + pad; y++) {
      for (let x = cx - pad; x <= cx + pad; x++) {
        const d = Math.abs(Math.hypot(x - cx, y - cy) - r);
        this.blend(x, y, color, half + 0.5 - d); // 1px AA falloff
      }
    }
  }

  /** Anti-aliased thick segment with round caps (magnifier handle). */
  capsule(x1, y1, x2, y2, w, color = WHITE) {
    const half = w / 2;
    const minX = Math.floor(Math.min(x1, x2) - half - 2);
    const maxX = Math.ceil(Math.max(x1, x2) + half + 2);
    const minY = Math.floor(Math.min(y1, y2) - half - 2);
    const maxY = Math.ceil(Math.max(y1, y2) + half + 2);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        this.blend(x, y, color, half + 0.5 - d);
      }
    }
  }

  rect(x0, y0, w, h, color = WHITE) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.blend(x, y, color, 1);
  }
}

// --- 5x7 pixel font (only the glyphs the two assets need) ------------------

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(canvas, text, x0, y0, scale, color = WHITE) {
  let x = x0;
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') canvas.rect(x + col * scale, y0 + row * scale, scale, scale, color);
      }
    }
    x += 6 * scale; // 5px glyph + 1px spacing
  }
  return x - x0 - scale; // rendered width
}

function textWidth(text, scale) { return text.length * 6 * scale - scale; }

// --- The two assets --------------------------------------------------------

/** 1200x630 Open Graph / Twitter card. */
function buildOgCard() {
  const W = 1200;
  const H = 630;
  const c = new Canvas(W, H);
  c.fillGradient();
  // Magnifier, centered in the upper half.
  c.ring(600, 185, 82, 22);
  c.capsule(659, 244, 723, 308, 26);
  // Wordmark + tagline, centered.
  const word = 'FINDABLE-AUDIT';
  drawText(c, word, Math.round((W - textWidth(word, 9)) / 2), 385, 9);
  const tag = 'SEO + GEO AUDIT - GRADED A-F';
  drawText(c, tag, Math.round((W - textWidth(tag, 4)) / 2), 505, 4);
  return encodePng(W, H, c.px);
}

/** 180x180 apple-touch-icon (full-bleed: iOS applies its own corner mask). */
function buildTouchIcon() {
  const S = 180;
  const c = new Canvas(S, S);
  c.fillGradient();
  c.ring(78, 78, 40, 14);
  c.capsule(108, 108, 140, 140, 18);
  return encodePng(S, S, c.px);
}

export const OG_IMAGE_PNG = buildOgCard();
export const TOUCH_ICON_PNG = buildTouchIcon();
