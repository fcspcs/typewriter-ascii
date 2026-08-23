/**
 * sheet.js — the sheet is the interface.
 *
 * One view, not two. The finished motif is always on screen; the line you
 * are on opens up *in place* and shows what to type. Lines behind are inked,
 * lines ahead are pale. Nothing else moves.
 *
 * The full table lives further down the page for looking things up, but you
 * should never need it while typing.
 */

import { runsOf } from '../core/runs.js';

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
 * Draw the open line: the same characters, but with run lengths above them
 * and a rule under each run so the eye can group them.
 *
 * @param {number} strike  how many keystrokes of this line are done
 */
function openLine(line, colours, strike) {
  const runs = runsOf(line, colours);
  if (!runs.length) return '&nbsp;';

  let done = 0;
  return runs.map((run) => {
    const cells = [];
    for (let k = 0; k < run.n; k++) {
      const idx = done + k;
      const cls = ['c'];
      if (run.n >= 3 && k && k % 5 === 0) cls.push('five');
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
export function paintSheet(els, lines, colours, at, strike, previous = -1) {
  const touch = new Set([at, previous].filter((i) => i >= 0 && i < els.length));

  // classes on every line are cheap; innerHTML is not
  els.forEach((el, i) => {
    el.classList.toggle('done', i < at);
    el.classList.toggle('now', i === at);
  });

  for (const i of touch) {
    els[i].innerHTML = i === at
      ? openLine(lines[i], colours?.[i], strike)
      : plainLine(lines[i], colours?.[i]);
  }
  // first paint: fill everything that is still empty
  els.forEach((el, i) => {
    if (!el.innerHTML) {
      el.innerHTML = i === at
        ? openLine(lines[i], colours?.[i], strike)
        : plainLine(lines[i], colours?.[i]);
    }
  });
}

/** Redraw only the open line — used while listening. */
export function paintStrike(els, lines, colours, at, strike) {
  if (at < 0 || at >= els.length) return;
  els[at].innerHTML = openLine(lines[at], colours?.[at], strike);
}

/**
 * The reference table. Same information, all lines at once.
 */
export function renderTable(host, lines, colours, startLine = 0) {
  host.innerHTML = lines.map((line, i) => {
    const runs = runsOf(line, colours?.[i]);
    const text = runs.length
      ? runs.map((r) => {
          // Spaces get a tinted marker, not an underscore: an underscore is
          // also a character you can type, so using it for "space" is one
          // more thing to misread.
          if (r.space) return `<span class="sp">${'\u00b7'.repeat(r.n)}</span>`;
          const t = r.n > 1 ? `${r.n}${esc(r.ch)}` : esc(r.ch);
          return r.red ? `<span class="red">${t}</span>` : t;
        }).join('  ')
      : '<span style="opacity:.4">empty</span>';
    return `<tr data-i="${i}"><td class="n">${i + 1 + startLine}</td>` +
           `<td class="rn">${text}</td></tr>`;
  }).join('');
  return [...host.querySelectorAll('tr')];
}

export function paintTable(rows, at) {
  rows.forEach((tr, i) => {
    tr.classList.toggle('done', i < at);
    tr.classList.toggle('now', i === at);
  });
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
