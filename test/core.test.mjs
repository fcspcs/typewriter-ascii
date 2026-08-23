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
  pitchFrom, expectedMm, PITCHES, LINE_PITCHES,
} from '../src/core/machine.js';
import { PROFILES, profileById } from '../src/profiles/index.js';
import {
  runsOf, runsToText, strikesInLine, colourMap, inkTally, parseRows,
  columnOfStrike,
} from '../src/core/runs.js';
import { letter, STYLES } from '../src/core/lettering.js';
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

console.log('measuring');

check('a perfect pica measurement reads as pica', () => {
  // 40 characters typed is 39 steps of carriage travel.
  const r = pitchFrom(39, 39 * 2.54);
  assert.strictEqual(r.nearest.perInch, 10);
  assert.ok(r.confident);
  assert.ok(Math.abs(r.perInch - 10) < 1e-9, `got ${r.perInch}`);
});

check('a perfect elite measurement reads as elite', () => {
  const r = pitchFrom(39, 39 * 25.4 / 12);
  assert.strictEqual(r.nearest.perInch, 12);
  assert.ok(r.confident);
});

check('the two pitches are far apart at forty characters', () => {
  // The whole point of forty rather than ten: the two readings have to be
  // impossible to confuse with a ruler.
  const gap = Math.abs(expectedMm(39, 10) - expectedMm(39, 12));
  assert.ok(gap > 15, `only ${gap.toFixed(1)} mm apart`);
});

check('a millimetre of ruler slip does not change the answer', () => {
  for (const p of PITCHES) {
    for (const slip of [-1, -0.5, 0.5, 1]) {
      const r = pitchFrom(39, expectedMm(39, p.perInch) + slip);
      assert.strictEqual(r.nearest.perInch, p.perInch,
        `${p.name} ${slip} mm out became ${r.nearest.name}`);
      assert.ok(r.confident, `${p.name} ${slip} mm out lost confidence`);
    }
  }
});

check('measuring the ink block instead of edge to edge is caught', () => {
  // The classic mistake: measuring the printed block is short by roughly a
  // whole character, which must not silently pass as a valid pitch.
  const r = pitchFrom(39, expectedMm(40, 10));
  assert.ok(!r.confident, 'an off-by-one measurement was accepted');
});

check('a reading between the two pitches is refused, not rounded', () => {
  const middle = (expectedMm(39, 10) + expectedMm(39, 12)) / 2;
  const r = pitchFrom(39, middle);
  assert.ok(!r.confident);
  assert.ok(r.offPercent > 5, `only ${r.offPercent} per cent off`);
});

check('nonsense input gives nothing back rather than a wrong pitch', () => {
  for (const [steps, mm] of [[0, 99], [39, 0], [-1, 99], [39, -5], [NaN, 99]]) {
    assert.strictEqual(pitchFrom(steps, mm), null, `${steps} / ${mm}`);
  }
});

check('line spacing measures the same way', () => {
  const r = pitchFrom(39, expectedMm(39, 6), LINE_PITCHES);
  assert.strictEqual(r.nearest.perInch, 6);
  assert.ok(r.confident);
});

check('a measured pitch drives the sheet size', () => {
  // What the measurement is actually for: the same paper holds a fifth more
  // characters on an elite machine.
  const elite = { ...sm7, cpi: 12 };
  const a4 = paperById('a4');
  assert.strictEqual(sheetGrid(a4, sm7).cols, 82);
  assert.strictEqual(sheetGrid(a4, elite).cols, 99);
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

check('a word renders to a block of lines', () => {
  const l = letter('AB', { style: 'block' });
  assert.strictEqual(l.length, 5);
  const w = Math.max(...l.map((x) => x.length));
  assert.ok(l.every((x) => x.length <= w), 'a line overran the block');
});

check('lettering uses only the fill characters it was given', () => {
  const l = letter('HI', { style: 'block', fill: 'X' });
  const used = new Set(l.join('').replace(/ /g, ''));
  assert.deepStrictEqual([...used], ['X']);
});

check('the shadow style uses both characters', () => {
  const l = letter('A', { style: 'shadow', fill: '#', light: '+' });
  const used = new Set(l.join('').replace(/ /g, ''));
  assert.ok(used.has('#') && used.has('+'), [...used].join(''));
});

check('every hollow style really is hollow', () => {
  // Compare ink DENSITY, not raw strokes: hollow faces are drawn larger, so
  // counting strokes would compare two different things and pass for the
  // wrong reason. This has caught the same mistake twice - at 2x scale the
  // hollowing silently does nothing.
  const density = (style) => {
    const l = letter('OO', { style });
    const cells = l.length * Math.max(...l.map((x) => x.length));
    return keystrokes(l) / cells;
  };
  const pairs = [['block', 'hollow'], ['big', 'hollowBig']];
  for (const [solid, thin] of pairs) {
    const a = density(solid);
    const b = density(thin);
    assert.ok(b < a * 0.85,
      `${thin} ${b.toFixed(2)} is not lighter than ${solid} ${a.toFixed(2)}`);
  }
});



check('unknown characters become blanks, not crashes', () => {
  const l = letter('A\u4f60B', { style: 'block' });
  assert.strictEqual(l.length, 5);
});


check('every lettering style is different from every other', () => {
  // Two styles that render identically means a transform silently did
  // nothing - which is how 'hollow, big' shipped as a copy of 'big'.
  const seen = new Map();
  for (const key of Object.keys(STYLES)) {
    const art = letter('ABCO', { style: key }).join('|');
    assert.ok(!seen.has(art), `${key} renders the same as ${seen.get(art)}`);
    seen.set(art, key);
  }
});

check('every style renders every letter and digit', () => {
  for (const key of Object.keys(STYLES)) {
    const art = letter('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', { style: key });
    assert.ok(art.length > 0, `${key} produced nothing`);
    assert.ok(art.some((l) => l.trim()), `${key} produced only blanks`);
  }
});

check('only styles that declare a second ink use one', () => {
  for (const key of Object.keys(STYLES)) {
    const art = letter('ABO', { style: key, fill: '#', light: '+' }).join('');
    const usesLight = art.includes('+');
    assert.strictEqual(usesLight, Boolean(STYLES[key].two),
      `${key}: uses light ink = ${usesLight}, declared = ${!!STYLES[key].two}`);
  }
});

check('styles have no blank rows top or bottom', () => {
  for (const key of Object.keys(STYLES)) {
    const art = letter('AB', { style: key });
    assert.ok(art[0].trim(), `${key} starts with a blank row`);
    assert.ok(art[art.length - 1].trim(), `${key} ends with a blank row`);
  }
});


check('every lettering style is typeable on the SM7', () => {
  // The whole point. The classic isometric and relief FIGlet faces all
  // need a backslash, and the Olympia SM7 has no backslash key - nor a
  // pipe, nor a tilde. A style that cannot be typed is not a style.
  const have = new Set(charset(sm7));
  for (const key of Object.keys(STYLES)) {
    const art = letter('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      { style: key, fill: '#', light: '+' });
    const used = new Set(art.join('').replace(/ /g, ''));
    for (const ch of used) {
      if (ch === '#' || ch === '+') continue;      // the two ink slots
      assert.ok(have.has(ch),
        `${key} needs ${JSON.stringify(ch)}, which the SM7 lacks`);
    }
  }
});

check('drawn faces declare the characters they use', () => {
  for (const [key, spec] of Object.entries(STYLES)) {
    if (!spec.uses) continue;
    const art = letter('ABO', { style: key, fill: '#', light: '+' });
    const used = new Set(art.join('').replace(/ /g, ''));
    for (const ch of spec.uses) {
      assert.ok(used.has(ch), `${key} declares ${ch} but never emits it`);
    }
  }
});

check('the three dimensional face keeps its counters open', () => {
  // Casting depth from every up-facing edge fills the inside of an O with
  // diagonals and the letter stops reading. Only the outer silhouette may
  // cast. An O must still have a hole in it.
  const art = letter('O', { style: 'oblique' });
  const middle = art[Math.floor(art.length / 2)];
  assert.ok(/\s{3,}/.test(middle),
    `the counter filled in: ${JSON.stringify(middle)}`);
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
