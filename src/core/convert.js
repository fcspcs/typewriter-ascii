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

/** Cell aspect: 2.54 mm wide, 4.23 mm tall for pica. */
export function cellAspect(m) {
  return cellWidthMm(m) / cellHeightMm(m);
}

/* ------------------------------------------------------------------ */
/* 1 + 2: from picture to ink                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {ImageData} img
 * @returns {{data: Float32Array, w: number, h: number}} 0 = paper, 1 = ink
 */
export function toInk(img, { invert = false } = {}) {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    // Rec. 601 luma, then treat transparency as paper.
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const ink = 1 - (lum * a + (1 - a));
    out[i] = invert ? 1 - ink : ink;
  }
  return { data: out, w, h };
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
