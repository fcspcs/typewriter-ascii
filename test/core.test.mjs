/**
 * Tests for the parts that do not need a browser.
 *
 * Glyph measuring needs a canvas, so it is not covered here — everything
 * else is plain arithmetic and can be checked properly.
 */
import assert from 'node:assert';
import {
  charset, makeTypeable, untypeable, standIns, PAPERS, paperById,
  textArea, sheetGrid, setUp, cellWidthMm, cellHeightMm,
  pitchFrom, expectedMm, PITCHES, LINE_PITCHES,
} from '../src/core/machine.js';
import * as machine from '../src/core/machine.js';
import {
  turnedGrid, planningGrid, turnRows, turnField, isTurned, TURNS, turnAdvice,
} from '../src/core/turn.js';
import {
  tiled, tilesOf, isComposite, unitOf, unitGrid, sheetCount, seams,
  splitMotif, layoutAdvice, MAX_ACROSS, MAX_DOWN,
} from '../src/core/compose.js';
import { PROFILES, profileById } from '../src/profiles/index.js';
import {
  runsOf, runsToText, strikesInLine, colourMap, inkTally, parseRows,
  columnOfStrike, inkPlan, INK_SCHEMES,
} from '../src/core/runs.js';
import {
  letter, STYLES, charsUsed, tonesOf, usesTwo, marksOf,
} from '../src/core/lettering.js';
import { toneRamp, inkLadder, inkWeights } from '../src/core/ink.js';
import { fitGrid, sentenceReads, keystrokes } from '../src/core/convert.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

const sm7 = profileById('olympia-sm7');
/** Distinguishable, typeable, and no spaces — a space would be trimmed. */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
// The second stock machine, and a genuinely different one for this purpose:
// it has no underscore, no acute and no section mark.
const pica = profileById('generic-pica-qwerty');

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
  const TONES = ['1', '2', '3', '4', '5'];
  for (const key of Object.keys(STYLES)) {
    // As long a ramp as the style asks for. Handing every style three and
    // expecting five back tests the degradation path, not the declaration -
    // a five-band face given three tones is *supposed* to come out in three.
    const ramp = TONES.slice(0, Math.max(1, STYLES[key].tones));
    const art = letter('ABO', { style: key, tones: ramp }).join('');
    const used = ramp.filter((t) => art.includes(t));
    assert.strictEqual(used.length, STYLES[key].tones,
      `${key}: drew ${used.length} inks, declares ${STYLES[key].tones}`);
    for (const ph of '#+~%*') {
      assert.ok(!art.includes(ph),
        `${key} leaked the ink placeholder ${ph}`);
    }
  }
});

check('styles have no blank rows top or bottom', () => {
  for (const key of Object.keys(STYLES)) {
    const art = letter('AB', { style: key });
    assert.ok(art[0].trim(), `${key} starts with a blank row`);
    assert.ok(art[art.length - 1].trim(), `${key} ends with a blank row`);
  }
});


check('every letter of the calligraphic hand is entered and left', () => {
  // The flourishes are derived once rather than drawn into all thirty-eight
  // glyphs (see penned), which is the only way they come out the same - but
  // it also means one wrong default strips them from every glyph at once
  // and leaves a face that is Block again, only three times as tall.
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    const art = letter(ch, { style: 'script', fill: '#' });
    assert.strictEqual(art[0].trim(), '/', `${ch} is not entered`);
    assert.ok(art[art.length - 1].trimStart().startsWith('##'),
      `${ch} has no terminal: ${JSON.stringify(art[art.length - 1])}`);
  }
});

check('the calligraphic hand leans without falling over', () => {
  // slant() shears half a column per row, which on a sixteen-row face is
  // eight columns and takes a four-letter word past the width of an upright
  // A4 line. `lean` is half of that; if it ever goes back to the full slant
  // this fails rather than quietly wrapping every word onto two lines.
  const upright = letter('TYPE', { style: 'script', fill: '#' });
  const leaning = letter('TYPE', { style: 'scriptLean', fill: '#' });
  const cols = (art) => Math.max(...art.map((r) => r.length));
  assert.ok(cols(leaning) > cols(upright), 'the leaning face did not lean');
  assert.ok(cols(leaning) <= 82,
    `${cols(leaning)} columns will not fit an upright A4 line`);
});

check('every lettering style comes out typeable, on both machines', () => {
  // The whole point, and now the end of the chain rather than a property of
  // the glyph data: the face asks for `^`, the engine answers `´`, and what
  // this reads is what would go on the paper. Nothing may reach the sheet
  // that the machine cannot strike.
  for (const m of [sm7, pica]) {
    const have = new Set(charset(m));
    for (const key of Object.keys(STYLES)) {
      const { swaps } = standIns(marksOf(key), { have });
      const art = letter('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        { style: key, fill: '#', light: '+', substitutes: swaps });
      for (const ch of new Set(art.join('').replace(/ /g, ''))) {
        if (ch === '#' || ch === '+') continue;    // the two ink slots
        assert.ok(have.has(ch),
          `${key} put ${JSON.stringify(ch)} on the sheet, and ${m.name} ` +
          `has no such key`);
      }
    }
  }
});

check('a style declares every mark it strikes', () => {
  // The other direction from the test below, and the one the picker relies
  // on: `uses` is what marksMissing() compares against the machine, so a
  // mark that gets struck without being declared is a key the picker
  // promises is not needed - and then the sheet asks for it anyway.
  const TONES = ['1', '2', '3', '4', '5'];
  for (const [key, spec] of Object.entries(STYLES)) {
    const ramp = TONES.slice(0, Math.max(1, spec.tones));
    const art = letter('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,-:?!',
      { style: key, tones: ramp });
    const declared = new Set([...(spec.uses ?? ''), ...ramp]);
    for (const ch of new Set(art.join('').replace(/ /g, ''))) {
      assert.ok(declared.has(ch),
        `${key} strikes ${JSON.stringify(ch)} without declaring it`);
    }
  }
});

check('every style has a stand-in for every mark, on both machines', () => {
  // The faces are written in the marks they were designed in, so `missing`
  // being empty is not a property of the faces - it is the engine doing its
  // job. Both stock profiles, because they differ: a generic pica QWERTY has
  // no underscore, and eight faces here are drawn with one.
  for (const m of [sm7, pica]) {
    const have = new Set(charset(m));
    for (const key of Object.keys(STYLES)) {
      const { missing } = standIns(marksOf(key), { have });
      assert.deepStrictEqual(missing, [],
        `${key} has nothing to stand in for ${missing.join(' ')} on ${m.name}`);
    }
  }
});

check('the stand-in engine is actually doing something', () => {
  // A test that only checks `missing` is empty would also pass if every face
  // happened to use nothing but letters. These two are the reason the engine
  // exists: the peaks face is built out of carets and the SM7 has none.
  const have = new Set(charset(sm7));
  const { swaps } = standIns(marksOf('peaks'), { have });
  assert.strictEqual(swaps.get('^'), '´', 'the caret was not stood in for');

  const { missing } = standIns(['☃'], { have });
  assert.deepStrictEqual(missing, ['☃'],
    'a mark with no table entry and no canvas should be reported, not guessed');
});

check('no face draws with a character reserved for a tone', () => {
  // `#`, `+`, `~`, `%` and `*` are the ramp's placeholders. A face that
  // draws a literal one of them gets the machine's fourth tone printed where
  // it wanted a per-cent sign - silently, and only on the styles that ask
  // for that many tones.
  for (const key of Object.keys(STYLES)) {
    const art = letter('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      { style: key, tones: ['1', '2', '3', '4', '5'] }).join('');
    for (const ph of '#+~%*') {
      assert.ok(!art.includes(ph), `${key} drew a literal ${ph}`);
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

console.log('turning the sheet sideways');

check('the paper never turns', () => {
  // The mistake this replaced, kept as a test so it cannot come back.
  // landscape() swapped the paper's width and height and everything
  // downstream believed it: A4 became 297 mm of writing line on a machine
  // whose scale ends at 249.
  const M = machine;
  assert.ok(!('landscape' in M), 'landscape() is back');
  assert.ok(!('wantsLandscape' in M), 'wantsLandscape() is back');
  assert.ok(!('orient' in M), 'orient() is back');
  for (const p of PAPERS) {
    assert.ok(p.h > p.w, `${p.name} is stored on its side`);
  }
});

check('turning buys shape, not room', () => {
  // A4 at pica: 82 x 70 on the sheet, 66 x 60 inside the margins. Turned,
  // that is 60 x 66 — the same cells, stood the other way up. The old model
  // claimed 100 x 39, which was 297 mm of paper the carriage cannot reach.
  const a4 = paperById('a4');
  const grid = sheetGrid(a4, sm7);
  const area = textArea(a4, sm7);
  assert.deepStrictEqual(grid, { cols: 82, rows: 70 });
  assert.deepStrictEqual(area, { cols: 66, rows: 60 });
  assert.deepStrictEqual(turnedGrid(area), { cols: 60, rows: 66 });
  assert.deepStrictEqual(planningGrid(area, 'none'), area);
  assert.deepStrictEqual(planningGrid(area, 'left'), turnedGrid(area));
  assert.deepStrictEqual(planningGrid(area, 'right'), turnedGrid(area));

  // What it does buy, in millimetres: a picture 60 cells wide on a turned
  // sheet reaches 254 mm, against 168 for the 66 an upright one gives.
  const across = turnedGrid(area).cols * cellHeightMm(sm7);
  const up = area.cols * cellWidthMm(sm7);
  assert.ok(across > up * 1.4, `${across.toFixed(0)} mm against ${up.toFixed(0)}`);
});

check('what cannot be typed is refused, not noted', () => {
  // The failure in full. Under the old model a 116-column motif on "A4
  // sideways" produced a left stop of 7 and a right stop of 80 — 73 columns
  // of carriage — and reported it as three notes and no refusal.
  const a4 = paperById('a4');
  const level = (w) => setUp(w, 20, a4, sm7).warnings.map((x) => x.level);
  assert.ok(!level(66).includes('stop'), 'refused a motif inside the margins');
  assert.ok(!level(82).includes('stop'), 'refused a motif that fits the sheet');
  assert.ok(level(116).includes('stop'), '116 columns went through as a note');
  assert.ok(level(99).includes('stop'), 'past the end of the scale, unrefused');
});

check('a turned grid is the same grid read the other way', () => {
  const rows = ['abc', 'def'];
  // Turn it left, then turn the result right: back where it started.
  const there = turnRows(rows, 'left');
  const back = turnRows(there, 'right');
  assert.deepStrictEqual(back, rows);
  // Rows and columns change places.
  assert.strictEqual(there.length, 3);
  assert.strictEqual(there[0].length, 2);
});

check('which corner is typed first is what the two turns differ in', () => {
  // It decides the order you work through the picture in, which is the only
  // thing a person notices before the sheet comes out. Turning the sheet
  // left means the motif's left-hand column is the first line typed; turning
  // it right means the right-hand column is.
  //
  //   T R      the motif: T top-left, R top-right,
  //   b .      b bottom-left
  const rows = ['TR', 'b.'];
  assert.strictEqual(turnRows(rows, 'left')[0], 'bT',
    'the left-hand column, bottom first');
  assert.strictEqual(turnRows(rows, 'right')[0], 'R.',
    'the right-hand column, top first');
});

check('marks are swapped for what will look right once turned', () => {
  const have = new Set([...'-_!"/(nu ']);
  // A bar is mapped by direction: a horizontal one has to be struck as a
  // vertical one, because the sheet is going to turn under it.
  assert.strictEqual(turnRows(['-'], 'left', have)[0], '!');
  assert.strictEqual(turnRows(['_'], 'right', have)[0], '!');
  // Nothing honest to swap to, so it stands.
  assert.strictEqual(turnRows(['~'], 'left', have)[0], '~');
  // Weight-bearing characters are chosen for how dark they are, and a B on
  // its side is exactly as dark as a B.
  assert.strictEqual(turnRows(['B'], 'left', have)[0], 'B');
});

check('a rotated mark the machine has not got is not used', () => {
  // The output has to stay typeable. An SM7 has no backslash, so a slash
  // stays a slash rather than becoming a key that is not there.
  const sm7Keys = new Set(charset(sm7));
  assert.ok(!sm7Keys.has(String.fromCharCode(92)), 'the SM7 grew a backslash');
  assert.strictEqual(turnRows(['/'], 'left', sm7Keys)[0], '/');
  for (const ch of turnRows(['-_/()'], 'left', sm7Keys)[0]) {
    assert.ok(sm7Keys.has(ch) || ch === ' ', `${ch} is not on the machine`);
  }
});

check('what turning helps is a motif that is too tall, not too wide', () => {
  // This is the opposite of what the app used to claim, and it is worth
  // being blunt about. A sheet is taller than it is wide, so laying a motif
  // down gives it the long axis for its height: 82 cells down and 70 across,
  // against 82 across and 70 down upright.
  //
  // What turning does *not* buy is columns. It buys millimetres — a turned
  // cell is 4.23 mm wide against 2.54 — which is why a photograph gains from
  // it and a long word does not.
  const a4 = paperById('a4');
  const stop = (w, h) => setUp(w, h, a4, sm7).warnings
    .some((x) => x.level === 'stop');
  assert.ok(stop(60, 78), '78 lines were said to fit an A4 that holds 70');
  assert.ok(!stop(78, 60), 'the same motif laid down was refused');
  // And the reverse, so nobody reads the above as "turning always helps".
  assert.ok(!stop(78, 60), 'a wide, short motif was refused upright');
  assert.ok(stop(60, 78), 'laying a wide motif down was said to fit');
});

check('the carriage refuses what the paper cannot', () => {
  // Only reachable on a machine whose scale is narrower than its paper, so
  // it is stated with one: no shipped profile is, which is exactly why the
  // old model's 297 mm writing line went unchallenged for so long.
  const narrow = { ...sm7, scale: { ...sm7.scale, max: 40 } };
  const wide = { ...paperById('a4'), w: 210, h: 297 };
  const stop = (w) => setUp(w, 10, wide, narrow).warnings
    .filter((x) => x.level === 'stop');
  assert.strictEqual(stop(30).length, 0, 'refused a motif inside the scale');
  assert.ok(/carriage does not reach/i.test(stop(60)[0]?.text ?? ''),
    'a motif past the end of the scale went through');
  // One problem, not two: off the paper as well and the paper says it.
  assert.strictEqual(stop(200).length, 1, 'two refusals for one motif');
});

check('turning a picture turns the picture, not the cells', () => {
  // A field laid on its side comes back as itself when it is stood up.
  const field = { w: 3, h: 2, data: Float32Array.from([1, 2, 3, 4, 5, 6]) };
  const left = turnField(field, 'left');
  assert.strictEqual(left.w, 2);
  assert.strictEqual(left.h, 3);
  const back = turnField(left, 'right');
  assert.strictEqual(back.w, 3);
  assert.strictEqual(back.h, 2);
  assert.deepStrictEqual([...back.data], [...field.data]);
});

console.log('one motif across several sheets');

check('a composite is the sheet multiplied, never the millimetres divided', () => {
  /*
   * The rule the whole feature rests on. A4 at pica holds 82 columns, which
   * is 208.28 mm of a 210 mm sheet. Two sheets butted together are 420 mm,
   * and 420 mm divided by the cell is 165 — one more column than the two
   * sheets hold between them. That column lands across the join, half on
   * each sheet, where no type bar can reach it.
   */
  const a4 = paperById('a4');
  const two = tiled(a4, 2, 1);
  assert.strictEqual(sheetGrid(a4, sm7).cols, 82);
  assert.strictEqual(Math.floor(420 / cellWidthMm(sm7)), 165,
    'the arithmetic this avoids has changed');
  assert.deepStrictEqual(sheetGrid(two, sm7), { cols: 164, rows: 70 });
  assert.deepStrictEqual(sheetGrid(tiled(a4, 2, 2), sm7), { cols: 164, rows: 140 });
});

check('the margins belong to the outside of the picture', () => {
  // Subtracted once, not once per sheet. A margin down the inside of a join
  // would be a white stripe through the middle of the picture.
  const a4 = paperById('a4');
  const one = textArea(a4, sm7);
  const two = textArea(tiled(a4, 2, 1), sm7);
  assert.deepStrictEqual(one, { cols: 66, rows: 60 });
  assert.strictEqual(two.cols, 164 - (82 - 66), 'the margin was counted twice');
  assert.strictEqual(two.rows, one.rows, 'a side join changed the top margin');
});

check('the leftover paper piles up at the joins', () => {
  const a4 = paperById('a4');
  const gap = seams(tiled(a4, 2, 2), sm7);
  // 210 - 82 x 2.54 and 297 - 70 x 4.2333.
  assert.ok(Math.abs(gap.across - 1.72) < 0.01, `${gap.across} across`);
  assert.ok(Math.abs(gap.down - 0.67) < 0.01, `${gap.down} down`);
});

check('composing and uncomposing leaves the paper as it was', () => {
  const a4 = paperById('a4');
  const back = tiled(tiled(a4, 3, 2), 1, 1);
  assert.strictEqual(back.w, a4.w);
  assert.strictEqual(back.h, a4.h);
  // The margin lives on the paper and not on the unit, so this is exactly
  // the property a careless round trip loses.
  assert.strictEqual(back.margin, a4.margin, 'the margin was dropped');
  assert.ok(!isComposite(back));
  assert.ok(!isComposite(a4));
  assert.ok(isComposite(tiled(a4, 2, 1)));
});

check('the matrix cannot be pushed past what it offers', () => {
  const a4 = paperById('a4');
  assert.deepStrictEqual(tilesOf(tiled(a4, 99, 99)),
    { across: MAX_ACROSS, down: MAX_DOWN });
  assert.deepStrictEqual(tilesOf(tiled(a4, 0, -3)), { across: 1, down: 1 });
});

check('every cell of the motif lands on exactly one sheet', () => {
  /*
   * The property that makes the whole thing typeable, checked by putting the
   * picture back together: read the slices out in the order they are typed
   * and the original has to come back, cell for cell.
   */
  const a4 = paperById('a4');
  const lines = Array.from({ length: 90 },
    (_, r) => Array.from({ length: 120 }, (_, c) => CHARS[(r + c) % CHARS.length]).join(''));
  const plan = splitMotif({ lines, paper: tiled(a4, 2, 2), machine: sm7 });

  const back = Array.from({ length: 90 }, () => new Array(120).fill(null));
  for (const sh of plan.sheets) {
    sh.lines.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        // Where this cell sits in the motif: the sheet's corner on the
        // composite, plus its own offset, less where the motif was placed.
        const col = sh.col * plan.grid.cols + sh.at.col + x - plan.origin.col;
        const row = sh.row * plan.grid.rows + sh.at.row + y - plan.origin.row;
        assert.strictEqual(back[row][col], null,
          `cell ${col},${row} landed on two sheets`);
        back[row][col] = line[x];
      }
    });
  }
  for (let r = 0; r < 90; r++) {
    assert.strictEqual(back[r].join(''), lines[r], `row ${r} came back wrong`);
  }
});

check('the picture is placed once, and the sheets are told', () => {
  // A sheet that centred its own slice would make the picture jump at every
  // join. So the second sheet across starts at its own column 0, and it is
  // the paper guide that carries the difference.
  const a4 = paperById('a4');
  const lines = Array.from({ length: 30 }, () => '#'.repeat(100));
  const plan = splitMotif({ lines, paper: tiled(a4, 2, 1), machine: sm7 });
  const [left, right] = plan.sheets;

  assert.deepStrictEqual(plan.origin, { col: 32, row: 20 });
  assert.deepStrictEqual(left.at, { col: 32, row: 20 });
  assert.deepStrictEqual(right.at, { col: 0, row: 20 });
  assert.strictEqual(left.lines[0].length, 50);
  assert.strictEqual(right.lines[0].length, 50);

  // What the machine is actually told, on both sheets: the margin stop is a
  // carriage position and the paper guide slides the sheet under it, so the
  // difference is where the ink lands on the paper.
  for (const [sh, want] of [[left, 32], [right, 0]]) {
    assert.strictEqual(sh.setup.left - sh.setup.paperGuide, want,
      `${sh.name} puts its piece at the wrong column`);
    assert.strictEqual(sh.setup.advance, 20, `${sh.name} winds on wrongly`);
  }
});

check('a sheet the motif never reaches is listed, not dropped', () => {
  // Somebody laying out four pieces of paper needs to know the fourth is
  // blank, not that there are three.
  const a4 = paperById('a4');
  const lines = Array.from({ length: 8 }, () => '#'.repeat(20));
  const plan = splitMotif({
    lines, paper: tiled(a4, 2, 2), machine: sm7, align: 'topleft',
  });
  assert.strictEqual(plan.sheets.length, 4);
  const used = plan.sheets.filter((sh) => !sh.blank);
  assert.strictEqual(used.length, 1, 'a small motif reached more than one sheet');
  assert.strictEqual(used[0].index, 0, 'top left did not land on the first sheet');
  for (const sh of plan.sheets) {
    assert.ok(sh.name.includes('of 4'), `unnamed sheet: ${sh.name}`);
  }
});

check('the centre of four sheets is the point where they meet', () => {
  /*
   * Arithmetically right and almost never wanted: centred on a two-by-two,
   * a motif that would fit one sheet is cut across all four. It is not
   * corrected — "centred" has one meaning — but it is said out loud, because
   * the preview at thumbnail size does not make it obvious.
   */
  const a4 = paperById('a4');
  const lines = Array.from({ length: 8 }, () => '#'.repeat(20));
  const plan = splitMotif({ lines, paper: tiled(a4, 2, 2), machine: sm7 });
  assert.strictEqual(plan.sheets.filter((sh) => !sh.blank).length, 4);
  const note = plan.warnings.find((w) => /would fit on one sheet/.test(w.text));
  assert.ok(note, `nothing said about it: ${JSON.stringify(plan.warnings)}`);
  assert.strictEqual(note.level, 'note', 'a positioning choice was made a refusal');
  assert.ok(/top left/.test(note.text), `no way out offered: ${note.text}`);

  // And it stays quiet when the split is the point of composing at all.
  const big = splitMotif({
    lines: Array.from({ length: 100 }, () => '#'.repeat(150)),
    paper: tiled(a4, 2, 2), machine: sm7,
  });
  assert.ok(!big.warnings.some((w) => /would fit on one sheet/.test(w.text)),
    'a motif that needs four sheets was told it fits on one');
});

check('paper the motif never reaches is pointed out', () => {
  /*
   * Easiest to walk into with a turn in play, where the axes are crossed:
   * three sheets *across* give a turned picture three sheets of height and
   * no extra width at all, because a turned sheet's width is counted down
   * the paper. Somebody who has just asked for three sheets and got one
   * needs to be told why, not left to count the dashed buttons.
   */
  const a4 = paperById('a4');
  const plan = splitMotif({
    lines: Array.from({ length: 40 }, () => '#'.repeat(50)),
    paper: tiled(a4, 3, 1), machine: sm7, align: 'topleft',
  });
  assert.strictEqual(plan.sheets.filter((sh) => !sh.blank).length, 1);
  const note = plan.warnings.find((w) => /stay blank/.test(w.text));
  assert.ok(note, `nothing said: ${JSON.stringify(plan.warnings)}`);
  assert.ok(/2 of the 3/.test(note.text), note.text);
  assert.strictEqual(note.level, 'note');

  // Quiet when every sheet earns its place.
  const full = splitMotif({
    lines: Array.from({ length: 60 }, () => '#'.repeat(240)),
    paper: tiled(a4, 3, 1), machine: sm7,
  });
  assert.ok(!full.warnings.some((w) => /stay blank/.test(w.text)),
    'a motif that reached every sheet was told it had not');
});

check('the sheets are numbered in the order they are typed', () => {
  const a4 = paperById('a4');
  const lines = Array.from({ length: 100 }, () => '#'.repeat(150));
  const plan = splitMotif({ lines, paper: tiled(a4, 2, 2), machine: sm7 });
  assert.deepStrictEqual(plan.sheets.map((sh) => [sh.col, sh.row]),
    [[0, 0], [1, 0], [0, 1], [1, 1]], 'left to right, then down');
});

check('what fits the paper and what the carriage reaches are asked apart', () => {
  /*
   * On a composite these are different questions and the old single answer
   * got one of them wrong. A hundred-column picture across two sheets is
   * fifty columns per sheet — well inside an SM7's 98-column scale — so
   * refusing it because no single line of 100 can be typed would refuse
   * something perfectly typeable in two visits.
   */
  const a4 = paperById('a4');
  const lines = Array.from({ length: 30 }, () => '#'.repeat(150));
  const plan = splitMotif({ lines, paper: tiled(a4, 2, 1), machine: sm7 });
  assert.deepStrictEqual(plan.warnings.filter((w) => w.level === 'stop'), [],
    '150 columns over two sheets was refused');
  for (const sh of plan.sheets) {
    assert.deepStrictEqual(
      (sh.setup?.warnings ?? []).filter((w) => w.level === 'stop'), [],
      `${sh.name} refused its own slice`);
  }

  // And it is still refused when it genuinely does not fit the paper.
  const huge = splitMotif({
    lines: Array.from({ length: 30 }, () => '#'.repeat(400)),
    paper: tiled(a4, 2, 1), machine: sm7,
  });
  assert.ok(huge.warnings.some((w) => w.level === 'stop'),
    '400 columns was said to fit two A4');
});

check('a single sheet is a composite of one, and says nothing extra', () => {
  // The single-sheet case has to come out of the same code, or the two drift
  // apart. What it must not do is start talking about joins.
  const a4 = paperById('a4');
  const lines = Array.from({ length: 20 }, () => '#'.repeat(60));
  const plan = splitMotif({ lines, paper: a4, machine: sm7 });
  assert.strictEqual(plan.sheets.length, 1);
  assert.deepStrictEqual(plan.sheets[0].lines, lines);
  assert.strictEqual(plan.sheets[0].name, 'A4');
  assert.deepStrictEqual(layoutAdvice(a4, sm7), []);
  assert.strictEqual(sheetCount(a4), 1);
  assert.strictEqual(unitGrid(a4, sm7).cols, sheetGrid(a4, sm7).cols);
});

check('laying out is explained, and the horizontal join is warned about', () => {
  const a4 = paperById('a4');
  const side = layoutAdvice(tiled(a4, 2, 1), sm7).map(([head]) => head).join(' | ');
  assert.ok(/Overlap 1\.7 mm/.test(side), side);
  assert.ok(!/bottom lines/i.test(side), `a side join warned about the feed: ${side}`);

  const stacked = layoutAdvice(tiled(a4, 1, 2), sm7);
  const heads = stacked.map(([head]) => head).join(' | ');
  assert.ok(/bottom lines/i.test(heads), heads);
  // The feed is the reason, and no number is invented for it.
  const body = stacked.map(([, b]) => b).join(' ');
  assert.ok(/feed rollers/i.test(body) && /not been measured/i.test(body), body);
});

check('a turned composite is the composite turned', () => {
  // The two compose: the tiling decides how much paper, the turn decides
  // which way the finished thing is read. Neither knows about the other.
  const a4 = paperById('a4');
  const g = sheetGrid(tiled(a4, 2, 1), sm7);
  assert.deepStrictEqual(planningGrid(g, 'left'), { cols: 70, rows: 164 });
  assert.deepStrictEqual(planningGrid(g, 'none'), g);
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

console.log('wrapping lettering to the paper');

check('a sentence too wide for the sheet is broken at spaces', () => {
  // Measured on an SM7 at pica: "GUTEN MORGEN LYON" in Block is 101 columns
  // against the 82 an upright A4 holds - 123% of the sheet. It simply ran
  // off the paper.
  const cap = textArea(paperById('a4'), sm7).cols;
  const loose = letter('GUTEN MORGEN LYON', { style: 'block', tones: ['B'] });
  assert.strictEqual(Math.max(...loose.map((l) => l.length)), 101,
    'the unwrapped width has moved; the rest of this test assumes it');

  const wrapped = letter('GUTEN MORGEN LYON',
    { style: 'block', tones: ['B'], maxCols: cap });
  const width = Math.max(...wrapped.map((l) => l.length));
  assert.ok(width <= cap, `wrapped to ${width} columns against a cap of ${cap}`);
  assert.ok(wrapped.length > loose.length, 'it did not take more rows');
});

check('it fits, unless a single word cannot be broken', () => {
  /*
   * The guarantee, stated precisely, because "never wider than the sheet"
   * is not achievable and pretending otherwise would mean hyphenating.
   *
   * Wrapping can only break at spaces. In a heavy face one word is already
   * over the limit on its own - measured on an SM7 at pica, "MORGEN" in
   * Hollow is 95 columns against 66 inside the margins - and no amount of
   * wrapping helps. So: the result is within the cap whenever every word
   * fits, and otherwise no wider than the widest single word needs.
   */
  const a4 = paperById('a4');
  const cap = textArea(a4, sm7).cols;
  const text = 'HALLO WELT WIE GEHT ES DIR HEUTE AM MORGEN';
  for (const style of ['block', 'big', 'wide', 'hollow', 'relief', 'slab']) {
    const tones = ['B', '2', '-'];
    const art = letter(text, { style, tones, maxCols: cap });
    const width = Math.max(...art.map((l) => l.length));

    const widestWord = Math.max(...text.split(' ').map((w) =>
      Math.max(...letter(w, { style, tones }).map((l) => l.length))));

    assert.ok(width <= Math.max(cap, widestWord),
      `${style}: ${width} columns, cap ${cap}, widest single word ` +
      `${widestWord}`);
    if (widestWord <= cap) {
      assert.ok(width <= cap,
        `${style}: every word fits in ${cap} yet the motif is ${width}`);
    }
  }
});

check('a word planned sideways wraps narrower and comes out wider', () => {
  // Both halves matter, and the first one reads like a regression until you
  // see the second. Turning gives a word *fewer* columns to wrap into — 60
  // inside the margins against 66 — so it takes more rows. What it gets back
  // is millimetres: those 60 cells reach 254 mm of paper where the 66 reach
  // 168, because a turned cell is 4.23 mm wide and an upright one is 2.54.
  const a4 = paperById('a4');
  const up = textArea(a4, sm7).cols;
  const across = planningGrid(textArea(a4, sm7), 'left').cols;
  assert.ok(across < up, `${across} columns turned against ${up} upright`);

  const text = 'HALLO WELT WIE GEHT ES DIR';
  const tall = letter(text, { style: 'block', tones: ['B'], maxCols: up });
  const wide = letter(text, { style: 'block', tones: ['B'], maxCols: across });
  assert.ok(Math.max(...wide.map((l) => l.length)) <= across,
    'wrapped past the width it was given');
  assert.ok(across * cellHeightMm(sm7) > up * cellWidthMm(sm7) * 1.4,
    'turning did not buy the millimetres it is for');

  // And once it is laid down, what was its width is a count of typed lines.
  const laid = turnRows(wide, 'left', new Set([...'B ']));
  assert.strictEqual(laid.length, Math.max(...wide.map((l) => l.length)));
  assert.ok(laid.length <= sheetGrid(a4, sm7).rows,
    `${laid.length} lines on a sheet that holds ${sheetGrid(a4, sm7).rows}`);
});

check('a single word too wide to break is left whole', () => {
  // Splitting a word mid-letter produces something nobody can read, and
  // hides the problem: setUp() already refuses a motif wider than the sheet
  // and says what to change. Silently hyphenating turns a clear refusal
  // into a mess.
  const cap = textArea(paperById('a4'), sm7).cols;
  const word = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD';
  const art = letter(word, { style: 'block', tones: ['B'], maxCols: cap });
  const plain = letter(word, { style: 'block', tones: ['B'] });
  assert.deepStrictEqual(art, plain, 'the word was broken up');

  // And the refusal is still raised, which is what tells the user to act.
  const width = Math.max(...art.map((l) => l.length));
  const stop = setUp(width, art.length, paperById('a4'), sm7).warnings
    .some((w) => w.level === 'stop');
  assert.ok(stop, 'no refusal for a motif 239 columns wide');
});

check('a long word does not drag the next one onto its line', () => {
  const cap = textArea(paperById('a4'), sm7).cols;
  const art = letter('ABCDEFGHIJKLMNOPQRSTUVWXYZ HI',
    { style: 'block', tones: ['B'], maxCols: cap });
  const alone = letter('HI', { style: 'block', tones: ['B'] });
  // The short word ends up on a line of its own, so the last block is
  // exactly as wide as 'HI' rendered by itself.
  const lastRow = art[art.length - 1];
  assert.strictEqual(lastRow.length, alone[alone.length - 1].length,
    `the tail row is ${lastRow.length} wide, 'HI' alone is ` +
    `${alone[alone.length - 1].length}`);
});

check('wrapping respects the line breaks already there', () => {
  const cap = textArea(paperById('a4'), sm7).cols;
  const art = letter('GUTEN MORGEN LYON\n\nHI',
    { style: 'block', tones: ['B'], maxCols: cap });
  assert.ok(Math.max(...art.map((l) => l.length)) <= cap);
  // The deliberate blank line survives the wrapping.
  assert.ok(art.some((l) => !l.trim()), 'the blank line was lost');
});

check('a word that fits is not touched', () => {
  // Wrapping must be invisible when it has nothing to do.
  for (const style of ['block', 'big', 'relief']) {
    const tones = ['B', '2', '-'];
    assert.deepStrictEqual(
      letter('HI', { style, tones, maxCols: 66 }),
      letter('HI', { style, tones }),
      `${style}: a short word was altered`);
  }
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
