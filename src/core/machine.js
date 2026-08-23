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
 *                    confident: boolean }}
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

  // Two per cent is about a millimetre out over forty characters — sloppier
  // than that and we should not be telling anybody they own a pica machine.
  // Pica and elite are twenty per cent apart, so this leaves plenty of room.
  return { perInch, nearest, offPercent, confident: offPercent <= 2 };
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
  '^': ['´', '`', 'A'],
  '~': ['-', '_', '='],
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
 * Portrait only. A typewriter feeds paper on its short edge; landscape art
 * means typing the motif rotated and turning the finished sheet.
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

/** How many cells fit on the whole sheet. */
export function sheetGrid(paper, m) {
  return {
    cols: Math.floor(paper.w / cellWidthMm(m)),
    rows: Math.floor(paper.h / cellHeightMm(m)),
  };
}

/** Cells inside the margins — the area worth using. */
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
export function setUp(motifW, motifH, paper, m, align = 'centre') {
  const warnings = [];
  const sheet = sheetGrid(paper, m);
  const area = textArea(paper, m);
  const marginCols = Math.floor((sheet.cols - area.cols) / 2);
  const marginRows = Math.floor((sheet.rows - area.rows) / 2);

  if (motifW > area.cols) {
    warnings.push(
      `The motif is ${motifW} columns wide but only ${area.cols} fit inside ` +
      `the margins. The margins will be narrower than usual.`);
  }
  if (motifH > area.rows) {
    warnings.push(
      `The motif is ${motifH} lines tall but only ${area.rows} fit inside ` +
      `the margins.`);
  }

  const fromEdge = align === 'topleft'
    ? marginCols
    : Math.max(0, Math.floor((sheet.cols - motifW) / 2));
  const advance = align === 'topleft'
    ? marginRows
    : Math.max(0, Math.floor((sheet.rows - motifH) / 2));

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
    if (fromEdge < m.scale.leftMin) {
      marginRelease = true;
      warnings.push(
        `The motif starts at scale ${fromEdge} but the left margin stop ` +
        `only reaches ${m.scale.leftMin}. Type the first ` +
        `${m.scale.leftMin - fromEdge} columns of each line with the margin ` +
        `release held down.`);
    } else {
      warnings.push(
        `The motif runs to scale ${fromEdge + motifW} but the right margin ` +
        `stop only reaches ${m.scale.rightMax}. Lines will run into the bell.`);
    }
  }

  if (guide + sheet.cols > m.scale.max) {
    warnings.push(
      `The right paper edge lands at scale ${guide + sheet.cols}, past the ` +
      `end of the scale (${m.scale.max}).`);
  }

  return { paperGuide: guide, left, right, advance, marginRelease, warnings };
}
