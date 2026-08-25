/**
 * convert.js — image → characters.
 *
 * The pipeline, in order:
 *   1. to ink   (bright pixels = paper, dark = ink)
 *   2. prepare  (smooth, contrast, optional outline or skeleton)
 *   3. crop     (to the motif, so the grid lands on the drawing)
 *   4. sample   (one cell per character)
 *   5. choose   (which character goes where)
 *
 * Step 2 is the one that decides whether the result looks like an
 * illustration or like a photo of mud. Smoothing before sampling kills
 * texture and leaves shape, which is what a typewriter can reproduce.
 */

import { buildAtlas, describeCell, bestChar, charForTone } from './glyphs.js';
import { cellWidthMm, cellHeightMm } from './machine.js';
import { turnField } from './turn.js';

/** Cell aspect: 2.54 mm wide, 4.23 mm tall for pica. */
export function cellAspect(m) {
  return cellWidthMm(m) / cellHeightMm(m);
}

/**
 * A block of typed characters as a picture, for setting type sideways.
 *
 * Fixed letterforms cannot be resampled the way a photograph can, and laying
 * a finished block down cell by cell stretches it 2.77 times over: a quarter
 * turn swaps the cell's 2.54 mm width and 4.23 mm height, and glyph data has
 * no way to follow. So a word planned sideways is turned into ink first —
 * each cell becomes a 3 × 5 patch of pixels, the cell's own shape near
 * enough exactly — and the ordinary picture pipeline takes it from there,
 * resampling it like it would a drawing.
 *
 * Solid patches, deliberately: drawing the marks as the glyphs they are
 * needs a canvas, and the browser uses one where it has it (see app.js).
 * What matters here is that the silhouette is right.
 *
 * @param {string[]} rows characters; a space is paper
 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
 *          the shape toInk() reads
 */
export function blockImage(rows, cw = 3, ch = 5) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const w = cols * cw;
  const h = Math.max(1, rows.length) * ch;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === ' ') return;
      for (let py = y * ch; py < (y + 1) * ch; py++) {
        for (let px = x * cw; px < (x + 1) * cw; px++) {
          const i = (py * w + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    });
  });
  return { width: w, height: h, data };
}

/* ------------------------------------------------------------------ */
/* 1 + 2: from picture to ink                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {ImageData} img
 * @param {Object} [opt]
 * @param {boolean|'auto'} [opt.invert='auto']
 * @returns {{data: Float32Array, w: number, h: number, inverted: boolean}}
 *          0 = paper, 1 = ink
 */
export function toInk(img, { invert = 'auto' } = {}) {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w * h);
  let sum = 0;

  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    // Rec. 601 luma, then treat transparency as paper.
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const ink = 1 - (lum * a + (1 - a));
    out[i] = ink;
    sum += ink;
  }

  // Which way round is the picture?
  //
  // A typewriter puts ink on white paper. It physically cannot fill a sheet
  // with ink — and a picture that is mostly ink is not a drawing, it is a
  // negative. White lettering on a black field is extremely common (logos,
  // album art, anything screenshotted from a dark page), and taken at face
  // value it produces a solid wall of the darkest character with the actual
  // artwork invisible inside it.
  //
  // So: if most of the image reads as ink, it is a negative. Flip it.
  const mean = sum / (w * h);
  const flip = invert === 'auto' ? mean > 0.55 : Boolean(invert);
  if (flip) for (let i = 0; i < out.length; i++) out[i] = 1 - out[i];

  return { data: out, w, h, inverted: flip };
}

/**
 * Stretch the ink range so it uses the characters available.
 *
 * Without this a picture that only ever sits between, say, 0.4 and 0.6 gets
 * rendered with the two or three characters whose coverage happens to land
 * in that band — flat, and usually the heavy ones. Percentile ends rather
 * than min/max, so one stray white speck cannot set the scale.
 *
 * The percentile has to follow the picture, though, and this is where a line
 * drawing used to be lost. A fixed 98th percentile assumes the top 2% of the
 * frame is drawing; an ornamental monogram covers well under 1%, so the 98th
 * percentile *is* background, the range comes out empty, and the function
 * gave up — leaving the faint blurred remains of the lines for `contrast` to
 * clamp to nothing. The rescue was skipped in exactly the case that needed
 * rescuing.
 *
 * So when the fixed percentile finds nothing, the top is taken from the ink
 * instead of from the frame: how much of the picture carries ink at all,
 * then a high point within *that* population. Still a percentile, so a
 * handful of hot pixels cannot set the scale, and a genuinely blank sheet
 * still has nothing to find and is still left alone.
 */
export function normalise(field, low = 0.02, high = 0.98) {
  const sorted = Float32Array.from(field.data).sort();
  const n = sorted.length;
  const lo = sorted[Math.floor(n * low)];
  let hi = sorted[Math.floor(n * high)];

  if (hi - lo < 0.05) {
    // Everything above a quarter of the way to the peak counts as ink. A
    // share of the range rather than an absolute, so a faint scan and a
    // black-and-white logo are measured the same way.
    const floor = lo + (sorted[n - 1] - lo) * 0.25;
    let inked = 0;
    while (inked < n && sorted[n - 1 - inked] > floor) inked++;
    if (inked) hi = sorted[n - 1 - Math.floor(inked * 0.2)];
  }
  if (hi - lo < 0.05) return field;      // genuinely flat; leave it alone

  const out = new Float32Array(field.data.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = clamp((field.data[i] - lo) / (hi - lo), 0, 1);
  }
  return { data: out, w: field.w, h: field.h };
}

/**
 * How much of the picture is ink, and how thick the strokes are.
 *
 * Area over perimeter. A stroke of width w and length L has area wL and
 * roughly 2L of edge, so twice the ratio gives back w; a solid blob of
 * radius r gives back r, which is the right answer for "how far can this be
 * smoothed before it stops being itself".
 *
 * Coverage comes with it because the two are only meaningful together. Thin
 * strokes over a small part of the frame is a drawing. Thin strokes over
 * half the frame is texture in a photograph, and blurring that away is the
 * whole point rather than a mistake.
 *
 * @returns {{coverage: number, width: number}} width in pixels, 0 if no ink
 */
export function strokes(field) {
  const { w, h, data } = field;
  let peak = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > peak) peak = data[i];
  if (peak <= 0) return { coverage: 0, width: 0 };

  const t = peak * 0.5;
  let area = 0;
  let edge = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] <= t) continue;
      area++;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
          data[i - 1] <= t || data[i + 1] <= t ||
          data[i - w] <= t || data[i + w] <= t) edge++;
    }
  }
  return {
    coverage: area / (w * h),
    width: edge ? (2 * area) / edge : 0,
  };
}

/** Separable box blur, run a few times — close enough to a gaussian. */
export function blur(field, radius) {
  if (radius <= 0) return field;
  const { w, h } = field;
  let src = field.data;
  let dst = new Float32Array(w * h);
  const r = Math.max(1, Math.round(radius));

  for (let pass = 0; pass < 2; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        dst[y * w + x] = sum / (2 * r + 1);
        sum -= src[y * w + clamp(x - r, 0, w - 1)];
        sum += src[y * w + clamp(x + r + 1, 0, w - 1)];
      }
    }
    [src, dst] = [dst, src];
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += src[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / (2 * r + 1);
        sum -= src[clamp(y - r, 0, h - 1) * w + x];
        sum += src[clamp(y + r + 1, 0, h - 1) * w + x];
      }
    }
    [src, dst] = [dst, src];
  }
  return { data: src, w, h };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Push values away from mid grey. */
export function contrast(field, amount) {
  if (amount === 1) return field;
  const out = new Float32Array(field.data.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = clamp((field.data[i] - 0.5) * amount + 0.5, 0, 1);
  }
  return { data: out, w: field.w, h: field.h };
}

/** Sobel edges, full resolution — used to rescue thin lines. */
export function edges(field) {
  const { w, h, data } = field;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1] +
        data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1];
      const gy =
        -data[i - w - 1] - 2 * data[i - w] - data[i - w + 1] +
        data[i + w - 1] + 2 * data[i + w] + data[i + w + 1];
      out[i] = Math.min(1, Math.hypot(gx, gy) / 4);
    }
  }
  return { data: out, w, h };
}

/**
 * Outline: the motif minus an eroded copy of itself.
 * Far fewer keystrokes than filling the shape, and it reads as a drawing.
 */
export function outline(field, threshold = 0.5) {
  const { w, h, data } = field;
  const solid = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = data[i] > threshold ? 1 : 0;

  const eroded = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      eroded[i] = Math.min(
        solid[i], solid[i - 1], solid[i + 1], solid[i - w], solid[i + w]);
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = solid[i] - eroded[i];
  return { data: out, w, h };
}

/**
 * Crop to the motif with a little air.
 * Without this the grid lands on whatever white space the source happens to
 * have, and straight edges stop falling on cell boundaries.
 */
export function cropToContent(field, threshold = 0.04, air = 2) {
  const { w, h, data } = field;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return field;
  x0 = Math.max(0, x0 - air); y0 = Math.max(0, y0 - air);
  x1 = Math.min(w - 1, x1 + air); y1 = Math.min(h - 1, y1 + air);

  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) out[y * nw + x] = data[(y + y0) * w + x + x0];
  }
  return { data: out, w: nw, h: nh };
}

/* ------------------------------------------------------------------ */
/* The preparation, in one place                                       */
/* ------------------------------------------------------------------ */

/**
 * Ink coverage below which a picture is treated as a drawing rather than a
 * photograph. Line art on a sheet runs well under a tenth of the frame; a
 * photograph that has been reduced to ink is far denser than this.
 */
const LINE_ART_COVERAGE = 0.15;

/**
 * Run steps 1 and 2 in the order that decides the result.
 *
 * This used to live inline in the page's convert(), which meant the command
 * line could not run it and no test covered the *order* — only the individual
 * steps. Order is the part that matters: the same five functions in a
 * different sequence give a different picture, and in the worst case an empty
 * one.
 *
 * `onStage` is called after every step with a copy-free view of the field, so
 * a caller can measure what each step did without this function knowing
 * anything about reporting.
 *
 * @param {ImageData} img
 * @param {Object} [o]
 * @param {boolean|'auto'} [o.invert='auto']
 * @param {number} [o.detail=0.45]     0…1, the Detail slider
 * @param {number} [o.contrast=1.3]    the Contrast slider, 1 = untouched
 * @param {string} [o.mode='shape']    'shape' | 'tone' | 'outline' | 'sentence'
 * @param {number} [o.maxCols=60]      sets the blur radius, via the cell size
 * @param {'none'|'left'|'right'} [o.turn='none'] which way the finished sheet
 *   will be turned to be looked at; see turn.js
 * @param {(stage: string, field: Object, extra?: Object) => void} [o.onStage]
 * @returns {{field: Object, inverted: boolean, radius: number}}
 */
export function prepare(img, o = {}) {
  const {
    invert = 'auto', detail = 0.45, contrast: amount = 1.3,
    mode = 'shape', maxCols = 60, turn = 'none', onStage = null,
  } = o;
  const step = (name, field, extra) => { onStage?.(name, field, extra); return field; };

  let field = step('ink', toInk(img, { invert }));
  const inverted = field.inverted;

  /*
   * Lie the picture down before anything measures it.
   *
   * A motif planned for a turned sheet is still typed on an upright one, so
   * from here down the picture *is* the upright picture: the blur radius,
   * the cell aspect in fitGrid() and the shape matching all work in the
   * machine's frame, unchanged. Turning the finished characters instead
   * would apply the 2.54 x 4.23 mm correction along the wrong axis and match
   * every character against a part of the picture that had moved.
   */
  if (turn === 'left' || turn === 'right') {
    field = step('turn', turnField(field, turn), { turn });
  }

  /*
   * Smooth before sampling: texture cannot survive a 2.5 mm cell, and
   * leaving it in produces noise that reads as dirt.
   *
   * The radius follows the cell, which is right for a photograph and wrong
   * for a drawing. A cell on A4 is fifteen pixels of a 900 px source, so at
   * the default Detail the radius is around seven — and a hairline is one.
   * Spreading one pixel of ink over fifteen leaves a peak of 0.15 where
   * there was 1.0, which is how an ornamental monogram arrived at the
   * character matcher as an empty grey field.
   *
   * So the radius is also capped by the strokes themselves, but only for
   * pictures sparse enough to be drawings. A photograph is dense, keeps the
   * full radius, and still loses the texture it needs to lose.
   */
  const art = strokes(field);
  let radius = Math.max(0, (1 - detail) * (field.w / maxCols) * 0.9);
  const lineArt = art.width > 0 && art.coverage < LINE_ART_COVERAGE;
  if (lineArt) radius = Math.min(radius, art.width * 0.5);
  field = step('blur', blur(field, radius), { radius, strokes: art });

  /*
   * Stretch, then push apart — and not the other way round.
   *
   * `contrast` pivots on 0.5, so it can only mean anything once the picture
   * occupies the range it is pivoting inside. Run first, on a drawing whose
   * average ink is 0.005, it clamps everything below 0.5 - 0.5/amount to
   * nothing: at the default 130% that is everything under 0.115, and the
   * blurred remains of a line peak at 0.15. Every pixel went to zero, and
   * the normalise that would have rescued the picture then had nothing left
   * to work with.
   */
  field = step('normalise', normalise(field));
  field = step('contrast', contrast(field, amount), { amount });

  if (mode === 'outline') field = step('outline', outline(field, 0.45));
  field = step('crop', cropToContent(field));

  return { field, inverted, radius, strokes: art, lineArt };
}

/* ------------------------------------------------------------------ */
/* 3: how many columns and rows                                        */
/* ------------------------------------------------------------------ */

/** Largest grid that fits the paper and keeps the picture's proportions. */
export function fitGrid(maxCols, maxRows, imgW, imgH, aspect) {
  let cols = maxCols;
  let rows = Math.max(1, Math.round(cols * (imgH / imgW) * aspect));
  if (rows > maxRows) {
    rows = maxRows;
    cols = Math.max(1, Math.round(rows * (imgW / imgH) / aspect));
  }
  return { cols, rows };
}

/* ------------------------------------------------------------------ */
/* 4 + 5: sample and choose                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert a prepared ink field into characters.
 *
 * @param {Object} field   from toInk/blur/…
 * @param {number} cols
 * @param {number} rows
 * @param {Object} atlas   from buildAtlas
 * @param {Object} [opt]
 * @param {'shape'|'tone'} [opt.mode='shape']
 * @param {Set<string>} [opt.allowed]
 * @returns {string[]} one string per row
 */
export function toCharacters(field, cols, rows, atlas, opt = {}) {
  const { mode = 'shape', allowed = null } = opt;
  const { w, h, data } = field;
  const cw = w / cols;
  const chH = h / rows;

  // Sample resolution per cell — matches the atlas so the shapes compare.
  const sw = atlas.cellW;
  const sh = atlas.cellH;
  const buf = new Float32Array(sw * sh);
  const lines = [];

  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      // bilinear-ish sample of this cell into the atlas resolution
      for (let y = 0; y < sh; y++) {
        const sy = clamp(Math.floor((r + (y + 0.5) / sh) * chH), 0, h - 1);
        for (let x = 0; x < sw; x++) {
          const sx = clamp(Math.floor((c + (x + 0.5) / sw) * cw), 0, w - 1);
          buf[y * sw + x] = data[sy * w + sx];
        }
      }
      const cell = describeCell(buf, sw, sh);
      line += mode === 'tone'
        ? charForTone(cell.coverage / (atlas.maxCoverage || 1), atlas, allowed)
        : bestChar(cell, atlas, { ...opt, allowed });
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

/**
 * Build a motif out of one repeating sentence.
 *
 * The sentence must read continuously across line breaks, so the character
 * stream only advances when something is actually typed. Word gaps that
 * would land on the edge of the motif are skipped — a ragged edge is worse
 * than a missing space, because the edge is what the eye reads as shape.
 */
export function toSentence(field, cols, rows, phrase, opt = {}) {
  const { threshold = 0.35, upper = null } = opt;
  const { w, h, data } = field;
  const cw = w / cols;
  const chH = h / rows;

  // average ink per cell
  const tone = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r * chH); y < Math.floor((r + 1) * chH); y++) {
        for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) {
          sum += data[y * w + x]; n++;
        }
      }
      row.push(n ? sum / n : 0);
    }
    tone.push(row);
  }

  // which cells sit on the edge of the motif
  const isEdge = (r, c) => {
    if (tone[r][c] < threshold) return false;
    const l = c > 0 && tone[r][c - 1] >= threshold;
    const rr = c < cols - 1 && tone[r][c + 1] >= threshold;
    return !l || !rr;
  };

  const chars = [...phrase];
  let i = 0;
  const lines = [];

  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      if (tone[r][c] < threshold) { line += ' '; continue; }
      // Skip word gaps that would fall on an edge cell.
      if (isEdge(r, c)) {
        let guard = 0;
        while (chars[i % chars.length] === ' ' && guard++ < chars.length) i++;
      }
      let ch = chars[i % chars.length];
      i++;
      if (upper === true) ch = ch.toUpperCase();
      else if (upper === false) ch = ch.toLowerCase();
      else ch = tone[r][c] > 0.62 ? ch.toUpperCase() : ch.toLowerCase();
      line += ch;
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

/** Does the sentence still read straight through? */
export function sentenceReads(lines, phrase) {
  const got = lines.join('').replace(/\s+/g, '').toLowerCase();
  const want = phrase.replace(/\s+/g, '').toLowerCase();
  if (!got || !want) return true;
  const need = want.repeat(Math.ceil(got.length / want.length) + 1);
  return need.startsWith(got);
}

/** Count actual keystrokes — spaces are movement, not work. */
export function keystrokes(lines) {
  return lines.reduce(
    (n, l) => n + [...l].filter((c) => c !== ' ').length, 0);
}

export { buildAtlas };
