/**
 * PDF output.
 *
 * A malformed PDF often still opens in one reader and fails in another, so
 * these check the structure explicitly rather than trusting that it "looked
 * fine".
 */
import assert from 'node:assert';
import { buildSheetPdf } from '../src/core/pdf.js';
import { runsOf, colourMap, inkTally } from '../src/core/runs.js';
import { paperById, setUp } from '../src/core/machine.js';
import { profileById } from '../src/profiles/index.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

const m = profileById('olympia-sm7');
const paper = paperById('a4');

function make(lines, opt = {}) {
  const colours = colourMap(lines, { rows: opt.red ?? [] });
  const width = Math.max(0, ...lines.map((l) => l.length));
  return buildSheetPdf({
    lines, colours, paper, machine: m,
    setup: setUp(width, lines.length, paper, m, 'centre'),
    instructions: [['Left margin stop to 34', 'The carriage returns here.']],
    tally: inkTally(lines, colours),
    runsOf, title: 'Test',
  });
}

console.log('pdf');

check('starts with a header and ends with the trailer', () => {
  const s = make(['abc']);
  assert.ok(s.startsWith('%PDF-'), 'no header');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'no EOF marker');
});

check('the cross-reference offset really points at the table', () => {
  // Readers use this to find every object. Off by one byte and the file is
  // broken, even though it may still open in a forgiving viewer.
  const s = make(['abc', 'def']);
  const at = +s.match(/startxref\s+(\d+)/)[1];
  assert.strictEqual(s.slice(at, at + 4), 'xref', 'startxref is wrong');
});

check('every object offset in the table is correct', () => {
  const s = make(['hello', '  world']);
  const at = +s.match(/startxref\s+(\d+)/)[1];
  const table = s.slice(at).split('\n');
  const count = +table[1].split(' ')[1];
  for (let i = 1; i < count; i++) {
    const off = +table[2 + i].slice(0, 10);
    assert.ok(s.startsWith(`${i} 0 obj`, off),
      `object ${i} is not at offset ${off}`);
  }
});

check('object count in the trailer matches reality', () => {
  const s = make(['x']);
  const declared = +s.match(/\/Size (\d+)/)[1];
  const actual = (s.match(/^\d+ 0 obj$/gm) ?? []).length;
  assert.strictEqual(declared, actual + 1, 'Size disagrees with the objects');
});

check('long motifs spill onto extra pages', () => {
  const short = make(['a']);
  const long = make(Array.from({ length: 120 }, (_, i) => 'x'.repeat(20 + i % 5)));
  const pages = (s) => +s.match(/\/Count (\d+)/)[1];
  assert.ok(pages(long) > pages(short), `${pages(long)} vs ${pages(short)}`);
});

check('red lines are drawn in red, not black', () => {
  const plain = make(['abc']);
  const red = make(['abc'], { red: [0] });
  assert.ok(!/rg/.test(plain) || !plain.includes('0.66 0.20 0.16 rg'));
  assert.ok(red.includes('0.66 0.20 0.16 rg'), 'no red fill colour emitted');
});

check('accented characters become octal escapes, not literals', () => {
  const s = make(['\u00c4\u00d6\u00dc\u00df']);
  assert.ok(s.includes('\\304'), 'A-umlaut not encoded');
  assert.ok(!s.includes('\\\\304'), 'escape was escaped twice');
});

check('brackets and backslashes in the art do not corrupt the file', () => {
  // These three characters end a PDF string early if not escaped, which
  // silently truncates the page.
  const s = make(['( ) \\ ( )']);
  const at = +s.match(/startxref\s+(\d+)/)[1];
  assert.strictEqual(s.slice(at, at + 4), 'xref');
  assert.ok(s.includes('\\(') && s.includes('\\)'), 'brackets not escaped');
});

check('an empty motif still produces a valid file', () => {
  const s = make([]);
  assert.ok(s.startsWith('%PDF-'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
});

check('declared stream lengths match the actual streams', () => {
  const s = make(['abc', '  d']);
  const re = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let mm, n = 0;
  while ((mm = re.exec(s))) {
    assert.strictEqual(mm[2].length, +mm[1], `stream ${n} length is wrong`);
    n++;
  }
  assert.ok(n > 0, 'no streams found');
});

check('the ruled page is numbered in the machine\'s own scale', () => {
  /*
   * The ruler used to count the motif — 5, 10, 15 from the first character
   * — while the scale drawn above the sheet on screen counts the carriage.
   * Two rulers over the same row of cells, giving a different number for
   * the same box, and the one on paper is the one you have at the machine.
   *
   * The carriage wins because its numbers are engraved on the machine:
   * reading 34 off the page and finding 34 on the carriage is one action.
   */
  const lines = ['x'.repeat(30)];
  const s = make(lines);
  const setup = setUp(30, 1, paper, m, 'centre');

  // Every number drawn on the ruled page, in the order it was written.
  const drawn = [...s.matchAll(/\((\d+)\) Tj/g)].map((x) => +x[1]);
  assert.ok(drawn.includes(setup.left),
    `the left stop ${setup.left} is not on the ruler: ${drawn.join(' ')}`);
  assert.ok(drawn.includes(setup.right),
    `the right stop ${setup.right} is not on the ruler: ${drawn.join(' ')}`);

  // Nothing between the stops that is not a carriage ten, and nothing
  // outside them at all — a motif column number would be both.
  const ruler = drawn.filter((n) => n !== 1 && n <= setup.right);
  for (const n of ruler) {
    assert.ok(n === setup.left || n === setup.right || n % 10 === 0,
      `${n} is neither a stop nor a ten of the carriage scale`);
    assert.ok(n >= setup.left && n <= setup.right,
      `${n} is outside the stops ${setup.left}..${setup.right}`);
  }
});

check('two numbers on the ruler never overlap', () => {
  /*
   * The stop and the nearest ten can fall within a cell or two of each
   * other, and `50` printed over `56` is worse than either alone. The stop
   * is the instruction, so where only one of the two fits it is the stop
   * that stays — the same rule the on-screen scale applies in characters.
   *
   * Measured off the drawn positions rather than counted in cells: the
   * page decides this in millimetres, from the cell width and the label
   * size, and re-deriving that arithmetic here would only test that the
   * copy matches itself. Helvetica advances 0.5 em, which is what the
   * ruler is set in.
   */
  const drawnLabels = (s) =>
    [...s.matchAll(/\/F1 ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((\d+)\) Tj/g)]
      .map((x) => ({
        size: +x[1], x: +x[2], y: +x[3], text: x[4],
        get end() { return this.x + this.text.length * this.size * 0.5; },
      }));

  for (const w of [12, 23, 30, 47, 66]) {
    const s = make(['x'.repeat(w)]);
    const setup = setUp(w, 1, paper, m, 'centre');

    // The ruler rows are the ones carrying several numbers; a line number
    // sits alone on its own baseline.
    const rows = new Map();
    for (const l of drawnLabels(s)) {
      if (!rows.has(l.y)) rows.set(l.y, []);
      rows.get(l.y).push(l);
    }
    const rulers = [...rows.values()].filter((r) => r.length > 1);
    assert.ok(rulers.length >= 2, `motif ${w}: no ruler rows found`);

    for (const row of rulers) {
      row.sort((a, b) => a.x - b.x);
      const seen = row.map((l) => l.text);
      assert.ok(seen.includes(String(setup.left))
        && seen.includes(String(setup.right)),
        `motif ${w}: a stop was dropped — ${seen.join(' ')}`);
      for (let i = 1; i < row.length; i++) {
        assert.ok(row[i].x >= row[i - 1].end,
          `motif ${w}: "${row[i - 1].text}" ends at ${row[i - 1].end.toFixed(1)} ` +
          `and "${row[i].text}" starts at ${row[i].x.toFixed(1)}`);
      }
    }
  }
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
