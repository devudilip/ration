// Generates the extension icons as PNGs using only node built-ins,
// so the repo needs no image tooling. Run: npm run icons
// Design: rounded dark square with three "ration bars" of decreasing fill —
// a tiny gauge, which is what the product is.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = new URL('../public/icons/', import.meta.url);
const BG = [0x1f, 0x29, 0x37, 255]; // slate
const BAR_BG = [0x4b, 0x5b, 0x71, 255];
const BARS = [
  { fill: 0.85, color: [0x34, 0xd3, 0x99, 255] }, // green
  { fill: 0.45, color: [0xfb, 0xbf, 0x24, 255] }, // amber
  { fill: 0.15, color: [0xf8, 0x71, 0x71, 255] }, // red
];

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
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

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4); // transparent
  const put = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const radius = Math.max(2, Math.round(size * 0.19));
  const inside = (x, y) => {
    const r = radius;
    const cx = x < r ? r : x >= size - r ? size - r - 1 : x;
    const cy = y < r ? r : y >= size - r ? size - r - 1 : y;
    if (cx === x || cy === y) return true;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (inside(x, y)) put(x, y, BG);

  const pad = Math.max(2, Math.round(size * 0.19));
  const trackW = size - pad * 2;
  const barH = Math.max(1, Math.round(size * 0.11));
  const gap = Math.max(1, Math.round(size * 0.09));
  const totalH = BARS.length * barH + (BARS.length - 1) * gap;
  let y0 = Math.round((size - totalH) / 2);
  for (const { fill, color } of BARS) {
    const fillW = Math.max(1, Math.round(trackW * fill));
    for (let dy = 0; dy < barH; dy++)
      for (let dx = 0; dx < trackW; dx++)
        put(pad + dx, y0 + dy, dx < fillW ? color : BAR_BG);
    y0 += barH + gap;
  }
  return px;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = new URL(`icon${size}.png`, OUT_DIR);
  writeFileSync(file, png(size, draw(size)));
  console.log(`wrote public/icons/icon${size}.png`);
}
