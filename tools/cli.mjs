#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Same modules as the web app — this is a second door into one codebase, not
 * a second implementation. Useful for scripting, for agents, and for anyone
 * who would rather not open a browser.
 *
 * Pictures work here now. They did not, and the reason given was that
 * measuring glyph shapes needs a canvas. True, but it only rules out one of
 * the four styles: `tableAtlas()` carries the measured weights without a
 * canvas, which covers tone, outline and sentence, and `--atlas` takes a
 * measured one for shape. Leaving the whole picture path out meant the part
 * most likely to go wrong was the part with no way to look at it.
 *
 *   node tools/cli.mjs image rose.png --mode tone --pdf out.pdf
 *   node tools/cli.mjs inspect rose.png            # why is it blank?
 *   node tools/cli.mjs image rose.png --json       # for scripts and agents
 *   node tools/cli.mjs text "HELLO" --style outline
 *   node tools/cli.mjs machines
 */

import fs from 'node:fs';
import { PROFILES, profileById } from '../src/profiles/index.js';
import {
  makeTypeable, PAPERS, paperById, setUp, charset, textArea, landscape,
  sheetGrid,
} from '../src/core/machine.js';
import { colourMap, inkTally, parseRows, runsOf, runsToText } from '../src/core/runs.js';
import { letter, tonesOf, marksMissing, STYLES } from '../src/core/lettering.js';
import { toneRamp } from '../src/core/ink.js';
import { buildSheetPdf } from '../src/core/pdf.js';
import { tableAtlas } from '../src/core/glyphs.js';
import {
  prepare, fitGrid, toCharacters, toSentence, cellAspect, keystrokes,
} from '../src/core/convert.js';
import { readImage, scaleTo, encodeField } from './png.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

/** Read `--name value` and `--flag`. */
function opt(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

/** A `--name` that must carry a number, so a typo is not silently a default. */
function num(name, fallback) {
  const v = opt(name);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`--${name} wants a number, got "${v}".`);
  return n;
}

const JSON_OUT = Boolean(opt('json'));

function die(msg) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(msg);
  process.exit(1);
}

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(`typewriter-ascii

  image <path>    turn a picture into something typeable  (PNG)
  inspect <path>  report what each step of the picture pipeline did
  file <path>     lay out an existing piece of ASCII art
  text <word>     render a word as letters
  machines        list machine profiles
  papers          list paper sizes

options
  --machine <id>  default olympia-sm7
  --paper <id>    default a4
  --align <centre|topleft>
  --orientation <upright|sideways>   which way the sheet goes in
  --red <lines>   e.g. 0-15,20 — put these lines on the red ribbon
  --style <id>    for 'text'; \\n in the word starts a second line
  --pdf <path>    also write a printable PDF
  --json          machine-readable output on stdout
  --quiet         only the setup summary

pictures
  --mode <shape|tone|outline|sentence>   default shape
  --contrast <50…300>    default 130, as the slider
  --detail <0…100>       default 45, as the slider
  --invert <auto|no|yes> default auto
  --width <n>            columns, default 60, capped by the edge of the sheet
  --sentence "<text>"    for --mode sentence
  --atlas <path.json>    measured glyph shapes, for --mode shape
  --preview <path.png>   write the prepared image, to see what was fed in
`);
  process.exit(0);
}

if (cmd === 'machines') {
  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok: true,
      machines: PROFILES.map((p) => ({
        id: p.id, name: p.name, cpi: p.cpi, lpi: p.lpi ?? null,
        twoColour: p.twoColour !== false,
        characters: charset(p).join(''),
      })),
    }, null, 2));
  } else {
    for (const p of PROFILES) {
      console.log(`${p.id.padEnd(22)} ${p.name}  ${p.cpi} cpi  ` +
        `${charset(p).length} characters`);
    }
  }
  process.exit(0);
}

if (cmd === 'papers') {
  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok: true,
      papers: PAPERS.map((p) => ({
        id: p.id, name: p.name, width: p.w, height: p.h, margin: p.margin,
      })),
    }, null, 2));
  } else {
    for (const p of PAPERS) {
      console.log(`${p.id.padEnd(12)} ${p.name}  ${p.w}×${p.h} mm`);
    }
  }
  process.exit(0);
}

/*
 * profileById() and paperById() fall back to the first entry rather than
 * failing, which is right for the page — a stored id from an older version
 * should not leave someone staring at a broken screen. On a command line it
 * is the opposite: a typo would quietly lay the art out for a machine the
 * caller never asked for, and the output looks perfectly reasonable. So the
 * id is checked here rather than the fallback being changed underneath the
 * app.
 */
const machineId = String(opt('machine', 'olympia-sm7'));
if (!PROFILES.some((p) => p.id === machineId)) {
  die(`No machine called "${machineId}". Try: cli.mjs machines`);
}
const machine = profileById(machineId);

const paperId = String(opt('paper', 'a4'));
if (!PAPERS.some((p) => p.id === paperId)) {
  die(`No paper called "${paperId}". Try: cli.mjs papers`);
}
const paper = paperById(paperId);

const align = opt('align', 'centre');

/*
 * Which way the sheet goes is stated, not worked out.
 *
 * `--landscape` used to mean "turn it if that comes out shorter", so the
 * same command could produce an upright sheet or a turned one depending on
 * the motif — and the column ceiling moved with it. Now it is a choice, and
 * the old flag is the obvious shorthand for having made it.
 */
const orientation = String(opt('orientation', opt('landscape') ? 'sideways' : 'upright'));
if (!['upright', 'sideways'].includes(orientation)) {
  die(`--orientation wants upright or sideways — got "${orientation}".`);
}
const sheet = orientation === 'sideways' ? landscape(paper) : paper;

/* ── pictures ────────────────────────────────────────────────── */

/** Below this a cell is left blank — bestChar's emptyBelow. */
const BLANK = 0.04;

/** What toSentence() needs before it will put a letter in a cell. */
const SENTENCE_INK = 0.35;

const MODES = ['shape', 'tone', 'outline', 'sentence'];

function loadPicture(path) {
  if (!path) die('Which picture? Give me a path to a PNG.');
  let buf;
  try {
    buf = fs.readFileSync(path);
  } catch (e) {
    die(`Cannot read ${path}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
  try {
    // Shrunk to the same working size the page uses. The blur radius
    // downstream is counted in pixels of this image, so the size has to
    // match or the two doors give different pictures.
    return scaleTo(readImage(buf, path), 900);
  } catch (e) {
    return die(e.message);
  }
}

/** How wide the motif may be, and how much paper there is for it. */
function picturePaper() {
  // The margins are where the motif normally sits; the edge of the paper is
  // the only hard stop. Asking for more than the margins hold is a note from
  // setUp(), not a refusal, so the ceiling here is the sheet.
  const room = textArea(sheet, machine);
  const edge = sheetGrid(sheet, machine);
  return { room, maxCols: Math.min(num('width', 60), edge.cols) };
}

/**
 * The glyph atlas, and an honest account of what it can do.
 *
 * Shape matching needs rendered glyphs. Without a canvas there are none, so
 * `--mode shape` quietly becoming a tone match would be the worst outcome:
 * plausible output, wrong reason. Either take a measured atlas from
 * `--atlas`, or say what happened.
 */
function pictureAtlas() {
  const path = opt('atlas');
  if (typeof path !== 'string') return tableAtlas(charset(machine));

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    return die(`Cannot read the atlas at ${path}: ${e.message}`);
  }
  if (!Array.isArray(raw?.glyphs) || !raw.glyphs.length) {
    die(`${path} is not a glyph atlas — expected a "glyphs" array. ` +
        `Make one with tools/atlas.html.`);
  }

  const glyphs = raw.glyphs.map((g) => ({
    ...g, shape: Float32Array.from(g.shape ?? []),
  }));
  // Histograms are a fixed size. A shorter one compares against whatever
  // happens to be there and matches badly for reasons no caller could guess,
  // so the size is checked rather than trusted.
  const want = Math.max(...glyphs.map((g) => g.shape.length));
  const ragged = glyphs.find((g) => g.ink > 0 && g.shape.length !== want);
  if (ragged) {
    die(`The atlas at ${path} is damaged: "${ragged.ch}" carries ` +
        `${ragged.shape.length} shape bins where the rest carry ${want}.`);
  }

  return {
    ...raw,
    glyphs,
    maxCoverage: raw.maxCoverage || Math.max(...glyphs.map((g) => g.coverage)),
    hasShapes: glyphs.some((g) => g.ink > 0),
  };
}

/** Every picture setting, read once, so image and inspect cannot disagree. */
function pictureSettings() {
  const mode = String(opt('mode', 'shape'));
  if (!MODES.includes(mode)) {
    die(`--mode wants one of ${MODES.join(', ')} — got "${mode}".`);
  }
  const invert = String(opt('invert', 'auto'));
  if (!['auto', 'no', 'yes'].includes(invert)) {
    die(`--invert wants auto, no or yes — got "${invert}".`);
  }
  const { room, maxCols } = picturePaper();
  return {
    mode,
    room,
    maxCols,
    invert: invert === 'auto' ? 'auto' : invert === 'yes',
    detail: num('detail', 45) / 100,
    contrast: num('contrast', 130) / 100,
    sentence: String(opt('sentence', 'she loved him and he loved her')),
  };
}

/** Mean ink per cell, on the grid the machine will actually type. */
function cellTones(field, cols, rows) {
  const cw = field.w / cols;
  const ch = field.h / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y++) {
        for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) {
          sum += field.data[y * field.w + x]; n++;
        }
      }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}

/**
 * Run the picture pipeline and hand back the characters plus everything
 * worth knowing about how they were arrived at.
 */
function convertPicture(path) {
  const img = loadPicture(path);
  const set = pictureSettings();
  const atlas = pictureAtlas();

  const stages = [];
  const { field, inverted, radius, strokes, lineArt } = prepare(img, {
    ...set,
    onStage(name, f, extra) {
      let max = 0, sum = 0, lit = 0;
      for (const v of f.data) {
        if (v > max) max = v;
        sum += v;
        if (v > BLANK) lit++;
      }
      stages.push({
        stage: name,
        width: f.w,
        height: f.h,
        max: +max.toFixed(4),
        mean: +(sum / f.data.length).toFixed(5),
        inked: +(lit / f.data.length).toFixed(5),
        ...extra,
      });
    },
  });

  const grid = fitGrid(set.maxCols, set.room.rows, field.w, field.h,
                       cellAspect(machine));
  const tones = cellTones(field, grid.cols, grid.rows);
  const live = tones.filter((t) => t >= BLANK).length;
  // Sentence mode fills areas rather than following lines, and asks a good
  // deal more of a cell than the blank threshold does.
  const dark = tones.filter((t) => t >= SENTENCE_INK).length;

  // Shape matching without rendered glyphs is a tone match wearing a
  // different name. Say which one actually ran.
  const wantsShape = set.mode !== 'tone' && set.mode !== 'sentence';
  const fellBack = wantsShape && !atlas.hasShapes;
  const notes = [];
  if (fellBack) {
    notes.push(
      `No glyph shapes available without a canvas, so "${set.mode}" matched ` +
      `by tone instead. Pass --atlas <file.json> for a measured atlas.`);
  }
  if (inverted) {
    notes.push('The picture read as mostly ink, so it was treated as a ' +
               'negative and flipped. Use --invert no to stop that.');
  }

  let lines;
  if (set.mode === 'sentence') {
    lines = toSentence(field, grid.cols, grid.rows, set.sentence);
  } else {
    const render = set.mode === 'tone' || fellBack ? 'tone' : 'shape';
    lines = toCharacters(field, grid.cols, grid.rows, atlas, {
      mode: render,
      allowed: new Set(charset(machine)),
      toneWeight: set.mode === 'tone' ? 1 : 0.35,
    });
  }

  const preview = opt('preview');
  if (typeof preview === 'string') {
    fs.writeFileSync(preview, encodeField(field));
    notes.push(`Wrote the prepared picture to ${preview}.`);
  }

  return { lines, stages, grid, live, dark, cells: grid.cols * grid.rows,
           set, atlas, inverted, radius, strokes, lineArt, notes, source: img };
}

/**
 * Say where the picture was lost.
 *
 * This is the command that would have saved an afternoon: a blank sheet is
 * not a bad character match, it is ink that stopped existing at some step,
 * and the only question worth answering is which one.
 */
function diagnose(run) {
  const { stages, live } = run;
  const struck = keystrokes(run.lines);
  const found = [];

  /*
   * Sentence mode has a threshold of its own, well above the one that
   * decides whether a cell is blank. A picture can clear the second and
   * fail the first, and then "inked cells" says one thing and the near-empty
   * sheet says another — which is worse than either number alone.
   *
   * It is not really a fault. Writing a picture in words fills *areas*, and
   * a drawing made of hairlines has no area: a two-pixel stroke crossing a
   * fifteen-pixel cell leaves that cell seven-eighths paper. Better to say
   * so than to let it look like a bug.
   */
  if (run.set.mode === 'sentence' && struck < live * 0.5) {
    found.push(`${live} cells carry ink but only ${run.dark} are dark enough ` +
      `to hold a letter, so ${struck} were typed. Writing a picture in words ` +
      `fills areas, and needs ${SENTENCE_INK} ink per cell against the ` +
      `${BLANK} that merely counts as marked — a drawing made of thin lines ` +
      `leaves every cell mostly paper. Try --mode outline, or a heavier ` +
      `picture.`);
  }

  if (live === 0) {
    const at = stages.findIndex((s, i) => i > 0 && s.max < BLANK
      && stages[i - 1].max >= BLANK);
    if (at > 0) {
      found.push(`Nothing survives "${stages[at].stage}": the strongest ink ` +
        `in the picture goes from ${stages[at - 1].max} to ${stages[at].max}, ` +
        `and anything under ${BLANK} is left blank. That step is what ` +
        `empties the page.`);
    } else {
      found.push('There is no ink in this picture at any step — check the ' +
        'file, and --invert if the drawing is light on a dark ground.');
    }
  }

  /*
   * Too much ink is a failure too, and it used to go unremarked.
   *
   * A typewriter physically cannot fill a sheet. A picture that arrives as a
   * solid wall of the heaviest character is a negative that was not turned
   * round — and unlike a blank page it looks like it worked, right up until
   * someone sits down to type two thousand strikes of `B`.
   */
  if (run.cells && live / run.cells > 0.8) {
    found.push(`${live} of ${run.cells} cells are inked — nearly the whole ` +
      `sheet, which is ${struck} keystrokes and not something a typewriter ` +
      `can do. ${run.inverted
        ? 'The picture was already flipped once; try --invert no.'
        : 'This is usually a light drawing on a dark ground: try --invert yes.'}`);
  }

  const at = (name) => stages.find((s) => s.stage === name);
  const ink = at('ink');
  const blurred = at('blur');
  const norm = at('normalise');
  const con = at('contrast');

  // A heavy blur is right for photographs and wrong for line art: it is the
  // one setting that can thin a drawing to nothing before anything else
  // gets a look at it.
  if (ink && blurred && ink.max > 0 && blurred.max < ink.max * 0.5) {
    found.push(`The blur takes the strongest ink from ${ink.max} down to ` +
      `${blurred.max} — the strokes measure ${run.strokes.width.toFixed(1)} px ` +
      `against a ${run.radius.toFixed(1)} px radius. Raise --detail to blur less.`);
  }

  // Both max and mean unchanged means normalise returned the field untouched
  // rather than merely happening to leave the peak where it was.
  if (norm && blurred && norm.max === blurred.max && norm.mean === blurred.mean
      && blurred.max > 0 && blurred.max < 0.5) {
    found.push(`Normalise left the picture alone — it still peaks at ` +
      `${norm.max} instead of being stretched to 1, so there is no ink for ` +
      `the rest of the pipeline to work with.`);
  }

  if (con && norm && norm.max >= BLANK && con.max < BLANK) {
    const floor = 0.5 - 0.5 / run.set.contrast;
    found.push(`Contrast at ${Math.round(run.set.contrast * 100)}% clamps ` +
      `everything below ${floor.toFixed(3)} to nothing, and the picture peaks ` +
      `at ${norm.max}. Lower --contrast.`);
  }

  if (!found.length) {
    found.push(`${live} of ${run.cells} cells carry enough ink to be typed, ` +
      `${struck} keystrokes in all.`);
  }
  return found;
}

if (cmd === 'inspect') {
  const run = convertPicture(args[1]);
  const findings = diagnose(run);
  const width = Math.max(0, ...run.lines.map((l) => l.length));

  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok: true,
      source: { width: run.source.width, height: run.source.height },
      settings: {
        mode: run.set.mode, contrast: run.set.contrast, detail: run.set.detail,
        maxCols: run.set.maxCols, invert: run.set.invert,
        blurRadius: +run.radius.toFixed(2),
      },
      strokes: {
        width: +run.strokes.width.toFixed(2),
        coverage: +run.strokes.coverage.toFixed(4),
        lineArt: run.lineArt,
      },
      atlas: { shapes: run.atlas.hasShapes, characters: run.atlas.glyphs.length - 1 },
      stages: run.stages,
      grid: run.grid,
      cells: { total: run.cells, inked: run.live },
      result: { width, height: run.lines.length, keystrokes: keystrokes(run.lines) },
      findings,
      notes: run.notes,
    }, null, 2));
  } else {
    console.log(`${args[1]} — ${run.source.width}×${run.source.height} working size, ` +
      `mode ${run.set.mode}, contrast ${Math.round(run.set.contrast * 100)}%, ` +
      `detail ${Math.round(run.set.detail * 100)}%`);
    console.log(`strokes ${run.strokes.width.toFixed(1)} px across ` +
      `${(run.strokes.coverage * 100).toFixed(1)}% of the frame — ` +
      `${run.lineArt ? 'a drawing, so the blur is held to ' +
        run.radius.toFixed(1) + ' px' : 'dense enough to blur fully at ' +
        run.radius.toFixed(1) + ' px'}\n`);
    console.log('stage       size        strongest   average   inked');
    for (const s of run.stages) {
      console.log(
        `${s.stage.padEnd(11)} ${`${s.width}×${s.height}`.padEnd(11)} ` +
        `${s.max.toFixed(3).padStart(9)} ${s.mean.toFixed(4).padStart(9)} ` +
        `${(s.inked * 100).toFixed(2).padStart(7)}%`);
    }
    console.log(`\ngrid ${run.grid.cols} × ${run.grid.rows}, ` +
      `${run.live} of ${run.cells} cells inked, ` +
      `${keystrokes(run.lines)} keystrokes, result ${width} × ${run.lines.length}`);
    console.log();
    for (const f of findings) console.log(`* ${f}`);
    for (const n of run.notes) console.log(`note: ${n}`);
  }
  process.exit(0);
}

/* ── build the motif ─────────────────────────────────────────── */

let lines = [];
let pictureNotes = [];

if (cmd === 'image') {
  const run = convertPicture(args[1]);
  lines = run.lines;
  pictureNotes = run.notes;
  if (!run.live) {
    // The one failure that looks like a bug in the machine rather than a
    // setting. Point at the command that explains it instead of printing an
    // empty sheet and letting the caller guess.
    pictureNotes.push(
      `Nothing came through. Run: node tools/cli.mjs inspect ${args[1]}`);
  }
} else if (cmd === 'file') {
  const path = args[1];
  if (!path) die('Which file?');
  const raw = fs.readFileSync(path, 'utf8').replace(/\t/g, '    ');
  const { text, dropped } = makeTypeable(raw, machine);
  lines = text.split('\n');
  if (dropped.size) {
    console.error(`note: ${[...dropped.keys()].join(' ')} cannot be typed on ` +
      `this machine and were left blank`);
  }
} else if (cmd === 'text') {
  const word = args[1];
  if (!word) die('Which word?');
  const style = opt('style', 'block');
  if (!STYLES[style]) {
    die(`Unknown style: ${style}. One of: ${Object.keys(STYLES).join(' ')}`);
  }
  // Refused rather than typed and swapped: a face is drawn out of specific
  // marks, and the nearest available shape is a different face.
  const lacking = marksMissing(style, charset(machine));
  if (lacking.length) {
    die(`--style ${style} strikes ${lacking.join(' ')}, which the ` +
      `${machine.name} does not have. Try --style block.`);
  }
  // Same ramp the page uses, taken from the machine rather than wished for.
  // A literal \n in the argument starts a second line of lettering, because
  // a shell makes a real newline awkward to type.
  const tones = toneRamp(Math.max(1, tonesOf(style)),
    { allowed: charset(machine) });
  // Wrapped to the margins of the chosen paper, like the page does. Without
  // it "GUTEN MORGEN LYON" in Block is 101 columns on an A4 that holds 82,
  // and the only output is a refusal.
  lines = letter(word.replace(/\\n/g, '\n'),
    { style, tones, maxCols: textArea(sheet, machine).cols });
} else {
  die(`Unknown command: ${cmd}`);
}

// Trim blank lines top and bottom — they are not keystrokes.
while (lines.length && !lines[0].trim()) lines.shift();
while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
if (!lines.length) die('Nothing to type.');

/* ── colour, setup, report ───────────────────────────────────── */

const width = Math.max(...lines.map((l) => l.length));
const colours = colourMap(lines, { rows: parseRows(opt('red', ''), lines.length) });
const tally = inkTally(lines, colours);
const setup = setUp(width, lines.length, sheet, machine, align);

const instructions = [];
if (setup.paperGuide) {
  instructions.push([`Paper guide to ${setup.paperGuide}`,
    'Lay the sheet against it; this shifts the whole sheet along the scale.']);
}
instructions.push([`Left margin stop to ${setup.left}`,
  'The carriage returns here every line, so leading spaces are never typed.']);
if (setup.advance) {
  instructions.push([`Wind on ${setup.advance} lines`, 'Feed the paper without typing.']);
}
instructions.push(['Line spacing 1', 'Anything wider breaks the picture.']);
if (tally.red && machine.twoColour) {
  instructions.push(['Ribbon to black',
    `${tally.black} strikes in black, ${tally.red} in red. Do all the black ` +
    `first; after switching, strike two or three times on scrap.`]);
}
if (setup.marginRelease) {
  instructions.push(['Margin release ready',
    'The motif starts further left than the stop can reach.']);
}

// setUp() reports { level, text } so the interface can tell an impossibility
// from an inconvenience. Interpolating the object printed `warning:
// [object Object]` and lost the message entirely - including "this will not
// fit on A4", which is the one warning that matters.
const warnings = setup.warnings.map((w) => (typeof w === 'string'
  ? { level: 'note', text: w }
  : { level: w.level ?? 'note', text: w.text }));

/* ── pdf ─────────────────────────────────────────────────────── */

let wrotePdf = null;
const pdfPath = opt('pdf');
if (typeof pdfPath === 'string') {
  const text = buildSheetPdf({
    lines, colours, paper: sheet, machine, setup, instructions, tally, runsOf,
    title: cmd === 'text' ? args[1] : 'Typewriter ASCII',
  });
  fs.writeFileSync(pdfPath, Buffer.from(text, 'latin1'));
  wrotePdf = pdfPath;
}

/* ── report ──────────────────────────────────────────────────── */

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: true,
    size: { width, height: lines.length },
    keystrokes: { total: tally.total, black: tally.black, red: tally.red },
    paper: { id: sheet.id, name: sheet.name, landscape: Boolean(sheet.landscape) },
    machine: { id: machine.id, name: machine.name },
    setup: {
      left: setup.left, paperGuide: setup.paperGuide ?? null,
      advance: setup.advance, marginRelease: Boolean(setup.marginRelease),
    },
    warnings,
    instructions: instructions.map(([heading, body]) => ({ heading, body })),
    notes: pictureNotes,
    lines,
  }, null, 2));
} else {
  console.log(`${width} × ${lines.length} characters, ${tally.total} keystrokes` +
    (tally.red ? ` (${tally.red} red)` : '') +
    `, ${sheet.name}${sheet.landscape ? ' sideways' : ''}, ${machine.name}`);
  for (const w of warnings) {
    console.log(`${w.level === 'stop' ? 'CANNOT' : 'note'}: ${w.text}`);
  }
  for (const n of pictureNotes) console.log(`note: ${n}`);
  console.log();
  instructions.forEach(([h, b], i) => console.log(`${i + 1}. ${h}\n   ${b}`));

  if (!opt('quiet')) {
    console.log('\nWhat to type — a number means repeat, _ is a space:\n');
    lines.forEach((line, i) => {
      const n = String(i + 1 + setup.advance).padStart(3);
      console.log(`${n}  ${runsToText(line, colours[i])}`);
    });
  }
  if (wrotePdf) console.log(`\nwrote ${wrotePdf}`);
}
