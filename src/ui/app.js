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
} from '../core/machine.js';
import { buildAtlas } from '../core/glyphs.js';
import {
  toInk, blur, contrast, edges, outline, cropToContent,
  fitGrid, toCharacters, toSentence, cellAspect, keystrokes,
} from '../core/convert.js';
import {
  colourMap, inkTally, parseRows, strikesInLine, runsOf,
} from '../core/runs.js';
import { letter } from '../core/lettering.js';
import { StrikeListener } from '../core/listen.js';
import { buildSheetPdf, downloadPdf } from '../core/pdf.js';
import {
  renderSheet, paintSheet, paintStrike, renderTable, paintTable, keepInView,
} from './sheet.js';
import { renderKeyboard, pick, learnByTyping } from './keyboard.js';

const $ = (id) => document.getElementById(id);

const app = {
  machine: PROFILES[0],
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
      paper: app.paper.id,
      chosen: [...app.chosen].join(''),
      at: app.at,
      mode: $('mode').value,
      width: $('width').value,
      contrast: $('contrast').value,
      detail: $('detail').value,
      redRows: $('redRows').value,
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
  $('machine').innerHTML = PROFILES
    .map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  $('paper').innerHTML = PAPERS
    .map((p) => `<option value="${p.id}">${p.name}</option>`).join('');

  app.machine = profileById(saved.machine ?? PROFILES[0].id);
  app.paper = paperById(saved.paper ?? PAPERS[0].id);
  $('machine').value = app.machine.id;
  $('paper').value = app.paper.id;

  app.chosen = new Set(saved.chosen ? [...saved.chosen] : charset(app.machine));

  if (saved.mode) $('mode').value = saved.mode;
  if (saved.width) $('width').value = saved.width;
  if (saved.contrast) $('contrast').value = saved.contrast;
  if (saved.detail) $('detail').value = saved.detail;
  if (saved.redRows) $('redRows').value = saved.redRows;
  if (saved.sentence) $('sentence').value = saved.sentence;
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

function convert() {
  const tab = currentTab();
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
    let field = toInk(app.image);

    const detail = +$('detail').value / 100;
    const mode = $('mode').value;

    // Smooth before sampling: texture cannot survive a 2.5 mm cell, and
    // leaving it in produces noise that reads as dirt.
    field = blur(field, Math.max(0, (1 - detail) * (field.w / maxCols) * 0.9));
    field = contrast(field, +$('contrast').value / 100);

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
  const rowSpec = parseRows($('redRows').value, app.lines.length);
  app.colours = colourMap(app.lines, { rows: rowSpec });

  app.setup = setUp(width, app.lines.length, app.paper, app.machine,
                    $('align').value);

  app.at = Math.min(app.at, Math.max(0, app.lines.length - 1));
  app.strike = 0;
  draw();
  save();
}

let noteTimer = null;
function note(text) {
  $('setupNote').textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { $('setupNote').textContent = ''; }, 8000);
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
  $('charCount').textContent = `${app.chosen.size} on`;

  const m = app.machine;
  $('machineHint').textContent =
    `${m.cpi} characters per inch, ${m.lpi} lines per inch` +
    (m.twoColour ? ', black and red ribbon' : '') +
    (m.notes ? `. ${m.notes}` : '');

  const area = textArea(app.paper, app.machine);
  $('paperHint').textContent =
    `${app.paper.name} holds ${area.cols} characters across and ` +
    `${area.rows} lines inside the margins.`;

  drawMini();

  $('instructions').innerHTML = instructions().map(
    ([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('');

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
  ['mode', 'align', 'paper', 'machine', 'letterStyle'].forEach((id) => {
    $(id).onchange = () => {
      if (id === 'machine') {
        app.machine = profileById($('machine').value);
        app.chosen = new Set(charset(app.machine));
        rebuildAtlas();
      }
      if (id === 'paper') app.paper = paperById($('paper').value);
      $('sentenceRow').hidden = $('mode').value !== 'sentence';
      convert();
    };
  });

  ['width', 'contrast', 'detail'].forEach((id) => {
    const out = $(`${id}Out`);
    const show = () => {
      out.textContent = id === 'width'
        ? `${$(id).value} cols`
        : `${$(id).value}%`;
    };
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
  window.addEventListener('resize', () => draw());
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
$('sentenceRow').hidden = $('mode').value !== 'sentence';
convert();
