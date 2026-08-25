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

import { rampGlyphs, RAMP_RANGE } from './ink.js';

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
 * Measure one character.
 *
 * Split out of buildAtlas() because the interesting case is the character a
 * machine has *not* got: an atlas is built from a machine's own keys, so the
 * mark you are looking for a stand-in for is by definition not in it. This
 * describes it anyway, against the same cell and the same font, so the two
 * descriptions are comparable. See nearestChar().
 *
 * @param {string} ch
 * @param {string} font  a monospace CSS font family
 */
export function describeGlyph(ch, font = 'monospace') {
  const mask = renderGlyph(ch, font);
  const { hist, total } = shapeOf(mask);
  let sum = 0;
  let moment = 0;
  for (let i = 0; i < mask.length; i++) {
    sum += mask[i];
    moment += Math.floor(i / CELL_W) * mask[i];
  }

  /*
   * How uneven the ink's top and bottom edges are, as a fraction of the
   * cell height. Per column that carries ink, note where the ink begins
   * and ends; the mean deviation of those two outlines from their medians
   * is the raggedness. A `B` draws one straight line across the top and
   * another across the bottom and measures near zero; a `W` is peaks and
   * valleys at both edges. See toneRamp() for why a surface cares.
   */
  const tops = [];
  const bots = [];
  for (let x = 0; x < CELL_W; x++) {
    let t = -1;
    let b = -1;
    for (let y = 0; y < CELL_H; y++) {
      if (mask[y * CELL_W + x] > 0.02) { if (t < 0) t = y; b = y; }
    }
    if (t >= 0) { tops.push(t); bots.push(b); }
  }
  const dev = (a) => {
    const s = [...a].sort((p, q) => p - q);
    const m = s[s.length >> 1];
    return a.reduce((acc, v) => acc + Math.abs(v - m), 0) / a.length;
  };
  const ragged = tops.length < 2 ? 0
    : (dev(tops) + dev(bots)) / (2 * CELL_H);

  return {
    ch,
    coverage: sum / mask.length,   // 0…1, for tone
    shape: hist,
    ink: total,
    ragged,
    /*
     * Where the ink sits vertically, 0 (top) … 1 (bottom).
     *
     * Coverage alone picks the wrong character at the faint end. The two
     * faintest marks on an SM7 are ` and ´ at 0.0167 coverage, but their
     * ink sits at 0.21 of the cell, tucked under the line above: a block
     * of them reads as a row of ticks floating over the letter, not as a
     * pale surface. `.` is 0.0179 — the same weight to any eye — and sits
     * at 0.73. So this breaks ties between characters of equal weight.
     */
    centre: sum > 0 ? moment / sum / (CELL_H - 1) : 0.5,
  };
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
    centre: 0.5,
    ragged: 0,
  });

  for (const ch of chars) glyphs.push(describeGlyph(ch, font));

  // Darkest character is worth knowing — it sets the top of the tone range.
  const maxCoverage = Math.max(...glyphs.map((g) => g.coverage));
  // A canvas that cannot render reports every glyph as empty. Say so rather
  // than pretend, the same way inkWeights() does — a shape match against
  // blank descriptors is really a tone match, and callers should know.
  const hasShapes = glyphs.some((g) => g.ink > 0);
  return { glyphs, maxCoverage, cellW: CELL_W, cellH: CELL_H, hasShapes };
}

/**
 * An atlas built from the measured table in ink.js, for where there is no
 * canvas — the command line, a test, a server.
 *
 * What it has and has not got is the whole point, so it is stated plainly:
 *
 *   coverage  approximated. The table records the *order* of the characters
 *             by weight and the two ends of the range, not each value, so
 *             coverage is interpolated across the ranking. Tone mode picks
 *             by nearest coverage, so this spreads the tones evenly by rank
 *             — close to the browser, not identical to it.
 *   centre    exact. Measured, one digit per character.
 *   shape     absent. A log-polar histogram cannot be recovered from a
 *             ranking; it needs the rendered glyph. `hasShapes` says so, and
 *             callers are expected to check rather than to quietly get a
 *             shape match that is really a tone match.
 *   ragged    absent, for the same reason: an edge cannot be recovered from
 *             a ranking. Without it the surface pick in toneRamp() falls
 *             back to rank order, which the table does know.
 *
 * @param {Iterable<string>} chars the machine's character set
 * @returns {Object} the same shape as buildAtlas, plus hasShapes: false
 */
export function tableAtlas(chars) {
  const known = new Map(rampGlyphs().map((g) => [g.ch, g]));
  const { min, max } = RAMP_RANGE;

  const glyphs = [{
    ch: ' ',
    coverage: 0,
    shape: new Float32Array(RADIAL * ANGULAR),
    ink: 0,
    centre: 0.5,
  }];

  for (const ch of chars) {
    if (ch === ' ') continue;
    const g = known.get(ch);
    glyphs.push({
      ch,
      // Unknown characters sit mid-range rather than at zero, which would
      // make them the preferred match for blank paper.
      coverage: g ? min + g.rank * (max - min) : (min + max) / 2,
      shape: new Float32Array(RADIAL * ANGULAR),
      ink: 0,
      centre: g ? g.centre : 0.5,
    });
  }

  return {
    glyphs,
    maxCoverage: Math.max(...glyphs.map((g) => g.coverage)),
    cellW: CELL_W,
    cellH: CELL_H,
    hasShapes: false,
  };
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

/**
 * The character this machine has that most looks like one it has not.
 *
 * The measured half of the stand-in engine — see standIns() in machine.js,
 * which calls this after its table has had first refusal. Shape carries the
 * decision here rather than tone, which is the right way round: a stand-in
 * for `[` should be bracket-shaped, not merely as dark as a bracket.
 *
 * Returns null rather than a guess in the two cases where a guess would be
 * worthless. Without a canvas there are no shape descriptors at all and the
 * match would silently degrade into a tone match — the caveat tableAtlas()
 * already states. And a mark the font draws as nothing has nothing to match.
 *
 * `emptyBelow` is overridden to zero on purpose. bestChar() is normally
 * reading a picture, where a nearly empty cell should come out blank; here
 * the caller has asked about a specific mark, and a caret really is that
 * faint. Left at the default, every light mark would answer "a space".
 */
export function nearestChar(ch, atlas, allowed, font = 'monospace') {
  if (!atlas?.hasShapes) return null;
  const want = describeGlyph(ch, font);
  if (!(want.ink > 0)) return null;
  const best = bestChar(want, atlas, {
    allowed: allowed instanceof Set ? allowed : new Set(allowed),
    emptyBelow: 0,
  });
  return best === ' ' ? null : best;
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
