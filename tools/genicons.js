/**
 * genicons.js - generates the extension's icon set (icon16/32/48/128.png)
 * from icons/icon-master.png (the 1536x1536 map-card asset).
 *
 * Pure Node, zero dependencies: minimal PNG decoder (8-bit RGB/RGBA, no
 * interlace), premultiplied box-filter downscale for clean edges at tiny
 * sizes, and the hand-rolled PNG encoder.
 *
 * Run: node tools/genicons.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(
      raw,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// PNG decoder (8-bit RGB/RGBA, no interlace) -> premultiplied RGBA buffer
// ---------------------------------------------------------------------------
function decodePNG(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('Not a PNG file.');

  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (pos + 8 < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('Only 8-bit PNG is supported.');
      colorType = data[9];
      if (colorType !== 6 && colorType !== 2) {
        throw new Error('Unsupported color type ' + colorType + ' (need RGBA or RGB).');
      }
      if (data[12]) throw new Error('Interlaced PNG is not supported.');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) {
    throw new Error('Truncated PNG data.');
  }

  const out = Buffer.alloc(width * height * 4);
  const row = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    raw.copy(row, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    unfilter(raw[y * (stride + 1)], row, prev, bpp);
    for (let x = 0; x < width; x++) {
      const c = x * bpp;
      const d = (y * width + x) * 4;
      const r = row[c];
      const g = row[c + 1];
      const b = row[c + 2];
      const a = bpp === 4 ? row[c + 3] : 255;
      // premultiply for correct averaging over transparent corners
      out[d] = (r * a) >> 8;
      out[d + 1] = (g * a) >> 8;
      out[d + 2] = (b * a) >> 8;
      out[d + 3] = a;
    }
    prev.set(row);
  }
  return { width, height, pixels: out };
}

function unfilter(filter, row, prev, bpp) {
  switch (filter) {
    case 0:
      break;
    case 1:
      for (let i = bpp; i < row.length; i++) {
        row[i] = (row[i] + row[i - bpp]) & 0xff;
      }
      break;
    case 2:
      for (let i = 0; i < row.length; i++) {
        row[i] = (row[i] + prev[i]) & 0xff;
      }
      break;
    case 3:
      for (let i = 0; i < bpp; i++) {
        row[i] = (row[i] + (prev[i] >> 1)) & 0xff;
      }
      for (let i = bpp; i < row.length; i++) {
        row[i] = (row[i] + ((row[i - bpp] + prev[i]) >> 1)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < row.length; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[i] = (row[i] + pred) & 0xff;
      }
      break;
    default:
      throw new Error('Unknown PNG filter ' + filter);
  }
}

// ---------------------------------------------------------------------------
// Box-filter downscale (premultiplied in -> straight RGBA out)
// ---------------------------------------------------------------------------
function downscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * sw) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const alpha = Math.round(a / n);
      const o = (y * dw + x) * 4;
      const m = alpha ? 255 / alpha : 0;
      out[o] = Math.min(255, Math.round((r / n) * m));
      out[o + 1] = Math.min(255, Math.round((g / n) * m));
      out[o + 2] = Math.min(255, Math.round((b / n) * m));
      out[o + 3] = alpha;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const SIZES = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');
const master = decodePNG(
  fs.readFileSync(path.join(iconsDir, 'icon-master.png'))
);
for (const size of SIZES) {
  const pixels = downscale(master.pixels, master.width, master.height, size, size);
  fs.writeFileSync(
    path.join(iconsDir, `icon${size}.png`),
    encodePNG(size, size, pixels)
  );
  console.log(`icon${size}.png written (${size}x${size})`);
}
