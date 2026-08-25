/**
 * machine.js — what a typewriter can actually do.
 *
 * Everything downstream depends on this: which characters exist, how wide a
 * cell is, how far the margin stops travel. Get it wrong and the art is
 * beautiful and untypeable.
 *
 * A profile is plain data, so people can add their own machine in a pull
 * request without touching any code.
 */

/** Inches → millimetres. */
const MM_PER_INCH = 25.4;

/**
 * @typedef {Object} Machine
 * @property {string}   id          stable key, used in URLs
 * @property {string}   name        shown in the picker
 * @property {string}   [maker]
 * @property {string}   [years]
 * @property {string}   [layout]    QWERTZ | QWERTY | AZERTY …
 * @property {number}   cpi         characters per inch (10 = pica, 12 = elite)
 * @property {number}   lpi         lines per inch (almost always 6)
 * @property {string[]} rows        keyboard rows, unshifted
 * @property {string[]} shiftRows   same keys, shifted
 * @property {string}   [extra]     typeable characters not on the picker
 * @property {Object}   scale       margin stop travel
 * @property {number}   scale.min   lowest number on the scale
 * @property {number}   scale.max   highest number on the scale
 * @property {number}   scale.leftMin   left stop cannot go below this
 * @property {number}   scale.rightMax  right stop cannot go beyond this
 * @property {boolean}  twoColour   black/red ribbon
 * @property {boolean}  backspace   has a backspace key
 * @property {boolean}  halfSpace   can set half steps (held space bar counts)
 * @property {string}   [notes]
 */

/** Millimetres per character cell. */
export function cellWidthMm(m) {
  return MM_PER_INCH / m.cpi;
}

/* ------------------------------------------------------------------ */
/* Measuring a real machine                                            */
/* ------------------------------------------------------------------ */

/**
 * The pitches machines were actually built in.
 *
 * Pica and elite are the two that matter. Anything else is a curiosity, and
 * a measurement that lands somewhere else is far more likely to be a
 * mis-measurement than a rare machine — so the caller is told the distance
 * to the nearest standard rather than being quietly snapped onto it.
 */
export const PITCHES = [
  { perInch: 10, name: 'pica' },
  { perInch: 12, name: 'elite' },
];

/** Line spacings. Six to the inch is very nearly universal. */
export const LINE_PITCHES = [
  { perInch: 6, name: 'six lines to the inch' },
];

/**
 * Turn a ruler reading into a pitch.
 *
 * `steps` is how many times the carriage moved between the two points you
 * measured — not how many characters you typed. Type forty M and the ink
 * runs from the first to the fortieth, which is thirty-nine steps of travel.
 *
 * That off-by-one is the whole reason this function exists. Measuring the
 * width of the block of ink instead would be wrong by most of a character,
 * because a printed M is narrower than the cell it sits in. Measuring the
 * *same edge* on the first and the last letter makes that side bearing
 * cancel out exactly, and what is left is whole steps of the carriage.
 *
 * Forty characters rather than ten for the same reason a long baseline beats
 * a short one anywhere else: a half-millimetre slip of the ruler is spread
 * across thirty-nine steps instead of nine.
 *
 * @param {number} steps  carriage or paper movements between the two marks
 * @param {number} mm     measured distance
 * @param {{perInch:number,name:string}[]} [table]
 * @returns {null | { perInch: number, nearest: object, offPercent: number,
 *                    confident: boolean, offByOne: boolean }}
 */
export function pitchFrom(steps, mm, table = PITCHES) {
  if (!(steps > 0) || !(mm > 0)) return null;

  const perInch = (steps * MM_PER_INCH) / mm;

  let nearest = table[0];
  for (const p of table) {
    if (Math.abs(p.perInch - perInch) < Math.abs(nearest.perInch - perInch)) {
      nearest = p;
    }
  }
  const offPercent = Math.abs(perInch - nearest.perInch) / nearest.perInch * 100;

  // How much slop to allow, and why that number.
  //
  // Not a feel for how careful people are with rulers — that would be a
  // guess. It comes from the question being asked. Pica and elite are twenty
  // per cent apart, so a reading exactly between them is ten per cent from
  // either. Half of that is the widest band that still lands unambiguously
  // in one camp, and that is the number used here.
  //
  // An earlier, tighter band was tempting because it also caught people
  // measuring the block of ink instead of edge to edge. That was the wrong
  // instinct: the mistake is worth about one character in forty, and it
  // never changes which pitch you land on. Refusing a perfectly good
  // measurement to police a harmless error helps nobody. It is reported
  // instead, as a hint for next time.
  const confident = offPercent <= 5;

  // A reading roughly one step too long is the block-of-ink mistake. The
  // sign matters: too long means the distance covered more steps than the
  // caller thinks, which is exactly what measuring past the last letter does.
  const oneStep = 100 / steps;
  const offByOne = perInch < nearest.perInch
    && Math.abs(offPercent - oneStep) < oneStep * 0.6;

  return { perInch, nearest, offPercent, confident, offByOne };
}

/** What that measurement should have read, had the machine been standard. */
export function expectedMm(steps, perInch) {
  return (steps * MM_PER_INCH) / perInch;
}

/** Millimetres per line. */
export function cellHeightMm(m) {
  return MM_PER_INCH / m.lpi;
}

/**
 * Every character the machine can strike.
 * Space is deliberately excluded — it is a movement, not a character.
 */
export function charset(m) {
  const seen = new Set();
  const out = [];
  const add = (s) => {
    for (const ch of s ?? '') {
      if (ch === ' ' || seen.has(ch)) continue;
      seen.add(ch);
      out.push(ch);
    }
  };
  (m.rows ?? []).forEach(add);
  (m.shiftRows ?? []).forEach(add);
  add(m.extra);
  return out;
}

/**
 * Substitutes for characters the machine lacks.
 *
 * Most typewriters have no zero — you type a capital O. Digital sources are
 * full of characters no mechanical machine ever had, so rather than refusing
 * the artwork we swap in the closest shape available.
 */
const SUBSTITUTES = {
  '0': ['O', 'o', 'Q'],
  '\\': ['/', 'X', 'x'],
  '|': ['!', 'I', 'l', '1'],
  '@': ['a', 'O', '§'],
  '#': ['+', 'H', '='],
  '$': ['§', 'S', 's'],
  '*': ['x', 'X', '+'],
  // `"` and `'` sit ahead of `A` because a caret is a small raised mark and
  // so are they. `A` was harmless while this table only patched the odd
  // character in pasted art; it decides whole faces now — the peaks face is
  // built out of carets — and a line of `A` reads as a word, not a texture.
  '^': ['´', '`', '"', "'", 'A'],
  '~': ['-', '_', '='],
  // Not every machine has one. A generic pica QWERTY does not, and eight of
  // the faces here are drawn with underscores, so without this line they are
  // all simply unavailable on it. `-` is the same stroke carried higher up
  // the cell, which is as close as a typewriter gets.
  '_': ['-', '=', '.'],
  '<': ['(', '/', 'c'],
  '>': [')', '/', 'j'],
  '[': ['(', '/', 'l'],
  ']': [')', '/', 'l'],
  '{': ['(', 'C', 'l'],
  '}': [')', ')', 'l'],
  '“': ['"'], '”': ['"'], '„': ['"'],
  '‘': ["'"], '’': ["'"], '‚': [','],
  '–': ['-'], '—': ['-'], '−': ['-'],
  '·': ['.'], '•': ['.'], '…': ['.'],
  '×': ['x'], '÷': [':'], '°': ['o'],
  '\u00a0': [' '],
};

/**
 * Stand-ins for the marks a machine has not got.
 *
 * Two stages, in this order, and the order is the whole design.
 *
 * The table first, because it carries judgements a measurement cannot make.
 * `^` and `´` do not look alike — one is a tent, the other a single stroke —
 * and a shape match would rather have `A` or a quotation mark. But `´` is
 * the right answer, because what matters is what the mark is *for*: it is
 * the thing you put above a letter. That knowledge is typographic, not
 * geometric, and the table is where it lives.
 *
 * Then `nearest`, if the caller has one: a measured match against the keys
 * this machine actually has. It catches every mark the table has never heard
 * of, which is every mark somebody adds a face for later — the table stops
 * being a list that has to be maintained and becomes a list of exceptions.
 *
 * Measuring needs a rendered glyph, so where there is no canvas there is no
 * second stage and the mark simply has no stand-in. That is reported in
 * `missing` rather than quietly filled with something wrong, which is the
 * same bargain tableAtlas() makes about shapes.
 *
 * @param {Iterable<string>} marks the marks a face insists on
 * @param {Object} o
 * @param {Iterable<string>} o.have what this machine can strike, already
 *   narrowed to whatever is switched on
 * @param {(ch: string, have: Set<string>) => (string|null)} [o.nearest]
 * @returns {{swaps: Map<string,string>, missing: string[]}}
 */
export function standIns(marks, { have, nearest = null }) {
  const set = have instanceof Set ? have : new Set(have);
  const swaps = new Map();
  const missing = [];

  for (const ch of new Set(marks)) {
    if (set.has(ch)) continue;
    const swap = (SUBSTITUTES[ch] ?? []).find((c) => set.has(c))
      ?? (nearest ? nearest(ch, set) : null);
    if (swap) swaps.set(ch, swap);
    else missing.push(ch);
  }
  return { swaps, missing };
}

/**
 * Map text onto what the machine can type.
 * Returns the converted text plus anything that had to be dropped, so the
 * caller can warn instead of silently mangling the artwork.
 */
export function makeTypeable(text, m) {
  const have = new Set(charset(m));
  const dropped = new Map();
  let out = '';

  for (const ch of text) {
    if (ch === ' ' || ch === '\n' || have.has(ch)) {
      out += ch;
      continue;
    }
    const swap = (SUBSTITUTES[ch] ?? []).find((c) => have.has(c));
    if (swap) {
      out += swap;
    } else {
      out += ' ';
      dropped.set(ch, (dropped.get(ch) ?? 0) + 1);
    }
  }
  return { text: out, dropped };
}

/** Which characters of `text` this machine cannot type at all. */
export function untypeable(text, m) {
  const have = new Set(charset(m));
  const bad = new Set();
  for (const ch of text) {
    if (ch === ' ' || ch === '\n' || have.has(ch)) continue;
    if (!(SUBSTITUTES[ch] ?? []).some((c) => have.has(c))) bad.add(ch);
  }
  return [...bad];
}

/* ------------------------------------------------------------------ */
/* Paper                                                               */
/* ------------------------------------------------------------------ */

/**
 * The sizes, as the sheet goes into the machine: upright, always.
 *
 * There is no turned entry and there is not going to be one. A sheet is fed
 * in on its short edge because that is the edge the platen is as wide as;
 * planning a motif to be *read* sideways is a different question and lives
 * in turn.js.
 */
export const PAPERS = [
  { id: 'a4',        name: 'A4',        w: 210, h: 297, margin: 20 },
  { id: 'a5',        name: 'A5',        w: 148, h: 210, margin: 15 },
  { id: 'a6',        name: 'A6 / postcard', w: 105, h: 148, margin: 8 },
  { id: 'letter',    name: 'US Letter', w: 215.9, h: 279.4, margin: 20 },
  { id: 'halfletter',name: 'Half Letter', w: 139.7, h: 215.9, margin: 15 },
];

export function paperById(id) {
  return PAPERS.find((p) => p.id === id) ?? PAPERS[0];
}

/**
 * There is no landscape() here any more, and that is the point.
 *
 * There used to be: it swapped the paper's width and height, and everything
 * downstream believed it. A4 became 297 mm of writing line, the width slider
 * offered 116 columns, and setUp() worked out a left stop of 7 and a right
 * stop of 80 for them — seventy-three columns of carriage for a hundred and
 * sixteen columns of motif, reported as three notes and no refusal.
 *
 * The Olympia SM7's scale runs 0 to 98. That is 249 mm, and it is the whole
 * of the carriage: the right margin stop reaches 80, or 203 mm. A 297 mm
 * writing line is not a stop that has to be released or a scale that stops
 * counting. It is not there.
 *
 * So the paper is always the paper. Landscape is now something you do to the
 * *motif* — laid on its side, typed on an upright sheet, and the sheet
 * turned afterwards. That lives in turn.js, which is where the rest of this
 * comment went.
 */

/**
 * How many cells fit on the whole sheet.
 *
 * Multiplied for a composite rather than divided, and the difference is not
 * a rounding detail. A4 at pica holds 82 columns — 208.28 mm of a 210 mm
 * sheet. Two sheets butted together are 420 mm, and 420 mm divided by the
 * cell gives 165: one more column than the two sheets hold between them,
 * sitting half on each side of the join, where no type bar can reach it.
 *
 * So a composite's grid is the single sheet's grid times the tiling. Every
 * cell then belongs to exactly one sheet, which is the only arrangement in
 * which every cell can actually be struck. See compose.js.
 */
export function sheetGrid(paper, m) {
  const unit = paper.unit ?? paper;
  return {
    cols: (paper.across ?? 1) * Math.floor(unit.w / cellWidthMm(m)),
    rows: (paper.down ?? 1) * Math.floor(unit.h / cellHeightMm(m)),
  };
}

/**
 * Cells inside the margins — the area worth using.
 *
 * The margin is subtracted once, not once per sheet. On a composite it is a
 * distance from the outside edge of the finished picture; a margin down the
 * inside of a join would be a white stripe through the middle of it.
 */
export function textArea(paper, m) {
  const mc = Math.round(paper.margin / cellWidthMm(m));
  const mr = Math.round(paper.margin / cellHeightMm(m));
  const g = sheetGrid(paper, m);
  return { cols: g.cols - 2 * mc, rows: g.rows - 2 * mr };
}

/* ------------------------------------------------------------------ */
/* Setting up the machine                                              */
/* ------------------------------------------------------------------ */

/**
 * Where the motif's top-left corner lands, in cells from the paper's corner.
 *
 * Lifted out of setUp() so that a composite can ask it once, about the whole
 * picture, and then tell each sheet where its own piece goes. A sheet that
 * placed its own slice would centre it on itself, and the picture would jump
 * at every join — which is exactly where the eye goes.
 *
 * @param {number} motifW  motif width in characters
 * @param {number} motifH  motif height in lines
 * @param {'centre'|'topleft'} align
 * @returns {{col: number, row: number}}
 */
export function placeOn(motifW, motifH, paper, m, align = 'centre') {
  const sheet = sheetGrid(paper, m);
  const area = textArea(paper, m);
  if (align === 'topleft') {
    return {
      col: Math.floor((sheet.cols - area.cols) / 2),
      row: Math.floor((sheet.rows - area.rows) / 2),
    };
  }
  return {
    col: Math.max(0, Math.floor((sheet.cols - motifW) / 2)),
    row: Math.max(0, Math.floor((sheet.rows - motifH) / 2)),
  };
}

/**
 * Work out paper guide and margin stops for a motif.
 *
 * The trick people miss: when the left margin stop will not reach far
 * enough, you do not move the stop — you move the *paper*, using the paper
 * guide. The stops are bolted to the carriage and have hard limits; the
 * sheet can sit anywhere.
 *
 * @param {number} motifW  motif width in characters
 * @param {number} motifH  motif height in lines
 * @param {Object} paper
 * @param {Machine} m
 * @param {'centre'|'topleft'} align
 */
export function setUp(motifW, motifH, paper, m, align = 'centre', at = null) {
  const warnings = [];
  const sheet = sheetGrid(paper, m);
  const area = textArea(paper, m);

  /*
   * Three different situations, and they used to be reported as if they were
   * one. Telling somebody to hold the margin release for seven columns is
   * useless advice when the motif is 152 columns wide and the sheet only
   * holds 82: no amount of margin technique makes those fit, and the
   * instruction reads as a demand rather than a warning.
   *
   *   1. wider than the usable area, but fits on the paper
   *        -> real, and the margins simply move. Worth a note.
   *   2. wider than the paper
   *        -> impossible. Say so, and say what to change.
   *
   * Each entry carries a severity so the interface can tell an
   * impossibility from an inconvenience.
   */
  const tooWide = motifW > sheet.cols;
  const tooTall = motifH > sheet.rows;

  /*
   * The carriage is a limit in its own right, and it used to have no voice.
   *
   * Fitting on the paper and fitting through the machine are two different
   * questions, and only the first was ever asked. They agree on every sheet
   * that goes in upright — A4 at pica is 82 columns against an SM7 scale of
   * 98 — which is exactly why the disagreement went unnoticed for as long as
   * the app believed a sheet could be fed in sideways.
   *
   * Only when the paper itself has nothing to say. A motif that is off the
   * edge of the sheet *and* past the end of the carriage is one problem, not
   * two, and it is the paper that people can do something about.
   */
  const travel = m.scale?.max ?? Infinity;
  if (motifW > travel && !tooWide) {
    warnings.push({
      level: 'stop',
      text: `The carriage does not reach: ${motifW} columns against a scale ` +
        `that ends at ${travel}. Nothing can be struck out there, with or ` +
        `without the margin release.`,
    });
  }

  if (tooWide || tooTall) {
    const bits = [];
    if (tooWide) bits.push(`${motifW} columns wide, the sheet holds ${sheet.cols}`);
    if (tooTall) bits.push(`${motifH} lines tall, the sheet holds ${sheet.rows}`);
    warnings.push({
      level: 'stop',
      text: `This will not fit on ${paper.name}: ${bits.join('; ')}. ` +
        `Use a smaller style, a shorter word, or a larger sheet.`,
    });
  } else if (!at) {
    /*
     * Only when this function chose the position. A sheet of a composite
     * gets its piece of the picture edge to edge by design — the margins
     * belong to the outside of the finished thing — so comparing its slice
     * against a single sheet's margins would raise the same note on every
     * sheet, about a decision nobody made.
     */
    if (motifW > area.cols) {
      warnings.push({
        level: 'note',
        text: `Wider than the usual margins — ${motifW} columns against ` +
          `${area.cols}. It fits on the paper; the margins just move in less.`,
      });
    }
    if (motifH > area.rows) {
      warnings.push({
        level: 'note',
        text: `Taller than the usual margins — ${motifH} lines against ` +
          `${area.rows}. It fits on the paper, with less room top and bottom.`,
      });
    }
  }

  /*
   * Placed, or told where to go.
   *
   * `at` is for one sheet of a composite, where the position is not this
   * function's to choose: it was decided once for the whole picture and
   * handed down, so that the joins line up. Everything below — the paper
   * guide, the stops, the margin release — is the same work either way.
   */
  const place = at ?? placeOn(motifW, motifH, paper, m, align);
  const fromEdge = place.col;
  const advance = place.row;

  let guide = 0;
  let left = fromEdge;
  let right = left + motifW;
  let marginRelease = false;

  // Left stop cannot reach? Slide the paper right instead.
  if (left < m.scale.leftMin) {
    guide = m.scale.leftMin - fromEdge;
    left = m.scale.leftMin;
    right = left + motifW;
  }

  if (right > m.scale.rightMax) {
    guide = 0;
    left = Math.max(m.scale.leftMin, fromEdge);
    right = Math.min(m.scale.rightMax, left + motifW);
    // Only worth explaining when the motif genuinely fits on the paper.
    // If it does not, the message above already said so, and adding margin
    // technique on top of an impossibility is just noise.
    if (tooWide) {
      // nothing to add
    } else if (fromEdge < m.scale.leftMin) {
      marginRelease = true;
      warnings.push({
        level: 'note',
        text: `The first ${m.scale.leftMin - fromEdge} columns sit left of ` +
          `where the margin stop reaches. Hold the margin release down for ` +
          `those, then let the stop take over.`,
      });
    } else {
      warnings.push({
        level: 'note',
        text: `The lines run past scale ${m.scale.rightMax}, so the bell ` +
          `will ring before the end of each one. Keep typing.`,
      });
    }
  }

  if (!tooWide && guide + sheet.cols > m.scale.max) {
    warnings.push({
      level: 'note',
      text: `The right edge of the paper sits past the end of the scale ` +
        `(${guide + sheet.cols} against ${m.scale.max}). Nothing is typed ` +
        `out there; it only means the scale stops telling you where you are.`,
    });
  }

  return { paperGuide: guide, left, right, advance, marginRelease, warnings };
}
