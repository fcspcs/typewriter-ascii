/**
 * Tests for the parts that do not need a browser.
 *
 * Glyph measuring needs a canvas, so it is not covered here — everything
 * else is plain arithmetic and can be checked properly.
 */
import assert from 'node:assert';
import {
  charset, makeTypeable, untypeable, PAPERS, paperById,
  textArea, sheetGrid, setUp, cellWidthMm, cellHeightMm,
} from '../src/core/machine.js';
import { PROFILES, profileById } from '../src/profiles/index.js';
import {
  runsOf, runsToText, strikesInLine, colourMap, inkTally, parseRows,
  columnOfStrike,
} from '../src/core/runs.js';
import { letter } from '../src/core/lettering.js';
import { fitGrid, sentenceReads, keystrokes } from '../src/core/convert.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

const sm7 = profileById('olympia-sm7');

console.log('machine');

check('every profile has the fields the app relies on', () => {
  for (const p of PROFILES) {
    for (const k of ['id', 'name', 'cpi', 'lpi', 'rows', 'shiftRows', 'scale']) {
      assert.ok(p[k] != null, `${p.id} is missing ${k}`);
    }
    assert.ok(p.scale.leftMin <= p.scale.rightMax, `${p.id} scale reversed`);
    assert.strictEqual(p.rows.length, p.shiftRows.length,
      `${p.id} row counts differ`);
  }
});

check('profile ids are unique', () => {
  const ids = PROFILES.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check('pica cell is 2.54 mm by 4.23 mm', () => {
  assert.ok(Math.abs(cellWidthMm(sm7) - 2.54) < 0.01);
  assert.ok(Math.abs(cellHeightMm(sm7) - 4.233) < 0.01);
});

check('charset has no duplicates and no space', () => {
  const cs = charset(sm7);
  assert.strictEqual(new Set(cs).size, cs.length, 'duplicates present');
  assert.ok(!cs.includes(' '), 'space should not be a character');
});

check('the SM7 has no zero key', () => {
  assert.ok(!charset(sm7).includes('0'));
});

check('zero is substituted with a capital O', () => {
  const { text, dropped } = makeTypeable('2026', sm7);
  assert.strictEqual(text, '2O26');
  assert.strictEqual(dropped.size, 0);
});

check('typographic quotes and dashes are folded down', () => {
  const { text } = makeTypeable('\u201chello\u201d \u2014 there', sm7);
  assert.ok(!/[\u201c\u201d\u2014]/.test(text), text);
  assert.ok(text.includes('"'), text);
});

check('untypeable reports only genuinely impossible characters', () => {
  assert.deepStrictEqual(untypeable('abc', sm7), []);
  const bad = untypeable('\u4f60\u597d', sm7);
  assert.strictEqual(bad.length, 2);
});

check('newlines and spaces survive conversion', () => {
  const { text } = makeTypeable('a b\nc', sm7);
  assert.strictEqual(text, 'a b\nc');
});

console.log('paper');

check('A4 at pica is 82 columns by 70 lines', () => {
  const g = sheetGrid(paperById('a4'), sm7);
  assert.strictEqual(g.cols, 82, `got ${g.cols}`);
  assert.strictEqual(g.rows, 70, `got ${g.rows}`);
});

check('the text area is smaller than the sheet', () => {
  for (const p of PAPERS) {
    const s = sheetGrid(p, sm7);
    const a = textArea(p, sm7);
    assert.ok(a.cols < s.cols && a.rows < s.rows, p.id);
    assert.ok(a.cols > 0 && a.rows > 0, `${p.id} has no usable area`);
  }
});

console.log('setting up');

check('a centred motif sits centred', () => {
  const s = setUp(40, 20, paperById('a4'), sm7, 'centre');
  const g = sheetGrid(paperById('a4'), sm7);
  const leftGap = s.left - (s.paperGuide ?? 0);
  const rightGap = g.cols - 40 - leftGap;
  assert.ok(Math.abs(leftGap - rightGap) <= 1,
    `left ${leftGap} right ${rightGap}`);
});

check('a narrow motif needs the paper guide, not a lower stop', () => {
  // Centred, a 20-wide motif starts at column 31 — fine.
  const s = setUp(20, 10, paperById('a4'), sm7, 'centre');
  assert.ok(s.left >= sm7.scale.leftMin, `left stop at ${s.left}`);
});

check('the left stop never goes below what the machine allows', () => {
  for (const w of [10, 30, 60, 82]) {
    const s = setUp(w, 10, paperById('a4'), sm7, 'centre');
    assert.ok(s.left >= sm7.scale.leftMin,
      `width ${w} put the stop at ${s.left}`);
  }
});

check('an over-wide motif warns instead of failing silently', () => {
  const s = setUp(200, 10, paperById('a4'), sm7, 'centre');
  assert.ok(s.warnings.length > 0);
});

check('top-left placement respects the margin', () => {
  const s = setUp(20, 10, paperById('a4'), sm7, 'topleft');
  assert.ok(s.advance > 0, 'should still wind on past the top margin');
});

console.log('runs');

check('a run of spaces is one run with the right count', () => {
  const r = runsOf('   ab');
  assert.strictEqual(r.length, 3);
  assert.deepStrictEqual(
    r.map((x) => [x.ch, x.n]), [[' ', 3], ['a', 1], ['b', 1]]);
});

check('trailing spaces are dropped, leading ones kept', () => {
  // Leading spaces are keystrokes. Trailing ones are not.
  const r = runsOf('  a  ');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].n, 2);
});

check('a colour change breaks a run', () => {
  const colours = ['black', 'red', 'red'];
  const r = runsOf('aaa', colours);
  assert.strictEqual(r.length, 2, 'should split at the ribbon change');
  assert.strictEqual(r[0].red, false);
  assert.strictEqual(r[1].red, true);
});

check('run indices point at the right column', () => {
  const r = runsOf('   xx  y');
  assert.deepStrictEqual(r.map((x) => x.col), [0, 3, 5, 7]);
});

check('strike count includes spaces but not trailing ones', () => {
  assert.strictEqual(strikesInLine('  ab  '), 4);
  assert.strictEqual(strikesInLine(''), 0);
});

check('the text form is readable', () => {
  assert.strictEqual(runsToText('   ...x'), '3_ 3. x');
});

check('columnOfStrike stays inside the line', () => {
  assert.strictEqual(columnOfStrike('abc', 99), 3);
  assert.strictEqual(columnOfStrike('abc', -5), 0);
});

console.log('colour');

check('only inked cells can be red', () => {
  const lines = ['a b'];
  const c = colourMap(lines, { rows: [0] });
  assert.strictEqual(c[0][0], 'red');
  assert.strictEqual(c[0][1], 'black', 'a space must never be red');
  assert.strictEqual(c[0][2], 'red');
});

check('the tally adds up to the keystroke count', () => {
  const lines = ['ab', ' c'];
  const c = colourMap(lines, { rows: [0] });
  const t = inkTally(lines, c);
  assert.strictEqual(t.total, 3);
  assert.strictEqual(t.red, 2);
  assert.strictEqual(t.black, 1);
  assert.strictEqual(t.total, keystrokes(lines));
});

check('row ranges parse the way people write them', () => {
  assert.deepStrictEqual([...parseRows('0-3')], [0, 1, 2, 3]);
  assert.deepStrictEqual([...parseRows('1,4')], [1, 4]);
  assert.deepStrictEqual([...parseRows('0-2,5')], [0, 1, 2, 5]);
  assert.deepStrictEqual([...parseRows('')], []);
  assert.deepStrictEqual([...parseRows('nonsense')], []);
});

check('row ranges are clipped to the motif', () => {
  assert.deepStrictEqual([...parseRows('0-99', 3)], [0, 1, 2]);
});

console.log('lettering');

check('a word renders to a block of equal-length lines', () => {
  const l = letter('AB');
  assert.strictEqual(l.length, 5);
  assert.ok(l.every((x) => x.length <= l[0].length + 2));
});

check('lettering uses only the fill characters it was given', () => {
  const l = letter('HI', { fill: 'X' });
  const used = new Set(l.join('').replace(/ /g, ''));
  assert.deepStrictEqual([...used], ['X']);
});

check('the shadow style uses both characters', () => {
  const l = letter('A', { style: 'shadow', fill: '#', light: '+' });
  const used = new Set(l.join('').replace(/ /g, ''));
  assert.ok(used.has('#') && used.has('+'), [...used].join(''));
});

check('the outline style is genuinely lighter than the solid one', () => {
  // Compare ink DENSITY, not raw keystrokes: the outline face is drawn at a
  // larger size, so counting strikes alone would compare two different
  // things and pass for the wrong reason.
  const density = (style) => {
    const l = letter('OO', { style });
    const cells = l.length * Math.max(...l.map((x) => x.length));
    return keystrokes(l) / cells;
  };
  const solid = density('block');
  const thin = density('outline');
  assert.ok(thin < solid * 0.85, `outline ${thin.toFixed(2)} vs block ${solid.toFixed(2)}`);
});

check('unknown characters become blanks, not crashes', () => {
  const l = letter('A\u4f60B');
  assert.strictEqual(l.length, 5);
});

console.log('grid fitting');

check('a wide picture is limited by width', () => {
  const g = fitGrid(60, 60, 400, 100, 0.6);
  assert.strictEqual(g.cols, 60);
  assert.ok(g.rows < 60);
});

check('a tall picture is limited by height', () => {
  const g = fitGrid(60, 20, 100, 400, 0.6);
  assert.strictEqual(g.rows, 20);
  assert.ok(g.cols < 60);
});

check('the aspect ratio survives the trip', () => {
  // A square picture on a 0.6 cell should come out taller than it is wide.
  const g = fitGrid(40, 200, 100, 100, 0.6);
  assert.ok(g.rows < g.cols, `${g.cols} x ${g.rows}`);
});

console.log('sentence mode');

check('a sentence still reads across line breaks', () => {
  const phrase = 'she loved him';
  const lines = ['shel', 'oved', 'him'];
  assert.ok(sentenceReads(lines, phrase));
});

check('a scrambled sentence is caught', () => {
  assert.ok(!sentenceReads(['xyz'], 'she loved him'));
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
