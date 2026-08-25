/**
 * The command line, driven the way an agent or a script drives it.
 *
 * Unit tests cover the pipeline; this covers the contract around it — that
 * `--json` really is parseable JSON, that a failure says so in the same
 * shape as a success rather than dying with a stack trace on stdout, and
 * that a wrong machine name is caught before it becomes an obscure error
 * three functions later. A tool other programs call has to be predictable
 * when it is unhappy, not only when it is happy.
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

const CLI = path.join(import.meta.dirname, '..', 'tools', 'cli.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typewriter-cli-'));

/** Run the CLI and hand back stdout plus the exit code, never throwing. */
function run(...argv) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...argv],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

const json = (r) => {
  try { return JSON.parse(r.out); }
  catch { throw new Error(`not JSON:\n${r.out.slice(0, 400)}`); }
};

/*
 * A drawing, written as a real PNG.
 *
 * `block` is what separates the two cases these tests need. A solid shape
 * survives any amount of blurring, so a picture containing one can never go
 * blank — which makes it useless for testing the failure and ideal for
 * testing the success.
 */
function drawing(file, { line = 3, block = true, negative = false } = {}) {
  const W = 300, H = 300;
  const px = new Uint8Array(W * H).fill(negative ? 0 : 255);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ring = Math.abs(Math.hypot(x - 150, y - 150) - 100) < line / 2;
      const solid = block && x > 40 && x < 110 && y > 40 && y < 110;
      if (ring || solid) px[y * W + x] = negative ? 255 : 0;
    }
  }
  const raw = Buffer.alloc(H * (W + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = px[y * W + x];
  }
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc = (b) => {
    let c = -1;
    for (const v of b) c = table[(c ^ v) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (t, b) => {
    const o = Buffer.alloc(b.length + 12);
    o.writeUInt32BE(b.length, 0);
    o.write(t, 4, 'latin1');
    b.copy(o, 8);
    o.writeUInt32BE(crc(o.subarray(4, 8 + b.length)), 8 + b.length);
    return o;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))]));
  return file;
}

const picture = drawing(path.join(dir, 'motif.png'));

console.log('turning a picture into keystrokes');

check('a picture comes out as something to type', () => {
  const r = run('image', picture, '--mode', 'tone', '--contrast', '110',
    '--detail', '80', '--width', '40', '--json');
  const o = json(r);
  assert.strictEqual(o.ok, true);
  assert.ok(o.keystrokes.total > 0, 'nothing to type');
  assert.ok(o.lines.some((l) => l.trim()), 'every line is blank');
  assert.ok(o.size.width <= 40, `${o.size.width} columns, asked for 40`);
});

check('only characters the machine actually has', () => {
  const o = json(run('image', picture, '--mode', 'tone', '--contrast', '110',
    '--detail', '80', '--machine', 'olympia-sm7', '--json'));
  const typed = new Set([...o.lines.join('')].filter((c) => c !== ' '));
  // The SM7 has no zero — you type a capital O. A picture that asks for one
  // is a picture nobody can type, and the whole point of choosing a machine
  // is that the output stays inside its keyboard.
  assert.ok(!typed.has('0'), 'typed a zero, which the SM7 has not got');
  assert.ok(typed.size > 0, 'nothing was typed at all');
});

check('and that holds for a picture spelled out in words', () => {
  /*
   * The one path that used to go straight to the sheet. A sentence was
   * typed exactly as given, so a single `}` — which the SM7 has not got —
   * spelled an entire motif and nothing anywhere said so. It is the same
   * promise as above and it was broken in the one place nobody had wired
   * the stand-in engine to.
   */
  const o = json(run('image', picture, '--mode', 'sentence',
    '--sentence', 'hello}world', '--machine', 'olympia-sm7', '--json'));
  const typed = new Set([...o.lines.join('')].filter((c) => c !== ' '));
  assert.ok(typed.size > 0, 'nothing was typed at all');
  assert.ok(!typed.has('}'), 'typed a brace, which the SM7 has not got');
  assert.ok(typed.has(')'), 'the brace was dropped rather than stood in for');
});

check('the case belongs to the picture, until --exact-case takes it back', () => {
  /*
   * Case is the only shading one repeating sentence has to give, so by
   * default the picture picks it, cell by cell, from how dark that part of
   * it is. That is a liberty taken with what was typed - a name, an
   * initial, a German noun - and this is the flag that takes it back.
   */
  const args = ['image', picture, '--mode', 'sentence',
    '--sentence', 'Ada Lovelace', '--machine', 'olympia-sm7', '--json'];
  const written = new Set([...'Ada Lovelace']);
  const struck = (r) => [...json(r).lines.join('')].filter((c) => c !== ' ');

  const shaded = struck(run(...args));
  assert.ok(shaded.length > 0, 'nothing was typed at all');
  assert.ok(shaded.some((c) => !written.has(c)),
    'the picture shaded nothing, so there was nothing to take back');

  const exact = struck(run(...args, '--exact-case'));
  assert.ok(exact.length > 0, 'nothing was typed at all');
  const invented = exact.filter((c) => !written.has(c));
  assert.strictEqual(invented.join(''), '',
    'letters were struck in a case nobody typed');
});

check('a sentence with nothing typeable in it is refused, not drawn', () => {
  // There is then nothing to spell the picture with, and a sheet of
  // characters the machine cannot strike is the one outcome this whole
  // program exists to prevent.
  const r = run('image', picture, '--mode', 'sentence',
    '--sentence', '▓▒░', '--machine', 'olympia-sm7', '--json');
  const o = json(r);
  assert.strictEqual(o.ok, false);
  assert.ok(/nothing to spell/i.test(o.error), o.error);
});

check('the setup is reported, not just the art', () => {
  const o = json(run('image', picture, '--mode', 'tone', '--contrast', '110',
    '--detail', '80', '--json'));
  assert.ok(Number.isFinite(o.setup.left), 'no margin stop');
  assert.ok(o.instructions.length > 0, 'no instructions');
  assert.ok(o.instructions.every((i) => i.heading && i.body));
});

console.log('saying what went wrong');

check('a missing file is a message, not a stack trace', () => {
  const r = run('image', path.join(dir, 'nope.png'), '--json');
  assert.strictEqual(r.code, 1);
  const o = json(r);
  assert.strictEqual(o.ok, false);
  assert.match(o.error, /no such file/);
});

check('a JPEG is turned away with the fix in the message', () => {
  const jpg = path.join(dir, 'photo.jpg');
  fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]));
  const o = json(run('image', jpg, '--json'));
  assert.strictEqual(o.ok, false);
  assert.match(o.error, /PNG/);
});

check('an unknown machine is caught at the door', () => {
  const o = json(run('image', picture, '--machine', 'smith-corona-9000', '--json'));
  assert.strictEqual(o.ok, false);
  assert.match(o.error, /machines/);
});

check('a mode that does not exist lists the ones that do', () => {
  const o = json(run('image', picture, '--mode', 'stipple', '--json'));
  assert.strictEqual(o.ok, false);
  assert.match(o.error, /shape/);
});

check('a slider given a word is rejected, not read as zero', () => {
  // Silently defaulting is how a caller ends up debugging the picture when
  // the problem is the argument.
  const o = json(run('image', picture, '--contrast', 'high', '--json'));
  assert.strictEqual(o.ok, false);
  assert.match(o.error, /number/);
});

console.log('inspecting the pipeline');

check('every step is reported, in order, with what it did', () => {
  const o = json(run('inspect', picture, '--json'));
  assert.strictEqual(o.ok, true);
  assert.deepStrictEqual(o.stages.map((s) => s.stage),
    ['ink', 'blur', 'normalise', 'contrast', 'crop']);
  assert.ok(o.stages.every((s) => typeof s.max === 'number'));
  assert.ok(o.grid.cols > 0 && o.grid.rows > 0);
});

check('a hairline drawing is not lost on the way to the characters', () => {
  // The failure this command was written for. Hairline contours at 171%
  // contrast and 44% detail used to arrive as an empty field and report a
  // motif "0 x 40" — a blank sheet with no indication why.
  const hairline = drawing(path.join(dir, 'hairline.png'),
    { line: 2, block: false });
  const o = json(run('inspect', hairline, '--contrast', '171', '--detail', '44',
    '--json'));
  assert.ok(o.cells.inked > 0, 'the drawing was erased again');
  assert.ok(o.result.keystrokes > 0, 'nothing to type');
  assert.strictEqual(o.strokes.lineArt, true, 'not recognised as a drawing');
  assert.ok(o.strokes.width > 0, 'no stroke width measured');
});

check('a sheet that is nearly all ink is reported, not quietly returned', () => {
  // The failure that looks like success. A negative nobody turned round
  // produces a full page of the heaviest character, which no typewriter can
  // put on paper — and unlike a blank sheet it reads as having worked.
  const neg = drawing(path.join(dir, 'negative.png'), { negative: true });
  const o = json(run('inspect', neg, '--invert', 'no', '--json'));
  assert.ok(o.cells.inked / o.cells.total > 0.8, 'expected a wall of ink');
  assert.ok(o.findings.some((f) => /invert/.test(f)),
    `a full sheet of ink went unremarked:\n${o.findings.join('\n')}`);
});

check('writing a drawing in words explains itself when it cannot', () => {
  // Sentence mode fills areas; a hairline has none. Without this the report
  // says "301 cells inked" and the sheet shows four letters.
  const hair = drawing(path.join(dir, 'thin.png'), { line: 2, block: false });
  const o = json(run('inspect', hair, '--mode', 'sentence', '--json'));
  if (o.result.keystrokes < o.cells.inked * 0.5) {
    assert.ok(o.findings.some((f) => /fills areas/.test(f)),
      `no explanation offered:\n${o.findings.join('\n')}`);
  }
});

check('a picture with nothing in it says so', () => {
  const blank = path.join(dir, 'blank.png');
  drawing(blank, { line: 0, block: false });
  const o = json(run('inspect', blank, '--json'));
  assert.strictEqual(o.cells.inked, 0);
  assert.ok(o.findings.some((f) => /no ink/i.test(f)),
    `an empty picture was not diagnosed:\n${o.findings.join('\n')}`);
});

check('a healthy picture is not reported as broken', () => {
  const o = json(run('inspect', picture, '--contrast', '110', '--detail', '80',
    '--json'));
  assert.ok(o.cells.inked > 0, 'nothing survived a picture that should work');
  assert.ok(!o.findings.some((f) => /empties the page/.test(f)),
    `a working picture was diagnosed as broken:\n${o.findings.join('\n')}`);
});

check('the prepared picture can be written out to look at', () => {
  const out = path.join(dir, 'prepared.png');
  run('inspect', picture, '--preview', out, '--contrast', '110', '--json');
  assert.ok(fs.existsSync(out), 'no preview written');
  assert.ok(fs.readFileSync(out).length > 8, 'preview is empty');
});

console.log('the older commands still work');

check('lettering a word', () => {
  const o = json(run('text', 'HI', '--json'));
  assert.strictEqual(o.ok, true);
  assert.ok(o.keystrokes.total > 0);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
