/**
 * Image handling.
 *
 * The bug these exist to prevent: a picture of white lettering on a black
 * field was rendered as a solid wall of the heaviest character, with the
 * artwork invisible inside it. 2158 keystrokes of W. A typewriter cannot
 * ink a whole sheet, so an image that reads as mostly ink is a negative.
 */
import assert from 'node:assert';
import {
  toInk, normalise, blur, contrast, cropToContent, outline, fitGrid,
} from '../src/core/convert.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

/** Build a greyscale ImageData-alike. */
function img(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const mean = (f) => f.data.reduce((a, b) => a + b, 0) / f.data.length;

// A shape covering about a fifth of the frame.
const shape = (x, y) => (y > 24 && y < 36 && x > 10 && x < 50);
const onWhite = img(60, 60, (x, y) => (shape(x, y) ? 0 : 255));
const onBlack = img(60, 60, (x, y) => (shape(x, y) ? 255 : 0));

console.log('polarity');

check('a dark drawing on white paper is left alone', () => {
  const f = toInk(onWhite);
  assert.strictEqual(f.inverted, false);
  assert.ok(mean(f) < 0.5, `ink coverage ${mean(f).toFixed(2)}`);
});

check('light artwork on a dark field is turned round', () => {
  const f = toInk(onBlack);
  assert.strictEqual(f.inverted, true, 'not detected as a negative');
  assert.ok(mean(f) < 0.5, `ink coverage ${mean(f).toFixed(2)}`);
});

check('both ways round give the same amount of ink', () => {
  // Same drawing, same work at the machine, whichever way it arrived.
  const a = mean(toInk(onWhite));
  const b = mean(toInk(onBlack));
  assert.ok(Math.abs(a - b) < 0.01, `${a.toFixed(3)} vs ${b.toFixed(3)}`);
});

check('a mostly-dark picture never asks you to ink the whole sheet', () => {
  // The reported failure: 2158 strikes out of 2160 cells.
  const f = toInk(img(40, 40, () => 10));
  assert.ok(mean(f) < 0.5, `would demand ${(mean(f) * 100).toFixed(0)}% coverage`);
});

check('the choice can be forced either way', () => {
  assert.strictEqual(toInk(onBlack, { invert: false }).inverted, false);
  assert.strictEqual(toInk(onWhite, { invert: true }).inverted, true);
});

check('a balanced picture is not flipped on a coin toss', () => {
  // Exactly half ink, half paper: leave it as it came.
  const half = img(40, 40, (x) => (x < 20 ? 0 : 255));
  assert.strictEqual(toInk(half).inverted, false);
});

console.log('range');

check('a flat picture is stretched to use every character', () => {
  const f = normalise(toInk(img(40, 40, (x) => (x < 20 ? 110 : 140))));
  const lo = Math.min(...f.data);
  const hi = Math.max(...f.data);
  assert.ok(hi - lo > 0.9, `range ${lo.toFixed(2)}..${hi.toFixed(2)}`);
});

check('a genuinely blank picture is left alone, not amplified into noise', () => {
  const f = normalise(toInk(img(20, 20, () => 255)));
  assert.ok(Math.max(...f.data) < 0.1, 'blank paper turned into something');
});

check('one stray speck cannot set the scale', () => {
  // A single white pixel in a mid-grey field. Min/max would key off it.
  const f = normalise(toInk(img(40, 40, (x, y) =>
    (x === 0 && y === 0 ? 255 : 128))));
  const spread = Math.max(...f.data) - Math.min(...f.data);
  assert.ok(spread < 0.5, `one pixel stretched the range to ${spread.toFixed(2)}`);
});

console.log('preparation');

check('blurring keeps the overall amount of ink', () => {
  const before = mean(toInk(onWhite));
  const after = mean(blur(toInk(onWhite), 3));
  assert.ok(Math.abs(before - after) < 0.05, `${before} vs ${after}`);
});

check('contrast pushes away from mid grey', () => {
  const f = contrast(toInk(img(10, 10, () => 128)), 2);
  assert.ok(f.data.every((v) => v >= 0 && v <= 1), 'values escaped 0..1');
});

check('cropping trims to the drawing', () => {
  const c = cropToContent(toInk(onWhite));
  assert.ok(c.w < 60 && c.h < 60, `still ${c.w}x${c.h}`);
  assert.ok(c.w > 30, 'cropped into the drawing');
});

check('an outline uses less ink than the solid shape', () => {
  const solid = mean(toInk(onWhite));
  const thin = mean(outline(toInk(onWhite), 0.5));
  assert.ok(thin < solid, `${thin.toFixed(3)} vs ${solid.toFixed(3)}`);
});

console.log('grid');

check('the grid never exceeds the paper', () => {
  const g = fitGrid(60, 20, 400, 100, 0.6);
  assert.ok(g.cols <= 60 && g.rows <= 20, JSON.stringify(g));
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
