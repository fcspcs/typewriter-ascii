/**
 * png.mjs — read and write PNG without a canvas.
 *
 * The browser gets image decoding free from `<canvas>`. Node does not, and
 * that single gap is why the command line could not touch pictures at all.
 * Everything here is plumbing: get pixels in, get pixels out, so the real
 * pipeline in src/core/convert.js can run unchanged in both places.
 *
 * PNG only, and on purpose. This app is for silhouettes and line drawings —
 * exactly the material that is already PNG. A JPEG decoder is several hundred
 * lines of DCT that would earn its keep on photographs, which do not survive
 * the trip to a typewriter anyway. Anything else gets a clear message telling
 * the caller what to do about it, which is more useful than a partial decoder
 * that fails in the middle.
 *
 * Node only — it uses node:zlib.
 */

import zlib from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel for each PNG colour type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

class PngError extends Error {}

/**
 * What kind of file is this, judged by its first bytes rather than its name?
 * A wrong extension is common enough that guessing from the name produces a
 * baffling error a long way from the cause.
 */
export function sniff(buf) {
  const starts = (...b) => b.every((v, i) => buf[i] === v);
  if (starts(...SIGNATURE)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x47, 0x49, 0x46)) return 'gif';
  if (starts(0x42, 0x4d)) return 'bmp';
  if (starts(0x52, 0x49, 0x46, 0x46) && buf[8] === 0x57) return 'webp';
  // SVG and other text formats, after any byte-order mark or leading space.
  const head = buf.subarray(0, 200).toString('latin1').trim().toLowerCase();
  if (head.includes('<svg') || head.startsWith('<?xml')) return 'svg';
  return 'unknown';
}

/** Paeth predictor, straight from the PNG specification. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Undo the per-scanline filters. This runs in place over the inflated bytes,
 * which arrive as [filter byte][scanline][filter byte][scanline]…
 *
 * @returns {Buffer} the unfiltered rows, filter bytes removed
 */
function unfilter(raw, height, rowBytes, bpp) {
  const out = Buffer.alloc(height * rowBytes);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const type = raw[pos++];
    const row = y * rowBytes;
    const prev = row - rowBytes;

    for (let i = 0; i < rowBytes; i++) {
      const x = raw[pos + i];
      const a = i >= bpp ? out[row + i - bpp] : 0;        // left
      const b = y > 0 ? out[prev + i] : 0;                // above
      const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;  // above-left
      let v;
      switch (type) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new PngError(`Unknown scanline filter ${type}.`);
      }
      out[row + i] = v & 0xff;
    }
    pos += rowBytes;
  }
  return out;
}

/** Pull sample number `i` out of a packed row of `depth`-bit samples. */
function sampleAt(row, i, depth) {
  if (depth === 8) return row[i];
  if (depth === 16) return row[i * 2];          // high byte is enough here
  const per = 8 / depth;                        // samples per byte
  const byte = row[Math.floor(i / per)];
  const shift = 8 - depth * ((i % per) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

/**
 * Decode a PNG into the same shape the browser hands us from
 * `getImageData`: width, height, and RGBA bytes.
 *
 * @param {Buffer} buf
 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
 */
export function decodePng(buf) {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new PngError('Not a PNG file.');
  }

  let width = 0, height = 0, depth = 8, colour = 6, interlace = 0;
  let palette = null, transparency = null;
  const idat = [];

  let pos = 8;
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;                          // length + type + data + crc

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colour = body[9];
      if (body[10] !== 0) throw new PngError('Unknown compression method.');
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height) throw new PngError('PNG header is missing.');
  if (interlace !== 0) {
    throw new PngError(
      'Interlaced (Adam7) PNG. Re-save it without interlacing.');
  }
  const channels = CHANNELS[colour];
  if (!channels) throw new PngError(`Unknown colour type ${colour}.`);
  if (colour === 3 && !palette) throw new PngError('Palette image has no PLTE.');

  const rowBytes = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  const rows = unfilter(
    zlib.inflateSync(Buffer.concat(idat)), height, rowBytes, bpp);

  const data = new Uint8ClampedArray(width * height * 4);
  // Scale a sample of this bit depth up to 0…255.
  const full = (1 << depth) - 1;
  const up = (v) => (depth === 16 ? v : Math.round((v * 255) / full));

  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;

      if (colour === 3) {
        const idx = sampleAt(row, s, depth);
        data[o] = palette[idx * 3];
        data[o + 1] = palette[idx * 3 + 1];
        data[o + 2] = palette[idx * 3 + 2];
        data[o + 3] = transparency && idx < transparency.length
          ? transparency[idx] : 255;
      } else if (colour === 0 || colour === 4) {
        const g = up(sampleAt(row, s, depth));
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = colour === 4
          ? up(sampleAt(row, s + 1, depth)) : 255;
      } else {
        data[o] = up(sampleAt(row, s, depth));
        data[o + 1] = up(sampleAt(row, s + 1, depth));
        data[o + 2] = up(sampleAt(row, s + 2, depth));
        data[o + 3] = colour === 6
          ? up(sampleAt(row, s + 3, depth)) : 255;
      }
    }
  }

  // A single transparent colour, rather than an alpha channel.
  if (transparency && (colour === 0 || colour === 2)) {
    const key = colour === 0
      ? [up(transparency.readUInt16BE(0))].concat([0, 0])
      : [0, 1, 2].map((i) => up(transparency.readUInt16BE(i * 2)));
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const hit = colour === 0
        ? data[o] === key[0]
        : data[o] === key[0] && data[o + 1] === key[1] && data[o + 2] === key[2];
      if (hit) data[o + 3] = 0;
    }
  }

  return { width, height, data };
}

/**
 * Read an image file, with a message worth reading when it is not a PNG.
 * @param {Buffer} buf
 * @param {string} name for the error message
 */
export function readImage(buf, name = 'that file') {
  const kind = sniff(buf);
  if (kind === 'png') return decodePng(buf);
  throw new PngError(
    `${name} is ${kind === 'unknown' ? 'not an image this tool reads' : `a ${kind.toUpperCase()}`}. ` +
    `Only PNG is supported here — convert it first, for example:\n` +
    `  magick input.${kind === 'unknown' ? 'xxx' : kind} output.png`);
}

/**
 * Shrink so the longest side is at most `maxSide`, by averaging the pixels
 * that fall in each destination cell.
 *
 * The browser gets this from `drawImage` into a smaller canvas. Doing it here
 * too is not decoration: the blur radius downstream is measured in pixels of
 * *this* image, so a 4000 px source and a 900 px one would otherwise be
 * prepared quite differently. Box averaging rather than nearest neighbour,
 * because dropping pixels from a line drawing drops whole lines.
 */
export function scaleTo(img, maxSide = 900) {
  const { width: w, height: h, data } = img;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  if (scale === 1) return img;

  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const out = new Uint8ClampedArray(nw * nh * 4);

  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
          n++;
        }
      }
      const o = (y * nw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: nw, height: nh, data: out };
}

/**
 * Write an ink field back out as a greyscale PNG.
 *
 * For looking at what the pipeline actually did. A table of numbers tells you
 * the ink survived; a picture tells you whether it still looks like the
 * drawing. Ink is inverted back to paper-and-ink on the way out, so the file
 * looks like the thing you fed in.
 *
 * @param {{data: Float32Array, w: number, h: number}} field
 * @returns {Buffer}
 */
export function encodeField(field) {
  const { w, h, data } = field;
  // One filter byte per row, filter type 0 — the field is already small.
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      raw[y * (w + 1) + 1 + x] = Math.round(255 * (1 - Math.min(1, Math.max(0, v))));
    }
  }

  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 0;      // greyscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
