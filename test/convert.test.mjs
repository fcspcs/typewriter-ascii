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
  toInk, normalise, blur, contrast, cropToContent, outline, fitGrid, prepare,
  strokes,
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

/*
 * The order of preparation, not just the steps.
 *
 * Every step above was covered on its own while the sequence they run in was
 * written out once, inline, in the page — where no test could reach it and
 * the command line could not run it at all. Order is what decides the
 * result: the same five functions in a different sequence give a different
 * picture, and for a line drawing they can give an empty one.
 */
console.log('the pipeline, in order');

check('every step runs, in the order the pipeline documents', () => {
  const seen = [];
  prepare(onWhite, { onStage: (name) => seen.push(name) });
  assert.deepStrictEqual(seen, ['ink', 'blur', 'normalise', 'contrast', 'crop']);
});

check('stretching comes before pushing apart, never the other way round', () => {
  // contrast() pivots on 0.5, so it means nothing until the picture occupies
  // the range it is pivoting inside. Reversed, a drawing whose average ink
  // is 0.005 is clamped to zero before normalise ever sees it.
  const seen = [];
  prepare(onWhite, { onStage: (name) => seen.push(name) });
  assert.ok(seen.indexOf('normalise') < seen.indexOf('contrast'),
    'contrast ran before the range was stretched');
});

check('outline only joins in when it is asked for', () => {
  const seen = [];
  prepare(onWhite, { mode: 'outline', onStage: (name) => seen.push(name) });
  assert.deepStrictEqual(
    seen, ['ink', 'blur', 'normalise', 'contrast', 'outline', 'crop']);
});

check('preparing by hand and by prepare() agree', () => {
  const o = { detail: 0.45, contrast: 1.3, maxCols: 20 };
  const byHand = (() => {
    let f = toInk(onWhite, { invert: 'auto' });
    const art = strokes(f);
    let r = Math.max(0, (1 - o.detail) * (f.w / o.maxCols) * 0.9);
    if (art.width > 0 && art.coverage < 0.15) r = Math.min(r, art.width * 0.5);
    f = blur(f, r);
    f = normalise(f);
    f = contrast(f, o.contrast);
    return cropToContent(f);
  })();
  const { field } = prepare(onWhite, o);
  assert.strictEqual(field.w, byHand.w);
  assert.strictEqual(field.h, byHand.h);
  assert.ok([...field.data].every((v, i) => Math.abs(v - byHand.data[i]) < 1e-9),
    'the shared pipeline drifted from the steps it is made of');
});

check('the blur radius follows the cell size, not the image', () => {
  // Same picture, half the columns: each cell covers twice as much of it, so
  // twice as much gets smoothed away before sampling.
  const wide = prepare(onWhite, { maxCols: 40 }).radius;
  const narrow = prepare(onWhite, { maxCols: 20 }).radius;
  assert.ok(narrow > wide, `${narrow} should exceed ${wide}`);
});

check('a negative is reported as flipped, whoever asked', () => {
  assert.strictEqual(prepare(onBlack).inverted, true);
  assert.strictEqual(prepare(onBlack, { invert: false }).inverted, false);
});

/*
 * A drawing made of thin lines.
 *
 * This is the picture the whole pipeline used to lose. An ornamental
 * monogram — hairline contours over about one percent of the frame — arrived
 * at the character matcher as an empty field, and the page reported a motif
 * "0 x 40". Three things stacked up: a blur radius sized to the cell rather
 * than the stroke, a normalise that gave up because its 98th percentile was
 * background, and a contrast pivoting on 0.5 while the average ink was
 * 0.005. Each is tested below on its own, and then together.
 */
console.log('a drawing made of thin lines');

/** A ring of the given stroke width, on white. */
const ring = (width) => img(300, 300, (x, y) =>
  (Math.abs(Math.hypot(x - 150, y - 150) - 110) < width / 2 ? 0 : 255));

const hairline = ring(2);

check('strokes tells a drawing from a photograph', () => {
  const line = strokes(toInk(hairline));
  assert.ok(line.coverage < 0.05, `a ring covers ${line.coverage}`);
  assert.ok(line.width > 1 && line.width < 5, `measured ${line.width} px`);

  // Texture is thin too, but it is everywhere — and blurring it away is the
  // point rather than the mistake.
  const noise = strokes(toInk(img(300, 300, (x, y) =>
    120 + 80 * Math.sin(x / 2.1) * Math.cos(y / 1.9))));
  assert.ok(noise.coverage > 0.15,
    `texture read as sparse (${noise.coverage})`);
});

check('a solid shape has no strokes to protect', () => {
  const line = strokes(toInk(onWhite));
  assert.ok(line.coverage > 0.1, `${line.coverage} is not solid`);
});

check('the blur is held back for a drawing, not for a photograph', () => {
  const drawn = prepare(hairline, { maxCols: 20, detail: 0.45 });
  assert.strictEqual(drawn.lineArt, true, 'a ring is not line art?');
  assert.ok(drawn.radius < drawn.strokes.width,
    `radius ${drawn.radius} would swallow a ${drawn.strokes.width} px stroke`);

  const photo = prepare(img(300, 300, (x, y) =>
    120 + 80 * Math.sin(x / 2.1) * Math.cos(y / 1.9)),
  { maxCols: 20, detail: 0.45 });
  assert.strictEqual(photo.lineArt, false, 'texture treated as a drawing');
  const full = (1 - 0.45) * (300 / 20) * 0.9;
  assert.ok(Math.abs(photo.radius - full) < 1e-9,
    `a photograph lost its blur: ${photo.radius} instead of ${full}`);
});

check('normalise finds the top of a drawing, not the top of the frame', () => {
  // Ink over well under a fiftieth of the frame: the 98th percentile is
  // paper, so the fixed ends find nothing and the sparse path has to.
  const faint = { w: 200, h: 200, data: new Float32Array(40000) };
  for (let i = 0; i < 200; i++) faint.data[i * 137 % 40000] = 0.2;
  const out = normalise(faint);
  assert.ok(Math.max(...out.data) > 0.9,
    `a sparse drawing was left at ${Math.max(...out.data)}`);
});

check('a hairline drawing survives the settings that used to empty the page', () => {
  // 171% contrast and 44% detail on hairline contours: this exact
  // combination produced a blank sheet.
  const { field } = prepare(hairline, {
    contrast: 1.71, detail: 0.44, maxCols: 60,
  });
  assert.ok(Math.max(...field.data) > 0.5,
    'the drawing was erased before it reached the characters');
  const inked = [...field.data].filter((v) => v > 0.04).length;
  assert.ok(inked > 0, 'nothing left to type');
});

check('the lines stay lines, rather than surviving as a smear', () => {
  // Amplitude alone is not enough. Before the blur was tied to the stroke,
  // reordering the pipeline brought the ink back but spread a 1% drawing
  // across 17% of the frame, which reads as dirt rather than as line.
  const before = strokes(toInk(hairline)).coverage;
  const { field } = prepare(hairline, { contrast: 1.3, detail: 0.45, maxCols: 60 });
  const after = [...field.data].filter((v) => v > 0.5).length / field.data.length;
  assert.ok(after < before * 4,
    `a ${(before * 100).toFixed(1)}% drawing became ${(after * 100).toFixed(1)}%`);
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
