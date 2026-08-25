/**
 * Tests for the FIGlet reader.
 *
 * No real font file appears here, deliberately: the whole reason the reader
 * exists is that the FIGlet collection's glyph data cannot be shipped in
 * this repository, and a test fixture is shipping. So the tests *generate*
 * a small font in the file format instead — which doubles as documentation
 * of the format, and lets each layout and smushing rule be exercised with
 * glyphs built to trigger exactly that rule.
 */
import assert from 'node:assert';
import {
  parseFlf, flfRender, flfLetter, flfMarks,
} from '../src/core/figlet.js';
import { standIns, charset } from '../src/core/machine.js';
import { profileById } from '../src/profiles/index.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

/* ------------------------------------------------------------------ */
/* A font factory                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build a syntactically complete .flf: header, comments, all 95 required
 * ASCII glyphs, the seven Deutsch glyphs, and any code-tagged extras.
 *
 * Three rows high. Every character defaults to a 2-wide block of itself;
 * `shapes` overrides individual characters with purpose-built glyphs.
 */
function makeFlf({ oldLayout = -1, fullLayout = null, shapes = {},
  extras = [] } = {}) {
  const head = ['flf2a$', 3, 3, 12, oldLayout, 2, 0];
  if (fullLayout !== null) head.push(fullLayout);

  const rowsFor = (ch) => {
    if (shapes[ch]) return shapes[ch];
    if (ch === ' ') return ['  ', '  ', '  '];
    const c = ch === '@' ? '#' : ch;   // @ is the endmark; do not confuse it
    return [c + c, c + c, c + c];
  };
  const glyph = (ch) => {
    const rows = rowsFor(ch);
    return rows.map((r, i) => r + (i === rows.length - 1 ? '@@' : '@'))
      .join('\n');
  };

  const chars = [
    ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
    'Ä', 'Ö', 'Ü', 'ä', 'ö', 'ü', 'ß',
  ];
  const parts = [
    head.join(' '),
    'a generated test font',
    'second comment line',
    ...chars.map(glyph),
    ...extras.map(([code, rows]) =>
      `${code}\n${rows.map((r, i) =>
        r + (i === rows.length - 1 ? '@@' : '@')).join('\n')}`),
  ];
  return parts.join('\n') + '\n';
}

const COL = (ch) => [ch, ch, ch];   // a one-column glyph, three rows of ch

/* ------------------------------------------------------------------ */

console.log('parsing');

check('a font parses: header, endmarks, all required characters', () => {
  const f = parseFlf(makeFlf(), 'test');
  assert.strictEqual(f.height, 3);
  assert.strictEqual(f.hardblank, '$');
  assert.strictEqual(f.layout.mode, 'full');
  assert.strictEqual(f.glyphs.size, 102);
  assert.deepStrictEqual(f.glyphs.get('A'), ['AA', 'AA', 'AA']);
});

check('the Deutsch characters are read, which a QWERTZ machine needs', () => {
  const f = parseFlf(makeFlf({ shapes: { 'Ü': ['UU', '..', 'UU'] } }));
  assert.deepStrictEqual(f.glyphs.get('Ü'), ['UU', '..', 'UU']);
  assert.ok(f.glyphs.has('ß'), 'no ß');
});

check('code-tagged glyphs are read, decimal and hex alike', () => {
  const f = parseFlf(makeFlf({
    extras: [[945, COL('a')], ['0x2603', COL('s')]],
  }));
  assert.ok(f.glyphs.has('α'), 'no decimal-tagged glyph');
  assert.ok(f.glyphs.has('☃'), 'no hex-tagged glyph');
});

check('not a font is said plainly', () => {
  assert.throws(() => parseFlf('hello world', 'x'), /not a FIGlet font/);
});

console.log('layout');

check('full width lays glyphs side by side', () => {
  const f = parseFlf(makeFlf({ oldLayout: -1 }));
  assert.strictEqual(flfRender(f, 'AB').rows[0], 'AABB');
});

check('kerning slides glyphs together until they would touch', () => {
  const f = parseFlf(makeFlf({
    oldLayout: 0,
    shapes: { A: ['A  ', 'A  ', 'A  '], B: [' B ', ' B ', ' B '] },
  }));
  // Two trailing spaces meet one leading space: three columns close up.
  assert.strictEqual(flfRender(f, 'AB').rows[0], 'AB');
});

check('kerning retreats no further than the start of the line', () => {
  // 'A' then a B whose glyph is nearly all air: the gap is wider than the
  // line is long, and the answer is the whole line consumed, not a crash
  // and not a negative slice.
  const f = parseFlf(makeFlf({
    oldLayout: 0,
    shapes: { A: ['A  ', 'A  ', 'A  '], B: ['   B', '   B', '   B'] },
  }));
  assert.strictEqual(flfRender(f, 'AB').rows[0], 'A  B');
});

check('a narrow glyph kerns deep into a wide gap', () => {
  const f = parseFlf(makeFlf({
    oldLayout: 0,
    shapes: { A: ['AA   ', 'AA   ', 'AA   '], B: ['B', 'B', 'B'] },
  }));
  assert.strictEqual(flfRender(f, 'AB').rows[0], 'AAB');
});

check('kerning stops at the first row that would collide', () => {
  const f = parseFlf(makeFlf({
    oldLayout: 0,
    shapes: { A: ['A  ', 'AA ', 'A  '], B: ['  B', ' BB', '  B'] },
  }));
  // The middle row only has two spaces between inks, so only two close.
  assert.strictEqual(flfRender(f, 'AB').rows[1], 'AABB');
});

check('the fullLayout field wins over the old one where both exist', () => {
  // Old field says smush, new field says kern: the new field is believed.
  const f = parseFlf(makeFlf({ oldLayout: 15, fullLayout: 64 }));
  assert.strictEqual(f.layout.mode, 'kern');
});

console.log('smushing, the six controlled rules');

const smushFont = (shapes) => parseFlf(makeFlf({
  oldLayout: 63, fullLayout: 128 + 63, shapes,
}));

check('rule 1: equal characters merge', () => {
  const f = smushFont({ l: COL('|'), r: COL('|') });
  assert.strictEqual(flfRender(f, 'lr').rows[0], '|');
});

check('rule 2: an underscore gives way to a border', () => {
  const f = smushFont({ u: COL('_'), p: COL('|') });
  assert.strictEqual(flfRender(f, 'up').rows[0], '|');
});

check('rule 3: the later border class wins', () => {
  const f = smushFont({ p: COL('|'), s: COL('/') });
  assert.strictEqual(flfRender(f, 'ps').rows[0], '/');
});

check('rule 4: opposite brackets close into a bar', () => {
  const f = smushFont({ a: COL('['), b: COL(']') });
  assert.strictEqual(flfRender(f, 'ab').rows[0], '|');
});

check('rule 5: crossing diagonals', () => {
  const f = smushFont({
    a: COL('/'), b: COL('\\'), c: COL('>'), d: COL('<'),
  });
  assert.strictEqual(flfRender(f, 'ab').rows[0], '|');
  assert.strictEqual(flfRender(f, 'ba').rows[0], 'Y');
  assert.strictEqual(flfRender(f, 'cd').rows[0], 'X');
});

check('rule 6: two hardblanks survive as one', () => {
  const f = smushFont({ a: COL('$'), b: COL('$') });
  // The hardblank pair smushes to a hardblank, which prints as a space —
  // but it held the column open: the glyphs did not vanish into nothing.
  const { rows } = flfRender(f, 'ab');
  assert.strictEqual(rows[0], '');
  const g = smushFont({ a: ['x$', 'x$', 'x$'], b: ['$y', '$y', '$y'] });
  assert.strictEqual(flfRender(g, 'ab').rows[0], 'x y');
});

check('characters that no rule covers do not overlap', () => {
  const f = smushFont({ a: COL('#'), b: COL('%') });
  assert.strictEqual(flfRender(f, 'ab').rows[0], '#%');
});

check('universal smushing: the later glyph paints over the earlier', () => {
  const f = parseFlf(makeFlf({
    fullLayout: 128,   // smushing, no rules: universal
    shapes: { a: COL('#'), b: COL('%') },
  }));
  assert.strictEqual(flfRender(f, 'ab').rows[0], '%');
});

console.log('setting type');

check('the hardblank prints as a space but is never smushed away', () => {
  const f = parseFlf(makeFlf({
    oldLayout: 0,
    shapes: { a: ['a$ ', 'a$ ', 'a$ '], b: ['b', 'b', 'b'] },
  }));
  // Kerning may close the real space, but not the hardblank.
  assert.strictEqual(flfRender(f, 'ab').rows[0], 'a b');
});

check('characters the font lacks come out as spaces, and are named', () => {
  const f = parseFlf(makeFlf());
  const { rows, unknown } = flfRender(f, 'A€B');
  assert.strictEqual(rows[0], 'AA  BB');
  assert.deepStrictEqual([...unknown], ['€']);
});

check('lines wrap to the paper at spaces, like the drawn faces do', () => {
  const f = parseFlf(makeFlf());
  const { lines } = flfLetter(f, 'AB CD', { maxCols: 6 });
  // Each word is 4 wide plus a 2-wide space: together 10, so they wrap.
  assert.strictEqual(lines.length, 6);
  assert.ok(lines[0].startsWith('AABB'));
  assert.ok(lines[3].startsWith('CCDD'));
});

check('a blank input line is a full-height gap', () => {
  const f = parseFlf(makeFlf());
  const { lines } = flfLetter(f, 'A\n\nB');
  assert.strictEqual(lines.length, 9);
  assert.ok(!lines[3].trim() && !lines[4].trim() && !lines[5].trim());
});

check('flfMarks reports every character the font might strike', () => {
  const f = parseFlf(makeFlf({ shapes: { A: ['/\\', '$.', '--'] } }));
  const marks = flfMarks(f);
  assert.ok(marks.has('/') && marks.has('\\') && marks.has('.'));
  assert.ok(!marks.has('$'), 'the hardblank is not a mark');
  assert.ok(!marks.has(' '), 'space is not a mark');
});

console.log('meeting the machine');

check('an imported font goes through the same stand-ins as everything else', () => {
  const sm7 = profileById('olympia-sm7');
  const f = parseFlf(makeFlf({ shapes: { A: ['^^', '||', '^^'] } }));
  const { lines } = flfLetter(f, 'A');
  const chars = new Set(lines.join('').replace(/ /g, ''));
  const { swaps, missing } = standIns(chars, { have: new Set(charset(sm7)) });
  assert.strictEqual(swaps.get('^'), '´', 'the caret found no stand-in');
  assert.strictEqual(swaps.get('|'), '!', 'the pipe found no stand-in');
  assert.deepStrictEqual(missing, []);
});

process.exit(failures ? 1 : 0);
