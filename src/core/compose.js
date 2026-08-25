/**
 * compose.js — one motif across several sheets of paper.
 *
 * A typewriter's resolution is fixed. A cell is 2.54 by 4.23 mm at pica and
 * nothing makes it smaller, so the only way to a bigger, more detailed
 * picture is a bigger piece of paper — and the largest piece of paper a
 * portable machine will take is the one it will take. Past that, you use
 * more than one and lay them side by side.
 *
 * The whole design follows from one rule:
 *
 *   **No cell ever straddles a join.**
 *
 * It sounds obvious and it decides everything. A4 at pica holds 82 columns,
 * which is 208.28 mm of the sheet's 210. Two sheets butted together are 420
 * mm, and 420 mm holds 165 columns — one more than the 164 the two sheets
 * hold separately. That extra column is real arithmetic and it is useless:
 * it lands across the join, half on one sheet and half on the other, and
 * there is no way to strike it. So the composite grid is the single sheet's
 * grid multiplied, never the composite's millimetres divided.
 *
 * What follows from that:
 *
 *   - every cell has exactly one sheet it belongs to, so every keystroke has
 *     somewhere to be typed
 *   - the leftover millimetres pile up at the joins rather than vanishing:
 *     1.72 mm at each vertical join on A4 at pica, 0.67 mm at each
 *     horizontal one. See seams(). Overlap the sheets by that much when you
 *     lay them out and the picture closes up
 *   - a motif row wider than one sheet cannot be typed as one line. It is
 *     two lines on two sheets, typed on separate visits to the machine,
 *     which is why splitMotif() exists and why the typing panel works on one
 *     sheet at a time
 *
 * The margins belong to the composite, not to each sheet. A margin down the
 * inside of a join would be a white stripe through the middle of the
 * picture, which is the one thing nobody laying two sheets side by side
 * wants.
 */

import { cellWidthMm, cellHeightMm, sheetGrid, textArea, setUp, placeOn }
  from './machine.js';

/** How many sheets across and down the picker offers. */
export const MAX_ACROSS = 4;
export const MAX_DOWN = 4;

/**
 * Several sheets, described as one piece of paper.
 *
 * The single sheet is kept under `unit`, because everything the machine does
 * is done to one sheet at a time: the platen is a sheet wide, the margin
 * stops are set for a sheet, and the paper guide positions a sheet. Only the
 * motif knows about the composite.
 */
export function tiled(paper, across = 1, down = 1) {
  const a = Math.max(1, Math.min(MAX_ACROSS, Math.round(across) || 1));
  const d = Math.max(1, Math.min(MAX_DOWN, Math.round(down) || 1));
  if (a === 1 && d === 1) {
    // Back to one sheet. Spreading `unit` over the paper rather than
    // returning it keeps everything the tiling never touched — the margin
    // above all, which lives on the paper and not on the unit.
    if (!paper.unit) return paper;
    const { unit, across: _a, down: _d, ...rest } = paper;
    return { ...rest, ...unit };
  }
  const unit = paper.unit ?? paper;
  return {
    ...unit,
    id: `${unit.id}-${a}x${d}`,
    name: `${a} × ${d} ${unit.name}`,
    unit: { id: unit.id, name: unit.name, w: unit.w, h: unit.h },
    across: a,
    down: d,
    w: unit.w * a,
    h: unit.h * d,
  };
}

export const tilesOf = (paper) =>
  ({ across: paper?.across ?? 1, down: paper?.down ?? 1 });

export const isComposite = (paper) => {
  const { across, down } = tilesOf(paper);
  return across > 1 || down > 1;
};

/** The single sheet a composite is made of — or the paper itself. */
export const unitOf = (paper) => paper?.unit
  ? { ...paper, ...paper.unit, unit: undefined, across: 1, down: 1 }
  : paper;

/** How many sheets in all. */
export const sheetCount = (paper) => {
  const { across, down } = tilesOf(paper);
  return across * down;
};

/** The cell grid of one physical sheet. */
export function unitGrid(paper, m) {
  const unit = paper?.unit ?? paper;
  return {
    cols: Math.floor(unit.w / cellWidthMm(m)),
    rows: Math.floor(unit.h / cellHeightMm(m)),
  };
}

/**
 * The paper that has nowhere to go, per join, in millimetres.
 *
 * This is the number somebody laying the sheets out needs and cannot work
 * out from anything on the page. A4 at pica: 82 columns is 208.28 mm of a
 * 210 mm sheet, so 1.72 mm of each sheet's right-hand edge carries nothing.
 * Butt the sheets and that 1.72 mm is a white stripe down the join; overlap
 * them by it and the picture is continuous.
 *
 * Vertically it is smaller — 70 rows is 296.33 mm of 297, so 0.67 mm — which
 * is worth knowing for the opposite reason: it is small enough to ignore,
 * and the real problem with a horizontal join is elsewhere. See
 * layoutAdvice().
 */
export function seams(paper, m) {
  const unit = paper?.unit ?? paper;
  const g = unitGrid(paper, m);
  return {
    across: unit.w - g.cols * cellWidthMm(m),
    down: unit.h - g.rows * cellHeightMm(m),
  };
}

/**
 * Where each sheet sits, what lands on it, and how to set the machine up.
 *
 * The placement is decided once, on the composite, and then handed to each
 * sheet — which is the opposite of letting each sheet centre its own slice.
 * A sheet that centred its own piece would produce a picture that jumps at
 * every join, and the joins are exactly where the eye goes.
 *
 * Sheets the motif never reaches come back with `blank: true` rather than
 * being dropped. Somebody laying out four sheets needs to know that the
 * fourth is blank paper, not that there are only three.
 *
 * @param {Object} a
 * @param {string[]} a.lines
 * @param {string[][]} [a.colours]
 * @param {Object} a.paper     a composite from tiled(), or any paper
 * @param {Object} a.machine
 * @param {'centre'|'topleft'} [a.align]
 */
export function splitMotif({ lines, colours, paper, machine, align = 'centre' }) {
  const { across, down } = tilesOf(paper);
  const unit = unitOf(paper);
  const g = unitGrid(paper, machine);
  const w = Math.max(0, ...lines.map((l) => l.length));
  const h = lines.length;
  const origin = placeOn(w, h, paper, machine, align);

  const sheets = [];
  for (let r = 0; r < down; r++) {
    for (let c = 0; c < across; c++) {
      const c0 = c * g.cols;
      const r0 = r * g.rows;
      // Where the motif and this sheet overlap, in composite cells.
      const fromCol = Math.max(c0, origin.col);
      const fromRow = Math.max(r0, origin.row);
      const toCol = Math.min(c0 + g.cols, origin.col + w);
      const toRow = Math.min(r0 + g.rows, origin.row + h);

      const where = {
        index: sheets.length,
        col: c,
        row: r,
        of: across * down,
        name: across * down > 1
          ? `${unit.name} ${sheets.length + 1} of ${across * down}` +
            ` — ${ordinal(c + 1)} across, ${ordinal(r + 1)} down`
          : unit.name,
      };

      if (toCol <= fromCol || toRow <= fromRow) {
        sheets.push({
          ...where, blank: true, lines: [], colours: [],
          setup: null, at: { col: 0, row: 0 },
        });
        continue;
      }

      // Sliced with the leading blanks kept: a space inside the motif is a
      // keystroke like any other, and dropping it here would move the margin
      // stop and shift everything after it by a column.
      const cut = [];
      const cutInk = [];
      for (let y = fromRow; y < toRow; y++) {
        const line = lines[y - origin.row] ?? '';
        const ink = colours?.[y - origin.row] ?? [];
        const a = fromCol - origin.col;
        const b = toCol - origin.col;
        cut.push(line.slice(a, b).replace(/\s+$/, ''));
        cutInk.push(ink.slice(a, b));
      }

      const at = { col: fromCol - c0, row: fromRow - r0 };
      const blank = cut.every((l) => !l.trim());
      sheets.push({
        ...where,
        blank,
        at,
        lines: cut,
        colours: cutInk,
        setup: setUp(toCol - fromCol, toRow - fromRow, unit, machine, align, at),
      });
    }
  }

  const size = sheetGrid(paper, machine);
  const room = textArea(paper, machine);
  const warnings = fitWarnings(w, h, paper, size, room);

  /*
   * Centred on a composite means centred on the *paper*, and the centre of
   * a two-by-two is the point where all four sheets meet. So a small motif
   * asked for in the middle lands squarely on the crossing — which is
   * arithmetically right and almost never what anybody wanted.
   *
   * Not corrected, because "centred" has one meaning and quietly giving it
   * another is worse than saying so. Said out loud instead, with the two
   * things that fix it.
   */
  const used = sheets.filter((sh) => !sh.blank).length;

  /*
   * Paper you asked for and the motif never reaches.
   *
   * Easiest to walk into with a turn in play, where the axes are crossed:
   * three sheets *across* give a turned picture three sheets of height and
   * no extra width at all, because a turned sheet's width is counted down
   * the paper. The cell counts in the hint say so, but only if you already
   * knew to read them that way — so this says it outright.
   */
  if (used && used < sheets.length) {
    const spare = sheets.length - used;
    warnings.push({
      level: 'note',
      text: `${spare} of the ${sheets.length} sheets stay blank — the motif ` +
        `does not reach them. Fewer sheets, or a wider motif, would use the ` +
        `paper you have asked for.`,
    });
  }

  if (used > 1 && w <= g.cols && h <= g.rows) {
    warnings.push({
      level: 'note',
      text: `This motif would fit on one sheet, but centring it on ` +
        `${across * down} puts it across ${used === 2 ? 'a join' : 'the joins'} ` +
        `— it is cut over ${used} sheets. Position it top left, or use fewer ` +
        `sheets, if that is not what you meant.`,
    });
  }

  return {
    across, down, origin, unit, grid: g,
    size,
    room,
    seams: seams(paper, machine),
    warnings,
    sheets,
  };
}

/**
 * Does the picture fit the paper — all of it, taken together.
 *
 * This is the question setUp() used to answer, and on a composite it cannot:
 * setUp() speaks for one sheet in one machine, so it would compare a
 * hundred-column picture against an eighty-two-column carriage and refuse
 * something that is perfectly typeable in two visits. What the carriage
 * reaches is a question for each sheet, and each sheet still asks it.
 *
 * So the two are separated. This is about paper. setUp() is about machinery.
 */
function fitWarnings(w, h, paper, size, room) {
  const out = [];
  if (!w || !h) return out;

  const tooWide = w > size.cols;
  const tooTall = h > size.rows;
  if (tooWide || tooTall) {
    const bits = [];
    if (tooWide) bits.push(`${w} columns wide, the paper holds ${size.cols}`);
    if (tooTall) bits.push(`${h} lines tall, the paper holds ${size.rows}`);
    const more = isComposite(paper)
      ? `Use a smaller style, a shorter word, or more sheets.`
      : `Use a smaller style, a shorter word, a larger sheet — or compose ` +
        `it across several.`;
    out.push({
      level: 'stop',
      text: `This will not fit on ${paper.name}: ${bits.join('; ')}. ${more}`,
    });
    return out;
  }

  if (w > room.cols) {
    out.push({
      level: 'note',
      text: `Wider than the usual margins — ${w} columns against ` +
        `${room.cols}. It fits on the paper; the margins just move in less.`,
    });
  }
  if (h > room.rows) {
    out.push({
      level: 'note',
      text: `Taller than the usual margins — ${h} lines against ` +
        `${room.rows}. It fits on the paper, with less room top and bottom.`,
    });
  }
  return out;
}

const ORDINALS = ['first', 'second', 'third', 'fourth'];
const ordinal = (n) => ORDINALS[n - 1] ?? `${n}th`;

/**
 * What to tell somebody who is about to lay the sheets out.
 *
 * Two things they cannot get from the picture, and the second is the one
 * that decides how to arrange the sheets in the first place.
 *
 * A vertical join — sheets side by side — is the easy one. The carriage
 * reaches both edges of a sheet, so a column of the picture can be struck
 * anywhere across it, and the join costs a millimetre and a half of overlap.
 *
 * A horizontal join — sheets one above the other — is not. The feed rollers
 * have to grip the paper for the platen to turn it, and near the bottom of a
 * sheet they let go; how near depends on the machine and this app has not
 * measured it on any of them. So the last lines of a sheet may simply not be
 * typeable, and a row of sheets side by side is the safer shape. Said as a
 * note rather than modelled as a limit, because a number nobody measured is
 * worse than no number.
 */
export function layoutAdvice(paper, m) {
  const { across, down } = tilesOf(paper);
  if (across === 1 && down === 1) return [];
  const gap = seams(paper, m);
  const out = [];

  out.push([
    `Lay the sheets ${across} across by ${down} down`,
    `Numbered left to right, then top to bottom — the order they are typed ` +
    `in. Each sheet goes into the machine on its own, upright, set up for ` +
    `its own piece of the picture.`,
  ]);

  if (across > 1) {
    out.push([
      `Overlap ${gap.across.toFixed(1)} mm at each side join`,
      `${unitOf(paper).name} at ${m.cpi} characters per inch holds ` +
      `${unitGrid(paper, m).cols} columns, which is ` +
      `${(unitGrid(paper, m).cols * cellWidthMm(m)).toFixed(1)} mm of a ` +
      `${unitOf(paper).w} mm sheet. Butt the sheets and that leftover strip ` +
      `is a white line down the join; slide them over it and the picture ` +
      `closes up.`,
    ]);
  }

  if (down > 1) {
    out.push([
      `Check the bottom lines before you commit`,
      `The feed rollers let go near the bottom of a sheet, so the last lines ` +
      `of each row may not be typeable at all — how many depends on the ` +
      `machine, and this has not been measured on yours. Type the bottom ` +
      `line of one sheet on scrap first. Sheets side by side avoid the ` +
      `question entirely.`,
    ]);
  }

  return out;
}
