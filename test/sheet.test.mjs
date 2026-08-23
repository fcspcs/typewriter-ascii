/**
 * Sheet rendering, without a browser.
 *
 * The sheet is the whole interface, so it is worth checking that the open
 * line really shows every keystroke — including the spaces, which are the
 * part people lose count of.
 */
import assert from 'node:assert';
import { runsOf, strikesInLine, colourMap } from '../src/core/runs.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

/**
 * Mirror of the cell-emitting logic in sheet.js openLine().
 * If this drifts from the real thing the test is worthless, so it stays
 * deliberately mechanical: one cell per keystroke, in order.
 */
function cellsOf(line, colours) {
  const cells = [];
  for (const run of runsOf(line, colours)) {
    for (let k = 0; k < run.n; k++) {
      cells.push({ ch: run.ch, red: run.red, space: run.space });
    }
  }
  return cells;
}

console.log('sheet');

check('the open line has exactly one cell per keystroke', () => {
  for (const line of ['   ...x', 'abc', '  a  b  ', '', 'x']) {
    assert.strictEqual(cellsOf(line).length, strikesInLine(line),
      `line ${JSON.stringify(line)}`);
  }
});

check('cells come out in typing order', () => {
  const line = '  ab';
  const got = cellsOf(line).map((c) => c.ch).join('');
  assert.strictEqual(got, '  ab');
});

check('spaces are cells too, not gaps in the sequence', () => {
  const cells = cellsOf('a   b');
  assert.strictEqual(cells.length, 5);
  assert.deepStrictEqual(cells.map((c) => c.space),
    [false, true, true, true, false]);
});

check('colours follow the character they belong to', () => {
  const lines = ['ab'];
  const colours = colourMap(lines, { rows: [0] });
  const cells = cellsOf(lines[0], colours[0]);
  assert.ok(cells.every((c) => c.red), 'whole line should be red');
});

check('a ribbon change splits the run but keeps the cell count', () => {
  const colours = ['black', 'red', 'red'];
  assert.strictEqual(runsOf('aaa', colours).length, 2);
  assert.strictEqual(cellsOf('aaa', colours).length, 3);
});

check('only runs worth counting get a label', () => {
  // Labelling every character is noise; noise is what loses your place.
  const worth = (r) => r.space || r.n >= 3;
  const runs = runsOf('   xxx ab');
  assert.deepStrictEqual(runs.map(worth), [true, true, true, false, false]);
});

check('five-grouping marks land every fifth cell', () => {
  // Note the trailing 'x': a line of nothing but spaces has them all
  // stripped, because trailing spaces are not keystrokes. Only spaces that
  // lead somewhere get typed.
  const run = runsOf('          x')[0];   // ten spaces, then a character
  assert.strictEqual(run.n, 10, `run was ${run.n} long`);
  const marks = [];
  for (let k = 0; k < run.n; k++) if (k && k % 5 === 0) marks.push(k);
  assert.deepStrictEqual(marks, [5]);
});

check('a line of only spaces costs no keystrokes', () => {
  assert.strictEqual(strikesInLine('      '), 0);
  assert.strictEqual(runsOf('      ').length, 0);
});

check('an empty line is still a line you advance past', () => {
  assert.strictEqual(strikesInLine(''), 0);
  assert.strictEqual(cellsOf('').length, 0);
});

console.log('progress through a motif');

check('walking every keystroke visits each line once', () => {
  const lines = ['  ab', 'c', '', 'de  '];
  let at = 0, strike = 0, guard = 0;
  const visited = [];

  while (at < lines.length && guard++ < 500) {
    const total = strikesInLine(lines[at]);
    if (strike >= total) { visited.push(at); at++; strike = 0; continue; }
    strike++;
  }
  assert.deepStrictEqual(visited, [0, 1, 2, 3]);
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
