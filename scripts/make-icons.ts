/**
 * Draws the app icon and writes every size the manifest, iOS and link previews
 * ask for. No image library: the shapes are two rounded rectangles, and PNG is
 * a container around a zlib stream, so both fit here without a dependency that
 * has to build native code in CI.
 *
 * Run with `npm run icons`. The output is committed, so a normal build and a
 * normal deploy never need this script.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Copied from src/styles/tokens.css. An icon cannot read a CSS variable. */
const BG = '#fff8f0';
const PRIMARY = '#6c4cf1';

/**
 * Card geometry in unit-square coordinates, so every size is the same picture.
 * The pair sits inside the middle 62%, which keeps it clear of the circle
 * Android crops a home-screen icon to.
 */
const CARD_W = 0.4;
const CARD_H = 0.54;
const CARD_R = 0.07;

/** Two lines of writing on the face, so the icon is a word card and not a tile. */
const LINES = [
  { cx: 0, cy: -0.035, w: 0.22, h: 0.045 },
  { cx: -0.04, cy: 0.055, w: 0.14, h: 0.045 },
];

/** Back card first. The one behind is the card this one was flipped from. */
const CARDS = [
  { angle: -14, alpha: 0.32, lines: false },
  { angle: 7, alpha: 1, lines: true },
];

/** 4x4 per pixel. Enough that the rounded corners do not stair-step at 32px. */
const SAMPLES = 4;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string): Rgb {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function mix(under: Rgb, over: Rgb, amount: number): Rgb {
  return {
    r: under.r + (over.r - under.r) * amount,
    g: under.g + (over.g - under.g) * amount,
    b: under.b + (over.b - under.b) * amount,
  };
}

interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Negative inside the rounded rectangle, positive outside, zero on the edge. */
function distance(x: number, y: number, box: Box, radius: number): number {
  const dx = Math.abs(x - box.cx) - (box.w / 2 - radius);
  const dy = Math.abs(y - box.cy) - (box.h / 2 - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

const CARD_BOX: Box = { cx: 0, cy: 0, w: CARD_W, h: CARD_H };

/** The card body first, then the writing on it, in the order they are painted. */
const SHAPES = [
  { box: CARD_BOX, radius: CARD_R },
  ...LINES.map((line) => ({ box: line, radius: line.h / 2 })),
];

/**
 * How much of this pixel each shape covers, from 0 to 1, measured in the
 * card's own rotated frame so the writing turns with the card it sits on.
 */
function coverages(x: number, y: number, step: number, angle: number): number[] {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);

  return SHAPES.map(({ box, radius }) => {
    let hits = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const px = x + ((sx + 0.5) / SAMPLES - 0.5) * step;
        const py = y + ((sy + 0.5) / SAMPLES - 0.5) * step;
        if (distance(px * cos - py * sin, px * sin + py * cos, box, radius) <= 0) hits += 1;
      }
    }
    return hits / (SAMPLES * SAMPLES);
  });
}

function pixels(width: number, height: number): Buffer {
  const background = parseHex(BG);
  const card = parseHex(PRIMARY);
  // The short side sets the scale, so a wide canvas is the square icon with
  // background either side rather than a stretched one.
  const unit = Math.min(width, height);
  const step = 1 / unit;

  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ux = (x + 0.5 - width / 2) / unit;
      const uy = (y + 0.5 - height / 2) / unit;

      let color = background;
      for (const { angle, alpha, lines } of CARDS) {
        const [body = 0, ...written] = coverages(ux, uy, step, angle);
        if (body > 0) color = mix(color, card, body * alpha);
        if (!lines) continue;
        // The writing is the background showing through, so it stays legible
        // whatever the card behind it is doing.
        for (const line of written) {
          if (line > 0) color = mix(color, background, line);
        }
      }

      const at = (y * width + x) * 3;
      out[at] = Math.round(color.r);
      out[at + 1] = Math.round(color.g);
      out[at + 2] = Math.round(color.b);
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number): Buffer {
  const rgb = pixels(width, height);

  // Every scanline carries filter type 0: the picture is flat color, so the
  // filters that help photographs would only cost time here.
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor, no alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svgRect(box: Box, radius: number, size: number, fill: string, alpha: number): string {
  const at = (unit: number) => (size / 2 + unit * size).toFixed(2);
  const span = (unit: number) => (unit * size).toFixed(2);
  return `<rect x="${at(box.cx - box.w / 2)}" y="${at(box.cy - box.h / 2)}" width="${span(box.w)}" height="${span(box.h)}" rx="${span(radius)}" fill="${fill}" fill-opacity="${String(alpha)}"/>`;
}

function svg(size: number): string {
  const half = (size / 2).toFixed(2);
  const groups = CARDS.map(({ angle, alpha, lines }) => {
    const shapes = [svgRect(CARD_BOX, CARD_R, size, PRIMARY, alpha)];
    if (lines) {
      for (const line of LINES) shapes.push(svgRect(line, line.h / 2, size, BG, 1));
    }
    return `  <g transform="rotate(${String(angle)} ${half} ${half})">\n    ${shapes.join('\n    ')}\n  </g>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(size)} ${String(size)}" width="${String(size)}" height="${String(size)}">
  <rect width="${String(size)}" height="${String(size)}" fill="${BG}"/>
${groups}
</svg>
`;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
mkdirSync(publicDir, { recursive: true });

const written: string[] = [];

function write(name: string, data: Buffer | string) {
  writeFileSync(resolve(publicDir, name), data);
  written.push(name);
}

write('icon.svg', svg(512));
write('favicon-32.png', png(32, 32));
write('apple-touch-icon.png', png(180, 180));
write('icon-192.png', png(192, 192));
write('icon-512.png', png(512, 512));
// Link previews crop to roughly 1.91:1, so the card is drawn into that frame
// rather than letting a messaging app cut a square in half.
write('og.png', png(1200, 630));

console.log(`✓ wrote ${String(written.length)} files: ${written.join(', ')}`);
