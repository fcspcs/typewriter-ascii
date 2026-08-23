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
        return w < amount;

      /*
       * The opposite, and the more theatrical one: the heaviest strikes go
       * red, so the picture keeps its drawing in black and the accents burn.
       */
      case 'accent':
        return w > 1 - amount * 0.7;

      /*
       * Lettering styles that already produce two kinds of cell — a face and
       * a shadow, drawn with different characters — get the shadow in red.
       * `.` never reaches here; the shadow characters are the light fill the
       * style was built with.
       */
      case 'shadow':
        return SHADOW_CHARS.has(ch);

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
 * Characters the lettering styles use for their second surface.
 *
 * Kept here rather than imported from lettering.js: runs.js is the layer
 * everything else depends on, and pulling the letter machinery in for one
 * lookup would invert that.
 */
const SHADOW_CHARS = new Set(['+', '/', '_', '!', '(', ')', ':', '.', ',', '`']);

/**
 * A function from character to how much ink it puts on the paper, 0..1.
 *
 * With an atlas this is measured. Without one it is a rough ranking — good
 * enough to order light from heavy, which is all the schemes ask of it.
 */
function inkWeights(atlas) {
  const ORDER = ' .,:;\'`-_~!/|()[]{}+=<>*^?ilrtcvxzsnuoaebdhkpqgwmMWNHRBQ#@';
  const ranked = (ch) => {
    const i = ORDER.indexOf(ch);
    return i < 0 ? 0.5 : i / (ORDER.length - 1);
  };

  const glyphs = atlas?.glyphs ?? [];
  if (glyphs.length) {
    const max = atlas.maxCoverage || 1;
    const values = glyphs.map((g) => g.coverage / max);
    // A measured atlas beats a hand-written ranking — but only if it actually
    // measured something. A canvas that cannot render (a headless browser, a
    // blocked font) reports every glyph as identical, and every scheme built
    // on tone would then quietly do nothing. Fall back rather than pretend.
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > 0.05) {
      const byChar = new Map(glyphs.map((g, i) => [g.ch, values[i]]));
      return (ch) => byChar.get(ch) ?? ranked(ch);
    }
  }
  return ranked;
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
