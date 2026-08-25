/**
 * turn.js — planning a motif for a sheet you turn *afterwards*.
 *
 * This file exists because of a mistake the app used to make. Landscape was
 * modelled as feeding the sheet in on its long edge: swap the paper's width
 * and height and let everything downstream follow. It reads well and it is
 * not true. A4 on its long edge is 297 mm of writing line, and the Olympia
 * SM7's carriage scale ends at 98 — 249 mm. The last forty-three columns of
 * a "116 column" motif had nowhere to go, and the app said so in a note
 * headed "nothing is typed out there", which is exactly backwards: nothing
 * *can* be typed out there.
 *
 * The paper goes in upright. It always goes in upright. What can be planned
 * is the picture: draw it lying on its side, type it upright on an upright
 * sheet, and turn the finished sheet a quarter turn to look at it. The type
 * bars still strike one way only — so the glyphs end up on their sides, and
 * that is the price. For a picture it costs nothing worth having: a cell is
 * 2.54 by 4.23 mm and what carries the image is how much ink is in it.
 *
 * Two frames, and keeping them apart is most of the work here:
 *
 *   the sheet   what the machine types. Always upright. Rows are lines you
 *               type, columns are carriage positions.
 *   the view    what you look at once the sheet is turned. Its width is the
 *               sheet's *height* and its cell is 4.23 by 2.54 mm — the
 *               aspect ratio turns with everything else, which is why a
 *               picture is turned before it is fitted and not after.
 *
 * `turn` is named for what your hands do: 'left' means you turn the finished
 * sheet anticlockwise to look at it, so the picture has to be laid down
 * clockwise to survive that. 'none' is an upright sheet read upright.
 */

/** The three ways a finished sheet can be read. */
export const TURNS = ['none', 'left', 'right'];

export const isTurned = (turn) => turn === 'left' || turn === 'right';

/**
 * A grid as the other frame sees it: rows and columns change places.
 *
 * Worth stating what this does *not* do, because the old model claimed it
 * did. Turning the sheet buys no room. A4 at pica holds 66 by 60 cells
 * inside its margins; turned, that is 60 by 66 — the same sixty-six by
 * sixty cells, stood the other way up. What turning buys is the *shape* of
 * the region, and with it the size of the picture: a 16:9 photograph fitted
 * upright comes out 168 by 93 mm, and planned sideways 254 by 142 mm, which
 * is one and a half times the size and two and a third times the detail.
 */
export function turnedGrid(g) {
  return { cols: g.rows, rows: g.cols };
}

/** The grid a motif has to be laid out against, given how it will be read. */
export function planningGrid(g, turn) {
  return isTurned(turn) ? turnedGrid(g) : g;
}

/* ------------------------------------------------------------------ */
/* Pictures: turn the field, not the finished characters               */
/* ------------------------------------------------------------------ */

/**
 * Rotate an ink field a quarter turn, so it can be typed on an upright sheet.
 *
 * This happens early — right after the picture becomes ink, before the blur,
 * the contrast and the character matching — and that is the whole trick. Do
 * it here and every later step is the ordinary upright pipeline: fitGrid()
 * gets a picture whose proportions are already stated in the sheet's frame
 * and corrects for the 2.54 × 4.23 mm cell in the ordinary way, and the
 * shape matcher in glyphs.js is choosing characters for the marks that will
 * actually be struck.
 *
 * Rotating the finished character grid instead would get both of those
 * wrong: the aspect correction would have been applied along the wrong axis,
 * and every character would have been chosen to match a part of the picture
 * that is no longer under it.
 *
 * @param {{w: number, h: number, data: Float32Array}} field
 * @param {'none'|'left'|'right'} turn  how the sheet will be *read*
 */
export function turnField(field, turn) {
  if (!isTurned(turn)) return field;
  const { w, h, data } = field;
  const out = { ...field, w: h, h: w, data: new Float32Array(data.length) };

  // Read the sheet left → the picture lies down right, and the other way
  // round. The two loops are the same walk with one index reversed; written
  // out rather than shared so each is readable on its own.
  if (turn === 'left') {
    // laid down clockwise: out(x, y) = in(y, h - 1 - x)
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < h; x++) {
        out.data[y * h + x] = data[(h - 1 - x) * w + y];
      }
    }
  } else {
    // laid down anticlockwise: out(x, y) = in(w - 1 - y, x)
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < h; x++) {
        out.data[y * h + x] = data[x * w + (w - 1 - y)];
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Text and pasted art: turn the characters, and admit what it costs   */
/* ------------------------------------------------------------------ */

/**
 * What a mark has to be typed as, so that it *looks* right once turned.
 *
 * Read the direction carefully, because it is the opposite of the one that
 * feels right. Turning the sheet anticlockwise turns everything printed on
 * it anticlockwise too, so a mark that should read as an underscore has to
 * be struck as whatever an underscore looks like when it is rotated the
 * other way — clockwise. This table is that: keyed by what you want to see,
 * valued by what to hit.
 *
 * It is deliberately short and only holds pairs that are honest. Bars are
 * mapped by *direction* and not by which side of the cell they sit on: an
 * underscore turned is a bar up the left-hand edge, no typewriter has one,
 * and a centred bar at 2.54 mm reads the same from any distance the picture
 * is meant to be seen from. Where nothing honest exists — a tilde has no
 * vertical twin — there is no entry and the mark is struck as it stands.
 *
 * Letters and digits are absent on purpose. They are chosen for weight, not
 * for direction, and a `B` on its side is exactly as dark as a `B`.
 */
const CLOCKWISE = {
  '-': '!', '_': '!', '=': '"', '|': '-', '!': '-',
  '/': '\\', '\\': '/',
  '(': 'n', ')': 'u',
  '<': '^', '>': 'v', '^': '>', 'v': '<',
};

const ANTICLOCKWISE = {
  '-': '!', '_': '!', '=': '"', '|': '-', '!': '-',
  '/': '\\', '\\': '/',
  '(': 'u', ')': 'n',
  '<': 'v', '>': '^', '^': '<', 'v': '>',
};

/** The mark table for a turn, keyed by the appearance you are after. */
export function turnedMarks(turn) {
  return turn === 'left' ? CLOCKWISE : turn === 'right' ? ANTICLOCKWISE : {};
}

/**
 * Rotate a block of characters a quarter turn.
 *
 * Unlike a picture, a word cannot be turned before it is drawn: the faces in
 * lettering.js choose their marks from the direction of the stroke they sit
 * in — an underscore where a stroke ends flat, a bracket where it turns —
 * and those decisions are made in the frame the letter is *read* in. So the
 * letter is drawn upright, in the marks that are right for the eye, and this
 * lays the finished block on its side and swaps each mark for the key that
 * will look like it afterwards.
 *
 * `have` is the machine's keys. A rotated mark it has not got is not worth
 * having: the original character was typeable and at least carries the right
 * weight, so it stays. Nothing this returns is untypeable that was not
 * untypeable already.
 *
 * @param {string[]} rows
 * @param {'none'|'left'|'right'} turn
 * @param {Set<string>|null} [have] the machine's characters
 */
export function turnRows(rows, turn, have = null) {
  if (!isTurned(turn) || !rows.length) return rows;

  const w = Math.max(0, ...rows.map((r) => r.length));
  if (!w) return rows;
  const grid = rows.map((r) => r.padEnd(w, ' '));
  const h = grid.length;
  const marks = turnedMarks(turn);
  const swap = (ch) => {
    const to = marks[ch];
    return to && (!have || have.has(to)) ? to : ch;
  };

  const out = [];
  // Turning the sheet left means the picture lies down to the right: the
  // block's left-hand column becomes the top line of typing, which is also
  // why it is the pleasanter of the two to type — you work through the
  // picture from its left edge, the way you would read it.
  for (let r = 0; r < w; r++) {
    let line = '';
    for (let c = 0; c < h; c++) {
      line += turn === 'left'
        ? swap(grid[h - 1 - c][r])
        : swap(grid[c][w - 1 - r]);
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

/**
 * Which way the paper has to be turned, in words you can act on.
 *
 * One sentence, one place, so the setup instructions, the PDF and the
 * command line cannot describe the same quarter turn three different ways.
 */
export function turnAdvice(turn) {
  if (!isTurned(turn)) return null;
  return turn === 'left'
    ? {
        short: 'turn the finished sheet to the left',
        long: 'A quarter turn anticlockwise. The top of the motif is at the '
            + 'right-hand edge of the paper, and you type it starting from '
            + 'its left-hand side.',
      }
    : {
        short: 'turn the finished sheet to the right',
        long: 'A quarter turn clockwise. The top of the motif is at the '
            + 'left-hand edge of the paper, and you type it starting from '
            + 'its right-hand side.',
      };
}
