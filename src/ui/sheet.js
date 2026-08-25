/**
 * sheet.js — the sheet is the interface.
 *
 * One view, not two. The finished motif is always on screen; the line you
 * are on opens up *in place* and shows what to type. Lines behind are inked,
 * lines ahead are pale. Nothing else moves.
 *
 * There is no second copy of the same lines further down the page. A
 * lookup table you never need while typing is a lookup table you read
 * instead of the sheet, and then you are counting in two places at once.
 */

import { runsOf } from '../core/runs.js';

/**
 * Lay numbers along a row of cells, first come first served.
 *
 * Both rulers on the page place their numbers with this — the scale above
 * the sheet and the one under the open line — because two rulers over the
 * same cells that place their numbers by different rules are two rulers
 * that will eventually disagree.
 *
 * A number goes down only where it has a blank column each side, and one
 * already placed is never disturbed. Overwriting looked like it worked
 * until it didn't: a label merely *adjacent* to another is overwritten by
 * nothing, so a ten-mark at 60 and a stop at 64 printed `6064` and read as
 * one number. Order is priority — whatever matters most is offered first,
 * and the convenience gives way to the instruction.
 *
 * @param {number} width
 * @param {Array<[number, string]>} labels [column, text], most important first
 * @returns {string} a row of `width` characters
 */
export function labelRow(width, labels) {
  const row = Array(width).fill(' ');
  const taken = Array(width).fill(false);

  for (const [at, text] of labels) {
    const start = Math.min(Math.max(0, at), Math.max(0, width - text.length));
    let clear = true;
    for (let k = start - 1; k <= start + text.length; k++) {
      if (k >= 0 && k < width && taken[k]) { clear = false; break; }
    }
    if (!clear) continue;
    for (let k = 0; k < text.length && start + k < width; k++) {
      row[start + k] = text[k];
      taken[start + k] = true;
    }
  }
  return row.join('');
}

/**
 * The ten-marks along a row of cells, in the machine's own numbering.
 *
 * @param {number} width
 * @param {number} from carriage column of the first cell
 * @returns {Array<[number, string]>}
 */
export function tenMarks(width, from) {
  const out = [];
  for (let i = 0; i < width; i++) {
    if ((from + i) % 10 === 0) out.push([i, String(from + i)]);
  }
  return out;
}

/**
 * Draw a line as plain motif text, split by ribbon colour.
 */
function plainLine(line, colours) {
  const text = line.replace(/\s+$/, '');
  if (!text) return '&nbsp;';
  let out = '';
  let i = 0;
  while (i < text.length) {
    const red = colours?.[i] === 'red';
    let j = i;
    while (j + 1 < text.length && (colours?.[j + 1] === 'red') === red) j++;
    const chunk = esc(text.slice(i, j + 1)).replace(/ /g, '&nbsp;');
    out += red ? `<i class="r">${chunk}</i>` : chunk;
    i = j + 1;
  }
  return out;
}

/**
 * Draw the open line: the same characters, with what to type written above
 * them and where they are written below.
 *
 * Above the cells: run lengths, for the parts of a line that repeat.
 *
 * Below them: the carriage's own scale, carried down from the top of the
 * sheet to the one line you are on. That half was missing, and what it left
 * behind showed the moment a motif had no repeats in it. Lettering, or a
 * picture written in words, is forty characters no two of which are the
 * same: every run is one cell long, so nothing was labelled, nothing was
 * ruled, and nothing was grouped. Spaces were the only thing on such a line
 * you could count, because spaces were the only thing that ever arrived in
 * runs. Look at the paper, look back, and finding your place meant counting
 * from the start of the line again.
 *
 * So the grouping stops being a property of the run and becomes a property
 * of the line: a rule under every cell, a tick every five columns and a
 * number every ten, whatever the characters happen to be. The columns are
 * the machine's rather than the line's own — the numbers engraved on the
 * carriage, in the same places the scale above the sheet puts them, so the
 * two rulers agree and a column can be read off whichever is nearer.
 *
 * @param {string} line
 * @param {string[]} colours 'black' | 'red' per column
 * @param {number} strike how many keystrokes of this line are done
 * @param {number} from carriage column of the first cell — the margin stop
 */
function openLine(line, colours, strike, from = 1) {
  const runs = runsOf(line, colours);
  if (!runs.length) return '&nbsp;';

  let done = 0;
  const strip = runs.map((run) => {
    const cells = [];
    for (let k = 0; k < run.n; k++) {
      const idx = done + k;
      const col = from + idx;
      const cls = ['c'];
      if (col % 10 === 0) cls.push('ten');
      else if (col % 5 === 0) cls.push('five');
      if (idx < strike) cls.push('past');
      else if (idx === strike) cls.push('hit');
      cells.push(
        `<span class="${cls.join(' ')}">${run.space ? '&nbsp;' : esc(run.ch)}</span>`);
    }
    done += run.n;

    // Only label runs worth counting. Labelling every single character is
    // noise, and noise is what makes people lose their place.
    const worth = run.space || run.n >= 3;
    const label = worth
      ? `<span class="n">${run.space ? run.n : `${run.n}&times;${esc(run.ch)}`}</span>`
      : '';
    const kind = worth ? (run.space ? ' gap' : ' rep') : '';
    const red = run.red ? ' r' : '';
    return `<span class="run${kind}${red}">${label}${cells.join('')}</span>`;
  }).join('');

  /*
   * The numbers under the rule, in the sheet's own grid, so a number sits
   * under the cell it names rather than near it — and at the sheet's own
   * size for the same reason the scale is: set even slightly smaller they
   * have a narrower column, and by the twentieth they have drifted off the
   * cell they belong to. They recede by ink instead.
   */
  const foot = esc(labelRow(done, tenMarks(done, from)));
  return `${strip}<span class="foot">${foot}</span>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {HTMLElement} host
 * @param {string[]} lines
 * @param {string[][]} colours
 */
export function renderSheet(host, lines, colours) {
  host.innerHTML = lines
    .map((_, i) => `<span class="ln" data-i="${i}"></span>`)
    .join('');
  return [...host.querySelectorAll('.ln')];
}

/**
 * Update which line is open and how far into it we are.
 * Only the two lines that changed are redrawn — redrawing the whole sheet
 * on every keystroke makes long motifs stutter.
 */
export function paintSheet(els, lines, colours, at, strike, previous = -1,
                           from = 1) {
  const touch = new Set([at, previous].filter((i) => i >= 0 && i < els.length));

  // classes on every line are cheap; innerHTML is not
  els.forEach((el, i) => {
    el.classList.toggle('done', i < at);
    el.classList.toggle('now', i === at);
  });

  for (const i of touch) {
    els[i].innerHTML = i === at
      ? openLine(lines[i], colours?.[i], strike, from)
      : plainLine(lines[i], colours?.[i]);
  }
  // first paint: fill everything that is still empty
  els.forEach((el, i) => {
    if (!el.innerHTML) {
      el.innerHTML = i === at
        ? openLine(lines[i], colours?.[i], strike, from)
        : plainLine(lines[i], colours?.[i]);
    }
  });
}

/** Redraw only the open line — used while listening. */
export function paintStrike(els, lines, colours, at, strike, from = 1) {
  if (at < 0 || at >= els.length) return;
  els[at].innerHTML = openLine(lines[at], colours?.[at], strike, from);
}

/**
 * Keep the open line in view without fighting the user.
 *
 * Scrolls only when the line is actually out of sight, and accounts for the
 * sticky header — centring in the whole window puts the line behind it.
 */
export function keepInView(el, headerPx = 0) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const top = headerPx + 12;
  const bottom = window.innerHeight - 12;
  if (r.top >= top && r.bottom <= bottom) return;

  const free = window.innerHeight - headerPx;
  const to = window.scrollY + r.top - headerPx - free / 2 + r.height / 2;
  window.scrollTo({ top: Math.max(0, to), behavior: 'smooth' });
}
