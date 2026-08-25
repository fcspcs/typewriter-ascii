/**
 * ink.js — how heavy each character is, and which ones to draw a tone with.
 *
 * Two jobs, previously done in two places and only one of them properly:
 *
 *   1. a weight per character, 0 (blank) … 1 (heaviest the machine has)
 *   2. a *ramp* — n characters spread from heavy to faint — for anything
 *      that needs more than one tone
 *
 * Job 2 was missing entirely. `app.js` used to say
 *
 *     const fill = have.includes('#') ? '#' : have.includes('H') ? 'H' : have[0];
 *
 * which is a wish, not a choice. The Olympia SM7 has no `#`, so every
 * lettering style on the machine this was written for fell through to a wall
 * of `H` — and `H` is not even the heaviest character the SM7 has. Measured
 * at the atlas cell (16 × 27 px, 21 px DejaVu Sans Mono) it covers 0.171 of
 * its cell against 0.204 for `B`, 0.196 for `M` and 0.190 for `W`. The
 * lettering looked flat because it was being drawn in a mid-weight character
 * and nothing else.
 */

/**
 * Fallback ink ramp, measured rather than guessed.
 *
 * Every printable ASCII character plus the German set, rendered into the
 * atlas cell and sorted by coverage, faintest first. The range runs 0.0167
 * (a grave accent) to 0.2043 (a capital B).
 *
 * Only reached when there is no atlas, or when the atlas measured nothing —
 * a headless browser, a blocked font. A real atlas measures the face that is
 * actually on screen and beats this every time.
 */
const RAMP =
  '`\u00b4.-\',:;"~^_!*r/\\>)<(|?+vlc=xzj7i][LsYtnuJy}fT1{C%owIV2F' +
  '\u00fckhX3ZS4ea\u00f6m5Apq\u00a7PUGbd$K\u00e469&OEH0\u00c4@' +
  '\u00dcgD\u00dfQR8\u00d6#WNMB';

/**
 * Where the ink of each RAMP character sits vertically: 0 is the top of the
 * cell, 9 the bottom, one digit per character in the same order.
 *
 * Coverage alone picks the wrong character at the faint end, and the reason
 * is worth writing down. On the SM7 the two faintest marks are `` ` `` and
 * `´` at 0.0167 — but their ink sits at 0.21 of the cell height, right up
 * under the line above. A block of them does not read as a pale surface, it
 * reads as a row of ticks floating over the letter. `.` is 0.0179, near
 * enough the same weight, and sits at 0.73; `-` is 0.0247 and sits at 0.56.
 * Both read as a tone. So centring breaks ties between characters of
 * effectively equal weight.
 */
const CENTRES =
  '2275375635384455555555455455556455555455556544555455445455555555555' +
  '545555455555555455444454654545445545';

/** Cell-relative vertical centre of a RAMP character, 0…1. */
function rampCentre(i) {
  return (CENTRES.charCodeAt(i) - 48) / 9;
}

/**
 * The ends of the measured coverage range, for anyone rebuilding an atlas
 * from the table above rather than from a canvas.
 */
export const RAMP_RANGE = { min: 0.0167, max: 0.2043 };

/**
 * The ramp as data: every character it knows, faintest first, with where it
 * sits in the ranking and where its ink sits in the cell.
 *
 * Exported so a headless atlas can be built from the same measurements the
 * tone ramp uses, instead of a second table drifting alongside this one.
 */
export function rampGlyphs() {
  return [...RAMP].map((ch, i) => ({
    ch,
    rank: i / (RAMP.length - 1),     // 0 faintest … 1 heaviest
    centre: rampCentre(i),
  }));
}

/**
 * A function from character to how much ink it puts on the paper, 0…1.
 *
 * With an atlas this is measured against the font on screen. Without one it
 * is the ramp above, which is measured too — just against a different face.
 *
 * @param {Object|null} atlas from buildAtlas()
 * @returns {(ch: string) => number}
 */
export function inkWeights(atlas) {
  const ranked = (ch) => {
    if (ch === ' ') return 0;
    const i = RAMP.indexOf(ch);
    return i < 0 ? 0.5 : i / (RAMP.length - 1);
  };

  const glyphs = atlas?.glyphs ?? [];
  if (glyphs.length) {
    const max = atlas.maxCoverage || 1;
    const values = glyphs.map((g) => g.coverage / max);
    // A measured atlas beats any table — but only if it actually measured
    // something. A canvas that cannot render reports every glyph as
    // identical, and every scheme built on tone would then quietly do
    // nothing. Fall back rather than pretend.
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > 0.05) {
      const byChar = new Map(glyphs.map((g, i) => [g.ch, values[i]]));
      return (ch) => byChar.get(ch) ?? ranked(ch);
    }
  }
  return ranked;
}

/** Where a character's ink sits in its cell, 0 (top) … 1 (bottom). */
function inkCentres(atlas) {
  const glyphs = atlas?.glyphs ?? [];
  const byChar = new Map();
  for (const g of glyphs) {
    if (typeof g.centre === 'number') byChar.set(g.ch, g.centre);
  }
  return (ch) => {
    if (byChar.has(ch)) return byChar.get(ch);
    const i = RAMP.indexOf(ch);
    return i < 0 ? 0.5 : rampCentre(i);
  };
}

/**
 * The characters available, heaviest first, with weight and ink centre.
 *
 * @param {Object} [o]
 * @param {Object} [o.atlas]
 * @param {Iterable<string>} [o.allowed] restrict to these characters
 * @returns {{ch: string, weight: number, centre: number}[]}
 */
export function inkLadder({ atlas = null, allowed = null } = {}) {
  const weight = inkWeights(atlas);
  const centre = inkCentres(atlas);
  // Edge evenness travels with the ladder where the atlas measured it; a
  // table atlas has none, and zero means "no reason to distrust the edges".
  const raggedBy = new Map((atlas?.glyphs ?? [])
    .filter((g) => typeof g.ragged === 'number')
    .map((g) => [g.ch, g.ragged]));
  const pool = allowed
    ? [...allowed]
    : (atlas?.glyphs ?? []).map((g) => g.ch).filter((c) => c !== ' ');

  const seen = new Set();
  const out = [];
  for (const ch of pool) {
    if (ch === ' ' || ch === '\n' || seen.has(ch)) continue;
    seen.add(ch);
    out.push({
      ch, weight: weight(ch), centre: centre(ch),
      ragged: raggedBy.get(ch) ?? 0,
    });
  }
  // Ties broken by character so the same machine always yields the same
  // ladder — a picker that reshuffles between redraws is unusable.
  out.sort((a, b) => b.weight - a.weight || (a.ch < b.ch ? -1 : 1));
  return out;
}

/**
 * How far either side of a rank counts as "near enough the same weight".
 *
 * On the SM7's 88 characters one rank is a little over 1% of the weight
 * range, which is below anything the eye separates on paper. Three ranks is
 * still under 4%, so that tolerance is free to spend on getting the ink into
 * the middle of the cell where it reads as a surface.
 */
const TIE = 3;

/**
 * What one rank of weight is worth against one unit of off-centre ink.
 *
 * Both terms are on the same 0…1 scale, so this number states the exchange
 * rate directly: at 0.02, moving three ranks off target must buy more than
 * 0.06 of centring — the ink has to come at least 6% of the cell height
 * nearer the middle — or the exact rank keeps it.
 *
 * Without this term ties go to whichever character the scan reaches first,
 * which is the heaviest in the window. Measured on the SM7: the middle of
 * the ladder is `2` at rank 44, and first-found returned `k` from rank 41
 * instead, three ranks too heavy, purely because both sit at the same
 * quantised centre.
 */
const RANK_COST = 0.02;

/**
 * Weights this close under the heaviest are the same ink to the eye, and
 * the flattest edge among them should win the surface. The gap that *is*
 * visible is known: `H` at 0.171 standing in for `B` at 0.204 — 16% down —
 * was the flat-grey-wall fault this file exists to fix. 8% keeps the true
 * dark cluster together and that fault out.
 */
const SURFACE_TIE = 0.08;

/**
 * The heaviest tone is not just the most ink — it is used as a *surface*,
 * stacked against itself, row upon row, in every solid stroke of the
 * lettering. Coverage cannot see the one thing that decides whether such a
 * stack reads as a stroke: the evenness of the edges where cell meets cell.
 * A browser's monospace can measure `W` a shade heavier than `B`, and then
 * every calligraphic stem comes out as rows of sawteeth — peaks and valleys
 * at both edges, white gaps between the lines — where `B`, within a couple
 * of percent of the same ink, stacks into a bar.
 *
 * So the surface is picked among the characters whose weight the eye could
 * not tell apart on paper (SURFACE_TIE), by the measured evenness of their
 * edges; among equally flat edges the heavier keeps the job. A table atlas
 * measures no edges, every `ragged` is zero, and this reduces to rank order
 * — the same answer as before, stated the long way round.
 */
function surfacePick(ladder) {
  const top = ladder[0].weight;
  let best = ladder[0];
  let bestCost = Infinity;
  for (const g of ladder) {
    if (g.weight < top - SURFACE_TIE) break;
    const cost = g.ragged + (top - g.weight) * 0.5;
    if (cost < bestCost) { bestCost = cost; best = g; }
  }
  return best.ch;
}

/**
 * `n` characters spread from heavy to faint.
 *
 * Picked by **rank**, not by weight. That distinction is the whole point and
 * worth setting down, because the obvious version is wrong.
 *
 * The obvious version asks for the character whose coverage lands nearest
 * halfway between the heaviest and the faintest. On the SM7 that is
 * (0.204 + 0.017) / 2 = 0.110, which selects `t` — and `t` is not a mid
 * tone, it is a thin vertical with a bar. Coverage is not spread evenly
 * across a character set: 60 of the SM7's 88 characters sit in the top half
 * of the range and 28 in the bottom, so the arithmetic midpoint lands far
 * down the population. By rank the middle is number 44, which is `2`/`V`/`X`
 * — genuinely a middle grey in a block. Rank also makes the answer
 * independent of the font's absolute scale, so a face that draws everything
 * heavier does not shift every tone.
 *
 * Duplicates are dropped: a machine with four characters cannot give six
 * tones, and repeating one is how a shadow ends up identical to the face it
 * is supposed to sit behind.
 *
 * @param {number} n how many tones, 1 or more
 * @param {Object} [o] as inkLadder()
 * @returns {string[]} heaviest first, length ≤ n
 */
export function toneRamp(n, o = {}) {
  const ladder = inkLadder(o);
  if (!ladder.length) return [];
  if (n <= 1) return [surfacePick(ladder)];

  const out = [];
  let surface = null;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      const ch = surfacePick(ladder);
      surface = ladder.find((g) => g.ch === ch);
      out.push(ch);
      continue;
    }
    // Rank quantile: 0 is the heaviest character the machine has, 1 the
    // faintest.
    const at = Math.round((i / (n - 1)) * (ladder.length - 1));

    // Among characters of indistinguishable weight, prefer the one whose ink
    // sits nearest the middle of the cell — but only by enough to beat the
    // exact rank. Never one already spent, and never one heavier than the
    // surface: a shadow that outweighs its face is upside down.
    let best = null;
    let bestCost = Infinity;
    for (let k = Math.max(0, at - TIE);
         k <= Math.min(ladder.length - 1, at + TIE); k++) {
      const g = ladder[k];
      if (out.includes(g.ch)) continue;
      if (g.weight > surface.weight) continue;
      const cost = Math.abs(g.centre - 0.5) + Math.abs(k - at) * RANK_COST;
      if (cost < bestCost) { bestCost = cost; best = g.ch; }
    }
    if (best) out.push(best);
  }
  return out;
}
