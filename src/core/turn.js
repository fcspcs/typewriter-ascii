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
 * Repeat lines until a block is `want` deep, keeping every mark.
 *
 * Nearest neighbour, and it has to be: a cell holds a character or it does
 * not, and there is no such thing as half a `+`. Blending is what a picture
 * does, and this exists precisely so that set type does not have to become
 * a picture to be turned.
 *
 * It resamples either way — a `want` below the block's own depth drops
 * lines rather than repeating them — but turnFit() never asks for that.
 * Above the floor it keeps, a turn still hands the block more lines than it
 * started with.
 */
export function stretchRows(rows, want) {
  const h = rows.length;
  if (!(want > 0) || !h || want === h) return rows.slice();
  return Array.from({ length: want },
    (_, y) => rows[Math.min(h - 1, Math.floor((y * h) / want))]);
}

/**
 * Merge columns until a block is `want` wide, and let the ink decide which
 * mark comes through.
 *
 * The counterpart to stretchRows(), and the harder half. Dropping a line
 * from a stretched block costs nothing, because the line above it is the
 * same line. Dropping a column costs a column — so the rule here is not
 * "take the nearest" but "take the heaviest": where two columns become one,
 * the cell with ink in it beats the cell with none. A hairline therefore
 * cannot vanish, which is exactly the failure that made the first version
 * of this refuse to squeeze at all. What it *can* do is move by half a cell,
 * and two strokes one column apart can close up into one.
 *
 * That is the true cost, and it is the right way round for a typewriter: a
 * stroke that disappears is a hole in a letter, a stroke that thickens is a
 * bolder letter. Above the floor turnFit() keeps, no more than one column in
 * two is ever merged away.
 *
 * `weight` is how much ink a mark carries, for a machine that has measured
 * its keys: a `+` then beats a `.` where both fall in the same merge.
 * Without one, ink beats paper and that is the whole rule.
 *
 * @param {string[]} rows
 * @param {number} want
 * @param {((ch: string) => number)|null} [weight]
 */
export function squeezeCols(rows, want, weight = null) {
  const wide = Math.max(0, ...rows.map((r) => r.length));
  if (!(want > 0) || !wide || want >= wide) return rows.slice();
  const ink = weight || ((ch) => (ch === ' ' ? 0 : 1));

  return rows.map((row) => {
    const from = row.padEnd(wide, ' ');
    let line = '';
    for (let x = 0; x < want; x++) {
      // The span of the drawn block this one column has to stand for. Never
      // empty, so no column of the original goes unlooked at.
      const a = Math.floor((x * wide) / want);
      const b = Math.max(a + 1, Math.floor(((x + 1) * wide) / want));
      let mark = ' ';
      let most = -1;
      for (let i = a; i < b; i++) {
        const w = ink(from[i]);
        // Strictly greater, so that where two marks weigh the same the left
        // one stays and a squeeze cannot drift a stroke rightwards.
        if (w > most) { most = w; mark = from[i]; }
      }
      line += mark;
    }
    return line.replace(/\s+$/, '');
  });
}

/**
 * How much of a block's width is worth keeping before it stops being type.
 *
 * Half. At that point every second column has been merged into its
 * neighbour, a one-column gap can no longer be relied on to stay open, and
 * the counter of an `o` fills in. Below this the shape matcher genuinely
 * does the better job — it resamples ink smoothly and picks a lighter key
 * where a stroke thins — so the caller takes that path instead.
 */
const KEEP_AT_LEAST = 0.5;

/**
 * What laying a block down will cost it, worked out before anything moves.
 *
 * Its own function because two callers need the same arithmetic for two
 * different reasons: turnType() to do it, and the page to say what was
 * done. Which way the sheet turns makes no difference to the sizing, so
 * `turn` is not asked for.
 *
 * The answer:
 *
 *   wide, deep   the block as the font set it
 *   cols, rows   the block as it has to be laid out to read in proportion
 *   lost         columns merged away; 0 when nothing was given up
 *   keep         cols ÷ wide — the whole cost in one number
 *
 * Null when the squeeze would go past KEEP_AT_LEAST, or when there is
 * nothing to lay out at all.
 *
 * @param {string[]} rows
 * @param {Object} [opt] as turnType()
 */
export function turnFit(rows, opt = {}) {
  const {
    aspect = 0.6, readCols = 0, readRows = 0, keepAtLeast = KEEP_AT_LEAST,
  } = opt;
  const deep = rows.length;
  // Trailing spaces are not columns. flfLetter() pads its rows out to the
  // widest glyph and letter() pads a centred line, and counting that padding
  // as width refused blocks that would have gone down untouched.
  const wide = Math.max(0, ...rows.map((r) => r.replace(/\s+$/, '').length));
  if (!deep || !wide || !(aspect > 0)) return null;

  // What the turn takes and has to be handed back: (4.23/2.54)², 2.77 at pica.
  const grow = 1 / (aspect * aspect);

  /*
   * Every column kept if the paper allows it, and that is tried first: a
   * block small enough to be laid down whole is laid down whole, exactly as
   * it was before this function existed.
   *
   * Where it will not go, the two ways out are not equal. Handing back fewer
   * lines than 2.77 keeps every mark and reads as the smear this file exists
   * to prevent, so the proportion is not the part that gives. The block is
   * scaled instead — both ways at once, until it is inside the paper — and
   * that costs columns and nothing else, because the lines it is given are
   * still more lines than it started with.
   */
  let keep = 1;
  if (readCols > 0) keep = Math.min(keep, readCols / wide);
  if (readRows > 0) keep = Math.min(keep, readRows / (deep * grow));
  if (!(keep > 0) || keep < keepAtLeast) return null;

  const cols = Math.max(1, Math.min(wide, Math.floor(wide * keep)));
  // Read off the columns that actually survived rather than off `keep`, so
  // the proportion follows the block that will be laid down rather than the
  // one that was asked for.
  let deepOut = Math.max(1, Math.round(deep * grow * (cols / wide)));
  if (readRows > 0) deepOut = Math.min(deepOut, readRows);

  return {
    wide, deep, cols, rows: deepOut, lost: wide - cols, keep: cols / wide,
  };
}

/**
 * Lay set type on its side so that it reads in proportion, marks intact.
 *
 * The reason a turn distorts type at all is that a cell is not square: 2.54
 * mm across and 4.23 mm down at pica. Turn the sheet and those swap, so a
 * block laid down cell for cell comes out stretched by the ratio twice over
 * — (4.23/2.54)², 2.77 times — which is what made a word planned sideways
 * read as a smear.
 *
 * The fix is to give the block back the lines the turn is about to take
 * from it: repeat each line 2.77 times and the cells come out the shape
 * they started. Nothing is resampled sideways, so the marks in a row stay
 * exactly as the font set them — which matters, because a mark cannot be
 * scaled the way ink can. Caligraphy2 draws its body in `+`, and a `+` is
 * the same mark whichever way the paper is held; matching it against a
 * grid of ink would have thrown it away and picked something else.
 *
 * A block with 2.77 times its own lines is a big block, and A4 at pica has
 * the room for about twenty-nine lines of type that way — past that the
 * motif runs off the end of the paper. That used to be the end of it: the
 * word went to the shape matcher and came back in the matcher's marks,
 * which is how a word set in `+` arrived struck in `W` and `M`. It is not
 * the end of it. Keeping the proportion is what a turn is about; keeping
 * every column is not. So the block is scaled down to the paper first —
 * squeezeCols() merges columns and lets the ink say which mark stands for
 * each merge — and the marks come through the turn as the font set them.
 *
 * Null only when that squeeze would go too far, below half the width; see
 * KEEP_AT_LEAST. The caller then has an honest choice to make, and app.js
 * makes it: set the word as a picture and say the marks are the matcher's.
 *
 * @param {string[]} rows the block as it is read, upright
 * @param {'none'|'left'|'right'} turn
 * @param {Object} [opt]
 * @param {number} [opt.aspect] cell width ÷ height — see cellAspect()
 * @param {number} [opt.readCols] the turned sheet, as the eye meets it
 * @param {number} [opt.readRows]
 * @param {Set<string>|null} [opt.have] the machine's characters
 * @param {((ch: string) => number)|null} [opt.weight] ink per mark, if known
 * @param {number} [opt.keepAtLeast] least of the width worth keeping
 * @returns {string[]|null} lines to type, or null if it will not go
 */
export function turnType(rows, turn, opt = {}) {
  const { aspect = 0.6, have = null, weight = null } = opt;
  if (!isTurned(turn) || !rows.length) return rows;

  /*
   * Padding off first, and before anything is measured.
   *
   * A row padded out to the widest glyph is not a wider row, and every step
   * below counts columns: turnFit() would charge the block for padding it
   * could have dropped, squeezeCols() would spend part of the squeeze on
   * blank cells, and turnRows() would lay each padded column down as a line
   * of typing with nothing on it.
   */
  const block = rows.map((r) => r.replace(/\s+$/, ''));
  const wide = Math.max(0, ...block.map((r) => r.length));
  if (!wide || !(aspect > 0)) return rows;

  const fit = turnFit(block, opt);
  if (!fit) return null;

  const scaled = fit.lost ? squeezeCols(block, fit.cols, weight) : block;
  return turnRows(stretchRows(scaled, fit.rows), turn, have);
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
