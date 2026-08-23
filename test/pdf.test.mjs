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

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
