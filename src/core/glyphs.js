/**
 * glyphs.js — measure what each character actually looks like.
 *
 * Nothing here is guessed. Every character is rendered into a canvas at the
 * cell's aspect ratio and measured, because the same character differs
 * between typefaces and a hand-written brightness ramp is always slightly
 * wrong.
 *
 * Two descriptions come out of it:
 *   coverage — how much ink, for tone matching
 *   shape    — a log-polar histogram, for matching *form* rather than tone
 *
 * The shape descriptor follows Xu, Zhang & Wong, "Structure-based ASCII Art"
 * (SIGGRAPH 2010). Tone matching alone gives halftone mush; the whole point
 * of that paper is that a character should follow the line, not just the
 * brightness.
 */

/** Sampling resolution of one cell. Higher is slower and barely better. */
const CELL_W = 16;
const CELL_H = 27;   // roughly the 10 cpi × 6 lpi cell shape

/** Log-polar bins, as in the paper. */
const RADIAL = 5;
const ANGULAR = 12;

/**
 * Render one character and return its ink mask, 0…1 per pixel.
 * @returns {Float32Array} length CELL_W * CELL_H
 */
function renderGlyph(ch, font) {
  const c = document.createElement('canvas');
  c.width = CELL_W;
  c.height = CELL_H;
  const g = c.getContext('2d', { willReadFrequently: true });

  g.fillStyle = '#fff';
  g.fillRect(0, 0, CELL_W, CELL_H);
  g.fillStyle = '#000';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  // Size chosen so a capital fills the cell without clipping descenders.
  g.font = `${Math.round(CELL_H * 0.78)}px ${font}`;
  g.fillText(ch, CELL_W / 2, CELL_H * 0.78);

  const px = g.getImageData(0, 0, CELL_W, CELL_H).data;
  const out = new Float32Array(CELL_W * CELL_H);
  for (let i = 0; i < out.length; i++) {
    // white paper, black ink → ink = 1 - brightness
    out[i] = 1 - px[i * 4] / 255;
  }
  return out;
}

/**
 * Log-polar histogram of an ink mask.
 *
 * Log spacing means the centre of the cell counts for more than the edge,
 * which is what makes the comparison tolerant of a line sitting slightly
 * off — the "alignment-insensitive" part of the paper's AISS metric.
 */
function shapeOf(mask, w = CELL_W, h = CELL_H) {
  const hist = new Float32Array(RADIAL * ANGULAR);
  const cx = w / 2;
  const cy = h / 2;
  const rMax = Math.min(w, h) / 2;
  let total = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = mask[y * w + x];
      if (v <= 0.02) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > rMax) continue;

      // log-spaced radial bin
      const rb = Math.min(
        RADIAL - 1,
        Math.floor(Math.log1p((r / rMax) * (Math.E - 1)) * RADIAL));
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI * 2;
      const ab = Math.min(ANGULAR - 1,
        Math.floor((a / (Math.PI * 2)) * ANGULAR));

      hist[rb * ANGULAR + ab] += v;
      total += v;
    }
  }
  // Normalise so thin and fat characters are comparable by shape.
  if (total > 0) for (let i = 0; i < hist.length; i++) hist[i] /= total;
  return { hist, total };
}

/**
 * Measure a whole character set.
 * @param {string[]} chars
 * @param {string} font  a monospace CSS font family
 */
export function buildAtlas(chars, font = 'monospace') {
  const glyphs = [];

  // Space first: always available, always free of ink.
  glyphs.push({
    ch: ' ',
    coverage: 0,
    shape: new Float32Array(RADIAL * ANGULAR),
    ink: 0,
  });

  for (const ch of chars) {
    const mask = renderGlyph(ch, font);
    const { hist, total } = shapeOf(mask);
    let sum = 0;
    for (let i = 0; i < mask.length; i++) sum += mask[i];
    glyphs.push({
      ch,
      coverage: sum / mask.length,   // 0…1, for tone
      shape: hist,
      ink: total,
    });
  }

  // Darkest character is worth knowing — it sets the top of the tone range.
  const maxCoverage = Math.max(...glyphs.map((g) => g.coverage));
  return { glyphs, maxCoverage, cellW: CELL_W, cellH: CELL_H };
}

/**
 * Turn a region of the source image into the same descriptors.
 * @param {Float32Array} mask ink values 0…1, row-major
 */
export function describeCell(mask, w, h) {
  const { hist, total } = shapeOf(mask, w, h);
  let sum = 0;
  for (let i = 0; i < mask.length; i++) sum += mask[i];
  return { coverage: sum / mask.length, shape: hist, ink: total };
}

/**
 * Pick the character that best matches a cell.
 *
 * @param {Object} cell        from describeCell
 * @param {Object} atlas       from buildAtlas
 * @param {Object} [opt]
 * @param {number} [opt.toneWeight=0.35]  0 = pure shape, 1 = pure tone
 * @param {number} [opt.emptyBelow=0.04]  coverage below this stays blank
 * @param {number} [opt.inkTolerance=0.25] how much extra ink is allowed
 * @param {Set<string>} [opt.allowed]     restrict to these characters
 */
export function bestChar(cell, atlas, opt = {}) {
  const {
    toneWeight = 0.35,
    emptyBelow = 0.04,
    inkTolerance = 0.25,
    allowed = null,
  } = opt;

  if (cell.coverage < emptyBelow) return ' ';

  let best = ' ';
  let bestCost = Infinity;

  for (const g of atlas.glyphs) {
    if (g.ch === ' ') continue;
    if (allowed && !allowed.has(g.ch)) continue;

    // Ink guard. Without it the shape metric happily picks a fat character
    // for a nearly empty cell: normalising by total ink makes heavy glyphs
    // look like a good match even when they lay down far too much ink.
    if (g.coverage > cell.coverage * (1 + inkTolerance) + 0.04) continue;

    let shapeCost = 0;
    for (let i = 0; i < g.shape.length; i++) {
      shapeCost += Math.abs(g.shape[i] - cell.shape[i]);
    }
    const toneCost = Math.abs(g.coverage - cell.coverage) * 4;
    const cost = shapeCost * (1 - toneWeight) + toneCost * toneWeight;

    if (cost < bestCost) {
      bestCost = cost;
      best = g.ch;
    }
  }
  return best;
}

/** Character whose coverage is closest to a target tone. */
export function charForTone(tone, atlas, allowed = null) {
  let best = ' ';
  let d = Infinity;
  for (const g of atlas.glyphs) {
    if (allowed && g.ch !== ' ' && !allowed.has(g.ch)) continue;
    const gd = Math.abs(g.coverage / atlas.maxCoverage - tone);
    if (gd < d) { d = gd; best = g.ch; }
  }
  return best;
}
