/**
 * app.js — wiring.
 *
 * Deliberately plain: no framework, no build step required, no state
 * library. The whole app is one object and a redraw function. If you can
 * read JavaScript you can read this.
 */

import { PROFILES, profileById } from '../profiles/index.js';
import {
  charset, makeTypeable, standIns, PAPERS, paperById, textArea, setUp, sheetGrid,
  pitchFrom, expectedMm, PITCHES, LINE_PITCHES, cellWidthMm, cellHeightMm,
} from '../core/machine.js';
import {
  isTurned, planningGrid, turnedGrid, turnRows, turnAdvice,
} from '../core/turn.js';
import {
  tiled, tilesOf, isComposite, unitOf, sheetCount, unitGrid, splitMotif,
  layoutAdvice, MAX_ACROSS, MAX_DOWN,
} from '../core/compose.js';
import { buildAtlas, nearestChar } from '../core/glyphs.js';
import {
  prepare, fitGrid, toCharacters, toSentence, cellAspect,
} from '../core/convert.js';
import {
  inkPlan, INK_SCHEMES, inkTally, inkLevels, parseRows, strikesInLine, runsOf,
} from '../core/runs.js';
import {
  letter, STYLES, usesTwo, tonesOf, charsUsed, marksOf, widestWord,
} from '../core/lettering.js';
import { toneRamp } from '../core/ink.js';
import { parseFlf, flfLetter } from '../core/figlet.js';
import { StrikeListener, LineTracker, METER_FULL_SCALE } from '../core/listen.js';
import { buildSheetPdf, downloadPdf } from '../core/pdf.js';
import {
  renderSheet, paintSheet, paintStrike, renderTable, paintTable, keepInView,
} from './sheet.js';
import { renderKeyboard, pick, learnByTyping } from './keyboard.js';

const $ = (id) => document.getElementById(id);

const app = {
  machine: PROFILES[0],
  // Measured pitches, keyed by profile id. Kept apart from the profile
  // itself so the shipped data stays the shipped data and a measurement can
  // always be undone.
  measured: {},
  inverted: false,
  base: PAPERS[0],    // the single sheet, as it goes in the machine
  across: 1,          // how many of them side by side …
  down: 1,            // … and how many rows of those. See compose.js.
  paper: PAPERS[0],   // base × across × down, which is what gets laid out on
  plan: null,         // splitMotif(): where every sheet's piece of it goes
  tile: 0,            // which physical sheet the typing panel is showing
  motif: [],          // the whole picture, across every sheet
  motifColours: [],
  ghost: false,       // the motif is the lettering box's placeholder, shown
                      // so the faces can be compared before anything is
                      // typed. Preview only: no instructions, no typing
                      // panel, no PDF.
  turn: 'none',       // 'none' | 'left' | 'right' — which way you turn the
                      // finished sheet to look at it. Never how it goes in.
  showTurned: true,   // preview the finished sheet turned, rather than as it
                      // comes out of the machine
  chosen: new Set(),
  atlas: null,
  image: null,        // ImageData of the source
  lines: [],
  colours: [],
  // How the preview is shown: the whole sheet scaled to the column, or the
  // sheet at the size it comes out of the machine.
  zoom: 'fit',
  at: 0,              // current line
  strike: 0,          // keystrokes done in the current line
  els: [],
  rows: [],
  setup: null,
  listener: null,
  tracker: null,      // set while listening: what the count is worth
};

/* ── persistence ─────────────────────────────────────────────── */

const KEY = 'typewriter-ascii';
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      machine: app.machine.id,
      measured: app.measured,
      paper: app.base.id,
      across: app.across,
      down: app.down,
      chosen: [...app.chosen].join(''),
      at: app.at,
      mode: $('mode').value,
      width: $('width').value,
      contrast: $('contrast').value,
      detail: $('detail').value,
      redRows: $('redRows').value,
      ink: $('ink').value,
      useRed: $('useRed').checked,
      inkAmount: $('inkAmount').value,
      invert: $('invert').value,
      sentence: $('sentence').value,
      orientation: $('orientation').value,
      showTurned: app.showTurned,
      zoom: app.zoom,
    }));
  } catch { /* private mode */ }
};
const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); }
  catch { return {}; }
};

/* ── setup ───────────────────────────────────────────────────── */

function fillSelects(saved) {
  // Built from the styles themselves, so adding one needs no HTML change.
  $('letterStyle').innerHTML = Object.entries(STYLES)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');

  /*
   * The real FIGlet fonts, from the manifest rather than a hard-coded list,
   * so dropping an .flf into fonts/ and naming it in index.json is all it
   * takes. Where the manifest cannot be fetched — a page opened straight
   * from disk, a test without a network stack — the drawn faces stand
   * alone, which is exactly what they did before the fonts shipped.
   */
  try {
    fetch('fonts/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((names) => {
        if (!Array.isArray(names) || !names.length) return;
        const group = document.createElement('optgroup');
        group.label = 'FIGlet fonts, as received';
        for (const n of names) {
          const o = document.createElement('option');
          o.value = FLF + n;
          o.textContent = n;
          group.append(o);
        }
        $('letterStyle').append(group);
        syncLetterHint();
      })
      .catch(() => {});
  } catch { /* no fetch here — the drawn faces stand alone */ }

  $('machine').innerHTML = PROFILES
    .map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  const sizes = PAPERS
    .map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  /*
   * The last entry is not a paper size, and it is deliberately worded so
   * that it does not read like one. Choosing it leaves the sheet size alone
   * and opens the matrix below, where the same list appears again as "of".
   */
  $('paper').innerHTML = sizes +
    `<option value="compose">Compose — several sheets…</option>`;
  $('composeUnit').innerHTML = sizes;
  renderMatrix();

  app.measured = (saved.measured && typeof saved.measured === 'object')
    ? saved.measured : {};

  useProfile(saved.machine ?? PROFILES[0].id);
  app.base = paperById(saved.paper ?? PAPERS[0].id);
  app.across = clamp(+saved.across || 1, 1, MAX_ACROSS);
  app.down = clamp(+saved.down || 1, 1, MAX_DOWN);
  app.paper = tiled(app.base, app.across, app.down);
  $('machine').value = app.machine.id;
  $('composeUnit').value = app.base.id;
  // `compose` is the last entry and is not a paper size; it is how the
  // tiling block is opened. Somebody who left the app composing comes back
  // to it rather than to a single sheet with their matrix forgotten.
  $('paper').value = isComposite(app.paper) ? 'compose' : app.base.id;

  app.chosen = new Set(saved.chosen ? [...saved.chosen] : charset(app.machine));

  if (saved.mode) $('mode').value = saved.mode;
  if (saved.width) $('width').value = saved.width;
  if (saved.contrast) $('contrast').value = saved.contrast;
  if (saved.detail) $('detail').value = saved.detail;
  if (saved.redRows) $('redRows').value = saved.redRows;
  if (saved.ink) $('ink').value = saved.ink;
  if (saved.useRed) $('useRed').checked = true;
  if (saved.inkAmount) $('inkAmount').value = saved.inkAmount;
  if (saved.invert) $('invert').value = saved.invert;
  if (saved.sentence) $('sentence').value = saved.sentence;
  /*
   * Two dead settings are still read here, and both are somebody's last
   * visit. `landscape: true` was the original checkbox; `orientation:
   * 'sideways'` was the select that replaced it. Both meant "I want this read
   * sideways", which is still a thing you can want — it is only the account
   * of how it gets typed that has changed — so both land on a left turn
   * rather than being thrown away.
   */
  const wants = saved.orientation === 'sideways' || saved.landscape === true
    ? 'left' : saved.orientation;
  if (wants && [...$('orientation').options].some((o) => o.value === wants)) {
    $('orientation').value = wants;
  }
  app.showTurned = saved.showTurned !== false;
  app.zoom = saved.zoom === 'original' ? 'original' : 'fit';

  /*
   * Where you had got to, restored once at startup.
   *
   * It used to be re-read from storage at the end of every single redraw,
   * which made a stored number outrank the running one on any path that had
   * not written to storage yet. convert() clamps it to the motif, so a saved
   * line past the end of a shorter one lands on the last line rather than
   * nowhere.
   */
  if (Number.isInteger(saved.at) && saved.at >= 0) app.at = saved.at;
}

/**
 * Adopt a profile, with any measurement the owner has taken laid over it.
 *
 * The profile is left untouched. A machine that has been measured is simply
 * a copy carrying the real numbers, so clearing the measurement is nothing
 * more than dropping the copy.
 */
function useProfile(id) {
  const base = profileById(id);
  const mine = app.measured[id];
  app.machine = mine ? { ...base, ...mine, pitchMeasured: true } : base;
  return app.machine;
}

/** Rebuild the glyph atlas — needed whenever the character set changes. */
function rebuildAtlas() {
  const chars = charset(app.machine).filter((c) => app.chosen.has(c));
  app.atlas = buildAtlas(chars, '"Courier New", monospace');
}

/* ── conversion ──────────────────────────────────────────────── */

function currentTab() {
  return document.querySelector('.tab.on')?.dataset.tab ?? 'image';
}

/**
 * Keep the width slider honest.
 *
 * Two ways it can lie, and both were in here. It ran to 120 columns when no
 * paper holds that many, so the top half of its travel did nothing but crop.
 * And it stayed on screen for lettering and pasted art, where the size comes
 * from the word or the source and the slider is simply not consulted — you
 * could drag it all day and watch nothing happen.
 *
 * A control that does nothing is worse than a missing one: it makes you
 * doubt what you are seeing everywhere else.
 */
/**
 * Show only the ribbon controls the chosen scheme actually reads.
 *
 * `shadow` and `bands` take their rule from the motif and have nothing to
 * tune; `rows` wants line numbers and not a slider. Leaving the others on
 * screen would repeat the mistake the width slider made — a control that
 * quietly does nothing.
 */
function syncInkControls() {
  /*
   * Not every scheme applies to every motif, and offering one that cannot
   * work is the same fault as the width slider had.
   *
   * `shadow` is the clear case: it colours the second surface of a lettering
   * style that draws one. Offered on a plain face, or on a picture, there is
   * no second surface and it would quietly produce nothing. So the menu is
   * rebuilt for whatever is currently being made, rather than being a fixed
   * list with dead entries in it.
   */
  // The switch decides whether any of this is on show at all. A second
  // colour means a second pass at the machine, so it is a decision in its
  // own right rather than one entry in a list of styles.
  const on = $('useRed').checked && (app.machine.twoColour !== false);
  $('inkOn').hidden = !on;
  $('inkOff').hidden = on;
  $('useRed').disabled = app.machine.twoColour === false;
  if (app.machine.twoColour === false) {
    $('inkOff').textContent =
      `${app.machine.name} has a single-colour ribbon, so everything is black.`;
  }
  if (!on) {
    $('inkTally').hidden = true;
    return;
  }

  // An imported font has no second surface to colour: like pasted art, it
  // is marks on a page, so red goes by lines or amount, not by face parts.
  const twoSurface = currentTab() === 'text'
    && !isFlf($('letterStyle').value) && usesTwo($('letterStyle').value);
  // Depth and accent grade a motif from faint to heavy. With a single ink
  // level there is nothing to grade: the slider would travel its whole
  // length and either do nothing or turn everything red. Leave them out.
  const graded = inkLevels(app.motif, app.atlas) > 1;
  const offered = INK_SCHEMES.filter((s) => s.id !== 'none'
    && (s.id !== 'shadow' || twoSurface)
    && (!['depth', 'accent'].includes(s.id) || graded));

  const wanted = $('ink').value;
  const ids = offered.map((s) => s.id).join(',');
  if (ids !== app.inkOffered) {
    app.inkOffered = ids;
    $('ink').innerHTML = offered
      .map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    // Keep the choice if it survived the change; a style swap should not
    // silently reset a setting the user made.
    $('ink').value = offered.some((s) => s.id === wanted)
      ? wanted : offered[0].id;
  }

  const scheme = $('ink').value;
  const def = INK_SCHEMES.find((s) => s.id === scheme);
  const usesAmount = ['depth', 'accent', 'lit', 'split'].includes(scheme);

  $('inkHint').textContent = def?.hint ?? '';
  $('inkAmountRow').hidden = !usesAmount;
  $('redRowsRow').hidden = scheme !== 'rows';
  $('inkAmountOut').textContent = `${$('inkAmount').value}%`;

  // What it costs at the machine: the red is a second pass, and knowing how
  // many strikes that is decides whether the effect is worth it.
  // The whole motif: a ribbon change is a decision about the job, and
  // quoting one sheet's share of it would make four sheets look like one.
  const t = inkTally(app.motif, app.motifColours);
  $('inkTally').textContent = t.red
    ? `${t.black} strikes in black, ${t.red} in red — two passes.`
    : '';
  $('inkTally').hidden = !t.red;
}

function syncWidthControl() {
  const applies = currentTab() === 'image';
  $('widthRow').hidden = !applies;
  if (!applies) return;

  /*
   * The ceiling is the sheet, not the margins.
   *
   * It used to be the usable area — 66 columns on an upright A4 — so a motif
   * that would have fitted the paper perfectly well at 80 could not be asked
   * for, because the control refused to go there. But setUp() already knows
   * the difference between the three cases: inside the margins, past the
   * margins but on the paper, and off the paper altogether. Only the last is
   * a real limit. The middle one is a note about where the stops end up, and
   * a note is not a reason to take the choice away.
   */
  /*
   * "How wide" is how wide the picture is *when you look at it*, and on a
   * turned sheet that is measured down the paper rather than across it. So
   * the ceiling comes from the planning grid: on A4 at pica, 82 cells upright
   * and 70 turned, because a turned cell is 4.23 mm wide where an upright one
   * is 2.54.
   *
   * Turning therefore *lowers* this number, and it is right that it does.
   * Fewer, wider cells across 297 mm is exactly the trade — the picture comes
   * out half as big again and takes its detail down the other axis.
   */
  const turned = isTurned(app.turn);
  const cap = planningGrid(sheetGrid(app.paper, app.machine), app.turn).cols;
  const area = planningGrid(textArea(app.paper, app.machine), app.turn).cols;

  const el = $('width');
  el.max = String(cap);
  if (+el.value > cap) el.value = String(cap);

  const over = +el.value > area;
  $('widthOut').textContent = `${el.value} cols`;
  $('widthHint').textContent =
    `Wider means more detail and a great many more keystrokes. ` +
    `${app.paper.name}${turned ? ' turned' : ''} holds ${area} across inside ` +
    `the usual margins and ${cap} edge to edge` +
    (over ? ' — past the margins now, so the stops move in less.' : '.');
}

/**
 * The paper as it is now: the sheet you chose, times the tiling.
 *
 * `app.base` is always a single sheet — the thing that goes in the machine —
 * and `app.paper` is always what the motif is laid out on. For one sheet
 * they are the same object. Keeping both, rather than deriving one when
 * needed, is what stops the two questions ("what am I feeding in?" and "how
 * big is the picture?") from being answered by the same number.
 *
 * The last entry in the sheet picker is not a sheet. It opens the matrix and
 * leaves the size alone, which is why the size appears a second time inside
 * the block, as "of".
 */
function usePaper() {
  const pick = $('paper').value;
  const composing = pick === 'compose';

  if (composing) {
    app.base = paperById($('composeUnit').value);
  } else {
    app.base = paperById(pick);
    // Picking a plain size is how you stop composing, so the matrix goes
    // back to one sheet rather than lying in wait for the next visit.
    app.across = 1;
    app.down = 1;
    $('composeUnit').value = app.base.id;
  }

  $('composeRow').hidden = !composing;
  app.across = clamp(app.across, 1, MAX_ACROSS);
  app.down = clamp(app.down, 1, MAX_DOWN);
  app.paper = tiled(app.base, app.across, app.down);
  paintMatrix();
  return app.paper;
}

/**
 * The matrix: point at the shape rather than describing it.
 *
 * Two number inputs would take the same information in fewer elements and be
 * worse, because what is being chosen is a shape — three across by two down
 * — and a shape is something you recognise rather than something you read.
 * Hovering shows what it would be; clicking takes it.
 */
function renderMatrix() {
  const host = $('matrix');
  if (!host) return;
  const cells = [];
  for (let r = 1; r <= MAX_DOWN; r++) {
    for (let c = 1; c <= MAX_ACROSS; c++) {
      cells.push(`<button type="button" class="cell" data-a="${c}" data-d="${r}"` +
        ` aria-label="${c} across by ${r} down"></button>`);
    }
  }
  host.style.setProperty('--across', String(MAX_ACROSS));
  host.innerHTML = cells.join('');
  for (const el of host.querySelectorAll('.cell')) {
    el.onclick = () => {
      app.across = +el.dataset.a;
      app.down = +el.dataset.d;
      // A different shape is a different piece of paper, so the sheet you
      // were on no longer means anything. Back to the first.
      app.tile = 0;
      convert();
      save();
    };
    el.onmouseenter = () => paintMatrix(+el.dataset.a, +el.dataset.d);
    el.onmouseleave = () => paintMatrix();
  }
}

/** Light the matrix up to `a` × `d` — the choice, or what hovering offers. */
function paintMatrix(a = app.across, d = app.down) {
  for (const el of $('matrix')?.querySelectorAll('.cell') ?? []) {
    el.classList.toggle('in', +el.dataset.a <= a && +el.dataset.d <= d);
    el.classList.toggle('on',
      +el.dataset.a === app.across && +el.dataset.d === app.down);
    el.setAttribute('aria-pressed',
      String(+el.dataset.a === app.across && +el.dataset.d === app.down));
  }
}

/**
 * What the matrix just bought, in the two units that matter.
 *
 * Millimetres because that is what you lay on a table, and cells because
 * that is what you type. Neither on its own answers "is this worth it": four
 * sheets of A4 is 420 by 594 mm, which sounds like a poster and is also
 * 21 320 cells, which is a great many keystrokes.
 */
function syncComposeHint() {
  const el = $('composeHint');
  if (!el) return;
  const n = sheetCount(app.paper);
  const seen = planningGrid(sheetGrid(app.paper, app.machine), app.turn);
  const mm = isTurned(app.turn)
    ? `${app.paper.h} × ${app.paper.w}` : `${app.paper.w} × ${app.paper.h}`;

  if (n === 1) {
    el.textContent = `One sheet — the same as choosing ${app.base.name} above. ` +
      `Point at a shape to spread the motif over more of them.`;
    return;
  }
  const gap = app.plan?.seams;
  el.textContent =
    `${n} sheets of ${app.base.name}, ${mm} mm, ` +
    `${seen.cols} × ${seen.rows} cells` +
    (isTurned(app.turn) ? ' as you will look at it' : '') + '. ' +
    (app.across > 1 && gap
      ? `Overlap them ${gap.across.toFixed(1)} mm at each side join. `
      : '') +
    `Each sheet is typed on its own.`;
}

/**
 * Which way the finished sheet gets turned — never which way it goes in.
 *
 * The paper does not turn any more, and nothing here decides anything: one
 * control states it, every caller reads it. Two earlier versions of this
 * function both got it wrong in ways worth remembering. The first decided the
 * orientation by comparing how the motif came out each way round, so the
 * paper could silently turn when you typed one more word. The second let you
 * state it, but stated it about the *paper* — and a sheet fed in on its long
 * edge is 297 mm of writing line on a machine with 249.
 */
function useTurn() {
  const v = $('orientation').value;
  app.turn = v === 'left' || v === 'right' ? v : 'none';
  return app.turn;
}

/**
 * The characters a lettering style should be drawn with, heaviest first.
 *
 * This replaced
 *
 *     const fill = have.includes('#') ? '#' : have.includes('H') ? 'H' : ...
 *
 * which asked for a character the machine this project was written for does
 * not have. The SM7 has no `#`, so every style fell through to `H` — and `H`
 * is not even the heaviest key it has: 0.171 coverage against 0.204 for `B`,
 * 0.196 for `M`, 0.190 for `W`. Every word came out as a flat grey wall
 * because it was drawn in a mid-weight character and nothing else.
 *
 * Now the ramp is taken from what the machine actually has, spread by rank
 * across whatever is switched on in the characters dialog. See ink.js.
 */
function letterTones(style) {
  return toneRamp(Math.max(1, tonesOf(style)),
    { atlas: app.atlas, allowed: app.chosen });
}

/**
 * What this machine will type where a face asks for a mark it has not got.
 *
 * The faces are written in the marks they were designed in — the peaks face
 * really does say `^` — and this is where that meets the machine in the
 * room. Table first, then a measured match against the atlas, which is why
 * `nearest` is handed in from here: machine.js has no business knowing about
 * a canvas, and glyphs.js has no business knowing about typewriters.
 *
 * Narrowed to `app.chosen`, not just the machine: a key switched off under
 * Characters is a key this machine does not have, for this purpose.
 */
function letterStandIns(style) {
  const have = new Set(charset(app.machine).filter((c) => app.chosen.has(c)));
  return standIns(marksOf(style), {
    have,
    nearest: (ch, pool) => nearestChar(ch, app.atlas, pool),
  });
}

/* ── the FIGlet fonts, offered beside the drawn faces ────────── */

/*
 * The fonts in fonts/ appear in the same picker as the drawn faces, under
 * their own group. The picker value is 'flf:Name'; the file is fetched the
 * first time that face is chosen and parsed once. An imported font is the
 * paste path with a typesetter in front — set exactly as the file says,
 * then swap what the machine lacks and blank what has no stand-in, saying
 * so either way. The same bargain the command line makes with --flf, with
 * one advantage over it: the measured half of the stand-in engine is here,
 * because there is a canvas.
 */
const FLF = 'flf:';
const isFlf = (v) => typeof v === 'string' && v.startsWith(FLF);
const flfFonts = new Map();          // name → parsed font, or 'loading'

/** The parsed font, or null while it is on its way (convert() re-runs). */
function flfFont(name) {
  const got = flfFonts.get(name);
  if (got && got !== 'loading') return got;
  if (!got) {
    flfFonts.set(name, 'loading');
    try {
      fetch(`fonts/${encodeURIComponent(name)}.flf`)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
        .then((text) => {
          flfFonts.set(name, parseFlf(text, name));
          convert();
        })
        .catch(() => flfFonts.delete(name));
    } catch { flfFonts.delete(name); }
  }
  return null;
}

/** A word set in an flf font, swapped to what this machine can strike. */
function flfLines(font, word, { have, maxCols }) {
  const fset = flfLetter(font, word, { maxCols });
  const { swaps, missing } = standIns(
    new Set(fset.lines.join('').replace(/ /g, '')),
    { have, nearest: (ch, pool) => nearestChar(ch, app.atlas, pool) });
  const gone = new Set(missing);
  return {
    unknown: fset.unknown, swaps, missing,
    lines: fset.lines.map((row) => [...row]
      .map((c) => swaps.get(c) ?? (gone.has(c) ? ' ' : c))
      .join('').replace(/\s+$/, '')),
  };
}

function convert() {
  const tab = currentTab();
  /*
   * The turn first, and then everything else.
   *
   * syncWidthControl() reads it — the slider's ceiling is 82 cells upright
   * and 70 turned — so settling it afterwards left the control a redraw
   * behind the choice, offering 82 columns of a sheet that now holds 70.
   */
  const turn = useTurn();
  usePaper();
  syncWidthControl();

  /*
   * Two grids, and everything below depends on not confusing them.
   *
   * `sheet` and `room` are the machine's: columns are carriage positions and
   * rows are lines you type, on an upright sheet, always. `plan` and
   * `planRoom` are the same regions as the eye meets them once the sheet has
   * been turned — rows and columns swapped. A motif is laid out against the
   * planning grid and then laid down onto the sheet, and the turn itself is
   * the only place the two are allowed to meet.
   */
  const sheet = sheetGrid(app.paper, app.machine);
  const room = textArea(app.paper, app.machine);
  const plan = planningGrid(sheet, turn);
  const planRoom = planningGrid(room, turn);
  // The slider is already bounded by the planning grid; the margins are a
  // note from setUp(), not a ceiling.
  const maxCols = Math.min(+$('width').value, plan.cols);
  // A word or a block of pasted art is turned once it is finished, so the
  // machine's own keys decide which rotated marks are worth having.
  const have = new Set(charset(app.machine).filter((c) => app.chosen.has(c)));

  let lines = [];
  let ghost = false;

  if (tab === 'text') {
    // Only the ends are trimmed. A blank line in the middle is a gap the
    // user asked for, and trailing spaces on a line are not keystrokes.
    let word = $('letterText').value
      .split('\n').map((l) => l.replace(/\s+$/, ''))
      .join('\n').replace(/^\n+|\n+$/g, '');
    /*
     * An empty box previews its own placeholder.
     *
     * The faces are the choice this tab exists for, and until now the only
     * way to compare them was to type something first — the picker sat next
     * to an empty preview and clicking through it did nothing at all. So
     * while there is nothing typed, the word the box is already showing in
     * grey is the word the sheet shows too, and the styles can be flicked
     * through on it. It is a ghost: something to look at, never a job to
     * do — draw() keeps the setup and typing sections away, because margin
     * stops for a word nobody asked to type are the same fault as setup
     * numbers for an empty sheet.
     */
    if (!word.trim()) {
      word = $('letterText').placeholder;
      ghost = true;
    }
    if (word.trim() && isFlf($('letterStyle').value)) {
      const font = flfFont($('letterStyle').value.slice(FLF.length));
      if (font) {
        const r = flfLines(font, word, { have, maxCols: planRoom.cols });
        if (r.unknown.size) {
          note(`${font.name} has no ${[...r.unknown].join(' ')} — left blank.`);
        }
        if (r.swaps.size) {
          note(`Typing ${[...r.swaps].map(([a, b]) => `${a} as ${b}`)
            .join(', ')} — this machine has no ${[...r.swaps.keys()].join(' ')}.`);
        }
        if (r.missing.length) {
          note(`No stand-in for ${r.missing.join(' ')} on this machine — ` +
               `left blank.`);
        }
        lines = turnRows(r.lines, turn, have);
      }
    } else if (word.trim()) {
      const style = $('letterStyle').value;
      /*
       * Wrapped to the margins, not to the edge of the paper.
       *
       * `textArea` rather than `sheetGrid`, and it is worth saying why,
       * because both "fit". Measured on an SM7 at pica, "GUTEN MORGEN LYON"
       * in Block: wrapped to the sheet's 82 columns it comes out 71 wide and
       * setUp() answers "wider than the usual margins - 71 against 66";
       * wrapped to the margins' 66 it is 65 wide, in the same eleven rows,
       * and setUp() says nothing at all. Same amount of typing, one fewer
       * thing to read past. Wrapping to the sheet edge would put that note
       * on essentially every sentence, which trains people to ignore the one
       * place the app warns them.
       */
      const { swaps } = letterStandIns(style);
      lines = turnRows(letter(word, {
        style, tones: letterTones(style), maxCols: planRoom.cols,
        substitutes: swaps,
        /*
         * The same control decides both halves of "centred", because there
         * is only one question being asked. `Position` puts the block on the
         * paper; it now also sets the lines of the block against each other,
         * which is the half that used to be flush left whatever you chose.
         */
        align: $('align').value === 'topleft' ? 'left' : 'centre',
      }), turn, have);
    }
  } else if (tab === 'paste') {
    const raw = $('pasted').value.replace(/\t/g, '    ');
    if (raw.trim()) {
      const { text, dropped } = makeTypeable(raw, app.machine);
      lines = turnRows(text.split('\n'), turn, have);
      if (dropped.size) {
        note(`Swapped out: ${[...dropped.keys()].join(' ')} — no equivalent ` +
             `on this machine, so those cells are blank.`);
      }
    }
  } else if (app.image) {
    const want = $('invert').value;           // auto | no | yes
    const mode = $('mode').value;

    // The same call the command line makes — see convert.js. Keeping the
    // order in one place is what stops the two from drifting apart.
    const { field, inverted } = prepare(app.image, {
      invert: want === 'auto' ? 'auto' : want === 'yes',
      detail: +$('detail').value / 100,
      contrast: +$('contrast').value / 100,
      mode,
      maxCols,
      // Laid on its side before anything measures it, so everything after
      // this is the ordinary upright pipeline. See turn.js.
      turn,
    });
    app.inverted = inverted;

    /*
     * Fitted in the machine's frame, because that is where a cell is 2.54 by
     * 4.23 mm. The budgets are the planning grid's, put back the right way
     * round: the slider bounds the picture's width as seen, which on a turned
     * sheet is a count of typed lines.
     */
    const budget = isTurned(turn)
      ? { cols: room.cols, rows: Math.min(maxCols, sheet.rows) }
      : { cols: maxCols, rows: room.rows };
    const grid = fitGrid(budget.cols, budget.rows, field.w, field.h,
                         cellAspect(app.machine));

    if (mode === 'sentence') {
      lines = toSentence(field, grid.cols, grid.rows, $('sentence').value);
    } else {
      lines = toCharacters(field, grid.cols, grid.rows, app.atlas, {
        mode: mode === 'tone' ? 'tone' : 'shape',
        allowed: app.chosen,
        toneWeight: mode === 'tone' ? 1 : 0.35,
      });
    }
  }

  /*
   * The motif, and then the sheets it is cut into.
   *
   * `app.motif` is the whole picture, on however much paper it takes.
   * `app.lines` is the one physical sheet the typing panel is showing. For a
   * single sheet they are the same lines and nothing below can tell the
   * difference; for a composite they are not, and every place that had to
   * choose between them is now forced to say which it meant.
   *
   * The ink plan is worked out on the whole motif and then cut with it, not
   * per sheet. A red band that reaches across a join has to be the same band
   * on both sides of it, and a scheme applied twice to two halves would
   * decide that separately for each.
   */
  app.motif = lines.length ? lines : [];
  app.ghost = ghost && app.motif.length > 0;
  app.motifColours = inkPlan(app.motif, {
    scheme: $('useRed').checked && app.machine.twoColour !== false
      ? $('ink').value : 'none',
    atlas: app.atlas,
    amount: +$('inkAmount').value / 100,
    rows: parseRows($('redRows').value, app.motif.length),
  });
  syncInkControls();

  app.plan = splitMotif({
    lines: app.motif,
    colours: app.motifColours,
    paper: app.paper,
    machine: app.machine,
    align: $('align').value,
  });
  useTile(app.tile, false);

  draw();
  save();
}

/**
 * Show one physical sheet: its lines, its ink, its own machine setup.
 *
 * Everything downstream of here — the run lengths, the table, the listening,
 * the PDF's typing pages — works on one sheet's worth of typing and always
 * did. Handing it a slice rather than the whole motif is the entire trick,
 * and it is why a composite needed no changes at all in runs.js or sheet.js.
 *
 * @param {number} i
 * @param {boolean} [fresh] true when a person picked the sheet, which starts
 *   it at line one; false on a redraw, which keeps the place.
 */
function useTile(i, fresh = true) {
  const sheets = app.plan?.sheets ?? [];
  let at = clamp(i, 0, Math.max(0, sheets.length - 1));
  /*
   * Never land on blank paper by accident. Changing the matrix can leave the
   * old index on a sheet the motif does not reach, and a panel showing an
   * empty sheet reads as a broken app rather than as an empty sheet — so a
   * redraw moves to the first sheet with something on it. Picking a blank
   * one by hand is left alone: that is somebody checking, and the panel says
   * plainly that there is nothing to type.
   */
  const firstUsed = sheets.findIndex((sh) => !sh.blank);
  if (!fresh && sheets[at]?.blank && firstUsed >= 0) at = firstUsed;

  app.tile = at;
  const cur = sheets[at] ?? null;
  app.lines = cur?.lines ?? [];
  app.colours = cur?.colours ?? [];
  app.setup = cur?.setup ?? null;
  app.at = fresh ? 0 : Math.min(app.at, Math.max(0, app.lines.length - 1));
  app.strike = 0;
}

/** The sheet the typing panel is on. */
const currentSheet = () => app.plan?.sheets?.[app.tile] ?? null;

let noteTimer = null;
function note(text) {
  const el = $('setupNote');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(clearNote, 8000);
}

function clearNote() {
  clearTimeout(noteTimer);
  const el = $('setupNote');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

/* ── drawing ─────────────────────────────────────────────────── */

/** Escape for the little live preview. */
const esc = (t) => String(t).replace(/[&<>]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * The live sheet beside the controls.
 *
 * Whole motif, tiny, so a change to any setting is visible without
 * scrolling. Sized to fit its column rather than to a fixed value.
 */
/**
 * Measure how wide one character is in the preview font, per px of size.
 *
 * Monospaced faces are not all 0.6 em: the browser picks whatever the system
 * offers, and guessing wrong tilts the whole sheet. Measured once, because
 * the answer only changes if the font does.
 */
let advanceRatio = 0;
function charAdvance() {
  if (advanceRatio) return advanceRatio;
  // 0.6 em is what Courier and most of its descendants use. It is the
  // fallback rather than the answer, because the browser picks the face from
  // a list and a wrong ratio tilts the whole sheet.
  advanceRatio = 0.6;
  try {
    const c = document.createElement('canvas').getContext('2d');
    const face = getComputedStyle(document.documentElement)
      .getPropertyValue('--mono').trim() || 'monospace';
    c.font = `100px ${face}`;
    const w = c.measureText('M')?.width;
    if (w > 0) advanceRatio = w / 100;
  } catch { /* no canvas text metrics: keep the fallback */ }
  return advanceRatio;
}

const PX_PER_MM = 96 / 25.4;   // a millimetre, as CSS reckons one

/**
 * The preview is a sheet of paper, not a block of text.
 *
 * It used to draw the motif alone, tight to its own edges. That answered
 * "what does it look like" and quietly dropped the two things the preview is
 * actually for: what shape the paper is, and where on it the motif lands.
 * A postcard and an A4 looked identical, and centring and top-left placement
 * were indistinguishable although they are a whole setting apart.
 *
 * So the whole sheet is drawn, in the proportions of the chosen paper, with
 * the motif standing where `setUp()` says the machine will put it. The cell
 * is the machine's real cell — wider than tall at pica, more so at elite —
 * so a circle that will come out as an egg looks like an egg here too.
 *
 * Two sizes, because a scaled sheet cannot answer everything. `fit` puts the
 * whole page beside the settings, which is what you need while you are still
 * choosing them. `original` draws the same sheet at the size it leaves the
 * machine, and that is a different question: at a tenth of scale any set of
 * characters reads as a smooth grey, and the only way to find out whether
 * the motif survives being made of type is to look at type the size it will
 * actually be.
 */
function drawMini() {
  /*
   * The whole picture, on all of its paper.
   *
   * Not `app.lines`, which is the one sheet the typing panel is on. This
   * panel exists to answer "what am I making", and on a composite that is a
   * thing made of four sheets — so the preview draws the composite, marks
   * the joins, and shades whichever sheet you are typing.
   */
  const lines = app.motif;
  const colours = app.motifColours;
  const host = $('mini');
  const paperEl = host.parentElement;
  const real = app.zoom === 'original';
  if (!lines.length) { host.textContent = ''; sizeSheet(paperEl, false); return; }

  const sheet = sheetGrid(app.paper, app.machine);
  /*
   * Taken from the plan, not from a setUp().
   *
   * The motif is placed once, on the whole composite, and each sheet is told
   * where its piece goes — so the origin is the plan's, and reading it back
   * out of one sheet's margin stop would give the offset within that sheet
   * rather than within the picture.
   */
  const col0 = Math.max(0, app.plan?.origin?.col ?? 0);
  const row0 = Math.max(0, app.plan?.origin?.row ?? 0);

  // The sheet keeps the paper's proportions, so the shape of the box is
  // itself information: a postcard looks like a postcard, and a sheet that
  // has been turned looks turned. If the preview stayed upright while the
  // instructions said to feed the paper sideways, one of the two would be
  // lying and there is no way to tell which from the machine.
  sizeSheet(paperEl, real);

  /*
   * The cell, in pixels.
   *
   * At `fit` the sheet's columns are spread across whatever width the column
   * gives us. At `original` the cell is not fitted to anything: it is the
   * machine's own 25.4/cpi millimetres, put on screen as millimetres, and
   * the sheet is sized to match rather than the other way round.
   */
  const cellW = real
    ? cellWidthMm(app.machine) * PX_PER_MM
    : (paperEl.clientWidth - 24) / sheet.cols;
  const cellH = cellW * (app.machine.cpi / app.machine.lpi);
  const size = cellW / charAdvance();

  host.style.fontSize = `${size}px`;
  host.style.lineHeight = `${cellH}px`;

  // Build every row of the sheet, blank ones included: the empty space above
  // and to the left is exactly what the margin stop and the paper feed are
  // being set to produce, so it is worth seeing.
  const out = [];
  for (let r = 0; r < sheet.rows; r++) {
    const line = lines[r - row0];
    if (line === undefined) { out.push(''); continue; }

    const text = line.replace(/\s+$/, '');
    let row = ' '.repeat(col0);
    let i = 0;
    while (i < text.length) {
      const red = colours?.[r - row0]?.[i] === 'red';
      let j = i;
      while (j + 1 < text.length
             && (colours?.[r - row0]?.[j + 1] === 'red') === red) j++;
      const chunk = esc(text.slice(i, j + 1));
      row += red ? `<i class="r">${chunk}</i>` : chunk;
      i = j + 1;
    }
    out.push(row);
  }
  host.innerHTML = out.join('\n');
  drawSeams(real ? 0 : 12, cellW, cellH);
}

/**
 * The joins, and the sheet you are on.
 *
 * Drawn at the *cell* boundary rather than at the sheet's nominal edge, and
 * the difference is the whole story of a join. A4 at pica holds 82 columns —
 * 208.28 mm of a 210 mm sheet — so butting two sheets leaves 1.72 mm of
 * blank paper between the last column of one and the first of the next. The
 * instructions tell you to close that up by overlapping the sheets, and this
 * draws the result of having done so: cells running straight through, with a
 * line where the paper changes hands.
 *
 * Which means the drawn composite is very slightly narrower than the paper
 * box around it — 416.6 mm of cells inside a 420 mm A4 pair. That gap is the
 * overlap, and it is the honest picture rather than a rounding error.
 */
function drawSeams(pad, cellW, cellH) {
  const el = $('seams');
  if (!el) return;
  const plan = app.plan;
  if (!plan || (plan.across === 1 && plan.down === 1)) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  const parts = [];
  for (let c = 1; c < plan.across; c++) {
    parts.push(`<i class="v" style="left:${pad + c * plan.grid.cols * cellW}px"></i>`);
  }
  for (let r = 1; r < plan.down; r++) {
    parts.push(`<i class="h" style="top:${pad + r * plan.grid.rows * cellH}px"></i>`);
  }

  const cur = currentSheet();
  if (cur) {
    parts.push(`<i class="here" style="` +
      `left:${pad + cur.col * plan.grid.cols * cellW}px;` +
      `top:${pad + cur.row * plan.grid.rows * cellH}px;` +
      `width:${plan.grid.cols * cellW}px;` +
      `height:${plan.grid.rows * cellH}px"></i>`);
  }

  el.innerHTML = parts.join('');
  el.hidden = false;
}

/**
 * The box the sheet is drawn in, at whichever of the two sizes is on.
 *
 * `fit` means the whole sheet on the screen, and that is two limits and not
 * one. Across is the column it sits in. Down is the window: a sheet sized
 * only to the column is portrait and half as tall again, so on a wide screen
 * the foot of the paper lands below the fold — and a preview you have to
 * scroll to see the end of is not a preview of a whole sheet. Whichever of
 * the two bites first sets the width, and the height follows from the
 * paper's own proportions.
 *
 * `original` answers to neither: the paper's millimetres set both, and the
 * wrapper is told to scroll, because 210 mm of A4 does not fit beside the
 * settings and must not be allowed to stretch the page trying.
 *
 * The shape is declared either way. It is what the sheet is when the size is
 * not pinned, and when it is pinned the two lengths simply outrank it.
 */
function sizeSheet(el, real) {
  const box = el.parentElement;
  // The sheet is drawn upright and then *rotated*, rather than being drawn
  // rotated. That is the honest preview: what turns on screen is the whole
  // sheet, characters included, so the sideways glyphs are visible as
  // sideways glyphs and nobody is promised letters the machine cannot type.
  const turned = app.showTurned && isTurned(app.turn) && app.motif.length > 0;

  el.classList.toggle('real', real);
  el.classList.toggle('turned', turned);
  box?.classList.toggle('real', real);
  box?.classList.toggle('turned', turned);

  // Cleared before measuring: a pinned width from the last render would
  // otherwise be handed back as "what the column has".
  el.style.transform = '';
  if (box) { box.style.width = ''; box.style.height = ''; }

  const shown = app.motif.length > 0;
  el.style.aspectRatio = shown ? `${app.paper.w} / ${app.paper.h}` : '';
  if (!shown) { el.style.width = ''; el.style.height = ''; return; }

  if (real) {
    el.style.width = `${app.paper.w * PX_PER_MM}px`;
    el.style.height = `${app.paper.h * PX_PER_MM}px`;
  } else {
    el.style.width = '';
    el.style.height = '';
    /*
     * The column, measured on the wrapper and never on the sheet itself.
     *
     * A turned sheet is out of the flow, so with its width cleared it does
     * not fill the column — it reports shrink-to-fit, which is very nearly
     * the width it was given last time. Reading that back made every press
     * of `fit` a fresh measurement of the previous answer: each press took
     * the short side of the sheet for the room available, so the sheet stood
     * down by its own aspect ratio again and again and walked itself out of
     * existence. The wrapper is an ordinary block and is the column whatever
     * the sheet inside it is doing.
     */
    const across = box?.clientWidth || el.clientWidth;
    if (turned) {
      // Turned, the sheet's *height* is what has to fit the column and its
      // width is what has to fit the window. Sizing it upright first and
      // rotating afterwards would put an A4's 297 mm across a 300 px column.
      // `across || Infinity` is for the case where the column cannot be
      // measured at all — a hidden panel, or a DOM with no layout. Treating
      // an unmeasurable column as an unconstrained one keeps the rotation
      // itself well defined rather than collapsing the sheet to nothing.
      const long = Math.max(1, Math.min(across || Infinity,
        window.innerHeight * 0.78 * (app.paper.h / app.paper.w)));
      el.style.height = `${Math.floor(long)}px`;
      el.style.width =
        `${Math.max(1, Math.floor(long * (app.paper.w / app.paper.h)))}px`;
    } else {
      // A share of the window, and not the room left below the heading: the
      // sticky column moves as the page scrolls, and a sheet that changed
      // size on the way down would be worse than one that is a little small.
      const down = window.innerHeight * 0.78 * (app.paper.w / app.paper.h);
      if (down < across) el.style.width = `${Math.floor(down)}px`;
    }
  }

  if (turned) layTurned(el, box, real);
}

/** The px number out of a style we set ourselves, or 0. */
const px = (v) => (/^([\d.]+)px$/.exec(v ?? '') ? +RegExp.$1 : 0);

/**
 * Rotate the drawn sheet, and give the space back to the page.
 *
 * A CSS rotation leaves the element's layout box where it was, so the box
 * around it is told the swapped size and the sheet is taken out of the flow
 * — otherwise the column reserves an upright A4's height for something that
 * is now lying down, and the settings beside it get pushed a page away.
 *
 * `turn` is what your hands do to the paper, so the preview does the same
 * thing: a left turn is a quarter turn anticlockwise on screen.
 */
function layTurned(el, box, real) {
  // Taken from the two lengths sizeSheet() has just pinned rather than from
  // the layout. Everything here is border-box, so they are the same number —
  // and asking the layout would force a reflow to read back a value we
  // already have.
  const w = px(el.style.width);
  const h = px(el.style.height);
  if (!w || !h) return;
  el.style.transform = app.turn === 'left'
    ? `translateY(${w}px) rotate(-90deg)`
    : `translateX(${h}px) rotate(90deg)`;
  if (!box) return;

  /*
   * The width the box takes is the one thing the two sizes disagree about.
   *
   * At `fit` the sheet was measured to fit the column lying down, so the box
   * is pinned to its new footprint and the column gives back exactly the
   * room a sheet on its side takes up.
   *
   * At `original` it must not be pinned. A turned A4 is 297 mm across, half
   * again as wide as the column, and a box that wide would drag the whole
   * page sideways to hold a preview. So the box stays the width of the
   * column and becomes the window you look through: the sheet overflows it,
   * and the scrollbars are how you move around the paper. The height is
   * still stated, because a rotated sheet is out of the flow and a box with
   * nothing in the flow has no height of its own to cap — the CSS ceiling
   * then takes it from there.
   */
  box.style.width = real ? '' : `${h}px`;
  box.style.height = `${w}px`;
}

/**
 * Fit, or actual size.
 *
 * Fit is the default and stays the default: on arrival the point is to see
 * the whole sheet at a glance while the settings are still moving. Actual
 * size is the second look you take once it is nearly right, so it is a
 * button and not a mode you have to be rescued from — and it is remembered,
 * because someone comparing two motifs at real size does not want to ask
 * for it again after every reload.
 */
function setZoom(zoom) {
  app.zoom = zoom === 'original' ? 'original' : 'fit';
  $('zoomFit').classList.toggle('on', app.zoom === 'fit');
  $('zoomReal').classList.toggle('on', app.zoom === 'original');
  $('zoomFit').setAttribute('aria-pressed', String(app.zoom === 'fit'));
  $('zoomReal').setAttribute('aria-pressed', String(app.zoom === 'original'));
  drawMini();
}

/**
 * Hold the sheet the way it is meant to be held, or the way it is typed.
 *
 * Both views are true and they answer different questions. Turned is the
 * picture: it is what you are making, and it is the default because it is
 * what somebody who chose a sideways motif wants to look at. Unturned is the
 * sheet as it comes out of the machine, which is the one to check against
 * while you are actually typing — the top line here is the top line there.
 *
 * It hides itself when the motif is upright, where the two are the same view
 * and the button would be a question nobody asked.
 */
function setTurnedView(on) {
  app.showTurned = Boolean(on);
  const btn = $('zoomTurn');
  if (btn) {
    btn.hidden = !isTurned(app.turn);
    btn.classList.toggle('on', app.showTurned);
    btn.setAttribute('aria-pressed', String(app.showTurned));
    btn.textContent = app.showTurned ? 'turned' : 'as typed';
  }
  drawMini();
}

/**
 * Say which keys the chosen face will actually strike.
 *
 * A style that draws three tones is a different proposition at the machine
 * from one that draws a silhouette, and until now the only way to find out
 * was to render it. Naming the characters also makes the pick visible: if
 * the machine has been stripped down to four keys in the characters dialog,
 * this is where you see the ramp collapse.
 */
function syncLetterHint() {
  const el = $('letterStyleHint');
  const sel = $('letterStyle');
  if (!el || !sel) return;

  /*
   * Which faces are possible is checked here, on every redraw, rather than
   * once when the picker is built — because it depends on two things that
   * both move: the machine, and which of its keys are switched on in the
   * characters dialog. A face drawn with `/` is not available on a machine
   * without one, and offering it anyway produces a sheet that cannot be
   * typed, which is the single thing this program exists to prevent.
   *
   * Disabled rather than hidden. A face that vanished would look like a bug;
   * one that is there and says which key it wants tells you what to change.
   */
  /*
   * And how wide each face makes the word, against the paper it has to go on.
   *
   * Wrapping breaks lines at spaces and nowhere else, so a single word wider
   * than the sheet cannot be rescued by anything except a different face or
   * a different piece of paper — it simply runs off the edge, and the
   * preview clips it there because paper does. Measured on an SM7 at pica,
   * `HELLO` is 94 columns in Raised, big and 114 in Slanted hollow against
   * the 82 an upright A4 holds: the word in the box on arrival does not fit
   * four of the faces on offer, and until now the only way to discover that
   * was to pick one and watch it get cut in half.
   *
   * So the picker says so, in the same breath as it says which faces the
   * machine has no keys for. Named rather than disabled: a face that is too
   * wide for A4 fits a turned sheet, or two sheets, or a shorter word, and
   * all three are things you might be about to do. A missing key is a fact
   * about the machine in the room; this is a fact about a choice.
   */
  const word = $('letterText').value.trim() || $('letterText').placeholder;
  const room = planningGrid(sheetGrid(app.paper, app.machine), app.turn).cols;

  for (const opt of sel.options) {
    /*
     * An imported font is never greyed out here: which marks it strikes is
     * only known once the file is fetched and the word is set, and the
     * stand-in engine answers for nearly anything. What it cannot answer
     * for is blanked and named at selection, like pasted art.
     */
    if (isFlf(opt.value)) continue;
    const { missing } = letterStandIns(opt.value);
    const name = STYLES[opt.value]?.name ?? opt.value;
    opt.disabled = missing.length > 0;
    if (missing.length) {
      opt.textContent = `${name} — no stand-in for ${missing.join(' ')}`;
      continue;
    }
    const w = widestWord(word, opt.value);
    opt.textContent = w > room
      ? `${name} — too wide, ${w} of ${room} columns` : name;
  }

  /*
   * With one face left there is nowhere to step and nothing to draw, which
   * happens on a machine narrowed until only one face can be struck. Said
   * plainly rather than left as three buttons that quietly do nothing.
   */
  const canStep = usableStyles().length > 1;
  for (const id of ['stylePrev', 'styleNext', 'styleAny']) {
    if ($(id)) $(id).disabled = !canStep;
  }

  const style = sel.value;

  if (isFlf(style)) {
    const name = style.slice(FLF.length);
    const font = flfFonts.get(name);
    if (!font || font === 'loading') {
      el.textContent = `${name} — fetching the font…`;
      return;
    }
    const have = new Set(charset(app.machine).filter((c) => app.chosen.has(c)));
    const r = flfLines(font, word, { have, maxCols: room });
    const w = Math.max(0, ...r.lines.map((l) => l.length));
    const parts = [];
    if (w > room) {
      parts.push(`Too wide — ${w} columns against the ${room} this sheet ` +
        `holds, and a word is only ever broken at a space.`);
    }
    if (r.swaps.size) {
      parts.push(`Typed ${[...r.swaps]
        .map(([a, b]) => `${a} as ${b}`).join(', ')}.`);
    }
    if (r.missing.length) {
      parts.push(`No stand-in for ${r.missing.join(' ')} — left blank.`);
    }
    parts.push('A FIGlet font, set exactly as received — fonts/README.md ' +
      'says whose it is.');
    if (app.ghost) {
      parts.push(`Showing ${$('letterText').placeholder} until you type something.`);
    }
    el.textContent = parts.join(' ');
    return;
  }

  const { swaps, missing } = letterStandIns(style);
  if (missing.length) {
    el.textContent = `${STYLES[style]?.name ?? style} is drawn with ` +
      `${missing.join(' ')}, and this machine has nothing that will stand in. ` +
      `Choose another face, or switch keys back on under Characters.`;
    return;
  }

  const used = charsUsed(style, letterTones(style))
    .map((ch) => swaps.get(ch) ?? ch);
  const n = tonesOf(style);
  const weight = n === 0 ? 'Drawn with fixed marks, not tones'
    : n === 1 ? 'One character'
      : n === 2 ? 'Two weights, face and shadow'
        : 'Three weights: lit edge, body, shaded edge';
  // Named as what you will actually strike, not as what the face asked for.
  // A hint that says `^` on a machine with no caret is worse than no hint.
  const stood = [...swaps].map(([want, got]) => `${want} as ${got}`);

  const parts = [];
  /*
   * The width first, when it is a problem, because it outranks everything
   * else here: which keys the face strikes does not matter if the word runs
   * off the paper. Three ways out, in the order they cost — the turn is
   * free, the paper is a drawer away, and changing the face is the one that
   * changes what you are making.
   */
  const tooWide = widestWord(word, style);
  if (tooWide > room) {
    parts.push(`${STYLES[style]?.name ?? style} sets ${word.split(/\s+/)
      .reduce((a, b) => (b.length > a.length ? b : a))} ${tooWide} columns ` +
      `wide and ${app.paper.name}${isTurned(app.turn) ? ' turned' : ''} holds ` +
      `${room}, so it will be cut off at the edge. A word is only ever broken ` +
      `at a space, so this one cannot wrap: turn the sheet, use more paper, ` +
      `or pick a narrower face.`);
  }
  if (used.length) {
    parts.push(`${weight} — ${used.join(' ')}.` +
      (stood.length ? ` Typed ${stood.join(', ')}.` : '') +
      ` Hollow and stencil faces cost far fewer keystrokes than solid ones.`);
  }
  // Said where the faces are chosen, because that is where somebody
  // clicking through them is looking — and because the preview is
  // otherwise a word they never typed.
  if (app.ghost) {
    parts.push(`Showing ${$('letterText').placeholder} until you type something.`);
  }
  el.textContent = parts.join(' ');
}

/**
 * The faces this machine can actually strike, in the order they are listed.
 *
 * Everything the stepper does is a walk along this array, and it is taken
 * from the picker rather than from STYLES because the picker is where the
 * machine has already had its say: syncLetterHint() greys out every face
 * whose marks the keys cannot make. Stepping onto one of those would select
 * an option the list itself refuses, which is the kind of disagreement this
 * app exists to prevent.
 */
const usableStyles = () =>
  [...$('letterStyle').options].filter((o) => !o.disabled);

/**
 * Take a face, by the same path a person clicking the list takes.
 *
 * Dispatching the event rather than calling convert() directly is what keeps
 * there being one path: the handler already knows to redraw and to save, and
 * a second copy of that here is a second thing to keep in step.
 */
function useStyle(value) {
  const sel = $('letterStyle');
  if (!value || value === sel.value) return;
  sel.value = value;
  /*
   * The event is built in the document's own realm, not from whatever
   * `Event` happens to be in scope here.
   *
   * A bare `new Event(...)` is the same class as the page's in a browser and
   * a different one everywhere else — under Node the global `Event` is
   * Node's, and dispatching one of those at a jsdom element is rejected
   * outright: "parameter 1 is not of type 'Event'". The select knows which
   * document it belongs to, so ask it.
   */
  const view = sel.ownerDocument?.defaultView ?? window;
  sel.dispatchEvent(new view.Event('change'));
}

/**
 * Step to the next face, or the one before.
 *
 * Wraps round, so neither arrow is ever a button that does nothing at one
 * end of the list. A face the machine cannot strike is stepped over rather
 * than landed on — see usableStyles() — and if the current face is itself
 * one of those, which happens when the character set is narrowed while a
 * face is chosen, forward starts at the top of the list and back at the
 * bottom rather than counting from a place that is not in it.
 */
function stepStyle(by) {
  const usable = usableStyles();
  if (usable.length < 2) return;
  const here = usable.findIndex((o) => o.value === $('letterStyle').value);
  const at = here < 0
    ? (by > 0 ? 0 : usable.length - 1)
    : (here + by + usable.length) % usable.length;
  useStyle(usable[at].value);
}

/**
 * Any face but this one.
 *
 * The one already showing is left out of the draw on purpose. A die that can
 * roll the number it is already on is a button that sometimes does nothing,
 * and there is no way to tell that from a button that is broken — the same
 * reason the two preview sizes do not act when pressed a second time.
 */
function anyStyle() {
  const pool = usableStyles().filter((o) => o.value !== $('letterStyle').value);
  if (!pool.length) return;
  useStyle(pool[Math.floor(Math.random() * pool.length)].value);
}

/**
 * Say what turning the sheet actually gives you — in millimetres.
 *
 * This hint used to sell landscape as extra room: "sideways would be 100 by
 * 39" against an upright 66 by 60, as though the sheet had grown. It had not,
 * and it could not: same paper, same margins, same cells. All that happens
 * when you turn a sheet is that they stand the other way up.
 *
 * So the comparison is made in millimetres, which is where the real
 * difference is. Sixty cells across a turned A4 is 254 mm of picture; the
 * sixty-six an upright one gives is 168. A cell count on its own hides that,
 * because a turned cell is two thirds again as wide as an upright one.
 *
 * The width is deliberately not raised when the sheet turns. It would more
 * than double the keystroke count without being asked — measured on a wide
 * photograph, 420 strikes at 60 columns against 950 at 95 — and a paper
 * setting has no business rewriting how much work the job is.
 */
function syncOrientationHint() {
  const el = $('orientationHint');
  if (!el) return;
  const up = textArea(app.paper, app.machine);
  const across = turnedGrid(up);
  const turned = isTurned(app.turn);
  const here = turned ? across : up;
  const there = turned ? up : across;
  const wide = (cols, t) =>
    Math.round(cols * (t ? cellHeightMm(app.machine) : cellWidthMm(app.machine)));

  el.textContent =
    `${turned ? 'Turned' : 'Upright'}: ${here.cols} × ${here.rows} cells ` +
    `inside the margins, ${wide(here.cols, turned)} mm across. ` +
    (turned
      ? `Upright would be ${there.cols} × ${there.rows} and narrower — the ` +
        `same sheet, but the picture only reaches ${wide(there.cols, false)} mm.`
      : `Turned would be ${there.cols} × ${there.rows}, reaching ` +
        `${wide(there.cols, true)} mm — and the paper still goes in upright.`);
}

/** Short plain-English note under each picture style. */
const MODE_HINTS = {
  shape: 'Each character is chosen because its shape matches that part of ' +
         'the picture, not just its darkness.',
  tone: 'Characters are chosen purely by how dark they are. Simpler, and ' +
        'it looks more like a halftone than a drawing.',
  outline: 'Only the edges are typed. Far fewer keystrokes.',
  sentence: 'The picture is spelled out using your sentence.',
};

function draw() {
  /*
   * The whole motif, not the sheet in front of you.
   *
   * Everything in this half of the page describes the finished picture: how
   * big it is, how many keystrokes it costs, whether it fits. On a composite
   * those are questions about all four sheets at once, and answering them
   * from the one currently on screen would quietly quarter every number.
   */
  const lines = app.motif;
  const colours = app.motifColours;
  const tally = inkTally(lines, colours);
  const width = Math.max(0, ...lines.map((l) => l.length));

  // With nothing to type, setUp() still returns numbers - it centres an
  // empty motif on the sheet. Those numbers are arithmetic, not advice, and
  // showing them as "set your margin stop to 41" is simply wrong. So the
  // instructions, the sheet and the table stay out of the way until there
  // is something real to type.
  document.body.classList.toggle('empty', lines.length === 0);
  // A ghost is drawn but not typed: the CSS fades the preview the way the
  // placeholder is faded in the box it came from, and keeps the setup and
  // typing sections away.
  document.body.classList.toggle('ghost', app.ghost);
  if (!lines.length) {
    $('seams').hidden = true;
    $('sheetPickRow').hidden = true;
    $('mini').textContent = '';
    $('facts').innerHTML = '';
    $('warnings').innerHTML = '';
    $('instructions').innerHTML = '';
    $('sheet').innerHTML = '';
    $('table').innerHTML = '';
    app.els = [];
    app.rows = [];
    $('count').textContent = '';
    $('bar').style.width = '0%';
    return;
  }

  /*
   * On a turned sheet the size is quoted twice, and it has to be. `width ×
   * lines` is what the machine does — columns of carriage, lines of typing —
   * and it looks like the wrong way round for the picture, because it is: the
   * picture is lying on its side. So the size you actually asked for is named
   * beside it.
   */
  const turned = isTurned(app.turn);
  const n = sheetCount(app.paper);
  $('facts').innerHTML = [
    ['size', `${width} × ${lines.length}`
      + (turned ? ` typed, ${lines.length} × ${width} seen` : '')],
    ['keystrokes', String(tally.total)],
    tally.red ? ['red', String(tally.red)] : null,
    ['paper', (turned ? `${app.paper.name}, turned ${app.turn}`
      : app.paper.name)
      + (n > 1 ? ` — ${n} sheets` : '')],
  ].filter(Boolean)
   .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  /*
   * A warning now says how serious it is. "This will not fit" and "the
   * margins move in a bit" were previously typeset identically, which made
   * the real one easy to miss and the mild one look like a telling-off.
   *
   * Two sources, and they answer different questions. The plan's warnings
   * are about the picture and the paper — does it fit, do the margins move.
   * The sheet's are about the machine in front of you: what the carriage
   * reaches, where the bell rings, when to hold the margin release. On a
   * single sheet both come out of the same piece of work and the split is
   * invisible; on a composite the first is asked once and the second once
   * per sheet, which is the only arrangement that is true.
   */
  $('warnings').innerHTML = [
    ...(app.plan?.warnings ?? []),
    ...(app.setup?.warnings ?? []),
  ]
    .map((w) => {
      const level = typeof w === 'string' ? 'note' : (w.level ?? 'note');
      const text = typeof w === 'string' ? w : w.text;
      return `<p class="warn ${level}">${esc(text)}</p>`;
    }).join('');

  syncLetterHint();
  /*
   * These two are stale after a tab switch but not visible: both sit inside
   * the picture panel, which the tab strip sets to display:none. Left as
   * they are on purpose - clearing them would be a change nobody can see,
   * and it costs a real test that documents what they say.
   *
   * `setupNote` is the one that genuinely leaks. See below.
   */
  $('modeHint').textContent = MODE_HINTS[$('mode').value] ?? '';
  $('invertHint').textContent = app.inverted
    ? 'This looks like light artwork on a dark background, so it has been '
      + 'turned round. A typewriter cannot ink a whole sheet.'
    : '';
  $('charCount').textContent = `${app.chosen.size} on`;
  syncOrientationHint();

  /*
   * The character-swap warning belongs to the motif that produced it.
   *
   * It is raised by the paste tab - "@ has no equivalent on this machine" -
   * and it sits beside the paper, outside the tab panels, so switching to
   * the lettering tab left it on screen for the rest of its eight seconds,
   * complaining about characters nothing on screen contains.
   */
  if (currentTab() !== 'paste') clearNote();

  // Both hints sit in a narrow column of settings. Anything that is not a
  // number you might act on goes in the tooltip instead of on screen: the
  // machine's notes, and whether the pitch was measured or assumed.
  const m = app.machine;
  const pitch = PITCHES.find((p) => p.perInch === m.cpi);
  const measured = m.pitchMeasured === true ? 'measured on your machine'
    : m.pitchMeasured === false ? 'assumed, not measured' : '';
  $('machineHint').textContent =
    `${m.cpi} cpi` + (pitch ? ` (${pitch.name})` : '') + `, ${m.lpi} lpi` +
    (m.twoColour ? ', two-colour ribbon' : '');
  $('machineHint').title =
    [measured && `Pitch ${measured}.`, m.notes].filter(Boolean).join(' ');

  // What fits on the sheet as it will actually be fed in, not on the size as
  // it sits in the picker.
  const area = textArea(app.paper, app.machine);
  const seen = planningGrid(area, app.turn);
  $('paperHint').textContent = `${seen.cols} x ${seen.rows} inside the margins`
    + (turned ? ', as you will look at it' : '');
  $('paperHint').title =
    `${app.paper.name} goes in upright and holds ${area.cols} characters ` +
    `across and ${area.rows} lines between the margins at ${m.cpi} ` +
    `characters per inch.` +
    (turned ? ` Turned to be read, that same region is ${seen.cols} across by ` +
      `${seen.rows} down.` : '');

  // Before drawMini(), because this is what decides whether the preview is
  // rotated at all — and because the button has to appear and disappear with
  // the orientation rather than with the next click on it.
  setTurnedView(app.showTurned);
  syncComposeHint();
  drawSheetPick();

  /*
   * A ghost stops here, with the preview drawn and the typing half empty.
   *
   * The half above answers "what would this face look like", which is the
   * whole reason the placeholder is rendered at all. The half below is a
   * work plan — margin stops, line counts, a sheet to work down — and a
   * work plan for a word nobody has asked to type is advice about nothing.
   */
  if (app.ghost) {
    $('instructions').innerHTML = '';
    $('sheet').innerHTML = '';
    $('table').innerHTML = '';
    app.els = [];
    app.rows = [];
    $('count').textContent = '';
    $('bar').style.width = '0%';
    return;
  }

  const steps = instructions();
  $('instructions').innerHTML = steps.map(
    ([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('');

  // The summary carries the settings itself, so a shut panel still answers
  // "what did it say again?" without being opened.
  $('setupSummary').textContent = steps.length
    ? `Before you start — ${steps.map(([a]) => a.toLowerCase()).join(', ')}`
    : 'Before you start — set the machine up';

  /*
   * From here down the panel is about typing, so it is about one sheet.
   *
   * The half above describes the finished picture and reads `app.motif`; the
   * half below is the thing you work down with a carriage in your hand, and
   * that is `app.lines` — the piece of the picture on the paper currently in
   * the machine. On a single sheet the two are the same array and none of
   * this matters; on a composite, mixing them up would number the lines of
   * sheet 3 as though sheet 1 were still in the machine.
   */
  const typing = app.lines;
  const typingInk = app.colours;

  // size the sheet so the widest line fits without scrolling, where possible
  const ch = Math.max(20, Math.max(0, ...typing.map((l) => l.length)));
  document.documentElement.style.setProperty(
    '--sheet-size', `${clamp(Math.floor((window.innerWidth - 80) / ch * 1.7), 8, 15)}px`);
  document.documentElement.style.setProperty(
    '--sheet-full', `${clamp(Math.floor((window.innerWidth - 40) / ch * 1.7), 9, 22)}px`);

  app.els = renderSheet($('sheet'), typing, typingInk);
  app.els.forEach((el, i) => {
    el.onclick = (e) => {
      if (i !== app.at) { go(i); return; }
      // Clicking inside the line you are on is how you say "I am here" when
      // the count has gone wrong. Without it, the only remedy for a lost
      // count is to start the line again, on a machine that cannot erase.
      const cell = e.target.closest?.('.c');
      if (!cell) return;
      const cells = [...el.querySelectorAll('.c')];
      const idx = cells.indexOf(cell);
      if (idx < 0) return;
      app.strike = idx;
      app.tracker?.resolve(idx);
      showCount(null);
      paintStrike(app.els, app.lines, app.colours, app.at, app.strike);
      $('strikes').textContent =
        `${app.strike} / ${strikesInLine(app.lines[app.at] ?? '')}`;
    };
  });

  /*
   * The table numbers the lines of the *motif*, the same as everywhere else.
   *
   * It used to add the paper feed, so line one of a word centred on A4 was
   * called line 32 - while the sheet above it, the progress counter and the
   * typing sheet in the PDF all called it line one. Four places, two
   * different numbering schemes, and the one that disagreed was the one
   * headed "for looking things up".
   *
   * Motif numbering is the right one because it is the only one you can
   * check: the paper feed is done once, before typing, and after that
   * nothing on the page or the machine tells you which absolute line of the
   * sheet you are on.
   */
  app.rows = renderTable($('table'), typing, typingInk);
  app.rows.forEach((tr, i) => { tr.onclick = () => go(i); });

  paint();
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Which sheet you are typing, when there is more than one.
 *
 * Numbered in the order they are typed, which is also the order they are
 * laid out: left to right, then down. A blank sheet is still listed and
 * still reachable — somebody laying out four pieces of paper needs to know
 * that the fourth is blank, not that there are three.
 */
function drawSheetPick() {
  const row = $('sheetPickRow');
  const host = $('sheetPick');
  if (!row || !host) return;

  const sheets = app.plan?.sheets ?? [];
  row.hidden = sheets.length < 2;
  if (row.hidden) { host.innerHTML = ''; return; }

  host.style.setProperty('--across', String(app.plan.across));
  host.innerHTML = sheets.map((sh, i) => {
    const cls = ['pick'];
    if (i === app.tile) cls.push('on');
    if (sh.blank) cls.push('blank');
    return `<button type="button" class="${cls.join(' ')}" data-i="${i}"` +
      ` aria-pressed="${i === app.tile}" title="${esc(sh.name)}">${i + 1}</button>`;
  }).join('');

  for (const el of host.querySelectorAll('.pick')) {
    el.onclick = () => {
      // A person picking a sheet is starting it, so it opens at line one.
      useTile(+el.dataset.i, true);
      draw();
      save();
    };
  }

  const cur = currentSheet();
  const done = sheets.filter((sh) => !sh.blank).length;
  $('sheetPickHint').textContent = cur
    ? `${cur.name}. ${done} of ${sheets.length} sheets carry any typing; ` +
      `each is set up on its own and its lines are numbered from one.`
    : '';
}

function instructions() {
  const s = app.setup;
  const out = [];
  const m = app.machine;
  const sheet = currentSheet();
  const composite = isComposite(app.paper);

  /*
   * The layout comes first and it is not a machine step at all: it is what
   * the sheets are *for*, and knowing it changes how you read everything
   * below. Somebody who does not know that sheet 2 goes to the right of
   * sheet 1 has no way to tell whether its margin stop is wrong.
   */
  if (composite) out.push(...layoutAdvice(app.paper, m));

  if (!s) {
    if (sheet?.blank) {
      out.push([`${sheet.name} stays blank`,
        `The motif does not reach this sheet. Leave the paper out of the ` +
        `machine, or keep it for the join — it still has to be there when ` +
        `you lay the picture out.`]);
    }
    return out;
  }

  if (composite) {
    out.push([`Take sheet ${app.tile + 1} — ${ordinalWord(sheet.col + 1)} ` +
      `across, ${ordinalWord(sheet.row + 1)} down`,
      `Its piece of the picture is ` +
      `${Math.max(0, ...app.lines.map((l) => l.length))} columns by ` +
      `${app.lines.length} lines. The stops below are for this sheet only; ` +
      `every sheet is set up differently, which is how the joins line up.`]);
  }

  /*
   * The first step used to be "feed the sheet in sideways", and it is worth a
   * note that it has gone. It could not be done: A4 on its long edge is 297
   * mm of writing line against an SM7 carriage of 249. What replaced it is at
   * the *end* of this list, because turning the sheet is now the last thing
   * you do rather than the first. The paper goes in the way paper always goes
   * in; the motif is what was laid on its side.
   */
  const advice = turnAdvice(app.turn);
  if (advice) {
    out.push([`Feed the ${unitOf(app.paper).name} in upright`,
      `As usual, short edge first. The motif is typed lying down — ` +
      `${Math.max(0, ...app.lines.map((l) => l.length))} columns across and ` +
      `${app.lines.length} lines down. Nothing about the machine changes.`]);
  }

  if (s.paperGuide) {
    out.push([`Paper guide to ${s.paperGuide}`,
      'Lay the sheet against it. This shifts the whole sheet along the scale.']);
  }
  out.push([`Left margin stop to ${s.left}`,
    'The carriage returns here every line, so leading spaces are never typed.']);
  if (s.advance) {
    out.push([`Wind on ${s.advance} lines`,
      'Feed the paper without typing.']);
  }
  out.push(['Line spacing 1', 'Anything wider breaks the picture.']);

  const tally = inkTally(app.lines, app.colours);
  if (tally.red && m.twoColour) {
    out.push(['Ribbon to black',
      `${tally.black} strikes in black, ${tally.red} in red. Do all the ` +
      `black first. After switching, strike two or three times on scrap — ` +
      `the first strike after a change smears.`]);
  }
  if (s.marginRelease) {
    out.push(['Margin release ready',
      'The motif starts further left than the stop can reach.']);
  }
  if (advice) {
    /*
     * Last, because it is the only step that happens after the typing — and
     * on a composite it is the whole picture that turns, once it is laid
     * out, not each sheet as it comes off the machine.
     */
    out.push([
      composite ? `When every sheet is done, ${advice.short}`
        : `When it is done, ${advice.short}`,
      composite ? `${advice.long} Lay all ${sheetCount(app.paper)} sheets out ` +
        `first, then turn the whole thing.` : advice.long]);
  }
  return out;
}

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth'];
const ordinalWord = (n) => ORDINAL_WORDS[n - 1] ?? `${n}th`;

function paint(previous = -1) {
  paintSheet(app.els, app.lines, app.colours, app.at, app.strike, previous);
  paintTable(app.rows, app.at);

  const n = app.lines.length || 1;
  $('bar').style.width = `${Math.round(app.at / n * 100)}%`;
  $('count').textContent = `${app.at} / ${app.lines.length} lines`;
  $('strikes').textContent =
    `${app.strike} / ${strikesInLine(app.lines[app.at] ?? '')}`;
}

/**
 * @param {number} i line to move to
 * @param {boolean} [scroll]
 * @param {boolean} [byHand] true when a person moved the line rather than
 *   the microphone. A person saying where they are settles the question, so
 *   it also clears a lost count; a carriage return only ends the line.
 */
function go(i, scroll = true, byHand = true) {
  // A ghost has no typing to navigate. A space pressed while flicking
  // through the faces must not move a line counter nobody can see — and
  // must not carry a moved counter into the real motif typed next.
  if (app.ghost) return;
  const prev = app.at;
  if (byHand && app.tracker) {
    app.tracker.resolve(0);
    app.tracker.begin(strikesInLine(app.lines[i] ?? ''));
    showCount(null);
  }
  // Moving off the first line means the paper is in and the stops are set.
  // Folding the setup away at that moment is the one point where it is
  // certainly finished with, and it costs a click to get back.
  if (i > 0 && prev === 0) $('stepSetup').open = false;
  app.at = clamp(i, 0, Math.max(0, app.lines.length - 1));
  app.strike = 0;
  paint(prev);
  if (scroll) keepInView(app.els[app.at], headerHeight());
  save();
}

function headerHeight() {
  return document.body.classList.contains('full')
    ? 0 : ($('stepSheet')?.querySelector('h2')?.offsetHeight ?? 0);
}

/** One keystroke heard or clicked. */
function strike() {
  const total = strikesInLine(app.lines[app.at] ?? '');
  app.strike++;
  app.tracker?.strike();
  if (app.strike >= total) {
    // Do not walk on by ear alone. The carriage return is the event that
    // says the line is finished, and it is far easier to hear than a
    // keystroke; while the microphone is on, that is what moves the line.
    // Running off the end of the count instead would compound a miscount
    // into a wrong line, which is the one error that ruins a whole sheet.
    if (!app.listener && app.at < app.lines.length - 1) go(app.at + 1);
    else { app.strike = total; paint(); }
    return;
  }
  paintStrike(app.els, app.lines, app.colours, app.at, app.strike);
  $('strikes').textContent = `${app.strike} / ${total}`;
}

/**
 * The carriage came back, so the line is over.
 *
 * This is where an error stops travelling. Whatever the count did during
 * this line, the next one starts from zero — which turns a mistake that
 * would otherwise follow the typist down the page into one confined to a
 * single line.
 */
function lineEnd(inside = 0) {
  const t = app.tracker;
  if (!t) return;
  const r = t.lineEnd(inside);
  if (app.at < app.lines.length - 1) go(app.at + 1, true, false);
  t.begin(strikesInLine(app.lines[app.at] ?? ''));
  showCount(r);
}

/**
 * Say how much the count is worth, and stop pretending when it is worth
 * nothing.
 *
 * The typist is looking at the paper, not at the screen, and the machine has
 * no undo — so a column that is quietly one out is worse than no column at
 * all, because the sheet is ruined before anyone notices. A display that
 * admits it is lost is merely annoying.
 */
function showCount(r) {
  const lost = !!app.tracker?.lost;
  document.body.classList.toggle('lost', lost);
  $('lost').hidden = !lost;
  if (lost && r) {
    // The line that just went wrong is already typed and cannot be helped.
    // What the disagreement really says is that counting is not working in
    // this room, so the *next* line should not be trusted either — which is
    // the warning worth giving.
    const off = r.error > 0 ? `${r.error} too many` : `${-r.error} too few`;
    $('lostWhy').textContent =
      `The last line counted ${off} against the ${r.expected} it holds. ` +
      `Do not trust the highlight until you have clicked where you are.`;
    return;
  }
  if (r) {
    $('earNote').textContent = r.error === 0
      ? `Line counted exactly right: ${r.expected}.`
      : `Line counted ${r.heard} against ${r.expected}. Close enough to carry on.`;
  }
}

/* ── events ──────────────────────────────────────────────────── */

function wire() {
  // tabs
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.panel').forEach((x) => x.classList.remove('on'));
      t.classList.add('on');
      document.querySelector(`[data-panel="${t.dataset.tab}"]`).classList.add('on');
      convert();
    };
  });

  // image
  const drop = $('drop');
  const file = $('file');
  file.onchange = () => file.files[0] && readImage(file.files[0]);
  ['dragenter', 'dragover'].forEach((e) =>
    drop.addEventListener(e, (ev) => {
      ev.preventDefault(); drop.classList.add('over');
    }));
  ['dragleave', 'drop'].forEach((e) =>
    drop.addEventListener(e, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) readImage(f);
  });

  // settings that only need a redraw
  ['mode', 'align', 'paper', 'machine', 'letterStyle', 'invert',
   'ink', 'useRed', 'orientation', 'composeUnit'].forEach((id) => {
    $(id).onchange = () => {
      if (id === 'machine') {
        useProfile($('machine').value);
        app.chosen = new Set(charset(app.machine));
        rebuildAtlas();
        showMeasured();
      }
      /*
       * A different piece of paper means the sheet you were typing no longer
       * exists — sheet 3 of 4 is nothing at all once the matrix is 2 × 1 —
       * so the panel goes back to the first. convert() reads the pickers
       * itself, through usePaper(), which is why there is nothing to assign
       * here any more.
       */
      if (id === 'paper' || id === 'composeUnit') app.tile = 0;
      $('sentenceRow').hidden = $('mode').value !== 'sentence';
      convert();
    };
  });

  ['width', 'contrast', 'detail', 'inkAmount'].forEach((id) => {
    const out = $(`${id}Out`);
    const show = () => {
      out.textContent = id === 'width'
        ? `${$(id).value} cols`
        : `${$(id).value}%`;
    };
    // Slider position is meaningless while dragging unless the number moves
    // with it, so the readout updates on input and the work happens on
    // change.

    $(id).oninput = show;
    $(id).onchange = () => { show(); convert(); };
    show();
  });

  ['letterText', 'pasted', 'sentence', 'redRows'].forEach((id) => {
    let t = null;
    $(id).oninput = () => { clearTimeout(t); t = setTimeout(convert, 250); };
  });

  // navigation
  $('next').onclick = () => go(app.at + 1);
  $('prev').onclick = () => go(app.at - 1);
  $('restart').onclick = () => go(0);

  document.addEventListener('keydown', (e) => {
    // `matches` only exists on elements, and a key event does not always
    // have one for a target — a keypress that arrives before anything on
    // the page has focus lands on the document itself.
    if (e.target?.matches?.('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault(); go(app.at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); go(app.at - 1);
    } else if (e.key === 'Escape' && document.body.classList.contains('full')) {
      toggleFull();
    }
  });

  // Walking the list of faces. The list itself stays the way to go straight
  // to one; these are for looking through them with the sheet in view.
  $('stylePrev').onclick = () => stepStyle(-1);
  $('styleNext').onclick = () => stepStyle(1);
  $('styleAny').onclick = anyStyle;

  $('full').onclick = toggleFull;
  $('pdf').onclick = savePdf;
  $('listen').onclick = toggleListen;

  /*
   * Redrawing is enough: nothing about the motif changes, only the size the
   * same sheet is drawn at, so there is no need to convert the picture again.
   *
   * Pressing the size you are already looking at does nothing at all. Sizing
   * is now idempotent, so a second press would land on the same number — but
   * a button that is already the answer should not be a button that acts,
   * and this way there is no second measurement to be wrong twice.
   */
  $('zoomFit').onclick = () => {
    if (app.zoom === 'fit') return;
    setZoom('fit'); save();
  };
  $('zoomReal').onclick = () => {
    if (app.zoom === 'original') return;
    setZoom('original'); save();
  };
  if ($('zoomTurn')) {
    $('zoomTurn').onclick = () => { setTurnedView(!app.showTurned); save(); };
  }
  $('back1').onclick = () => {
    app.strike = Math.max(0, app.strike - 1);
    app.tracker?.strike(-1);
    paintStrike(app.els, app.lines, app.colours, app.at, app.strike);
    // The readout is the only thing that says where the count now is. It
    // was left showing the number before the correction, so pressing -1
    // appeared to do nothing at all.
    $('strikes').textContent =
      `${app.strike} / ${strikesInLine(app.lines[app.at] ?? '')}`;
  };
  $('sens').oninput = () => {
    if (app.listener) app.listener.sensitivity = +$('sens').value / 100;
  };
  $('calibrate').onclick = calibrate;

  // charset dialog
  $('editCharset').onclick = openCharset;

  // measuring
  $('mApply').onclick = applyMeasurement;
  $('mClear').onclick = clearMeasurement;
  ['mCount', 'mMm', 'lCount', 'lMm'].forEach((id) => {
    $(id).oninput = showExpected;
    $(id).onkeydown = (e) => { if (e.key === 'Enter') applyMeasurement(); };
  });

  window.addEventListener('resize', () => draw());
}

/* ── measuring ───────────────────────────────────────────── */

/**
 * Say what the ruler ought to read for each standard pitch, before anything
 * is measured. Two numbers 16 mm apart are easy to tell apart with a ruler,
 * and seeing them first makes it obvious the reading is a real decision and
 * not a guess.
 */
function showExpected() {
  const n = +$('mCount').value;
  const steps = n - 1;
  if (!(steps > 0)) { $('mExpect').textContent = ''; return; }

  $('mExpect').textContent =
    `Over ${steps} steps of carriage travel that should read ` +
    PITCHES.map((p) => `${expectedMm(steps, p.perInch).toFixed(1)} mm for ${p.name}`)
      .join(', or ') + '.';
}

function applyMeasurement() {
  const steps = +$('mCount').value - 1;
  const mm = +$('mMm').value;
  const found = pitchFrom(steps, mm);

  if (!found) {
    $('mResult').textContent =
      'Type the number of letters and the distance you measured.';
    return;
  }

  const parts = [];
  const patch = {};

  if (!found.confident) {
    // Refusing to guess is the point. Between pica and elite there is a
    // twenty per cent gap; landing in the middle of it means something is
    // genuinely wrong, and snapping to the nearer one would bake that
    // mistake into every sheet from now on.
    $('mResult').textContent =
      `That works out at ${found.perInch.toFixed(2)} characters per inch, ` +
      `which is ${found.offPercent.toFixed(0)} per cent away from ` +
      `${found.nearest.name} and too far off to call. ` +
      `${steps + 1} letters typed means ${steps} steps of travel; for ` +
      `${found.nearest.name} that distance should read about ` +
      `${expectedMm(steps, found.nearest.perInch).toFixed(0)} mm. ` +
      `Nothing has been changed.`;
    return;
  }

  patch.cpi = found.nearest.perInch;
  const other = PITCHES.find((p) => p.perInch !== found.nearest.perInch);
  parts.push(
    `${found.perInch.toFixed(1)} characters per inch — that is ` +
    `${found.nearest.name}, ${found.nearest.perInch} to the inch. ` +
    (other
      ? `${other.name[0].toUpperCase()}${other.name.slice(1)} would have ` +
        `measured ${expectedMm(steps, other.perInch).toFixed(0)} mm, so there ` +
        `is no doubt about it.`
      : ''));

  if (found.offByOne) {
    // Worth saying, not worth refusing over: it shifts the reading by about
    // one character in forty and never changes which pitch you land on.
    parts.push(
      `The reading is long by roughly one character, which usually means the ` +
      `whole block of ink was measured. Same edge on the first and the last ` +
      `letter next time — it will not change the answer, only tidy it up.`);
  }

  // Line spacing is optional; almost nobody needs it, so a blank field is
  // not a fault.
  const lSteps = +$('lCount').value - 1;
  const lMm = +$('lMm').value;
  if (lMm > 0) {
    let lines = pitchFrom(lSteps, lMm, LINE_PITCHES);
    let extra = '';

    /*
     * The vertical version of the block-of-ink mistake, and worth correcting
     * rather than only mentioning.
     *
     * Sideways, measuring the whole block instead of edge to edge costs about
     * one character in forty — annoying, never decisive. Downwards it is far
     * bigger: measuring to the *bottom* of the last line rather than the top
     * adds the height of a capital, and a typewriter capital is very nearly a
     * whole line tall. Ten lines measured that way read about one line too
     * long, which comes out as 5.4 lines per inch — and the old code simply
     * answered "not a spacing machines were built in" and threw a perfectly
     * good measurement away.
     *
     * Reinterpreting the reading as one step longer is safe here in a way it
     * would not be sideways: there is only one line pitch in the table, so
     * the correction can confirm six lines to the inch or change nothing at
     * all. It cannot land on the wrong answer, because there is no other
     * answer to land on.
     */
    if (lines && !lines.confident && lines.offByOne) {
      const asOneMore = pitchFrom(lSteps + 1, lMm, LINE_PITCHES);
      if (asOneMore?.confident) {
        lines = asOneMore;
        extra =
          ` The reading is about one line long, which is what measuring to ` +
          `the bottom of the last capital does instead of to its top. Read ` +
          `as ${lSteps + 1} steps it lands cleanly, so that is what it was.`;
      }
    }

    if (lines?.confident) {
      patch.lpi = lines.nearest.perInch;
      parts.push(
        `Line spacing confirmed at ${lines.nearest.perInch} to the inch.${extra}`);
    } else if (lines) {
      parts.push(
        `The line measurement gives ${lines.perInch.toFixed(2)} lines per ` +
        `inch, which is not a spacing machines were built in. For ` +
        `${lines.nearest.perInch} to the inch, ${lSteps} steps should read ` +
        `about ${expectedMm(lSteps, lines.nearest.perInch).toFixed(0)} mm. ` +
        `Left alone.`);
    }
  }

  app.measured[app.machine.id] = patch;
  useProfile(app.machine.id);

  const area = planningGrid(textArea(app.paper, app.machine), app.turn);
  parts.push(`${app.paper.name}${isTurned(app.turn) ? ', turned,' : ''}` +
    ` now holds ${area.cols} characters across.`);

  $('mResult').textContent = parts.join(' ');
  convert();
}

function clearMeasurement() {
  delete app.measured[app.machine.id];
  useProfile(app.machine.id);
  $('mMm').value = '';
  $('lMm').value = '';
  $('mResult').textContent = 'Back to the numbers the profile ships with.';
  convert();
}

/** Show an existing measurement when the machine is switched. */
function showMeasured() {
  const mine = app.measured[app.machine.id];
  $('mResult').textContent = mine
    ? `Measured: ${mine.cpi} characters per inch` +
      (mine.lpi ? `, ${mine.lpi} lines per inch.` : '.')
    : '';
}

function readImage(f) {
  const img = new Image();
  img.onload = () => {
    // Work at a sane size; a 4000 px photo helps nobody here.
    const scale = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    app.image = g.getImageData(0, 0, c.width, c.height);

    const pv = $('preview');
    pv.width = c.width; pv.height = c.height;
    pv.getContext('2d').drawImage(c, 0, 0);
    pv.hidden = false;
    $('dropText').hidden = true;
    $('drop').classList.add('has');
    convert();
  };
  img.src = URL.createObjectURL(f);
}

function toggleFull() {
  document.body.classList.toggle('full');
  const on = document.body.classList.contains('full');
  $('full').textContent = on ? 'exit full screen' : 'full screen';
  draw();
  keepInView(app.els[app.at], headerHeight());
}

/** A printable version: the sheet at true size, then what to type. */
function savePdf() {
  // Never a ghost: a PDF of the placeholder would be a work plan for a
  // word nobody asked for.
  if (app.ghost || !app.motif.length) return;
  /*
   * The whole job, not the sheet on screen.
   *
   * A PDF is what you take away from the screen, so it has to carry every
   * piece of paper: each one at true size, each one with its own stops, each
   * one with its own ruled pages. `paper` is the *single* sheet, because
   * that is what this document gets printed on however big the picture is.
   */
  const text = buildSheetPdf({
    lines: app.motif,
    colours: app.motifColours,
    sheets: app.plan?.sheets ?? null,
    // The sheet as it goes in the machine, which is upright and nothing
    // else. The true-size pages are drawn at this size, and a motif planned
    // for a turned sheet is already lying down by the time it gets here.
    paper: unitOf(app.paper),
    turn: app.turn,
    machine: app.machine,
    setup: app.setup,
    instructions: instructions(),
    tally: inkTally(app.motif, app.motifColours),
    runsOf,
    title: 'Typewriter ASCII',
  });
  downloadPdf(text, 'typewriter-ascii.pdf');
}

/* ── listening ───────────────────────────────────────────────── */

async function toggleListen() {
  if (app.listener) {
    app.listener.stop();
    app.listener = null;
    app.tracker = null;
    document.body.classList.remove('counting', 'lost');
    $('ear').hidden = true;
    $('lost').hidden = true;
    $('listen').textContent = 'listen';
    $('listen').classList.remove('on');
    return;
  }

  const l = new StrikeListener({
    sensitivity: +$('sens').value / 100,
    onStrike: () => {
      $('lamp').classList.add('on');
      setTimeout(() => $('lamp').classList.remove('on'), 60);
      strike();
    },
    onReturn: ({ strikesInside }) => lineEnd(strikesInside),
    onFrame: ({ flux, threshold }) => {
      const pc = (v) => `${Math.min(100, Math.max(0, v / METER_FULL_SCALE * 100))}%`;
      $('level').style.width = pc(flux);
      $('markTh').style.left = pc(threshold);
    },
  });

  try {
    await l.start();
  } catch {
    $('earNote').textContent =
      'No microphone access. Browsers only allow it over https or on a ' +
      'file opened locally.';
    $('ear').hidden = false;
    return;
  }
  app.listener = l;
  app.tracker = new LineTracker().begin(strikesInLine(app.lines[app.at] ?? ''));
  document.body.classList.add('counting');
  $('ear').hidden = false;
  $('listen').textContent = 'stop listening';
  $('listen').classList.add('on');
  if (l.warning) $('earNote').textContent = l.warning;
}

/**
 * Measure this machine: type a known number of strikes, then fit the
 * refractory window to them. Beats any default, because it measures the
 * actual rebound delay of that typewriter.
 */
async function calibrate() {
  if (!app.listener) { await toggleListen(); }
  if (!app.listener) return;

  const want = 20;
  const peaks = [];
  const l = app.listener;
  const original = l.onStrike;

  // Record every candidate, not just accepted ones: with the gate wide open
  // the rebound comes through too, which is exactly what has to be measured.
  const relaxed = l.opt.minIntervalMs;
  l.opt.minIntervalMs = 10;
  if (l.detector) l.detector.opt.minIntervalMs = 10;
  l.onStrike = (info) => peaks.push(info);

  $('earNote').textContent =
    `Type ${want} characters at your normal pace. Counting…`;

  await new Promise((done) => {
    const check = setInterval(() => {
      $('earNote').textContent =
        `Type ${want} characters at your normal pace. Heard ${peaks.length} sounds…`;
      if (peaks.length >= want * 2.5) { clearInterval(check); done(); }
    }, 400);
    setTimeout(() => { clearInterval(check); done(); }, 25000);
  });

  const cal = StrikeListener.calibrate(want, peaks);
  l.onStrike = original;
  if (cal && cal.err === 0) {
    l.apply(cal);
    $('earNote').textContent =
      `Calibrated: ${cal.minIntervalMs} ms between strikes on this machine.`;
  } else {
    l.apply({ minIntervalMs: relaxed });
    $('earNote').textContent =
      'Could not settle on a setting. Try again somewhere quieter, or use ' +
      'the sensitivity slider.';
  }
}

/* ── charset dialog ──────────────────────────────────────────── */

function openCharset() {
  const dlg = $('charsetDialog');
  const before = new Set(app.chosen);
  let learning = null;

  const sync = () => {
    $('charsetText').value = charset(app.machine)
      .filter((c) => app.chosen.has(c)).join('');
  };
  const repaint = renderKeyboard($('keyboard'), app.machine, app.chosen, sync);
  sync();

  dlg.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = () => {
      pick(b.dataset.pick, app.machine, app.chosen);
      repaint(); sync();
    };
  });

  $('charsetText').oninput = () => {
    app.chosen.clear();
    [...$('charsetText').value].forEach((c) => c !== ' ' && app.chosen.add(c));
    repaint();
  };

  $('learn').onclick = () => {
    if (learning) {
      learning.stop(); learning = null;
      $('learn').textContent = 'learn from typing';
      $('learnNote').textContent = '';
      repaint(); sync();
      return;
    }
    app.chosen.clear();
    // Both views of the same set, or they contradict each other. Learning
    // used to clear the keyboard and leave the text field listing all 88
    // characters of the old machine, so the dialog showed "nothing
    // selected" and "everything selected" side by side.
    repaint(); sync();
    $('learn').textContent = 'stop learning';
    learning = learnByTyping(app.chosen, () => { repaint(); sync(); }, (n) => {
      $('learnNote').textContent = `${n} characters`;
    });
    $('learnNote').textContent = 'Press every key your machine has.';
  };

  dlg.onclose = () => {
    learning?.stop();
    if (dlg.returnValue === 'cancel') {
      app.chosen = before;
    } else {
      rebuildAtlas();
      convert();
      save();
    }
  };
  dlg.showModal();
}

/* ── go ──────────────────────────────────────────────────────── */

const saved = load();
fillSelects(saved);
rebuildAtlas();
wire();
showExpected();
showMeasured();
// Marks the buttons before the first draw, so the pair says which size is on
// even when the remembered answer is not the default.
setZoom(app.zoom);
$('sentenceRow').hidden = $('mode').value !== 'sentence';
convert();
