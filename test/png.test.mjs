/**
 * Reading pictures without a canvas.
 *
 * The command line could not touch images at all, so the picture pipeline —
 * the part of this app most likely to go wrong — had no second door and no
 * way to be looked at from a script. These tests cover the plumbing that
 * opened it: get pixels in, get pixels out, and shrink them the way the
 * browser does, because the blur radius downstream is counted in pixels of
 * the working image.
 */
import assert from 'node:assert';
import zlib from 'node:zlib';
import { decodePng, encodeField, readImage, scaleTo, sniff } from '../tools/png.mjs';
import { toInk } from '../src/core/convert.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = -1;
  for (const v of b) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * Build a PNG by hand, so the decoder is tested against the format rather
 * than against our own encoder agreeing with itself.
 *
 * @param {number} colour PNG colour type
 * @param {number} depth  bits per sample
 * @param {Buffer[]} rows unfiltered scanlines
 * @param {Object} [extra] { palette, transparency }
 */
function png(w, h, colour, depth, rows, extra = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = colour;

  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r])));
  const parts = [SIGNATURE, chunk('IHDR', ihdr)];
  if (extra.palette) parts.push(chunk('PLTE', extra.palette));
  if (extra.transparency) parts.push(chunk('tRNS', extra.transparency));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const pixel = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [...img.data.slice(i, i + 4)];
};

console.log('what kind of file is this');

check('a PNG is recognised by its bytes', () => {
  assert.strictEqual(sniff(png(1, 1, 0, 8, [Buffer.from([0])])), 'png');
});

check('other formats are named, so the message can say what to do', () => {
  assert.strictEqual(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.strictEqual(sniff(Buffer.from('GIF89a')), 'gif');
  assert.strictEqual(sniff(Buffer.from('BM....')), 'bmp');
  assert.strictEqual(sniff(Buffer.from('<svg xmlns="...">')), 'svg');
});

check('a JPEG is refused by name, not by a decoding accident', () => {
  // A partial decoder that fails somewhere in the middle of the file tells
  // the caller nothing they can act on.
  assert.throws(() => readImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x.jpg'),
    /JPEG/);
});

console.log('colour types');

check('8-bit greyscale', () => {
  const img = decodePng(png(2, 1, 0, 8, [Buffer.from([0, 255])]));
  assert.deepStrictEqual(pixel(img, 0, 0), [0, 0, 0, 255]);
  assert.deepStrictEqual(pixel(img, 1, 0), [255, 255, 255, 255]);
});

check('truecolour', () => {
  const img = decodePng(png(2, 1, 2, 8,
    [Buffer.from([255, 0, 0, 0, 0, 255])]));
  assert.deepStrictEqual(pixel(img, 0, 0), [255, 0, 0, 255]);
  assert.deepStrictEqual(pixel(img, 1, 0), [0, 0, 255, 255]);
});

check('an alpha channel survives', () => {
  const img = decodePng(png(2, 1, 6, 8,
    [Buffer.from([9, 9, 9, 255, 9, 9, 9, 0])]));
  assert.strictEqual(pixel(img, 0, 0)[3], 255);
  assert.strictEqual(pixel(img, 1, 0)[3], 0);
});

check('a palette is looked up', () => {
  const img = decodePng(png(2, 1, 3, 8, [Buffer.from([1, 0])], {
    palette: Buffer.from([1, 2, 3, 250, 251, 252]),
  }));
  assert.deepStrictEqual(pixel(img, 0, 0), [250, 251, 252, 255]);
  assert.deepStrictEqual(pixel(img, 1, 0), [1, 2, 3, 255]);
});

check('one bit per pixel, which is what line art is often saved as', () => {
  // Eight pixels packed into a byte: 1010 0000
  const img = decodePng(png(4, 1, 0, 1, [Buffer.from([0b10100000])]));
  assert.strictEqual(pixel(img, 0, 0)[0], 255);
  assert.strictEqual(pixel(img, 1, 0)[0], 0);
  assert.strictEqual(pixel(img, 2, 0)[0], 255);
  assert.strictEqual(pixel(img, 3, 0)[0], 0);
});

check('a transparent colour key becomes transparent', () => {
  // A logo saved with white marked transparent rather than with an alpha
  // channel. toInk() treats transparency as paper, so getting this wrong
  // turns the background into solid ink and the whole picture into a
  // negative.
  const key = Buffer.alloc(6);                 // white, as three 16-bit words
  for (let i = 0; i < 3; i++) key.writeUInt16BE(255, i * 2);
  const img = decodePng(png(2, 1, 2, 8,
    [Buffer.from([255, 255, 255, 0, 0, 0])], { transparency: key }));
  assert.strictEqual(pixel(img, 0, 0)[3], 0, 'the keyed colour stayed opaque');
  assert.strictEqual(pixel(img, 1, 0)[3], 255, 'the drawing went transparent');
});

console.log('filters');

check('every scanline filter is undone', () => {
  // Two identical rows, the second written with the Up filter, must decode
  // to the same pixels. Filters are where a decoder silently smears.
  const row = Buffer.from([10, 20, 30, 40]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.concat([
    Buffer.from([0]), row,                       // None
    Buffer.from([2]), Buffer.from([0, 0, 0, 0]), // Up, all deltas zero
  ]);
  const buf = Buffer.concat([SIGNATURE, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const img = decodePng(buf);
  for (let x = 0; x < 4; x++) {
    assert.strictEqual(pixel(img, x, 1)[0], pixel(img, x, 0)[0],
      `column ${x} drifted between rows`);
  }
});

console.log('shrinking');

check('the longest side lands on the working size', () => {
  const img = { width: 1800, height: 900, data: new Uint8ClampedArray(1800 * 900 * 4).fill(255) };
  const small = scaleTo(img, 900);
  assert.strictEqual(small.width, 900);
  assert.strictEqual(small.height, 450);
});

check('a small picture is left alone', () => {
  const img = { width: 10, height: 10, data: new Uint8ClampedArray(400).fill(255) };
  assert.strictEqual(scaleTo(img, 900), img);
});

check('a thin line is averaged down, not dropped', () => {
  // Nearest-neighbour sampling deletes whole lines from a drawing. Box
  // averaging keeps them, fainter — which is the thing the blur then has to
  // contend with, so it must not vanish here first.
  const w = 400, h = 4;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    const i = (y * w + 200) * 4;             // one dark column
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  const small = scaleTo({ width: w, height: h, data }, 100);
  const ink = toInk(small);
  assert.ok(Math.max(...ink.data) > 0.2,
    `the line disappeared in the resize (peak ${Math.max(...ink.data)})`);
});

console.log('writing a field back out');

check('a field survives the round trip', () => {
  const w = 8, h = 4;
  const field = { w, h, data: new Float32Array(w * h) };
  for (let i = 0; i < field.data.length; i++) field.data[i] = (i % 8) / 7;

  const img = decodePng(encodeField(field));
  assert.strictEqual(img.width, w);
  assert.strictEqual(img.height, h);
  // Ink is written out as paper-and-ink, so it comes back inverted.
  const back = toInk(img);
  for (let i = 0; i < field.data.length; i++) {
    assert.ok(Math.abs(back.data[i] - field.data[i]) < 0.01,
      `pixel ${i}: ${back.data[i]} vs ${field.data[i]}`);
  }
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
