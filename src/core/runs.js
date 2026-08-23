/**
 * runs.js — a line of art turned into things you actually do at the machine.
 *
 * The hard part of typing ASCII art is not the characters. It is losing
 * count in a row of eighteen spaces and having everything after it shift by
 * one. So every space counts as a step, exactly like a character.
 */

import { inkWeights } from './ink.js';

/**
 * @typedef {Object} Run
 * @property {string}  ch     the character (' ' for a space run)
 * @property {number}  n      how many times
 * @property {boolean} red    on the red half of the ribbon
 * @property {boolean} space  convenience flag
 * @property {number}  col    column where the run starts, 0-based
 * @property {number}  index  keystroke number of the first strike in the line
 */

/**
 * Split a line into runs of identical character *and* colour.
 * A colour change breaks a run because the ribbon selector gets moved.
 *
 * @param {string} line
 * @param {string[]} [colours] 'black' | 'red' per column
 * @returns {Run[]}
 */
export function runsOf(line, colours = null) {
  const text = line.replace(/\s+$/, '');
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const col = colours?.[i] === 'red';
    let j = i;
    while (
      j + 1 < text.length &&
      text[j + 1] === ch &&
      (colours?.[j + 1] === 'red') === col
    ) j++;
    out.push({
      ch,
      n: j - i + 1,
      red: col,
      space: ch === ' ',
      col: i,
      index: i,
    });
    i = j + 1;
  }
  return out;
}

/**
 * Short text form: `18_ 3: 2_ ..`, red runs in brackets.
 * Useful for a plain-text fallback and for testing.
 */
export function runsToText(line, colours = null) {
  const parts = runsOf(line, colours).map((r) => {
    const sym = r.space ? '_' : r.ch;
    const t = r.n > 1 ? `${r.n}${sym}` : sym;
    return r.red ? `(${t})` : t;
  });
  return parts.length ? parts.join(' ') : '(empty)';
}

/** Total strikes in a line, spaces included — this is what the ear hears. */
export function strikesInLine(line) {
  return line.replace(/\s+$/, '').length;
}

/**
 * Where does keystroke number `n` land in this line?
 * Used to drive the live position while listening to the machine.
 */
export function columnOfStrike(line, n) {
  return Math.min(Math.max(0, n), strikesInLine(line));
}

/**
 * Colour map for a whole motif.
 *
 * Three ways to say what goes on the red half, in order of precedence:
 *   mask   — an array of strings, 'r' marks a red cell
 *   rows   — whole motif lines, e.g. the flower head
 *   chars  — specific characters
 */
export function colourMap(lines, { mask = null, rows = null, chars = '' } = {}) {
  const rowSet = rows instanceof Set ? rows : new Set(rows ?? []);
  const charSet = new Set(chars);
  const width = Math.max(0, ...lines.map((l) => l.length));

  return lines.map((line, r) => {
    const out = [];
    for (let c = 0; c < width; c++) {
      const ch = line[c] ?? ' ';
      let red = false;
      if (ch !== ' ') {
        if (mask) red = /[rR]/.test(mask[r]?.[c] ?? '');
        else if (rowSet.has(r)) red = true;
        else if (charSet.has(ch)) red = true;
      }
      out.push(red ? 'red' : 'black');
    }
    return out;
  });
}

/**
 * Decide the ribbon colour for every cell.
 *
 * The old control was a text box asking for line numbers — "0-15" — which
 * answered the question "which rows are red" and never the question anybody
 * actually has, which is "where does the red *help*". Colour on a typewriter
 * is not decoration: the ribbon has two halves, and the second half is a
 * second ink you have already paid for. Used with the shape of the motif it
 * buys depth, shadow and material.
 *
 * Every scheme here is a rule about the picture, not about row numbers.
 *
 * @param {string[]} lines
 * @param {Object} o
 * @param {string} o.scheme
 * @param {Object} [o.atlas]   glyph atlas, for the schemes that need to know
 *                             how much ink a character carries
 * @param {number} [o.amount]  0..1, how much of the motif turns red
 * @param {Set<number>|number[]} [o.rows]  explicit rows, for scheme 'rows'
 */
export function inkPlan(lines, { scheme = 'none', atlas = null, amount = 0.5,
                                 rows = null, chars = '' } = {}) {
  const width = Math.max(0, ...lines.map((l) => l.length));
  const height = lines.length;
  const black = () => lines.map(() => Array(width).fill('black'));
  if (scheme === 'none' || !height) return black();

  // Explicit schemes keep working through the same door as before.
  if (scheme === 'rows') return colourMap(lines, { rows });
  if (scheme === 'chars') return colourMap(lines, { chars });

  /* How much ink each character carries, 0..1. The atlas measured this when
   * it rendered the glyphs; without one, fall back to a rough ordering so
   * the schemes still do something sensible in tests and on paper. */
  const weight = inkWeights(atlas);

  /*
   * The tonal schemes take their cut from the motif, not from an abstract
   * scale.
   *
   * The first version compared each character's ink against the slider
   * directly. On a photograph that is fine — there are sixty different
   * characters and the range is full. On lettering there are two, `#` and
   * `+`, sitting at 0.98 and 0.33: the slider then did nothing at all for
   * its first third, jumped to 43% red, and did nothing for the rest. On a
   * hollow or block face, with a single character, it did nothing anywhere
   * across its whole travel.
   *
   * So the amount now means what it says — *this fraction of the strikes
   * turns red* — and the cut is placed at whichever ink level comes closest
   * to that fraction. On a photograph it is smooth; on two-character
   * lettering it snaps, because there is nothing in between to snap to.
   */
  const cut = (scheme === 'depth' || scheme === 'accent')
    ? tonalCut(lines, weight, amount, scheme)
    : 0;

  // The heaviest character actually in the motif, for the shadow scheme.
  let heaviest = 0;
  if (scheme === 'shadow') {
    for (const line of lines) {
      for (const ch of line) {
        if (ch !== ' ') heaviest = Math.max(heaviest, weight(ch));
      }
    }
  }

  const map = lines.map((line, r) => {
    const out = [];
    for (let c = 0; c < width; c++) {
      const ch = line[c] ?? ' ';
      if (ch === ' ') { out.push('black'); continue; }
      out.push(redAt(ch, r, c) ? 'red' : 'black');
    }
    return out;
  });
  return map;

  function redAt(ch, r, c) {
    const w = weight(ch);
    switch (scheme) {
      /*
       * Depth. The darkest characters carry the picture; red on the lightest
       * ones pushes them back, because red ink on white paper reads lighter
       * than black at the same coverage. So the faintest `amount` of the
       * tonal range goes red and the picture gains a background.
       */
      case 'depth':
        return w <= cut;

      /*
       * The opposite, and the more theatrical one: the heaviest strikes go
       * red, so the picture keeps its drawing in black and the accents burn.
       */
      case 'accent':
        return w >= cut;

      /*
       * Lettering styles that already produce two kinds of cell — a face and
       * a shadow, drawn with different characters — get the shadow in red.
       *
       * "Anything that is not the heaviest character present" rather than a
       * list of shadow characters. The list was wrong the moment the tones
       * stopped being hard-coded: it named `+` and `:` because those were
       * the only light characters the old code could ever pick, and on an
       * SM7 the shadow now comes out as `-` or `2`, neither of which was on
       * it. A list of characters cannot answer a question about *this*
       * motif; the motif can.
       */
      case 'shadow':
        return w < heaviest;

      /*
       * A light from the top left, the way anything is drawn when it wants
       * to look solid: cells in the lower right half of the motif go red.
       * Cheap, and it works on any shape at all.
       */
      case 'lit': {
        const d = (c / Math.max(1, width - 1)) + (r / Math.max(1, height - 1));
        return d > 2 - amount * 2;
      }

      /*
       * Bands across the picture. Not a gimmick: on a wide motif it is the
       * one scheme that makes a lost line obvious, because the colour tells
       * you which band you are in.
       */
      case 'bands': {
        const band = Math.max(2, Math.round(height / 6));
        return Math.floor(r / band) % 2 === 1;
      }

      /* Top half red, bottom half black, or wherever `amount` puts the line. */
      case 'split':
        return r < height * amount;

      default:
        return false;
    }
  }
}

/**
 * How many distinct ink levels a motif actually contains.
 *
 * The tonal schemes grade a motif from faint to heavy. With a single level
 * there is nothing to grade and they cannot do anything at all, so the
 * interface uses this to leave them out rather than offer a control that
 * does nothing.
 */
export function inkLevels(lines, atlas = null) {
  const weight = inkWeights(atlas);
  const seen = new Set();
  for (const line of lines) {
    for (const ch of line) if (ch !== ' ') seen.add(weight(ch));
  }
  return seen.size;
}

/**
 * Find the ink level that splits the strikes closest to the wanted fraction.
 *
 * Never returns a cut that colours nothing: the scheme has been chosen, so
 * some red is the whole point, and "you asked for red and got none" is the
 * exact fault this is here to prevent.
 */
function tonalCut(lines, weight, amount, scheme) {
  const all = [];
  for (const line of lines) {
    for (const ch of line) if (ch !== ' ') all.push(weight(ch));
  }
  if (!all.length) return scheme === 'depth' ? -1 : Infinity;

  const levels = [...new Set(all)].sort((a, b) => a - b);
  let best = levels[scheme === 'depth' ? 0 : levels.length - 1];
  let bestErr = Infinity;
  for (const lv of levels) {
    const hit = scheme === 'depth'
      ? all.filter((v) => v <= lv).length
      : all.filter((v) => v >= lv).length;
    const err = Math.abs(hit / all.length - amount);
    if (err < bestErr) { bestErr = err; best = lv; }
  }
  return best;
}


/** What the schemes are called, and what they do. For the interface. */
export const INK_SCHEMES = [
  { id: 'none',   name: 'Black only',
    hint: 'One pass, no ribbon change.' },
  { id: 'depth',  name: 'Depth',
    hint: 'Faint areas in red so they fall back behind the dark ones.' },
  { id: 'accent', name: 'Accent',
    hint: 'The heaviest strikes in red. Drawing stays black.' },
  { id: 'shadow', name: 'Shadow',
    hint: 'The shadow of a lettering style in red, the face in black.' },
  { id: 'lit',    name: 'Lit from the left',
    hint: 'Lower right in red, as if lit from the top left.' },
  { id: 'bands',  name: 'Bands',
    hint: 'Alternating bands. Easiest to keep your place in.' },
  { id: 'split',  name: 'Split',
    hint: 'Top red, bottom black.' },
  { id: 'rows',   name: 'Chosen lines',
    hint: 'Name the lines yourself.' },
];

/** How many strikes are black and how many red. */
export function inkTally(lines, colours) {
  let black = 0, red = 0;
  lines.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch === ' ') return;
      if (colours?.[r]?.[c] === 'red') red++; else black++;
    });
  });
  return { black, red, total: black + red };
}

/**
 * Parse a range like "0-15,20" into a Set of line numbers.
 */
export function parseRows(spec, limit = Infinity) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = +m[1], b = Math.min(+m[2], limit - 1);
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(t)) {
      out.add(+t);
    }
  }
  return out;
}
