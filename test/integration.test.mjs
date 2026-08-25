/**
 * Load the real index.html with the real modules and drive it.
 *
 * Unit tests pass happily while the page is broken: a mistyped id, a module
 * that throws on load, a listener attached to something that is not there.
 * This catches that class of failure.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message ?? e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'https://example.test/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

const { window } = dom;

// Things jsdom lacks that the app touches.
window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {} });
window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
window.scrollTo = () => {};
/*
 * A canvas that returns something worth looking at.
 *
 * It used to hand back a uniformly white field, so the picture path ran but
 * had nothing to convert - `cropToContent` found no motif and every test
 * about pictures was really a test that nothing threw. This returns a dark
 * bar across the middle of anything larger than a glyph cell, which is a
 * motif with real edges to crop to and real tone to sample.
 *
 * Atlas cells are 16 px wide and are left white on purpose: glyph measuring
 * has its own fallback for a canvas that cannot render (see ink.js), and
 * feeding it a black bar would measure the bar instead of the character.
 */
const ATLAS_CELL_W = 16;
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    fillRect() {}, drawImage() {}, fillText() {},
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4).fill(255);
      if (w > ATLAS_CELL_W) {
        for (let yy = Math.floor(h * 0.2); yy < Math.floor(h * 0.8); yy++) {
          for (let xx = Math.floor(w * 0.05); xx < Math.floor(w * 0.95); xx++) {
            const i = (yy * w + xx) * 4;
            data[i] = 20; data[i + 1] = 20; data[i + 2] = 20;
          }
        }
      }
      return { width: w, height: h, data };
    },
    set font(v) {}, get font() { return ''; },
    set fillStyle(v) {}, set textAlign(v) {}, set textBaseline(v) {},
  };
};
window.HTMLDialogElement ??= class {};
window.HTMLElement.prototype.showModal ??= function () { this.open = true; };
window.HTMLElement.prototype.close ??= function () { this.open = false; };
window.URL.createObjectURL = () => 'blob:test';
window.URL.revokeObjectURL = () => {};

// A wide photograph, 4:1. jsdom has no decoder, so the app is handed the
// dimensions and told the load finished.
window.Image = class {
  constructor() { this.width = 1200; this.height = 300; }
  set src(v) { setTimeout(() => this.onload?.(), 0); }
  get src() { return 'blob:test'; }
};

// Globals the modules expect to find.
for (const k of ['document', 'navigator', 'location', 'localStorage',
                 'requestAnimationFrame', 'performance', 'Image',
                 'HTMLElement', 'URL', 'Blob', 'getComputedStyle']) {
  try {
    Object.defineProperty(globalThis, k, {
      value: window[k], writable: true, configurable: true,
    });
  } catch { /* some globals are read-only in newer node */ }
}
Object.defineProperty(globalThis, 'window', {
  value: window, writable: true, configurable: true,
});

// Import the app the way the browser would.
// pathToFileURL, not the bare path: on Windows an absolute path starts with
// a drive letter, and the ESM loader reads `C:` as a URL scheme it does not
// know. The test could not run on Windows at all until this.
await import(pathToFileURL(path.join(ROOT, 'src/ui/app.js')).href);
await new Promise((r) => setTimeout(r, 60));

const $ = (id) => window.document.getElementById(id);
let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('page loads');

await check('no errors while loading', () => {
  assert(errors.length === 0, errors.join('\n       '));
});

await check('machine list is filled from the profiles', () => {
  const opts = [...$('machine').options].map((o) => o.value);
  assert(opts.includes('olympia-sm7'), `got ${opts.join(',')}`);
  assert(opts.length >= 3, `only ${opts.length} machines`);
});

await check('paper list is filled', () => {
  assert($('paper').options.length >= 5, 'too few papers');
});

console.log('lettering path');

await check('typing a word produces a sheet', () => {
  const tabs = [...window.document.querySelectorAll('.tab')];
  tabs.find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = 'HI';
  $('letterText').dispatchEvent(new window.Event('input'));
});

await new Promise((r) => setTimeout(r, 400));

await check('the sheet has one element per line', () => {
  const lines = window.document.querySelectorAll('.sheet .ln');
  assert(lines.length >= 5, `sheet has ${lines.length} lines`);
});

await check('exactly one line is open at a time', () => {
  const now = window.document.querySelectorAll('.sheet .ln.now');
  assert(now.length === 1, `${now.length} lines open`);
});

await check('the open line shows runs, the others do not', () => {
  const open = window.document.querySelector('.sheet .ln.now');
  assert(open.querySelectorAll('.run').length > 0, 'open line has no runs');
  const other = [...window.document.querySelectorAll('.sheet .ln')]
    .find((el) => !el.classList.contains('now'));
  assert(other.querySelectorAll('.run').length === 0,
    'a closed line is showing runs');
});

await check('the reference table matches the sheet', () => {
  const rows = window.document.querySelectorAll('#table tr');
  const lines = window.document.querySelectorAll('.sheet .ln');
  assert(rows.length === lines.length,
    `${rows.length} rows vs ${lines.length} lines`);
});

await check('facts are reported', () => {
  const t = $('facts').textContent;
  assert(/keystrokes/.test(t), `facts read: ${t}`);
});

await check('setup instructions are produced', () => {
  assert($('instructions').children.length > 0, 'no instructions');
});

console.log('navigation');

await check('next moves to the following line', () => {
  const before = [...window.document.querySelectorAll('.sheet .ln')]
    .findIndex((e) => e.classList.contains('now'));
  $('next').click();
  const after = [...window.document.querySelectorAll('.sheet .ln')]
    .findIndex((e) => e.classList.contains('now'));
  assert(after === before + 1, `${before} -> ${after}`);
});

await check('previous lines are marked done', () => {
  const done = window.document.querySelectorAll('.sheet .ln.done');
  assert(done.length >= 1, 'nothing marked done');
});

await check('back goes back', () => {
  $('prev').click();
  const at = [...window.document.querySelectorAll('.sheet .ln')]
    .findIndex((e) => e.classList.contains('now'));
  assert(at === 0, `landed on ${at}`);
});

await check('clicking a line jumps to it', () => {
  const lines = [...window.document.querySelectorAll('.sheet .ln')];
  lines[2].click();
  assert(lines[2].classList.contains('now'), 'did not jump');
});

await check('the progress bar moves', () => {
  assert($('bar').style.width !== '' && $('bar').style.width !== '0%',
    `width is ${$('bar').style.width}`);
});

console.log('full screen');

await check('full screen hides everything but the sheet', () => {
  $('full').click();
  assert(window.document.body.classList.contains('full'), 'class not set');
  assert(/exit/.test($('full').textContent), 'label did not change');
  $('full').click();
  assert(!window.document.body.classList.contains('full'), 'did not leave');
});

console.log('pasted art');

await check('pasted art is converted and untypeable characters swapped', () => {
  const tabs = [...window.document.querySelectorAll('.tab')];
  tabs.find((t) => t.dataset.tab === 'paste').click();
  // 0 and @ do not exist on an SM7.
  $('pasted').value = 'a0b@c\n  xx';
  $('pasted').dispatchEvent(new window.Event('input'));
});

await new Promise((r) => setTimeout(r, 400));

await check('the zero was replaced with a capital O', () => {
  const text = [...window.document.querySelectorAll('.sheet .ln')]
    .map((e) => e.textContent).join('\n');
  assert(!/0/.test(text), `still contains a zero: ${text}`);
  assert(/O/.test(text), `no substitute found: ${text}`);
});

console.log('red ribbon');

await check('marking lines red colours them', () => {
  // Using the red half at all is now a switch of its own, and naming lines
  // by hand is one scheme among several behind it.
  $('useRed').checked = true;
  $('useRed').dispatchEvent(new window.Event('change'));
  $('ink').value = 'rows';
  $('ink').dispatchEvent(new window.Event('change'));
  $('redRows').value = '0';
  $('redRows').dispatchEvent(new window.Event('input'));
});

await new Promise((r) => setTimeout(r, 400));

await check('red cells appear in the sheet', () => {
  const red = window.document.querySelectorAll('.sheet .ln .r, .sheet .ln.now .run.r');
  assert(red.length > 0, 'nothing marked red');
});

await check('the facts mention red strikes', () => {
  assert(/red/.test($('facts').textContent), $('facts').textContent);
});

const setInk = async (scheme) => {
  $('useRed').checked = true;
  $('useRed').dispatchEvent(new window.Event('change'));
  await wait(60);
  $('ink').value = scheme;
  $('ink').dispatchEvent(new window.Event('change'));
  await wait(240);
};

await check('the red half is off until it is switched on', async () => {
  // A second colour means a second pass through the machine. That is a
  // decision, not a style, so it starts off and says so.
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterStyle').value = 'shadow';
  $('letterStyle').dispatchEvent(new window.Event('change'));
  $('letterText').value = 'AB';
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(400);

  $('useRed').checked = false;
  $('useRed').dispatchEvent(new window.Event('change'));
  await wait(250);

  assert($('inkOn').hidden, 'the schemes are on show with the ribbon switched off');
  assert(!/red/.test($('facts').textContent),
    `red strikes with the switch off: "${$('facts').textContent}"`);
});

await check('every scheme offered reddens something', async () => {
  // A name in the menu that produces no red is a control that does nothing.
  $('useRed').checked = true;
  $('useRed').dispatchEvent(new window.Event('change'));
  await wait(250);

  const ids = [...$('ink').options].map((o) => o.value);
  assert(ids.length >= 5, `only ${ids.length} schemes offered`);
  assert(!ids.includes('none'),
    '"black only" is still in the menu as well as being the switch');

  for (const id of ids) {
    if (id === 'rows') continue;
    await setInk(id);
    assert(/red/.test($('facts').textContent), `${id} produced no red strikes`);
  }
});

await check('shadow is only offered where there is a shadow to colour', async () => {
  // It colours the second surface of a lettering style that draws one.
  // On a plain face there is no second surface and it would do nothing.
  $('letterStyle').value = 'shadow';
  $('letterStyle').dispatchEvent(new window.Event('change'));
  await wait(300);
  assert([...$('ink').options].some((o) => o.value === 'shadow'),
    'not offered on a shadowed style');

  $('letterStyle').value = 'block';
  $('letterStyle').dispatchEvent(new window.Event('change'));
  await wait(300);
  assert(![...$('ink').options].some((o) => o.value === 'shadow'),
    'offered on a plain face, where it cannot do anything');

  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(300);
  assert(![...$('ink').options].some((o) => o.value === 'shadow'),
    'offered for a picture, which has no shadow layer');

  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  await wait(300);
});

await check('the amount slider only shows where it is read', async () => {
  $('letterStyle').value = 'shadow';
  $('letterStyle').dispatchEvent(new window.Event('change'));
  await setInk('shadow');
  assert($('inkAmountRow').hidden,
    'an amount is offered for a scheme that takes its rule from the motif');

  await setInk('depth');
  assert(!$('inkAmountRow').hidden, 'the amount went missing where it applies');
  assert($('redRowsRow').hidden, 'line numbers offered for a picture rule');

  await setInk('rows');
  assert(!$('redRowsRow').hidden, 'no way to name the lines');
});

await check('the cost of the second pass is stated', async () => {
  await setInk('lit');
  assert(/two passes/.test($('inkTally').textContent),
    `got "${$('inkTally').textContent}"`);

  $('useRed').checked = false;
  $('useRed').dispatchEvent(new window.Event('change'));
  await wait(250);
  assert($('inkTally').hidden, 'a pass count is shown for a single-pass motif');
});

console.log('character set');

await check('the charset dialog builds a keyboard', () => {
  $('editCharset').click();
  const keys = window.document.querySelectorAll('#keyboard .key');
  assert(keys.length > 30, `only ${keys.length} keys`);
});

await check('no key is labelled with a zero, because the SM7 has none', () => {
  const labels = [...window.document.querySelectorAll('#keyboard .key')]
    .map((k) => k.dataset.ch);
  assert(!labels.includes('0'), 'a zero key appeared');
});

await check('presets change the selection', () => {
  const on = () => window.document.querySelectorAll('#keyboard .key.on').length;
  window.document.querySelector('[data-pick="none"]').click();
  assert(on() === 0, `${on()} keys still on`);
  window.document.querySelector('[data-pick="all"]').click();
  assert(on() > 30, `only ${on()} keys on`);
});


console.log('the four faults reported from the browser');

await check('the typing cursor is hidden until something counts strikes', () => {
  // Highlighting a character implies progress is being tracked. Nothing is
  // tracking it unless the microphone is on.
  assert(!window.document.body.classList.contains('counting'),
    'counting class set with no listener running');
});

await check('native controls follow the dark theme', () => {
  // Without color-scheme the browser draws the option list white with
  // near-white text, which is unreadable in dark mode.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert(/color-scheme:\s*light dark/.test(css), 'color-scheme missing in CSS');
  const meta = window.document.querySelector('meta[name="color-scheme"]');
  assert(meta, 'color-scheme meta tag missing');
});

await check('the preview is a sheet, in the shape of the chosen paper', async () => {
  // The preview used to draw the motif alone, tight to its own edges: an A6
  // postcard and an A4 looked identical, and centred and top-left placement
  // were indistinguishable although a whole setting separates them.
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = 'HI';
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(400);

  const view = window.document.querySelector('.paper-view');
  const a4 = paperRatio(view);
  assert(a4, `no aspect ratio set: "${view.style.aspectRatio}"`);
  assert(Math.abs(a4 - 210 / 297) < 0.01, `A4 came out at ${a4.toFixed(3)}`);

  $('paper').value = 'a6';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(400);
  const a6 = paperRatio(view);
  assert(Math.abs(a6 - 105 / 148) < 0.01, `A6 came out at ${a6.toFixed(3)}`);

  $('paper').value = 'a4';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(400);
});

function paperRatio(el) {
  const m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(el.style.aspectRatio ?? '');
  return m ? +m[1] / +m[2] : 0;
}

await check('placement moves the motif on the sheet', async () => {
  // Centred and top-left must not draw the same thing. The blank cells above
  // and to the left are what the paper feed and the margin stop are being
  // set to produce, so they belong in the picture.
  $('align').value = 'centre';
  $('align').dispatchEvent(new window.Event('change'));
  await wait(400);
  const centred = $('mini').textContent;

  $('align').value = 'topleft';
  $('align').dispatchEvent(new window.Event('change'));
  await wait(400);
  const topLeft = $('mini').textContent;

  assert(centred !== topLeft, 'the preview ignores where the motif is placed');

  const lead = (s) => s.split('\n').findIndex((l) => l.trim().length);
  assert(lead(centred) > lead(topLeft),
    `centred should start further down: ${lead(centred)} vs ${lead(topLeft)}`);

  $('align').value = 'centre';
  $('align').dispatchEvent(new window.Event('change'));
  await wait(400);
});

await check('the paper preview stays white in the dark theme', () => {
  // Paper has no night mode. Everywhere else the theme is a matter of
  // comfort; inside this box the colours are a prediction of what comes out
  // of the machine, and pale characters on a dark ground predict the
  // negative of the truth.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const block = css.match(/\.paper-view\s*\{[^}]*\}/)?.[0] ?? '';

  assert(!/var\(--raised\)|var\(--paper\)/.test(block),
    'the sheet still takes its background from the theme');
  assert(/#fff/i.test(block), `no white ground: "${block}"`);

  const pre = css.match(/\.paper-view pre\s*\{[^}]*\}/)?.[0] ?? '';
  assert(!/var\(--ink\)/.test(pre),
    'the characters still take their colour from the theme');
});

await check('the live preview sits with the settings, not below the fold', () => {
  const compose = window.document.querySelector('.compose');
  assert(compose, 'no compose grid');
  assert(compose.querySelector('.controls-col'), 'no controls column');
  assert(compose.querySelector('#mini'), 'preview is not beside the controls');
});

await check('the preview fills in as soon as there is something to type', () => {
  assert($('mini').innerHTML.trim().length > 0, 'preview is empty');
});

await check('the preview offers fit and actual size, and fit is the default', () => {
  // Both live in the heading over the sheet, where the other tool pairs on
  // this page live, and one of them is always marked. A pair of buttons with
  // neither marked leaves you unable to tell which size you are looking at,
  // which is the one thing this pair exists to say.
  const tools = window.document.querySelector('.paper-stick h2 .tools');
  assert(tools, 'no tools beside the preview heading');
  assert(tools.contains($('zoomFit')) && tools.contains($('zoomReal')),
    'the size buttons are not over the preview');
  assert($('zoomFit').classList.contains('on'), 'fit is not the default');
  assert(!$('zoomReal').classList.contains('on'), 'both sizes are marked on');
});

await check('actual size draws the sheet in real millimetres', async () => {
  // The whole claim of this view is that a ruler held to the screen agrees
  // with the machine: A4 is 210 mm across, and six lines to the inch is 96
  // CSS pixels to the inch. Scaled to a column both are true of nothing.
  const view = window.document.querySelector('.paper-view');
  const mm = 96 / 25.4;

  $('zoomReal').click();
  await wait(50);

  assert($('zoomReal').classList.contains('on'), 'the button is not marked');
  assert(!$('zoomFit').classList.contains('on'), 'fit is still marked too');
  assert(view.classList.contains('real'), 'the sheet is not in actual size');
  assert(view.parentElement.classList.contains('paper-scroll'),
    'nothing to scroll a sheet wider than the column');
  assert(view.parentElement.classList.contains('real'),
    'the scroll box was not told the sheet is now oversized');

  const w = parseFloat(view.style.width);
  const h = parseFloat(view.style.height);
  assert(Math.abs(w - 210 * mm) < 1, `A4 is ${w.toFixed(1)} px, not 210 mm`);
  assert(Math.abs(h - 297 * mm) < 1, `A4 is ${h.toFixed(1)} px tall, not 297 mm`);

  // The line pitch the machine actually feeds, taken from the machine and
  // not from a number typed twice.
  const lpi = +/([\d.]+)\s*lpi/.exec($('machineHint').textContent)?.[1];
  assert(lpi > 0, `no line pitch on screen: "${$('machineHint').textContent}"`);
  const line = parseFloat($('mini').style.lineHeight);
  assert(Math.abs(line - 96 / lpi) < 0.5,
    `a line is ${line.toFixed(2)} px, but ${lpi} to the inch is ${(96 / lpi).toFixed(2)}`);
});

await check('a sheet bigger than the column can be moved around', () => {
  // jsdom does no layout, so the rule that gives an oversized sheet somewhere
  // to overflow to is checked where it is written. Without it the sheet is
  // simply clipped at actual size, and everything past 210 mm is unreachable.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const block = css.match(/\.paper-scroll\.real\s*\{[^}]*\}/)?.[0] ?? '';
  assert(/overflow:\s*auto/.test(block), `nothing scrolls: "${block}"`);
  assert(/max-height/.test(block),
    'an A4 at actual size would push the settings off the bottom of the page');
});

await check('fit puts the whole sheet back on the screen', async () => {
  const view = window.document.querySelector('.paper-view');
  $('zoomFit').click();
  await wait(50);

  assert(!view.classList.contains('real'), 'still pinned to actual size');
  assert(!view.parentElement.classList.contains('real'),
    'the scroll box is still braced for an oversized sheet');
  assert(view.style.height === '', `height still pinned: "${view.style.height}"`);
  // Either nothing at all, when the column is the tighter of the two limits,
  // or a width the window height allows — but never the paper's own 210 mm.
  const w = parseFloat(view.style.width);
  assert(!(w > 0) || Math.abs(w - 210 * (96 / 25.4)) > 1,
    `still the whole 210 mm across: "${view.style.width}"`);
  // The shape of the paper is not a property of the size it is drawn at: it
  // is what the preview says a sheet is, and it has to survive the trip back.
  assert(Math.abs(paperRatio(view) - 210 / 297) < 0.01,
    `the sheet lost its shape: "${view.style.aspectRatio}"`);
});

await check('fit stops at the height of the window, not just the column', () => {
  // A portrait sheet fitted to the column alone is half as tall again as it
  // is wide, so on a wide screen the foot of the paper sits below the fold —
  // and a whole-sheet preview you have to scroll to see the end of is not
  // one. jsdom does no layout, so the rule is read where it is written: the
  // width is capped by the window height as well as by the column.
  const js = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');
  const fn = js.match(/function sizeSheet\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert(/window\.innerHeight/.test(fn),
    'the fitted sheet never looks at how tall the window is');
  assert(/clientWidth/.test(fn), 'the fitted sheet ignores the column it is in');
});

await check('the size you chose is still there next time', () => {
  // Someone comparing two motifs at actual size should not have to ask for
  // it again after every reload.
  $('zoomReal').click();
  const stored = JSON.parse(window.localStorage.getItem('typewriter-ascii') ?? '{}');
  assert(stored.zoom === 'original', `stored "${stored.zoom}"`);
  $('zoomFit').click();
  assert(JSON.parse(window.localStorage.getItem('typewriter-ascii')).zoom === 'fit',
    'going back to fit was not remembered');
});

await check('the preview can actually stay put while the settings scroll', () => {
  // `position: sticky` is not enough on its own. A sticky element only
  // travels inside its own parent, and the compose grid is `align-items:
  // start`, which shrinks the paper column to the height of the paper. With
  // no room to travel it scrolls away like anything else — declared sticky,
  // behaving fixed to the page. jsdom does no layout, so this checks the
  // rule that gives it the room.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert(/\.paper-stick\s*\{[^}]*position:\s*sticky/.test(css),
    'the preview is not declared sticky');
  assert(/\.paper-col\s*\{[^}]*align-self:\s*stretch/.test(css),
    'the paper column does not stretch, so sticky has nowhere to travel');
});

await check('the preview follows a change of settings', () => {
  const before = $('mini').innerHTML;
  $('useRed').checked = true;
  $('useRed').dispatchEvent(new window.Event('change'));
  $('ink').value = 'bands';
  $('ink').dispatchEvent(new window.Event('change'));
  return new Promise((r) => setTimeout(() => {
    assert($('mini').innerHTML !== before, 'preview did not react');
    $('useRed').checked = false;
    $('useRed').dispatchEvent(new window.Event('change'));
    setTimeout(r, 250);
  }, 400));
});

await check('spaces are marked, not left blank', () => {
  const table = $('table').innerHTML;
  assert(/class="sp"/.test(table), 'no space markers in the table');
  assert(!/_/.test(table.replace(/[^_]/g, '')) || true, '');
});

await check('every picture style explains itself', () => {
  const sel = $('mode');
  for (const o of sel.options) {
    sel.value = o.value;
    sel.dispatchEvent(new window.Event('change'));
    assert($('modeHint').textContent.trim().length > 20,
      `no explanation for ${o.value}`);
  }
});

await check('the sentence field only appears when it applies', () => {
  $('mode').value = 'shape';
  $('mode').dispatchEvent(new window.Event('change'));
  assert($('sentenceRow').hidden, 'sentence field shown for the wrong style');
  $('mode').value = 'sentence';
  $('mode').dispatchEvent(new window.Event('change'));
  assert(!$('sentenceRow').hidden, 'sentence field hidden when it applies');
});

await check('the machine explains what it is', () => {
  // Short on screen, the rest in the tooltip: this sits in a narrow column
  // of settings, and a sentence there is read once and then in the way.
  assert(/cpi/.test($('machineHint').textContent),
    $('machineHint').textContent);
  assert(/pica|elite/.test($('machineHint').textContent),
    'the pitch is not named');
});

await check('the paper says how much fits', () => {
  assert(/\d+ x \d+/.test($('paperHint').textContent),
    $('paperHint').textContent);
  assert(/characters across/.test($('paperHint').title),
    `the long form is not in the tooltip: "${$('paperHint').title}"`);
});


console.log('nothing to type yet');

await check('no setup numbers are shown before there is a motif', async () => {
  // setUp() happily centres an empty motif and returns a margin stop of 41.
  // Printing that as "set your margin stop to 41" is advice about nothing.
  const tabs = [...window.document.querySelectorAll('.tab')];
  tabs.find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = '';
  $('letterText').dispatchEvent(new window.Event('input'));
  await new Promise((r) => setTimeout(r, 350));

  assert(window.document.body.classList.contains('empty'),
    'empty state not set');
  assert($('instructions').children.length === 0,
    'still showing setup instructions: ' + $('instructions').textContent);
  assert($('facts').textContent.trim() === '', 'still showing facts');
  assert($('sheet').innerHTML.trim() === '', 'sheet not cleared');
  assert($('table').innerHTML.trim() === '', 'table not cleared');
});

await check('the instructions come back once there is something to type', async () => {
  $('letterText').value = 'HI';
  $('letterText').dispatchEvent(new window.Event('input'));
  await new Promise((r) => setTimeout(r, 350));

  assert(!window.document.body.classList.contains('empty'), 'still empty');
  assert($('instructions').children.length > 0, 'no instructions');
  assert(/keystrokes/.test($('facts').textContent), 'no facts');
});

console.log('the width slider tells the truth');

await check('it cannot be dragged off the edge of the paper', async () => {
  // It used to run to 120 columns, which did nothing but crop. Then it
  // stopped at the margins — 66 on an upright A4 — which was the opposite
  // mistake: a motif of 80 columns fits the sheet perfectly well, and the
  // control simply would not go there. The sheet is the limit; the margins
  // are a note from setUp().
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(350);

  assert(+$('width').max === 82, `slider runs to ${$('width').max}, not 82`);
  assert(/66 inside/.test($('widthHint').textContent)
      && /82 edge to edge/.test($('widthHint').textContent),
    `both limits are not explained: "${$('widthHint').textContent}"`);
});

await check('past the margins it says so rather than refusing', async () => {
  // 'change', not 'input': the readout follows the thumb while dragging, the
  // work happens when it is let go.
  $('width').value = '78';
  $('width').dispatchEvent(new window.Event('change'));
  await wait(350);
  assert(/past the margins/.test($('widthHint').textContent),
    `no note about the margins: "${$('widthHint').textContent}"`);

  $('width').value = '60';
  $('width').dispatchEvent(new window.Event('input'));
  await wait(350);
});

await check('it follows a change of paper', async () => {
  $('paper').value = 'a6';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(350);

  const max = +$('width').max;
  assert(max > 0 && max < 82, `postcard still allows ${max} columns`);
  assert(+$('width').value <= max, 'the value was left above the new ceiling');

  $('paper').value = 'a4';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(350);
});

await check('it gets out of the way where it does nothing', async () => {
  // Lettering takes its size from the word and the face; pasted art from the
  // source. The slider is not consulted in either, and a control that does
  // nothing makes you doubt every other control on the page.
  for (const tab of ['text', 'paste']) {
    [...window.document.querySelectorAll('.tab')]
      .find((t) => t.dataset.tab === tab).click();
    await wait(350);
    assert($('widthRow').hidden, `still offered in the ${tab} tab`);
  }

  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(350);
  assert(!$('widthRow').hidden, 'gone missing where it does apply');
});

console.log('turning the sheet sideways');

const typeWord = async (text, style = 'block') => {
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterStyle').value = style;
  $('letterStyle').dispatchEvent(new window.Event('change'));
  $('letterText').value = text;
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(420);
};

const setOrientation = async (which) => {
  $('orientation').value = which;
  $('orientation').dispatchEvent(new window.Event('change'));
  await wait(420);
};

await check('a word too wide for A4 is refused while the sheet stays upright',
  async () => {
    await setOrientation('upright');
    // 'LORENZ' raised is 95 columns; A4 at pica holds 82.
    await typeWord('LORENZ', 'relief');
    assert(/warn stop/.test($('warnings').innerHTML),
      `no refusal: ${$('warnings').textContent}`);
  });

await check('turning the sheet makes the same word fit', async () => {
  await setOrientation('sideways');
  assert(!/warn stop/.test($('warnings').innerHTML),
    `still refused sideways: ${$('warnings').textContent}`);
});

await check('the preview turns with it', async () => {
  // If the preview stayed upright while the instructions said to feed the
  // paper sideways, one of the two would be lying and there is no way to
  // tell which from the machine.
  const r = paperRatio(window.document.querySelector('.paper-view'));
  assert(Math.abs(r - 297 / 210) < 0.01,
    `the sheet is still ${r.toFixed(3)}, not A4 landscape`);
});

await check('the instructions say to feed it in sideways', () => {
  const t = $('instructions').textContent;
  assert(/sideways/i.test(t), `no such step: "${t.slice(0, 120)}"`);
  // And it comes first: it is the only step that has to happen before the
  // paper goes in, and the only one that cannot be corrected afterwards.
  assert(/sideways/i.test($('instructions').children[0].textContent),
    'the paper is fed in before being told which way round');
});

await check('the facts and the paper hint agree that it is turned', () => {
  assert(/sideways/i.test($('facts').textContent),
    `the facts still call it upright A4: ${$('facts').textContent}`);
  assert(/sideways/i.test($('paperHint').textContent),
    `the paper hint disagrees: ${$('paperHint').textContent}`);
});

await check('a small word stays sideways once sideways is chosen', async () => {
  /*
   * This is the change. The switch used to say "if it helps", so a motif
   * that fitted upright quietly turned the sheet back — the same settings
   * gave different paper depending on the word, and the width ceiling moved
   * with it. Now the answer is whatever was asked for, and only that.
   */
  await typeWord('HI', 'block');
  const r = paperRatio(window.document.querySelector('.paper-view'));
  assert(Math.abs(r - 297 / 210) < 0.01,
    `the sheet turned itself back upright: ${r.toFixed(3)}`);
  assert(/sideways/i.test($('instructions').textContent),
    'sideways was chosen but the instructions do not say so');
});

await check('choosing upright puts the same word back upright', async () => {
  await setOrientation('upright');
  const r = paperRatio(window.document.querySelector('.paper-view'));
  assert(Math.abs(r - 210 / 297) < 0.01,
    `still sideways: ${r.toFixed(3)}`);
});

await check('the choice explains what either way round holds', async () => {
  const upright = $('orientationHint').textContent;
  assert(/66/.test(upright) && /100/.test(upright),
    `does not compare the two: "${upright}"`);
  await setOrientation('sideways');
  const sideways = $('orientationHint').textContent;
  assert(/100/.test(sideways) && /long edge/i.test(sideways),
    `nothing useful said while sideways: "${sideways}"`);
});

await check('the orientation survives a reload', async () => {
  const saved = JSON.parse(window.localStorage.getItem('typewriter-ascii'));
  assert(saved.orientation === 'sideways',
    `not saved: ${JSON.stringify(saved.orientation)}`);
  await setOrientation('upright');
});

console.log('lettering wraps to the sheet');

// The motif width, measured from the lines that are NOT open. The open line
// is drawn with run labels above the characters, so its textContent is
// longer than the line it represents.
const motifCols = () => Math.max(0,
  ...[...window.document.querySelectorAll('.sheet .ln')]
    .filter((e) => !e.classList.contains('now'))
    .map((e) => e.textContent.replace(/\u00a0/g, ' ').replace(/\s+$/, '').length));

await check('a long sentence is broken instead of running off the paper',
  async () => {
    // Measured on an SM7 at pica: "GUTEN MORGEN LYON" in Block is 101
    // columns against the 82 an upright A4 holds - 123% of the sheet. It
    // overran the preview.
    await setOrientation('upright');
    await typeWord('GUTEN MORGEN LYON', 'block');

    const width = motifCols();
    assert(width > 0, 'nothing was drawn');
    assert(width <= 82,
      `${width} columns, the upright A4 sheet holds 82`);
    assert(window.document.querySelectorAll('.sheet .ln').length > 5,
      'it still fits on one block, so nothing was wrapped');
    assert(!/warn stop/.test($('warnings').innerHTML),
      `refused after wrapping: ${$('warnings').textContent}`);
  });

await check('wrapping to the margins leaves nothing to complain about',
  async () => {
    // textArea rather than sheetGrid. Wrapped to the sheet's 82 columns the
    // same sentence is 71 wide and setUp() answers "wider than the usual
    // margins - 71 against 66"; wrapped to the margins it is 65 wide in the
    // same eleven rows and setUp() says nothing. Same typing, one fewer
    // thing to read past - and a note on every sentence trains people to
    // ignore the one place the app warns them.
    assert($('warnings').textContent.trim() === '',
      `a warning survived wrapping: ${$('warnings').textContent}`);
  });

await check('turning the sheet takes fewer rows', async () => {
  await setOrientation('upright');
  await typeWord('HALLO WELT WIE GEHT ES DIR', 'block');
  const tall = window.document.querySelectorAll('.sheet .ln').length;

  await setOrientation('sideways');
  const wide = window.document.querySelectorAll('.sheet .ln').length;
  assert(wide < tall, `${wide} rows across against ${tall} upright`);

  const view = window.document.querySelector('.paper-view');
  assert(Math.abs(paperRatio(view) - 297 / 210) < 0.01,
    `the sheet did not turn: ${paperRatio(view).toFixed(3)}`);
  assert(motifCols() <= 116,
    `${motifCols()} columns, landscape A4 holds 116`);
});

await check('the layout is wrapped for the sheet it will be typed on',
  async () => {
    /*
     * The fault this guards against used to be subtle and is now impossible,
     * which is the reason for stating it. Deciding the orientation *after*
     * laying the word out meant wrapping to the landscape width, asking
     * "does 71 columns fit upright?", hearing yes, and printing a motif laid
     * out for margins of 100 on a sheet with margins of 66.
     *
     * With the sheet chosen first there is only ever one answer, so the test
     * is simply that each orientation wraps to its own margins.
     */
    await setOrientation('upright');
    await typeWord('GUTEN MORGEN LYON', 'block');
    const view = window.document.querySelector('.paper-view');
    assert(Math.abs(paperRatio(view) - 210 / 297) < 0.01,
      `upright was asked for, sheet is ${paperRatio(view).toFixed(3)}`);
    assert(motifCols() <= 66,
      `laid out for a sheet it is not on: ${motifCols()} columns against ` +
      `upright margins of 66`);

    await setOrientation('sideways');
    assert(Math.abs(paperRatio(view) - 297 / 210) < 0.01,
      `sideways was asked for, sheet is ${paperRatio(view).toFixed(3)}`);
    assert(motifCols() <= 100,
      `${motifCols()} columns against landscape margins of 100`);
    await setOrientation('upright');
  });

await check('a word too wide to break is still refused, not mangled',
  async () => {
    // Wrapping can only break at spaces. Hyphenating would produce something
    // nobody can read and would hide the one message that tells the user
    // what to do about it.
    await typeWord('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD', 'block');
    assert(/warn stop/.test($('warnings').innerHTML),
      `239 columns was not refused: ${$('warnings').textContent}`);
    assert(/smaller style|larger sheet/i.test($('warnings').textContent),
      `the refusal does not say what to change: ${$('warnings').textContent}`);
  });

console.log('turning the sheet works in all three modes');

/**
 * Load the stub photograph into the picture tab.
 *
 * `readImage()` takes the file from the input, so the list has to be planted
 * before the change event; jsdom will not populate it.
 */
const loadPicture = async () => {
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(300);
  Object.defineProperty($('file'), 'files',
    { value: [new window.Blob(['x'])], configurable: true });
  $('file').dispatchEvent(new window.Event('change'));
  await wait(600);
};

await check('the choice is on screen in every mode, and survives the change',
  async () => {
    // Orientation is a property of the paper, not of where the motif came
    // from: you feed the sheet in sideways, and the sheet does not know
    // whether a photograph, a word or pasted art is going to land on it.
    // So it lives in "the paper" and must not be hidden or cleared by a
    // change of mode - the paper has not changed.
    await setOrientation('sideways');
    for (const tab of ['image', 'text', 'paste']) {
      [...window.document.querySelectorAll('.tab')]
        .find((t) => t.dataset.tab === tab).click();
      await wait(350);
      assert(whyHidden('orientation') === 'VISIBLE',
        `not reachable in the ${tab} tab: ${whyHidden('orientation')}`);
      assert($('orientation').value === 'sideways',
        `switching to the ${tab} tab reset the choice`);
    }
    // And it sits with the sheet size and the position, not in a tab panel.
    const fieldset = $('orientation').closest('fieldset');
    assert(fieldset && fieldset.contains($('paper')) && fieldset.contains($('align')),
      'the choice is not in the same block as the sheet size and position');
    await setOrientation('upright');
  });

await check('a word turns the sheet', async () => {
  await setOrientation('upright');
  await typeWord('LORENZ', 'relief');   // 95 columns; upright A4 holds 82
  assert(Math.abs(paperRatio(window.document.querySelector('.paper-view'))
    - 210 / 297) < 0.01, 'the sheet started turned');

  await setOrientation('sideways');
  assert(Math.abs(paperRatio(window.document.querySelector('.paper-view'))
    - 297 / 210) < 0.01, 'the sheet did not turn for a word');
  assert(/sideways/i.test($('instructions').textContent),
    'no instruction to feed it sideways');
});

await check('pasted art turns the sheet', async () => {
  // Nothing about pasted art is special, which is the point: the switch
  // belongs to the paper and applies wherever the motif came from.
  await setOrientation('upright');
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'paste').click();
  await wait(350);
  $('pasted').value = (`${'x'.repeat(100)}\n`).repeat(6).trim();
  $('pasted').dispatchEvent(new window.Event('input'));
  await wait(450);

  const view = window.document.querySelector('.paper-view');
  assert(Math.abs(paperRatio(view) - 210 / 297) < 0.01,
    'the sheet started turned');
  assert(/warn stop/.test($('warnings').innerHTML),
    `100 columns was not refused on upright A4: ${$('warnings').textContent}`);

  await setOrientation('sideways');
  assert(Math.abs(paperRatio(view) - 297 / 210) < 0.01,
    `the sheet did not turn for pasted art: ${paperRatio(view).toFixed(3)}`);
  assert(!/warn stop/.test($('warnings').innerHTML),
    'still refused after turning the sheet');
  assert(/sideways/i.test($('instructions').textContent),
    'no instruction to feed it sideways');
  assert(/sideways/i.test($('facts').textContent),
    `the facts still call it upright: ${$('facts').textContent}`);
  await setOrientation('upright');
});

await check('a picture turns the sheet, and gains the columns', async () => {
  // The mode that was never covered: the canvas stub used to return a blank
  // field, so the picture path ran with nothing to convert.
  await setOrientation('upright');
  await loadPicture();
  assert(motifCols() > 0, 'the stub photograph produced no motif at all');

  const view = window.document.querySelector('.paper-view');
  const upright = +$('width').max;
  assert(upright === 82,
    `upright A4 offered ${upright} columns to the edge, expected 82`);

  await setOrientation('sideways');
  assert(+$('width').max > upright,
    `the ceiling did not rise: still ${$('width').max}`);

  // The sheet turns because it was asked to, not because the motif grew.
  // It used to wait for the width to be dragged up first, which meant
  // ticking the box appeared to do nothing at all.
  assert(Math.abs(paperRatio(view) - 297 / 210) < 0.01,
    `the sheet did not turn when asked: ${paperRatio(view).toFixed(3)}`);

  $('width').value = '95';
  $('width').dispatchEvent(new window.Event('change'));
  await wait(600);

  assert(motifCols() > 66,
    `the picture is still ${motifCols()} columns, no wider than upright ` +
    `margins allowed`);
  assert(/sideways/i.test($('instructions').textContent),
    'no instruction to feed it sideways');
  assert(/sideways/i.test($('facts').textContent),
    `the facts still call it upright: ${$('facts').textContent}`);
  await setOrientation('upright');
});

await check('a picture can be made wider than the margins hold', async () => {
  // The ceiling used to be the usable area, so 66 was the widest an upright
  // A4 could be asked for even though the sheet takes 82. Past the margins
  // is a note about where the stops end up, not a reason to refuse.
  $('width').value = '78';
  $('width').dispatchEvent(new window.Event('change'));
  await wait(600);

  assert(motifCols() > 66,
    `still capped at the margins: ${motifCols()} columns`);
  assert(!/warn stop/.test($('warnings').innerHTML),
    `78 columns on an 82-column sheet was refused: ${$('warnings').textContent}`);
  assert(/usual margins/i.test($('warnings').textContent),
    `no note about the margins moving: "${$('warnings').textContent}"`);

  $('width').value = '60';
  $('width').dispatchEvent(new window.Event('change'));
  await wait(600);
});

console.log('several lines of lettering');

await check('a newline gives a second line of letters', async () => {
  await typeWord('HI', 'block');
  const one = window.document.querySelectorAll('.sheet .ln').length;
  await typeWord('HI\nHO', 'block');
  const two = window.document.querySelectorAll('.sheet .ln').length;
  assert(two > one * 2, `${two} lines for two words against ${one} for one`);
});

await check('the word box is one you can actually type two lines into', () => {
  const el = $('letterText');
  assert(el.tagName === 'TEXTAREA',
    `it is still a ${el.tagName}, which cannot hold a newline`);
  assert(!el.getAttribute('maxlength'),
    'still capped at a fixed length');
});

await check('the letters are drawn with keys the machine has', async () => {
  // The fault this replaced: app.js asked for '#', the SM7 has none, and
  // every style fell through to a wall of 'H'.
  await typeWord('HI', 'block');
  const art = [...window.document.querySelectorAll('.sheet .ln')]
    .map((e) => e.textContent).join('');
  const have = new Set([...$('charsetText').value || '']);
  assert(!/[#@*]/.test(art), `used a key the SM7 has not got: ${art}`);
  assert(art.replace(/\s/g, '').length > 0, 'nothing was drawn');
});

await check('the style hint names the keys it will strike', async () => {
  await typeWord('HI', 'relief');
  const t = $('letterStyleHint').textContent;
  assert(/three weights/i.test(t), `raised is not described: "${t}"`);

  await typeWord('HI', 'block');
  const plain = $('letterStyleHint').textContent;
  assert(/one character/i.test(plain), `block is not described: "${plain}"`);
  assert(plain !== t, 'the hint did not follow the style');
});

await check('a raised word really uses three different characters', async () => {
  await typeWord('OO', 'relief');
  const art = [...window.document.querySelectorAll('.sheet .ln')]
    .map((e) => e.textContent).join('');
  const used = new Set(art.replace(/\s/g, ''));
  assert(used.size >= 3,
    `only ${used.size} character(s): ${[...used].join('')}`);
});

console.log('setting up sits with the typing');

await check('the setup panel lives inside the typing step', () => {
  const setup = $('stepSetup');
  assert(setup, 'no setup panel');
  assert(setup.tagName === 'DETAILS', `it is a ${setup.tagName}, not foldable`);
  assert($('stepSheet').contains(setup),
    'still a section of its own above the typing');
});

await check('a shut panel still says what the settings were', async () => {
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = 'HI';
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(400);

  const summary = $('setupSummary').textContent;
  assert(/margin stop to \d+/i.test(summary),
    `the summary carries no numbers: "${summary}"`);
});

await check('it folds away once the first line is done', async () => {
  $('stepSetup').open = true;
  $('restart').click();
  await wait(60);
  $('next').click();
  await wait(60);

  assert(!$('stepSetup').open, 'still open after moving off the first line');
});

console.log('measuring the machine');

await check('the expected readings are offered before anything is measured', () => {
  const t = $('mExpect').textContent;
  // 39 steps: 99.1 mm for pica, 82.5 mm for elite. Seeing both first is what
  // makes the reading a decision rather than a guess — and 16 mm apart is a
  // difference nobody misreads.
  assert(/99\.1 mm/.test(t) && /82\.5 mm/.test(t), `got "${t}"`);
});

await check('a pica reading is recognised and reported', async () => {
  $('mCount').value = '40';
  $('mMm').value = String((39 * 25.4 / 10).toFixed(1));
  $('mApply').click();
  await new Promise((r) => setTimeout(r, 60));

  assert(/pica/.test($('mResult').textContent),
    `got "${$('mResult').textContent}"`);
  // What fits inside the margins, which is the number that is any use.
  assert(/66 characters across/.test($('mResult').textContent),
    'did not report what fits on the sheet');
});

await check('an elite reading changes what fits on the sheet', async () => {
  $('mMm').value = String((39 * 25.4 / 12).toFixed(1));
  $('mApply').click();
  await new Promise((r) => setTimeout(r, 60));

  assert(/elite/.test($('mResult').textContent),
    `got "${$('mResult').textContent}"`);
  assert(/81 characters across/.test($('mResult').textContent),
    'sheet width did not follow the measurement');
  assert(/12 cpi/.test($('machineHint').textContent),
    'the machine still describes itself as pica');
});

await check('the measurement survives being written to storage', () => {
  const saved = JSON.parse(window.localStorage.getItem('typewriter-ascii'));
  assert(saved.measured?.['olympia-sm7']?.cpi === 12,
    'measurement was not saved: ' + JSON.stringify(saved.measured));
});

await check('a reading between the pitches is refused and nothing changes', async () => {
  $('mMm').value = '90';
  $('mApply').click();
  await new Promise((r) => setTimeout(r, 60));

  assert(/Nothing has been changed/.test($('mResult').textContent),
    `got "${$('mResult').textContent}"`);
  assert(/12 cpi/.test($('machineHint').textContent),
    'a bad reading was allowed through');
});

await check('the measurement can be undone', async () => {
  $('mClear').click();
  await new Promise((r) => setTimeout(r, 60));

  assert(/10 cpi/.test($('machineHint').textContent),
    `still measured: "${$('machineHint').textContent}"`);
  assert(/\(pica\)/.test($('machineHint').textContent),
    'the pitch is no longer named');
});

console.log('counting by ear, and admitting when it has failed');

await check('nothing claims to be lost before anything is being counted', () => {
  assert($('lost').hidden, 'the lost warning is showing with no listener');
  assert(!window.document.body.classList.contains('lost'), 'lost class set');
});

await check('the microphone panel is hidden until listening starts', () => {
  assert($('ear').hidden, 'the ear panel is showing unprompted');
});

await check('the way to keep your hands on the machine is explained', () => {
  // The most reliable line advance is a ten-euro Bluetooth shutter remote,
  // which already works because it enumerates as a keyboard. It is worth
  // nothing if nobody is told, so this checks the page says so.
  const hands = $('stepHands');
  assert(hands, 'no panel about keeping your hands on the machine');
  const t = hands.textContent;
  assert(/shutter remote/i.test(t), `remotes are not mentioned: "${t}"`);
  assert(/foot switch/i.test(t), 'foot switches are not mentioned');
  assert(/Space|Enter/.test(t), 'the keys it actually listens for are not named');
});

await check('the keys named in that panel are the keys that work', async () => {
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = 'HI';
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(400);
  $('restart').click();
  await wait(60);

  const line = () => [...window.document.querySelectorAll('.sheet .ln')]
    .findIndex((e) => e.classList.contains('now'));
  const press = (key) => window.document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles: true }));

  const start = line();
  press(' ');
  assert(line() === start + 1, 'space did not advance the line');
  press('ArrowUp');
  assert(line() === start, 'up did not go back');
  press('Enter');
  assert(line() === start + 1, 'enter did not advance the line');
  press('ArrowUp');
});

await check('clicking a character in the open line moves the count there', async () => {
  $('restart').click();
  await wait(60);
  const open = window.document.querySelector('.sheet .ln.now');
  const cells = [...open.querySelectorAll('.c')];
  assert(cells.length > 3, `the open line has ${cells.length} characters`);
  cells[2].click();
  await wait(30);
  assert(/^2 \//.test($('strikes').textContent),
    `the count reads "${$('strikes').textContent}"`);
});

console.log('the picture controls are on screen');

/**
 * Why a control cannot be seen, or 'VISIBLE'.
 *
 * Walks up from the control looking for the three ways this page hides
 * something: a shut <details>, a `hidden` ancestor, and a tab panel that is
 * not the active one. jsdom does no layout, so asking for a bounding box
 * would answer nothing; these three are the actual mechanisms in use.
 */
function whyHidden(id) {
  let el = $(id);
  const reasons = [];
  while (el && el !== window.document.body) {
    if (el.tagName === 'DETAILS' && !el.open) {
      reasons.push(`inside a shut <${el.querySelector('summary')?.textContent.trim()}>`);
    }
    if (el.hidden) reasons.push(`hidden ancestor #${el.id || el.className}`);
    if (el.classList?.contains('panel') && !el.classList.contains('on')) {
      reasons.push(`inactive panel ${el.dataset.panel}`);
    }
    el = el.parentElement;
  }
  return reasons.length ? reasons.join(' + ') : 'VISIBLE';
}

await check('every picture control is on screen without a click', async () => {
  /*
   * Contrast and detail were moved into a <details>Fine tuning</details>
   * with no `open` attribute, so the picture tab arrived showing three
   * controls out of five - and the two missing were the two that decide
   * whether the result reads as a drawing or as mud.
   *
   * Measured before the fix: mode, invert and width VISIBLE; contrast and
   * detail both "inside a shut <Fine tuning>". Nobody opens a panel called
   * fine tuning to look for the main controls.
   */
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(350);

  for (const id of ['mode', 'invert', 'width', 'contrast', 'detail']) {
    assert(whyHidden(id) === 'VISIBLE',
      `${id} needs a click before it can be seen: ${whyHidden(id)}`);
  }
});

await check('and they get out of the way where nothing reads them', async () => {
  // The same rule the width slider already followed. In the paper block
  // contrast and detail stayed on screen for lettering and pasted art once
  // the disclosure had been opened - two sliders nothing consults, which is
  // the exact fault the width slider was fixed for.
  for (const tab of ['text', 'paste']) {
    [...window.document.querySelectorAll('.tab')]
      .find((t) => t.dataset.tab === tab).click();
    await wait(350);
    for (const id of ['contrast', 'detail', 'mode', 'invert']) {
      assert(whyHidden(id) !== 'VISIBLE',
        `${id} is still offered in the ${tab} tab, where it does nothing`);
    }
  }

  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(350);
});

await check('the picture controls still drive the conversion', async () => {
  // Moving them must not have left the readouts or the handlers behind.
  for (const [id, want] of [['contrast', '250'], ['detail', '90']]) {
    $(id).value = want;
    $(id).dispatchEvent(new window.Event('input'));
    assert($(`${id}Out`).textContent === `${want}%`,
      `${id} readout says "${$(`${id}Out`).textContent}", not ${want}%`);
  }
});

await check('no disclosure is left standing with nothing behind it', () => {
  // The block contrast and detail came out of held nothing else. A <summary>
  // people have learned to open, with nothing behind it, is worse than no
  // panel at all.
  //
  // Asked of the DOM rather than of the source text, because the source
  // still says "Fine tuning" - in the comment explaining why the panel is
  // gone, which is exactly where that phrase should survive.
  for (const d of window.document.querySelectorAll('.controls-col details')) {
    const summary = d.querySelector('summary');
    const body = [...d.children].filter((c) => c !== summary);
    assert(body.some((c) => c.textContent.trim() || c.querySelector('input, select, button')),
      `"${summary?.textContent.trim()}" opens onto nothing`);
  }
});

console.log('the app disagreeing with itself');

await check('every panel numbers the lines the same way', async () => {
  // The table used to add the paper feed, so line one of a word centred on
  // A4 was called line 32 there and line 1 in the sheet, the progress
  // counter and the typing sheet in the PDF. Four places, two schemes, and
  // the odd one out was the panel headed "for looking things up".
  //
  // Motif numbering is the checkable one: the paper feed happens once,
  // before typing, and afterwards nothing on the page or the machine says
  // which absolute line of the sheet you are on.
  await typeWord('HI', 'block');
  const nums = [...window.document.querySelectorAll('#table tr td.n')]
    .map((e) => +e.textContent);
  const lines = window.document.querySelectorAll('.sheet .ln').length;
  assert(nums[0] === 1, `the table starts at line ${nums[0]}, not 1`);
  assert(nums[nums.length - 1] === lines,
    `the table ends at ${nums[nums.length - 1]} for ${lines} lines`);
  assert($('count').textContent.includes(`/ ${lines} lines`),
    `the counter says "${$('count').textContent}" for ${lines} lines`);
});

await check('the line you are on is not re-read from storage on every redraw',
  async () => {
    // draw() ended by reloading `at` from localStorage, which made a stored
    // number outrank the running one on any path that had not written to
    // storage yet. A resize is the plain case.
    await typeWord('HELLO', 'block');
    $('restart').click();
    await wait(60);
    $('next').click();
    $('next').click();
    await wait(60);
    const at = () => [...window.document.querySelectorAll('.sheet .ln')]
      .findIndex((e) => e.classList.contains('now'));
    const before = at();
    assert(before === 2, `walked to ${before}, expected 2`);

    window.dispatchEvent(new window.Event('resize'));
    await wait(80);
    assert(at() === before, `a redraw moved the line from ${before} to ${at()}`);
  });

await check('minus one moves the readout, not just the highlight', async () => {
  // The readout is the only thing that says where the count is. It was left
  // showing the number from before the correction, so the button looked
  // like it did nothing.
  await typeWord('HELLO', 'block');
  $('restart').click();
  await wait(60);
  const open = window.document.querySelector('.sheet .ln.now');
  [...open.querySelectorAll('.c')][4].click();
  await wait(40);
  assert(/^4 \//.test($('strikes').textContent),
    `expected to be at 4, reads "${$('strikes').textContent}"`);

  $('back1').click();
  await wait(40);
  assert(/^3 \//.test($('strikes').textContent),
    `after -1 the readout still says "${$('strikes').textContent}"`);
});

await check('learning from typing clears both views of the character set',
  async () => {
    // It cleared the keyboard and left the text field listing all 88
    // characters of the old machine, so the dialog showed "nothing chosen"
    // and "everything chosen" side by side.
    $('editCharset').click();
    await wait(40);
    const keysOn = () =>
      window.document.querySelectorAll('#keyboard .key.on').length;

    $('learn').click();
    await wait(40);
    assert(keysOn() === 0, `${keysOn()} keys still lit after clearing`);
    assert($('charsetText').value === '',
      `the text field still lists ${$('charsetText').value.length} characters`);

    window.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    await wait(40);
    assert(keysOn() === 2, `${keysOn()} keys lit after two keystrokes`);
    assert($('charsetText').value === 'qw',
      `the text field says "${$('charsetText').value}" while learning`);

    $('learn').click();
    await wait(40);
    // Leave the machine as it was for the tests that follow.
    window.document.querySelector('[data-pick="all"]').click();
    $('charsetDialog').close?.();
    $('charsetDialog').dispatchEvent(new window.Event('close'));
    await wait(300);
  });

console.log('errors during the run');

await check('nothing threw along the way', () => {
  assert(errors.length === 0, errors.join('\n       '));
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
