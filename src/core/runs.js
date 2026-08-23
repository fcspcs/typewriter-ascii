/**
 * runs.js — a line of art turned into things you actually do at the machine.
 *
 * The hard part of typing ASCII art is not the characters. It is losing
 * count in a row of eighteen spaces and having everything after it shift by
 * one. So every space counts as a step, exactly like a character.
 */

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
