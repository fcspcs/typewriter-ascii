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
  columnOfStrike, inkPlan, INK_SCHEMES,
} from '../src/core/runs.js';
import {
  letter, STYLES, charsUsed, tonesOf, usesTwo,
} from '../src/core/lettering.js';
import { toneRamp, inkLadder, inkWeights } from '../src/core/ink.js';
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

check('measuring the ink block is still accepted, but flagged', () => {
  // The classic mistake: measuring the whole block of ink is long by about
  // one character. It never changes which pitch you land on, so refusing the
  // measurement over it would be pedantry — it is reported instead.
  const r = pitchFrom(39, expectedMm(40, 10));
  assert.strictEqual(r.nearest.perInch, 10);
  assert.ok(r.confident, 'a usable measurement was refused');
  assert.ok(r.offByOne, 'the off-by-one was not noticed');
});

check('a clean measurement is not flagged as off by one', () => {
  for (const p of PITCHES) {
    const r = pitchFrom(39, expectedMm(39, p.perInch));
    assert.ok(!r.offByOne, `${p.name} wrongly flagged`);
  }
});

check("Lorenz's own measurement reads as pica", () => {
  // 40 capital M spanning 104 mm on the SM7. Deliberately kept as a test:
  // this is the number the shipped profile rests on, and an earlier, tighter
  // tolerance rejected it.
  for (const steps of [39, 40]) {
    const r = pitchFrom(steps, 104);
    assert.strictEqual(r.nearest.perInch, 10, `${steps} steps`);
    assert.ok(r.confident, `${steps} steps was refused`);
  }
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

check('not fitting the paper is a stop, not a note', () => {
  // 200 columns on a sheet that holds 82. This used to be reported at the
  // same weight as "the margins move in a bit", alongside advice about the
  // margin release — technique for something no technique can fix.
  const s = setUp(200, 10, paperById('a4'), sm7, 'centre');
  const stops = s.warnings.filter((w) => w.level === 'stop');
  assert.strictEqual(stops.length, 1, 'expected exactly one blocking warning');
  assert.ok(/will not fit/i.test(stops[0].text), stops[0].text);
  assert.ok(!s.warnings.some((w) => /margin release/i.test(w.text)),
    'margin release advice given for a motif that cannot fit at all');
});

check('a motif that fits but overruns the margins is only a note', () => {
  // 80 columns: wider than the 66 inside the margins, but the sheet holds
  // 82, so it is genuinely typeable and the advice is worth having.
  const s = setUp(80, 10, paperById('a4'), sm7, 'centre');
  assert.ok(s.warnings.length > 0, 'said nothing at all');
  assert.ok(!s.warnings.some((w) => w.level === 'stop'),
    'a typeable motif was reported as impossible');
});

check('every warning carries a level and a readable sentence', () => {
  for (const w of setUp(200, 400, paperById('a6'), sm7, 'centre').warnings) {
    assert.ok(['stop', 'note'].includes(w.level), JSON.stringify(w));
    assert.ok(w.text.length > 20 && /\.$/.test(w.text.trim()), w.text);
  }
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

console.log('ribbon colour');

check('black only leaves nothing for the second pass', () => {
  const art = ['##', '##'];
  const t = inkTally(art, inkPlan(art, { scheme: 'none' }));
  assert.strictEqual(t.red, 0);
  assert.strictEqual(t.black, 4);
});

check('a space is never coloured, whatever the scheme', () => {
  // A space is not a strike. Colouring one would put a keystroke in the
  // count that nobody types.
  const art = ['# #', '   '];
  for (const s of INK_SCHEMES.map((x) => x.id)) {
    const map = inkPlan(art, { scheme: s, amount: 0.9 });
    assert.strictEqual(map[0][1], 'black', s);
    assert.ok(map[1].every((c) => c === 'black'), s);
  }
});

check('shadow colours the shadow and leaves the face alone', () => {
  // The point of the scheme: a shadowed style already draws two surfaces
  // with two characters, so the ribbon can simply follow that division.
  const art = letter('A', { style: 'shadow', fill: '#', light: '+' });
  const map = inkPlan(art, { scheme: 'shadow' });
  art.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch === '#') assert.strictEqual(map[r][c], 'black', 'face went red');
      if (ch === '+') assert.strictEqual(map[r][c], 'red', 'shadow stayed black');
    });
  });
});

check('accent reddens the heavy strikes, depth the faint ones', () => {
  // The two are opposites and must not quietly agree with each other.
  const art = ['#.#.', '.#.#'];
  const accent = inkPlan(art, { scheme: 'accent', amount: 0.6 });
  const depth = inkPlan(art, { scheme: 'depth', amount: 0.6 });
  const redAt = (m, ch) => art.some((line, r) =>
    [...line].some((c, i) => c === ch && m[r][i] === 'red'));
  assert.ok(redAt(accent, '#'), 'accent left the heavy character black');
  assert.ok(redAt(depth, '.'), 'depth left the faint character black');
  assert.ok(!redAt(depth, '#'), 'depth reddened the heavy character too');
});

check('more amount means more red, never less', () => {
  const art = ['#+.#', '.+#+'];
  let last = -1;
  for (const a of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const t = inkTally(art, inkPlan(art, { scheme: 'depth', amount: a }));
    assert.ok(t.red >= last, `${a} gave less red than the step before`);
    last = t.red;
  }
});

check('every scheme in the list is actually implemented', () => {
  // A name in the menu that falls through to "no red" is a control that
  // does nothing, which is the fault this whole feature was replacing.
  const art = letter('AB', { style: 'shadow', fill: '#', light: '+' });
  for (const s of INK_SCHEMES) {
    if (s.id === 'none') continue;
    const opt = { scheme: s.id, amount: 0.5 };
    if (s.id === 'rows') opt.rows = new Set([0]);
    if (s.id === 'chars') opt.chars = '#';
    const t = inkTally(art, inkPlan(art, opt));
    assert.ok(t.red > 0, `${s.id} produced no red at all`);
    assert.ok(t.black > 0, `${s.id} left nothing in black`);
  }
});

check('every scheme offered has a name and an explanation', () => {
  for (const s of INK_SCHEMES) {
    assert.ok(s.name && s.hint, s.id);
    assert.ok(s.hint.length < 80, `${s.id} hint is too long for the column`);
  }
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

check('a style uses exactly the number of inks it declares', () => {
  // `tones` is what the interface asks the machine for. A style that
  // declares three and draws two gets a character it never uses; one that
  // declares two and draws three emits a placeholder as a literal `~`.
  const TONES = ['1', '2', '3'];
  for (const key of Object.keys(STYLES)) {
    const art = letter('ABO', { style: key, tones: TONES }).join('');
    const used = TONES.filter((t) => art.includes(t));
    assert.strictEqual(used.length, STYLES[key].tones,
      `${key}: drew ${used.length} inks, declares ${STYLES[key].tones}`);
    assert.ok(!art.includes('~'), `${key} leaked a tone placeholder`);
    assert.ok(!art.includes('#'), `${key} leaked an ink placeholder`);
    assert.ok(!art.includes('+'), `${key} leaked an ink placeholder`);
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

console.log('choosing characters for a tone');

check('the ramp never asks for a key the machine has not got', () => {
  // The whole fault this replaced: app.js asked for '#', the SM7 has no '#',
  // and every style fell through to a wall of 'H'.
  const have = new Set(charset(sm7));
  for (const n of [1, 2, 3, 4, 5, 6, 8]) {
    for (const ch of toneRamp(n, { allowed: have })) {
      assert.ok(have.has(ch), `${n}-tone ramp wants ${ch}, not on the SM7`);
    }
  }
});

check('the heaviest tone is the heaviest character available', () => {
  // 'H' was what the old code settled for. Measured at the atlas cell it
  // covers 0.171 against 0.204 for 'B' - a mid-weight character standing in
  // for the darkest one, which is why solid faces read flat.
  const have = new Set(charset(sm7));
  const ladder = inkLadder({ allowed: have });
  assert.strictEqual(toneRamp(3, { allowed: have })[0], ladder[0].ch);
  assert.notStrictEqual(ladder[0].ch, 'H', 'H is not the heaviest SM7 key');
});

check('the tones of a ramp are ordered and distinct', () => {
  const have = new Set(charset(sm7));
  const w = inkWeights(null);
  for (const n of [2, 3, 4, 5, 6]) {
    const ramp = toneRamp(n, { allowed: have });
    assert.strictEqual(new Set(ramp).size, ramp.length, `${n}: repeated a tone`);
    for (let i = 1; i < ramp.length; i++) {
      assert.ok(w(ramp[i]) < w(ramp[i - 1]),
        `${n}: ${ramp[i]} is not lighter than ${ramp[i - 1]}`);
    }
  }
});

check('a machine with few keys gets fewer tones, not repeated ones', () => {
  // Repeating a character is how a shadow ends up identical to the face it
  // is meant to sit behind.
  const ramp = toneRamp(4, { allowed: new Set(['H', 'X']) });
  assert.strictEqual(new Set(ramp).size, ramp.length);
  assert.ok(ramp.length <= 2, ramp.join(''));
});

check('the middle tone is a middle grey, not a thin one', () => {
  // Picked by rank, not by weight. The arithmetic midpoint of the SM7's
  // coverage range is 0.110, which selects 't' - a thin vertical with a bar,
  // not a tone. 60 of its 88 characters sit in the top half of the range, so
  // the midpoint lands far down the population.
  const have = new Set(charset(sm7));
  const ladder = inkLadder({ allowed: have });
  const mid = toneRamp(3, { allowed: have })[1];
  const rank = ladder.findIndex((g) => g.ch === mid);
  const off = Math.abs(rank - (ladder.length - 1) / 2) / ladder.length;
  assert.ok(off < 0.1, `${mid} sits at rank ${rank} of ${ladder.length}`);
});

check('the faintest tone is a mark on the line, not one above it', () => {
  // The two faintest SM7 keys are ` and ´ at 0.0167 coverage, but their ink
  // sits at 0.21 of the cell height - a block of them reads as ticks
  // floating over the letter, not as a pale surface. '.' is 0.0179, the same
  // weight to any eye, and sits at 0.73.
  const faint = toneRamp(3, { allowed: new Set(charset(sm7)) })[2];
  assert.ok(!'`\u00b4\'"^'.includes(faint), `${faint} floats above the line`);
});

console.log('several lines of lettering');

check('a newline makes a second line of letters', () => {
  const one = letter('AB', { style: 'block', fill: '#' });
  const two = letter('AB\nCD', { style: 'block', fill: '#' });
  assert.ok(two.length > one.length * 2,
    `${two.length} rows for two lines against ${one.length} for one`);
});

check('the two blocks are separated by blank rows', () => {
  const two = letter('AB\nCD', { style: 'block', fill: '#' });
  const blanks = two.filter((l) => !l.trim()).length;
  assert.ok(blanks >= 1, 'the two lines run straight into each other');
  // Never at the ends - those are keystrokes nobody types.
  assert.ok(two[0].trim() && two[two.length - 1].trim());
});

check('a blank line is kept as a gap', () => {
  // Otherwise there is no way to ask for air between two lines, and a blank
  // line silently does nothing.
  const tight = letter('AB\nCD', { style: 'block', fill: '#' });
  const airy = letter('AB\n\nCD', { style: 'block', fill: '#' });
  assert.ok(airy.length > tight.length,
    `${airy.length} rows against ${tight.length} - the blank line vanished`);
});

check('every line of a multi-line word is drawn', () => {
  const art = letter('A\nB\nC', { style: 'block', fill: '#' }).join('\n');
  // Three separate blocks means three groups of inked rows.
  const groups = art.split('\n').reduce((n, l, i, all) =>
    n + (l.trim() && !(all[i - 1] ?? '').trim() ? 1 : 0), 0);
  assert.strictEqual(groups, 3, `found ${groups} blocks`);
});

check('a single line is unchanged by the multi-line support', () => {
  // The common case must not have grown a blank row or shifted.
  const l = letter('HELLO', { style: 'big', fill: '#' });
  assert.strictEqual(l.length, 7);
  assert.ok(l.every((x) => x.trim()), 'a blank row crept into one line');
});

console.log('the raised face has a light direction');

check('raised draws three distinct weights', () => {
  // Two tones is a hollow letter with a fill: an edge lit from every side at
  // once has no light direction and nothing stands off the page.
  for (const style of ['relief', 'reliefBig']) {
    const art = letter('O', { style, tones: ['1', '2', '3'] }).join('');
    for (const t of ['1', '2', '3']) {
      assert.ok(art.includes(t), `${style} never used tone ${t}`);
    }
  }
});

check('the lit edge is up and left, the shaded edge down and right', () => {
  // The direction is the whole point: with no direction it is a hollow
  // letter with a fill. The leftmost cell of the bottom row is a corner and
  // is lit, so this counts rather than forbidding.
  const art = letter('L', { style: 'relief', tones: ['1', '2', '3'] });
  const count = (row, t) => [...row].filter((c) => c === t).length;
  const top = art[0];
  const bottom = art[art.length - 1];
  assert.ok(count(top, '1') > 0 && count(top, '3') === 0,
    `the top row is not lit: ${top}`);
  assert.ok(count(bottom, '3') > count(bottom, '1'),
    `the bottom row is not shaded: ${bottom}`);

  // And the same sideways, on a row that crosses the upright.
  const mid = art[Math.floor(art.length / 2)];
  assert.ok(mid.indexOf('1') < mid.lastIndexOf('3'),
    `the light does not run left to right: ${mid}`);
});

check('a two-key machine degrades the raised face instead of failing', () => {
  // The shaded edge falls back to the body, never to the lit edge - that
  // would paint both edges the same and give a solid blob.
  const art = letter('O', { style: 'relief', tones: ['A', 'B'] }).join('');
  assert.ok(art.includes('A') && art.includes('B'));
  assert.ok(!/[^AB ]/.test(art), `leaked a placeholder: ${art.slice(0, 40)}`);
});

check('the shadow scheme finds the shadow whatever it is drawn with', () => {
  // It used to test a fixed list of characters, which named '+' and ':'
  // because those were the only light characters the old code could pick.
  // On an SM7 the shadow now comes out as '-' or '2', neither of which was
  // on the list, and the scheme quietly reddened nothing.
  for (const tones of [['#', '+'], ['B', '-'], ['M', '2'], ['W', 'x']]) {
    const art = letter('AB', { style: 'shadow', tones });
    const map = inkPlan(art, { scheme: 'shadow' });
    let face = 0, shade = 0;
    art.forEach((line, r) => [...line].forEach((ch, c) => {
      if (ch === tones[0]) { face++; assert.strictEqual(map[r][c], 'black',
        `${tones.join('/')}: the face went red`); }
      if (ch === tones[1]) { shade++; assert.strictEqual(map[r][c], 'red',
        `${tones.join('/')}: the shadow stayed black`); }
    }));
    assert.ok(face > 0 && shade > 0, `${tones.join('/')}: nothing drawn`);
  }
});

check('charsUsed names the fixed marks a drawn face needs', () => {
  // `drafted` draws every stroke with a character chosen for its direction,
  // so it takes no tone at all - but it still needs three specific keys, and
  // a picker that only reported tones would say it needs nothing.
  assert.deepStrictEqual(charsUsed('drafted', ['B', '2', '-']).sort(),
    ['!', '/', '_']);
  assert.deepStrictEqual(charsUsed('block', ['B', '2', '-']), ['B']);
  assert.deepStrictEqual(charsUsed('relief', ['B', '2', '-']), ['B', '2', '-']);
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
