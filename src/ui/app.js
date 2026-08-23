/**
 * app.js — wiring.
 *
 * Deliberately plain: no framework, no build step required, no state
 * library. The whole app is one object and a redraw function. If you can
 * read JavaScript you can read this.
 */

import { PROFILES, profileById } from '../profiles/index.js';
import {
  charset, makeTypeable, PAPERS, paperById, textArea, setUp,
  pitchFrom, expectedMm, PITCHES, LINE_PITCHES,
} from '../core/machine.js';
import { buildAtlas } from '../core/glyphs.js';
import {
  toInk, blur, contrast, edges, outline, cropToContent, normalise,
  fitGrid, toCharacters, toSentence, cellAspect, keystrokes,
} from '../core/convert.js';
import {
  inkPlan, INK_SCHEMES, inkTally, parseRows, strikesInLine, runsOf,
} from '../core/runs.js';
import { letter, STYLES, usesTwo } from '../core/lettering.js';
import { StrikeListener } from '../core/listen.js';
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
  paper: PAPERS[0],
  chosen: new Set(),
  atlas: null,
  image: null,        // ImageData of the source
  lines: [],
  colours: [],
  at: 0,              // current line
  strike: 0,          // keystrokes done in the current line
  els: [],
  rows: [],
  setup: null,
  listener: null,
};

/* ── persistence ─────────────────────────────────────────────── */

const KEY = 'typewriter-ascii';
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      machine: app.machine.id,
      measured: app.measured,
      paper: app.paper.id,
      chosen: [...app.chosen].join(''),
      at: app.at,
      mode: $('mode').value,
      width: $('width').value,
      contrast: $('contrast').value,
      detail: $('detail').value,
      redRows: $('redRows').value,
      ink: $('ink').value,
      inkAmount: $('inkAmount').value,
      invert: $('invert').value,
      sentence: $('sentence').value,
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

  $('ink').innerHTML = INK_SCHEMES
    .map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  $('machine').innerHTML = PROFILES
    .map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  $('paper').innerHTML = PAPERS
    .map((p) => `<option value="${p.id}">${p.name}</option>`).join('');

  app.measured = (saved.measured && typeof saved.measured === 'object')
    ? saved.measured : {};

  useProfile(saved.machine ?? PROFILES[0].id);
  app.paper = paperById(saved.paper ?? PAPERS[0].id);
  $('machine').value = app.machine.id;
  $('paper').value = app.paper.id;

  app.chosen = new Set(saved.chosen ? [...saved.chosen] : charset(app.machine));

  if (saved.mode) $('mode').value = saved.mode;
  if (saved.width) $('width').value = saved.width;
  if (saved.contrast) $('contrast').value = saved.contrast;
  if (saved.detail) $('detail').value = saved.detail;
  if (saved.redRows) $('redRows').value = saved.redRows;
  if (saved.ink) $('ink').value = saved.ink;
  if (saved.inkAmount) $('inkAmount').value = saved.inkAmount;
  if (saved.invert) $('invert').value = saved.invert;
  if (saved.sentence) $('sentence').value = saved.sentence;
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
  const scheme = $('ink').value;
  const def = INK_SCHEMES.find((s) => s.id === scheme);
  const usesAmount = ['depth', 'accent', 'lit', 'split'].includes(scheme);

  $('inkHint').textContent = def?.hint ?? '';
  $('inkAmountRow').hidden = !usesAmount;
  $('redRowsRow').hidden = scheme !== 'rows';
  $('inkAmountOut').textContent = `${$('inkAmount').value}%`;

  // What it costs at the machine: the red is a second pass, and knowing how
  // many strikes that is decides whether the effect is worth it.
  const t = inkTally(app.lines, app.colours);
  $('inkTally').textContent = t.red
    ? `${t.black} strikes in black, ${t.red} in red — two passes.`
    : '';
  $('inkTally').hidden = !t.red;
}

function syncWidthControl() {
  const applies = currentTab() === 'image';
  $('widthRow').hidden = !applies;
  if (!applies) return;

  const area = textArea(app.paper, app.machine);
  const el = $('width');
  el.max = String(area.cols);
  if (+el.value > area.cols) el.value = String(area.cols);

  $('widthOut').textContent = `${el.value} cols`;
  $('widthHint').textContent =
    `Wider means more detail and a great many more keystrokes. ` +
    `${app.paper.name} holds ${area.cols} inside the margins, which is as ` +
    `far as this goes.`;
}

function convert() {
  const tab = currentTab();
  syncWidthControl();
  const area = textArea(app.paper, app.machine);
  const maxCols = Math.min(+$('width').value, area.cols);

  let lines = [];

  if (tab === 'text') {
    const word = $('letterText').value.trim();
    if (word) {
      const style = $('letterStyle').value;
      // Use characters the machine actually has for fill and shadow.
      const have = [...app.chosen];
      const fill = have.includes('#') ? '#'
        : have.includes('H') ? 'H' : (have[0] ?? '#');
      const light = have.includes('+') ? '+'
        : have.includes(':') ? ':' : (have[1] ?? fill);
      lines = letter(word, { style, fill, light });
      app.twoInk = usesTwo(style);
    }
  } else if (tab === 'paste') {
    const raw = $('pasted').value.replace(/\t/g, '    ');
    if (raw.trim()) {
      const { text, dropped } = makeTypeable(raw, app.machine);
      lines = text.split('\n');
      if (dropped.size) {
        note(`Swapped out: ${[...dropped.keys()].join(' ')} — no equivalent ` +
             `on this machine, so those cells are blank.`);
      }
    }
  } else if (app.image) {
    const want = $('invert').value;           // auto | no | yes
    let field = toInk(app.image, {
      invert: want === 'auto' ? 'auto' : want === 'yes',
    });
    app.inverted = field.inverted;

    const detail = +$('detail').value / 100;
    const mode = $('mode').value;

    // Smooth before sampling: texture cannot survive a 2.5 mm cell, and
    // leaving it in produces noise that reads as dirt.
    field = blur(field, Math.max(0, (1 - detail) * (field.w / maxCols) * 0.9));
    field = contrast(field, +$('contrast').value / 100);
    // Use the whole range of characters, not just the band the source
    // happens to occupy.
    field = normalise(field);

    if (mode === 'outline') field = outline(field, 0.45);
    field = cropToContent(field);

    const grid = fitGrid(maxCols, area.rows, field.w, field.h,
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

  app.lines = lines.length ? lines : [];
  const width = Math.max(0, ...app.lines.map((l) => l.length));
  app.colours = inkPlan(app.lines, {
    scheme: $('ink').value,
    atlas: app.atlas,
    amount: +$('inkAmount').value / 100,
    rows: parseRows($('redRows').value, app.lines.length),
  });
  syncInkControls();

  app.setup = setUp(width, app.lines.length, app.paper, app.machine,
                    $('align').value);

  app.at = Math.min(app.at, Math.max(0, app.lines.length - 1));
  app.strike = 0;
  draw();
  save();
}

let noteTimer = null;
function note(text) {
  const el = $('setupNote');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { el.textContent = ''; el.hidden = true; }, 8000);
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
function drawMini() {
  const { lines, colours } = app;
  const host = $('mini');
  if (!lines.length) { host.textContent = ''; return; }

  const width = Math.max(...lines.map((l) => l.length));
  const box = host.parentElement.clientWidth - 34;
  const size = clamp(Math.floor(box / Math.max(width, 1) * 1.68), 4, 13);
  document.documentElement.style.setProperty('--mini-size', `${size}px`);

  host.innerHTML = lines.map((line, r) => {
    const text = line.replace(/\s+$/, '');
    if (!text) return '';
    let out = '';
    let i = 0;
    while (i < text.length) {
      const red = colours?.[r]?.[i] === 'red';
      let j = i;
      while (j + 1 < text.length && (colours?.[r]?.[j + 1] === 'red') === red) j++;
      const chunk = esc(text.slice(i, j + 1));
      out += red ? `<i class="r">${chunk}</i>` : chunk;
      i = j + 1;
    }
    return out;
  }).join('\n');
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
  const { lines, colours } = app;
  const tally = inkTally(lines, colours);
  const width = Math.max(0, ...lines.map((l) => l.length));

  // With nothing to type, setUp() still returns numbers - it centres an
  // empty motif on the sheet. Those numbers are arithmetic, not advice, and
  // showing them as "set your margin stop to 41" is simply wrong. So the
  // instructions, the sheet and the table stay out of the way until there
  // is something real to type.
  document.body.classList.toggle('empty', lines.length === 0);
  if (!lines.length) {
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

  $('facts').innerHTML = [
    ['size', `${width} × ${lines.length}`],
    ['keystrokes', String(tally.total)],
    tally.red ? ['red', String(tally.red)] : null,
    ['paper', app.paper.name],
  ].filter(Boolean)
   .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  $('warnings').innerHTML = (app.setup?.warnings ?? [])
    .map((w) => `<p class="warn">${w}</p>`).join('');

  $('modeHint').textContent = MODE_HINTS[$('mode').value] ?? '';
  $('invertHint').textContent = app.inverted
    ? 'This looks like light artwork on a dark background, so it has been '
      + 'turned round. A typewriter cannot ink a whole sheet.'
    : '';
  $('charCount').textContent = `${app.chosen.size} on`;

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

  const area = textArea(app.paper, app.machine);
  $('paperHint').textContent = `${area.cols} x ${area.rows} inside the margins`;
  $('paperHint').title =
    `${app.paper.name} holds ${area.cols} characters across and ` +
    `${area.rows} lines between the margins at ${m.cpi} characters per inch.`;

  drawMini();

  const steps = instructions();
  $('instructions').innerHTML = steps.map(
    ([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('');

  // The summary carries the settings itself, so a shut panel still answers
  // "what did it say again?" without being opened.
  $('setupSummary').textContent = steps.length
    ? `Before you start — ${steps.map(([a]) => a.toLowerCase()).join(', ')}`
    : 'Before you start — set the machine up';

  // size the sheet so the widest line fits without scrolling, where possible
  const ch = Math.max(20, width);
  document.documentElement.style.setProperty(
    '--sheet-size', `${clamp(Math.floor((window.innerWidth - 80) / ch * 1.7), 8, 15)}px`);
  document.documentElement.style.setProperty(
    '--sheet-full', `${clamp(Math.floor((window.innerWidth - 40) / ch * 1.7), 9, 22)}px`);

  app.els = renderSheet($('sheet'), lines, colours);
  app.els.forEach((el, i) => {
    el.onclick = () => { if (i !== app.at) go(i); };
  });

  app.rows = renderTable($('table'), lines, colours, app.setup?.advance ?? 0);
  app.rows.forEach((tr, i) => { tr.onclick = () => go(i); });

  const saved = load();
  if (saved.at != null && saved.at < lines.length) app.at = saved.at;

  paint();
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function instructions() {
  const s = app.setup;
  if (!s) return [];
  const out = [];
  const m = app.machine;

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
  return out;
}

function paint(previous = -1) {
  paintSheet(app.els, app.lines, app.colours, app.at, app.strike, previous);
  paintTable(app.rows, app.at);

  const n = app.lines.length || 1;
  $('bar').style.width = `${Math.round(app.at / n * 100)}%`;
  $('count').textContent = `${app.at} / ${app.lines.length} lines`;
  $('strikes').textContent =
    `${app.strike} / ${strikesInLine(app.lines[app.at] ?? '')}`;
}

function go(i, scroll = true) {
  const prev = app.at;
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
  if (app.strike >= total) {
    if (app.at < app.lines.length - 1) go(app.at + 1);
    else { app.strike = total; paint(); }
    return;
  }
  paintStrike(app.els, app.lines, app.colours, app.at, app.strike);
  $('strikes').textContent = `${app.strike} / ${total}`;
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
   'ink'].forEach((id) => {
    $(id).onchange = () => {
      if (id === 'machine') {
        useProfile($('machine').value);
        app.chosen = new Set(charset(app.machine));
        rebuildAtlas();
        showMeasured();
      }
      if (id === 'paper') app.paper = paperById($('paper').value);
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
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault(); go(app.at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); go(app.at - 1);
    } else if (e.key === 'Escape' && document.body.classList.contains('full')) {
      toggleFull();
    }
  });

  $('full').onclick = toggleFull;
  $('pdf').onclick = savePdf;
  $('listen').onclick = toggleListen;
  $('back1').onclick = () => {
    app.strike = Math.max(0, app.strike - 1);
    paintStrike(app.els, app.lines, app.colours, app.at, app.strike);
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
    const lines = pitchFrom(lSteps, lMm, LINE_PITCHES);
    if (lines?.confident) {
      patch.lpi = lines.nearest.perInch;
      parts.push(`Line spacing confirmed at ${lines.nearest.perInch} to the inch.`);
    } else if (lines) {
      parts.push(
        `The line measurement gives ${lines.perInch.toFixed(2)} lines per ` +
        `inch, which is not a spacing machines were built in. Left alone.`);
    }
  }

  app.measured[app.machine.id] = patch;
  useProfile(app.machine.id);

  const area = textArea(app.paper, app.machine);
  parts.push(`${app.paper.name} now holds ${area.cols} characters across.`);

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
  if (!app.lines.length) return;
  const text = buildSheetPdf({
    lines: app.lines,
    colours: app.colours,
    paper: app.paper,
    machine: app.machine,
    setup: app.setup,
    instructions: instructions(),
    tally: inkTally(app.lines, app.colours),
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
    document.body.classList.remove('counting');
    $('ear').hidden = true;
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
    onFrame: ({ flux, threshold }) => {
      $('level').style.width = `${Math.min(100, flux / 8 * 100)}%`;
      $('markTh').style.left = `${Math.min(100, threshold / 8 * 100)}%`;
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
  document.body.classList.add('counting');
  $('ear').hidden = false;
  $('listen').textContent = 'stop listening';
  $('listen').classList.add('on');
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

  // Record every candidate, not just accepted ones.
  const relaxed = { refractoryMs: l.opt.refractoryMs, reboundRatio: l.opt.reboundRatio };
  l.opt.refractoryMs = 10;
  l.opt.reboundRatio = 0;
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
      `Calibrated: ${cal.refractoryMs} ms between strikes on this machine.`;
  } else {
    l.opt.refractoryMs = relaxed.refractoryMs;
    l.opt.reboundRatio = relaxed.reboundRatio;
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
    repaint();
    $('learn').textContent = 'stop learning';
    learning = learnByTyping(app.chosen, repaint, (n) => {
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
$('sentenceRow').hidden = $('mode').value !== 'sentence';
convert();
