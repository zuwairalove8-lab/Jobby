#!/usr/bin/env node
/**
 * Generates the JOBBY icon set without any image dependency.
 * Draws a rounded gradient tile with a minimal robot glyph and encodes a PNG
 * directly (zlib + CRC32), then copies Android launcher densities when present.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------- PNG writer ------------------------------- */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------- painting -------------------------------- */

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

function render(size, { padding = 0 } = {}) {
  const buffer = Buffer.alloc(size * size * 4, 0);
  const inner = size - padding * 2;
  const radius = inner * 0.24;
  const cyan = hex('#00d4ff');
  const violet = hex('#7b61ff');
  const dark = hex('#04121c');

  const blend = (x, y, [r, g, b], alpha) => {
    if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
    const i = (y * size + x) * 4;
    const a = Math.min(1, alpha);
    buffer[i] = Math.round(buffer[i] * (1 - a) + r * a);
    buffer[i + 1] = Math.round(buffer[i + 1] * (1 - a) + g * a);
    buffer[i + 2] = Math.round(buffer[i + 2] * (1 - a) + b * a);
    buffer[i + 3] = Math.round(Math.min(255, buffer[i + 3] + 255 * a));
  };

  const inRoundRect = (x, y, left, top, width, height, r) => {
    if (x < left || y < top || x > left + width || y > top + height) return false;
    const cx = Math.min(Math.max(x, left + r), left + width - r);
    const cy = Math.min(Math.max(y, top + r), top + height - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= left + r && x <= left + width - r) || (y >= top + r && y <= top + height - r);
  };

  // background tile with a diagonal cyan→violet gradient
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!inRoundRect(x, y, padding, padding, inner, inner, radius)) continue;
      const t = Math.min(1, Math.max(0, (x - padding + (y - padding)) / (inner * 2)));
      const color = [
        Math.round(cyan[0] + (violet[0] - cyan[0]) * t),
        Math.round(cyan[1] + (violet[1] - cyan[1]) * t),
        Math.round(cyan[2] + (violet[2] - cyan[2]) * t),
      ];
      blend(x, y, color, 1);
    }
  }

  // robot head
  const headW = inner * 0.46;
  const headH = inner * 0.38;
  const headX = padding + (inner - headW) / 2;
  const headY = padding + inner * 0.34;
  const headR = headW * 0.24;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inRoundRect(x, y, headX, headY, headW, headH, headR)) blend(x, y, dark, 0.92);
    }
  }

  // eyes
  const eyeR = inner * 0.035;
  for (const offset of [-0.09, 0.09]) {
    const ex = padding + inner / 2 + inner * offset;
    const ey = headY + headH / 2;
    for (let y = -eyeR; y <= eyeR; y += 1) {
      for (let x = -eyeR; x <= eyeR; x += 1) {
        if (x * x + y * y <= eyeR * eyeR) blend(Math.round(ex + x), Math.round(ey + y), cyan, 1);
      }
    }
  }

  // antenna
  const antennaX = padding + inner / 2;
  const antennaTop = headY - inner * 0.11;
  const antennaW = Math.max(1.4, inner * 0.022);
  for (let y = antennaTop; y < headY; y += 1) {
    for (let x = antennaX - antennaW; x <= antennaX + antennaW; x += 1) {
      blend(Math.round(x), Math.round(y), dark, 0.92);
    }
  }
  const dotR = inner * 0.035;
  for (let y = -dotR; y <= dotR; y += 1) {
    for (let x = -dotR; x <= dotR; x += 1) {
      if (x * x + y * y <= dotR * dotR) {
        blend(Math.round(antennaX + x), Math.round(antennaTop + y), dark, 0.92);
      }
    }
  }

  // shoulder bar
  const barW = inner * 0.34;
  const barH = inner * 0.055;
  const barX = padding + (inner - barW) / 2;
  const barY = headY + headH + inner * 0.06;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inRoundRect(x, y, barX, barY, barW, barH, barH / 2)) blend(x, y, dark, 0.75);
    }
  }

  return encodePng(size, size, buffer);
}

/* --------------------------------- output --------------------------------- */

const targets = [
  ['public/icons/icon-192.png', 192, {}],
  ['public/icons/icon-512.png', 512, {}],
  ['public/icons/maskable-512.png', 512, { padding: 42 }],
  ['public/icons/apple-touch-icon.png', 180, {}],
  ['public/favicon.png', 64, {}],
];

for (const [path, size, options] of targets) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, render(size, options));
  console.log(`wrote ${path} (${size}px)`);
}

const androidMipmaps = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

const androidRes = join(root, 'android/app/src/main/res');
if (existsSync(androidRes)) {
  for (const [folder, size] of androidMipmaps) {
    const dir = join(androidRes, folder);
    mkdirSync(dir, { recursive: true });
    const png = render(size);
    writeFileSync(join(dir, 'ic_launcher.png'), png);
    writeFileSync(join(dir, 'ic_launcher_round.png'), png);
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), render(size * 2, { padding: Math.round(size * 0.3) }));
  }
  console.log('updated Android launcher icons');
  const splash = join(androidRes, 'drawable', 'splash.png');
  if (existsSync(splash)) {
    copyFileSync(join(root, 'public/icons/icon-512.png'), splash);
    console.log('refreshed Android splash image');
  }
} else {
  console.log('android/ not present yet — run `npx cap add android` then re-run `npm run icons`');
}
