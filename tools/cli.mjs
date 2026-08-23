#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Same modules as the web app — this is a second door into one codebase, not
 * a second implementation. Useful for scripting, and for anyone who would
 * rather not open a browser.
 *
 * Image conversion is deliberately absent: measuring glyph shapes needs a
 * canvas, and faking one here would mean maintaining a second version of the
 * part that matters most. Templates, lettering and PDF all work.
 *
 *   node tools/cli.mjs file rose.txt --paper a4 --red 0-15 --pdf out.pdf
 *   node tools/cli.mjs text "HELLO" --style outline
 *   node tools/cli.mjs machines
 */

import fs from 'node:fs';
import { PROFILES, profileById } from '../src/profiles/index.js';
import {
  makeTypeable, PAPERS, paperById, setUp, charset,
} from '../src/core/machine.js';
import { colourMap, inkTally, parseRows, runsOf, runsToText } from '../src/core/runs.js';
import { letter } from '../src/core/lettering.js';
import { buildSheetPdf } from '../src/core/pdf.js';

const args = process.argv.slice(2);
const cmd = args[0];

/** Read `--name value` and `--flag`. */
function opt(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(`typewriter-ascii

  file <path>     lay out an existing piece of ASCII art
  text <word>     render a word as letters
  machines        list machine profiles
  papers          list paper sizes

options
  --machine <id>  default olympia-sm7
  --paper <id>    default a4
  --align <centre|topleft>
  --red <lines>   e.g. 0-15,20 — put these lines on the red ribbon
  --style <block|outline|shadow|slab>   for 'text'
  --pdf <path>    also write a printable PDF
  --quiet         only the setup summary
`);
  process.exit(0);
}

if (cmd === 'machines') {
  for (const p of PROFILES) {
    console.log(`${p.id.padEnd(22)} ${p.name}  ${p.cpi} cpi  ` +
      `${charset(p).length} characters`);
  }
  process.exit(0);
}

if (cmd === 'papers') {
  for (const p of PAPERS) console.log(`${p.id.padEnd(12)} ${p.name}  ${p.w}×${p.h} mm`);
  process.exit(0);
}

const machine = profileById(opt('machine', 'olympia-sm7'));
const paper = paperById(opt('paper', 'a4'));
const align = opt('align', 'centre');

/* ── build the motif ─────────────────────────────────────────── */

let lines = [];

if (cmd === 'file') {
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
  const have = charset(machine);
  const fill = have.includes('#') ? '#' : have.includes('H') ? 'H' : have[0];
  const light = have.includes('+') ? '+' : have.includes(':') ? ':' : fill;
  lines = letter(word, { style: opt('style', 'block'), fill, light });
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
const setup = setUp(width, lines.length, paper, machine, align);

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

console.log(`${width} × ${lines.length} characters, ${tally.total} keystrokes` +
  (tally.red ? ` (${tally.red} red)` : '') + `, ${paper.name}, ${machine.name}`);
for (const w of setup.warnings) console.log(`warning: ${w}`);
console.log();
instructions.forEach(([h, b], i) => console.log(`${i + 1}. ${h}\n   ${b}`));

if (!opt('quiet')) {
  console.log('\nWhat to type — a number means repeat, _ is a space:\n');
  lines.forEach((line, i) => {
    const n = String(i + 1 + setup.advance).padStart(3);
    console.log(`${n}  ${runsToText(line, colours[i])}`);
  });
}

/* ── pdf ─────────────────────────────────────────────────────── */

const pdfPath = opt('pdf');
if (typeof pdfPath === 'string') {
  const text = buildSheetPdf({
    lines, colours, paper, machine, setup, instructions, tally, runsOf,
    title: cmd === 'text' ? args[1] : 'Typewriter ASCII',
  });
  fs.writeFileSync(pdfPath, Buffer.from(text, 'latin1'));
  console.log(`\nwrote ${pdfPath}`);
}
