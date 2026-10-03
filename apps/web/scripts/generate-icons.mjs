// Generates the PWA icons (PNG) and favicon (SVG) into public/. Zero dependencies:
// shapes are rasterized with 4x4 supersampling and encoded with node:zlib.
// Run: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 23, 42]; // slate-900
const FG = [248, 250, 252]; // slate-50
const ACCENT = [56, 189, 248]; // sky-400

/** Shapes in a 0..1 unit square (inside the safe area handled by `inset`). */
function shapeAt(x, y) {
  // Briefcase body
  const body = roundRect(x, y, 0.16, 0.34, 0.84, 0.8, 0.07);
  // Handle (outline)
  const handleOuter = roundRect(x, y, 0.36, 0.2, 0.64, 0.4, 0.06);
  const handleInner = roundRect(x, y, 0.42, 0.26, 0.58, 0.4, 0.03);
  // Check mark across the body (the "tracked" part)
  const check = segment(x, y, 0.33, 0.57, 0.46, 0.69, 0.045) || segment(x, y, 0.46, 0.69, 0.68, 0.46, 0.045);
  if (check && body) return ACCENT;
  if (body || (handleOuter && !handleInner)) return FG;
  return null;
}

function roundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function segment(x, y, ax, ay, bx, by, w) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= w * w;
}

/** size px; `inset` shrinks the glyph (maskable icons need a ~20% safe zone); `rounded` clips corners. */
function render(size, { inset = 0.1, rounded = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) {
          const u = (i + (si + 0.5) / S) / size;
          const v = (j + (sj + 0.5) / S) / size;
          if (rounded && !roundRect(u, v, 0, 0, 1, 1, 0.22)) continue;
          const gu = (u - inset) / (1 - 2 * inset);
          const gv = (v - inset) / (1 - 2 * inset);
          const c = shapeAt(gu, gv) ?? BG;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = S * S, o = (j * size + i) * 4;
      const cover = a / 255;
      px[o] = cover ? r / cover : 0;
      px[o + 1] = cover ? g / cover : 0;
      px[o + 2] = cover ? b / cover : 0;
      px[o + 3] = a / n;
    }
  }
  return encodePng(size, size, px);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const out = new URL('../public/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon-192.png', out), render(192));
writeFileSync(new URL('icon-512.png', out), render(512));
// Maskable: full-bleed background, glyph inside the 80% safe zone.
writeFileSync(new URL('icon-maskable-512.png', out), render(512, { inset: 0.22, rounded: false }));
writeFileSync(new URL('apple-touch-icon.png', out), render(180, { rounded: false }));
writeFileSync(
  new URL('favicon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="rgb(${BG})"/>
  <g transform="translate(10 10) scale(0.8)">
    <path d="M36 40V26a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v14h-6V26H42v14z" fill="rgb(${FG})"/>
    <rect x="16" y="34" width="68" height="46" rx="7" fill="rgb(${FG})"/>
    <path d="M33 57l13 12 22-23" fill="none" stroke="rgb(${ACCENT})" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`,
);
console.log('icons written to public/');
