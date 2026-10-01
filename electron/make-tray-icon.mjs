/**
 * electron/make-tray-icon.mjs — paint the tray/window icon with zero deps.
 * Generates a 32×32 PNG: Sofia's cyan orb glow on transparency.
 * Run: `node electron/make-tray-icon.mjs` (writes electron/tray.png).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 32;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Soft radial glow: white-hot core → sky blue → transparent. */
function paint() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let o = 0;
  const c = (SIZE - 1) / 2;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c) / c; // 0 centre → ~1.4 corner
      const glow = Math.max(0, 1 - d);
      const core = Math.max(0, 1 - d * 2.2);
      const a = Math.round(255 * Math.pow(glow, 1.6));
      // lerp sky (56,189,248) → white (255,255,255) by core heat
      raw[o++] = Math.round(56 + (255 - 56) * core);
      raw[o++] = Math.round(189 + (255 - 189) * core);
      raw[o++] = 255;
      raw[o++] = a;
    }
  }
  return raw;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: truecolour + alpha

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(paint(), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), 'tray.png');
writeFileSync(out, png);
console.log(`[sophia-desktop] wrote ${out} (${png.length} bytes)`);
