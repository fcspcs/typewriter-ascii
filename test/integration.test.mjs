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

await check('the lines are listed once, not twice', () => {
  // A second copy of every line lived below the sheet, headed "for looking
  // things up". Two lists of the same lines is two places to lose your
  // place in, and the one you are not typing from wins the argument.
  assert(!window.document.getElementById('table'),
    'the reference table is back');
  assert(window.document.querySelectorAll('.sheet').length === 1,
    'more than one sheet on the page');
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
  $('letterStyle').value = 'oblique';
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

await check('shadow is not offered where there is no shadow to colour', async () => {
  // It colours the second surface of art that draws one. No drawn face
  // ships with a second surface any more — the three-dimensional face is
  // one weight plus its projection marks — and a picture never had a
  // shadow layer. The scheme itself stays for pasted art that arrives in
  // two weights.
  $('letterStyle').value = 'oblique';
  $('letterStyle').dispatchEvent(new window.Event('change'));
  await wait(300);
  assert(![...$('ink').options].some((o) => o.value === 'shadow'),
    'offered on a face with no second surface');

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
  $('letterStyle').value = 'oblique';
  $('letterStyle').dispatchEvent(new window.Event('change'));
  await setInk('bands');
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

await check('nothing else on the page answers to the layout\'s name', () => {
  /*
   * `.compose` is the page: a fixed 20rem column of settings beside a column
   * of paper. A widget elsewhere took the same class for a row of two
   * buttons and redeclared it `display: flex` further down the stylesheet —
   * later, and no less specific, so it won. The whole page became a flex
   * row: the settings column grew to the width of its own hint text and the
   * paper shrank into what was left, which is the layout inside out.
   *
   * Both halves are checked, because either one alone would let it back in:
   * a second element with the name, or a second rule declaring it.
   */
  const claims = [...window.document.querySelectorAll('.compose')];
  assert(claims.length === 1,
    `${claims.length} elements claim to be the page layout`);
  assert(claims[0].tagName === 'SECTION',
    `the page layout is a <${claims[0].tagName.toLowerCase()}>, not the section`);

  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const blocks = [...css.matchAll(/\.compose\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert(blocks.length > 0, 'the page layout is not declared at all');
  const stray = blocks.find((b) => /display:\s*(?!grid)\S/.test(b));
  assert(!stray, `something else redeclares the page layout: "${stray?.trim()}"`);
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
  // An empty cell reads as "nothing here", which is the exact misreading
  // that loses the count. Every space you must type is a tinted cell.
  const open = window.document.querySelector('.sheet .ln.now');
  assert(open, 'no line is open');
  if (!open.querySelectorAll('.run').length) return;   // a blank line
  // The sheet writes its spaces as non-breaking ones, so a browser cannot
  // collapse the very thing being counted.
  const blanks = [...open.textContent]
    .filter((c) => c.charCodeAt(0) === 0xa0).length;
  const marked = open.querySelectorAll('.run.gap .c').length;
  assert(blanks === marked,
    `${blanks} spaces in the open line, ${marked} of them marked`);
});

await check('the space key is cut from the sheet, not drawn beside it', () => {
  // The key used to be a glyph of its own - an open box - while the sheet
  // drew a tinted cell with a dot in it. One space, two symbols, and the
  // reader left to work out they meant the same thing.
  const key = window.document.querySelector('.sheet-key .run.gap .c');
  assert(key, 'the space key is not built from the sheet’s own cell');
  assert(key.textContent.trim() === '',
    `the key spells the space out as ${JSON.stringify(key.textContent)}`);
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

await check('a sentence meets the machine, and says what it will strike',
  async () => {
    /*
     * The path that used to go straight to the sheet. A `}` in the box
     * spelled a whole motif in a character the Olympia SM7 has not got,
     * and nothing anywhere said so — the promise the rest of the program
     * keeps, broken in the one place nobody had wired to the stand-in
     * engine.
     */
    // The field lives in the picture panel, so the warning belongs there
    // too — it is hidden with the panel when another tab is on.
    [...window.document.querySelectorAll('.tab')]
      .find((t) => t.dataset.tab === 'image').click();
    await wait(300);
    $('sentence').value = 'hello}world';
    $('sentence').dispatchEvent(new window.Event('input'));
    await wait(500);

    const t = $('sentenceFit').textContent;
    assert(!$('sentenceFit').hidden, 'nothing said about an untypeable mark');
    assert(/\} as \)/.test(t), `the swap is not named: "${t}"`);
    assert(!$('sentenceFit').classList.contains('stop'),
      'a sentence that can still be typed was refused');
  });

await check('and a sentence with nothing typeable left is refused', async () => {
  // There is then nothing to spell the picture with.
  $('sentence').value = '▓▒░';
  $('sentence').dispatchEvent(new window.Event('input'));
  await wait(500);

  assert($('sentenceFit').classList.contains('stop'),
    `not refused: "${$('sentenceFit').textContent}"`);
  assert(/nothing to spell/i.test($('sentenceFit').textContent),
    `no reason given: "${$('sentenceFit').textContent}"`);

  $('sentence').value = 'she loved him and he loved her';
  $('sentence').dispatchEvent(new window.Event('input'));
  await wait(400);
  assert($('sentenceFit').hidden, 'the refusal outlived the sentence');

  $('mode').value = 'shape';
  $('mode').dispatchEvent(new window.Event('change'));
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  await wait(300);
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

await check('an empty lettering box previews its placeholder', async () => {
  // The box already shows its placeholder in grey; the sheet now shows the
  // same word, so the faces can be flicked through before anything is
  // typed. A ghost, not a job: preview and facts, but no setup numbers and
  // no sheet to work down.
  const tabs = [...window.document.querySelectorAll('.tab')];
  tabs.find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = '';
  $('letterText').dispatchEvent(new window.Event('input'));
  await new Promise((r) => setTimeout(r, 350));

  assert(window.document.body.classList.contains('ghost'),
    'ghost state not set');
  assert(!window.document.body.classList.contains('empty'),
    'marked empty although the placeholder is on show');
  assert($('mini').textContent.trim().length > 0,
    'no preview of the placeholder');
  assert(/keystrokes/.test($('facts').textContent), 'no facts for the ghost');
  assert($('instructions').children.length === 0,
    'setup instructions for a word nobody typed: ' +
    $('instructions').textContent);
  assert($('sheet').innerHTML.trim() === '', 'a typing sheet for a ghost');
});

await check('the faces can be compared on the ghost', async () => {
  const before = $('mini').textContent;
  const other = [...$('letterStyle').options]
    .find((o) => o.value !== $('letterStyle').value && !o.disabled);
  assert(other, 'no second face to switch to');
  $('letterStyle').value = other.value;
  $('letterStyle').dispatchEvent(new window.Event('change'));
  await wait(100);
  assert($('mini').textContent.trim().length > 0, 'the preview went blank');
  assert($('mini').textContent !== before,
    'the preview did not follow the face');
});

await check('no setup numbers are shown before there is a motif', async () => {
  // setUp() happily centres an empty motif and returns a margin stop of 41.
  // Printing that as "set your margin stop to 41" is advice about nothing.
  // The picture tab has no placeholder to preview, so with no picture it is
  // genuinely empty — and leaving the lettering tab takes the ghost away.
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(350);

  assert(window.document.body.classList.contains('empty'),
    'empty state not set');
  assert(!window.document.body.classList.contains('ghost'),
    'the ghost survived leaving the lettering tab');
  assert($('instructions').children.length === 0,
    'still showing setup instructions: ' + $('instructions').textContent);
  assert($('facts').textContent.trim() === '', 'still showing facts');
  assert($('sheet').innerHTML.trim() === '', 'sheet not cleared');
});

await check('the instructions come back once there is something to type', async () => {
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = 'HI';
  $('letterText').dispatchEvent(new window.Event('input'));
  await new Promise((r) => setTimeout(r, 350));

  assert(!window.document.body.classList.contains('empty'), 'still empty');
  assert(!window.document.body.classList.contains('ghost'),
    'a typed word is still marked as a ghost');
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
  assert(/66 across inside/.test($('widthHint').textContent)
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

await check('it applies wherever there is a layout to decide', async () => {
  /*
   * A picture is scaled to it and a word breaks at spaces to reach it, so
   * the one number that decides how wide a motif comes out belongs in both
   * — it used to be readable in the picture tab alone, which left lettering
   * laid out to a width nobody could see or change.
   *
   * Pasted art is the exception, and the tab says so rather than offering a
   * dead control: art arrives at its own size and has no layout left to
   * decide. A slider there would have to resample it to mean anything.
   */
  for (const tab of ['image', 'text']) {
    [...window.document.querySelectorAll('.tab')]
      .find((t) => t.dataset.tab === tab).click();
    await wait(350);
    assert(!$('widthRow').hidden, `gone missing in the ${tab} tab`);
  }

  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'paste').click();
  await wait(350);
  assert($('widthRow').hidden, 'still offered for pasted art');
  assert(/own size/.test($('pasteFit').textContent),
    `no reason given in its place: "${$('pasteFit').textContent}"`);
  assert(/\d+ columns/.test($('pasteFit').textContent),
    `the numbers the slider would have set are not stated: ` +
    `"${$('pasteFit').textContent}"`);

  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(350);
});

await check('a line of lettering breaks at spaces to the width set', async () => {
  // The cap is what makes a sentence unable to overrun the paper: whatever
  // the slider is set to is inside the sheet, and lines break to reach it.
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('width').value = '40';
  $('width').dispatchEvent(new window.Event('change'));
  // Words that each fit the setting on their own, so what is being tested
  // is the break and not the refusal.
  $('letterText').value = 'HI HO ES DU';
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(500);

  const wide = Math.max(0, ...$('mini').textContent.split('\n')
    .map((r) => r.replace(/\s+$/, '').length));
  const from = Math.min(...$('mini').textContent.split('\n')
    .filter((r) => r.trim()).map((r) => r.length - r.trimStart().length));
  assert(wide - from <= 40,
    `${wide - from} columns against the 40 the slider was set to`);

  $('width').value = '60';
  $('width').dispatchEvent(new window.Event('change'));
  await wait(400);
});

await check('a word too wide to break is caught at the box it was typed in',
  async () => {
    /*
     * The one motif that can still be asked for and not fit: wrapping only
     * ever breaks at a space, so a single long word cannot be rescued by a
     * narrower column. It is named where it was typed, with both numbers,
     * and the ways out that would actually work are offered as buttons —
     * never turning the sheet, which is narrower still.
     */
    $('letterText').value = 'Moinnnnnnnnnnnnnnnnnnn';
    $('letterText').dispatchEvent(new window.Event('input'));
    await wait(500);

    const t = $('letterFit').textContent;
    assert(!$('letterFit').hidden, 'nothing said about a word that will not fit');
    assert(/\d+ of \d+ columns/.test(t), `both numbers are not given: "${t}"`);
    assert(/Moinnn/.test(t), `the offending word is not named: "${t}"`);
    assert($('letterText').classList.contains('over'),
      'the box does not show that it holds something untypeable');

    // And it goes away again when the word does fit.
    $('letterText').value = 'HI';
    $('letterText').dispatchEvent(new window.Event('input'));
    await wait(500);
    assert($('letterFit').hidden, 'the refusal outlived the word that caused it');
    assert(!$('letterText').classList.contains('over'),
      'the box stayed marked after the word was shortened');
  });

console.log('planning a motif to be read sideways');

// The motif width, measured from the lines that are NOT open. The open line
// is drawn with run labels above the characters, so its textContent is
// longer than the line it represents.
const motifCols = () => Math.max(0,
  ...[...window.document.querySelectorAll('.sheet .ln')]
    .filter((e) => !e.classList.contains('now'))
    .map((e) => e.textContent.replace(/\u00a0/g, ' ').replace(/\s+$/, '').length));

const typeWord = async (text, style = 'oblique') => {
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterStyle').value = style;
  $('letterStyle').dispatchEvent(new window.Event('change'));
  $('letterText').value = text;
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(420);
};

/**
 * How far the last inked line of the preview sits inside the motif, left and
 * right.
 *
 * Read off the preview and not off the typing sheet, because the sheet
 * expands the line you are on into runs — `3 x space` rather than three
 * spaces — so its text is a description of the line rather than the line.
 *
 * Measured against the motif's own ink rather than against column zero: the
 * preview draws the whole sheet, so every row carries the margin the paper
 * feed puts there, and that offset is the same on every row and none of its
 * business here.
 */
const shortLineOffsets = () => {
  const all = $('mini').textContent.split('\n');
  while (all.length && !all[all.length - 1].trim()) all.pop();
  const rows = all.filter((r) => r.trim());
  const edges = (rs) => rs.map((r) => ({
    left: r.length - r.trimStart().length,
    right: r.replace(/\s+$/, '').length,
  }));
  const whole = edges(rows);
  const from = Math.min(...whole.map((e) => e.left));
  const to = Math.max(...whole.map((e) => e.right));
  // The last *block's* envelope, not its last row: extrude's bottom row
  // stops short of the depth the projection casts up and to the right.
  const lastBlank = all.reduce((at, l, i) => (l.trim() ? at : i), -1);
  const block = edges(all.slice(lastBlank + 1).filter((r) => r.trim()));
  return {
    left: Math.min(...block.map((e) => e.left)) - from,
    right: to - Math.max(...block.map((e) => e.right)),
  };
};

const setOrientation = async (which) => {
  $('orientation').value = which;
  $('orientation').dispatchEvent(new window.Event('change'));
  await wait(420);
};

await check('the paper stays upright whichever way the motif is planned',
  async () => {
    /*
     * The whole correction, in one assertion.
     *
     * "Sideways" used to swap the paper's width and height, and everything
     * downstream believed it: A4 became 297 mm of writing line on a machine
     * whose carriage scale ends at 249, the width slider offered 116 columns,
     * and setUp() worked out a left stop of 7 and a right stop of 80 for
     * them. Seventy-three columns of carriage for a hundred and sixteen
     * columns of motif, reported as three notes and no refusal.
     *
     * A sheet goes in on its short edge. That is the edge the platen is as
     * wide as, and no setting on this page can change it.
     */
    await typeWord('HI', 'oblique');
    const view = window.document.querySelector('.paper-view');
    for (const which of ['upright', 'left', 'right']) {
      await setOrientation(which);
      assert(Math.abs(paperRatio(view) - 210 / 297) < 0.01,
        `${which} put A4 in the machine sideways: ` +
        `${paperRatio(view).toFixed(3)}`);
    }
    await setOrientation('upright');
  });

await check('a motif too tall for A4 fits once it is planned sideways',
  async () => {
    /*
     * What turning actually buys, and it is the opposite of what the app used
     * to claim. A sheet is taller than it is wide, so laying the motif down
     * gives its height the long axis: 82 cells down against 70 across.
     *
     * Stated in pasted art rather than in a word, because the numbers have to
     * be exact for the assertion to mean anything. 60 by 78 does not fit an
     * A4 that holds 82 by 70; laid down it is 78 by 60, and it does.
     */
    await setOrientation('upright');
    [...window.document.querySelectorAll('.tab')]
      .find((t) => t.dataset.tab === 'paste').click();
    await wait(350);
    $('pasted').value = (`${'x'.repeat(60)}\n`).repeat(78).trim();
    $('pasted').dispatchEvent(new window.Event('input'));
    await wait(500);
    assert(/warn stop/.test($('warnings').innerHTML),
      `78 lines were not refused on an A4 that holds 70: ` +
      `${$('warnings').textContent}`);

    await setOrientation('left');
    assert(!/warn stop/.test($('warnings').innerHTML),
      `still refused when planned sideways: ${$('warnings').textContent}`);
    assert(motifCols() === 78 || $('facts').textContent.includes('78 × 60'),
      `laid down it should be 78 across by 60 down: ${$('facts').textContent}`);
  });

await check('the motif is what lies down, and the facts say so', async () => {
  // Typed 5 x 29 and seen 29 x 5, say. The machine's numbers come first
  // because they are the ones you check against the carriage scale, but the
  // size that was asked for has to be there too or the panel looks broken.
  const t = $('facts').textContent;
  assert(/typed/.test(t) && /seen/.test(t),
    `the two sizes are not both given: ${t}`);
  assert(/turned left/.test(t), `the facts do not say it is turned: ${t}`);
});

await check('the preview can be held either way', async () => {
  // The sheet is drawn upright and rotated whole, so what turns is the
  // paper, characters and all - the glyphs are visibly lying on their sides
  // rather than being redrawn as letters the machine cannot strike.
  const view = window.document.querySelector('.paper-view');
  assert(view.classList.contains('turned'),
    'a sideways motif was previewed as though it were upright');
  assert(/rotate\(-90deg\)/.test(view.style.transform),
    `a left turn is not a quarter turn anticlockwise: "${view.style.transform}"`);
  // Still an upright sheet underneath. The rotation is a way of holding it.
  assert(Math.abs(paperRatio(view) - 210 / 297) < 0.01,
    'the rotation was faked by reshaping the paper');

  $('zoomTurn').click();
  await wait(200);
  assert(!view.classList.contains('turned'),
    'the preview would not go back to the sheet as it is typed');
  $('zoomTurn').click();
  await wait(200);
});

/*
 * A turned sheet measuring itself.
 *
 * jsdom does no layout, so both elements are given what a browser would
 * report: the wrapper is an ordinary block and is as wide as the column, and
 * the turned sheet is out of the flow with `width: auto`, so it reports
 * shrink-to-fit — very nearly the width it was last given. That last part is
 * the whole trap, and without it standing in for a real browser none of this
 * can be caught here at all.
 */
const COLUMN = 420;
const fakeWidths = () => {
  const view = window.document.querySelector('.paper-view');
  const box = view.parentElement;
  Object.defineProperty(box, 'clientWidth',
    { get: () => COLUMN, configurable: true });
  Object.defineProperty(view, 'clientWidth',
    { get: () => parseFloat(view.style.width) || COLUMN, configurable: true });
  return () => { delete box.clientWidth; delete view.clientWidth; };
};

await check('a turned sheet keeps its size when the page is redrawn', async () => {
  // The fault this is here about: `fit` measured the room it had on the
  // sheet itself. Turned, the sheet is out of the flow, so what came back
  // was its own short side rather than the column — and every redraw stood
  // the sheet down by its aspect ratio again. Pressing fit a few times over
  // a sideways motif shrank it to nothing.
  const view = window.document.querySelector('.paper-view');
  const undo = fakeWidths();
  try {
    $('zoomReal').click();
    await wait(150);
    $('zoomFit').click();
    await wait(150);

    const first = parseFloat(view.style.height);
    assert(first > 1, `nothing was fitted: "${view.style.height}"`);

    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new window.Event('resize'));
      await wait(60);
    }
    const after = parseFloat(view.style.height);
    assert(Math.abs(after - first) < 1,
      `the sheet shrank from ${first} to ${after} px across four redraws`);
    assert(Math.abs(first - COLUMN) < 2,
      `a turned sheet should lie right across the column: ${first} of ${COLUMN}`);
  } finally { undo(); }
});

await check('pressing the size you are already on does nothing', async () => {
  // Not merely harmless — nothing at all. The sizing is idempotent now, so a
  // second press would land on the same number anyway, but a button that is
  // already the answer should not act, and there is then no second
  // measurement left to go wrong.
  const undo = fakeWidths();
  try {
    const before = $('mini').innerHTML;
    $('mini').innerHTML = 'scribble';
    $('zoomFit').click();
    $('zoomFit').click();
    await wait(120);
    assert($('mini').innerHTML === 'scribble',
      'pressing fit while already fitted redrew the sheet');
    $('mini').innerHTML = before;
  } finally { undo(); }
});

await check('a turned sheet at actual size can be reached at the foot',
  async () => {
    /*
     * Turned and at actual size the sheet is deliberately bigger than the
     * box: 297 mm across and 210 mm down. The box was being pinned to that
     * whole footprint and then clipped by the height ceiling with the
     * overflow hidden, so the bottom of the paper was cut off with no way to
     * scroll to it.
     */
    const view = window.document.querySelector('.paper-view');
    const box = view.parentElement;
    const mm = 96 / 25.4;
    const undo = fakeWidths();
    try {
      $('zoomReal').click();
      await wait(200);

      // Still an upright sheet underneath, in real millimetres. The rotation
      // is what makes it lie across.
      assert(Math.abs(parseFloat(view.style.width) - 210 * mm) < 1,
        `the sheet is ${view.style.width}, not 210 mm`);
      assert(Math.abs(parseFloat(view.style.height) - 297 * mm) < 1,
        `the sheet is ${view.style.height} long, not 297 mm`);

      // The box keeps the column's width and becomes the window you look
      // through. Pinned to the sheet's 297 mm it would drag the whole page
      // sideways to hold a preview.
      assert(box.style.width === '',
        `the box was pinned to ${box.style.width}, wider than the column`);
      assert(Math.abs(parseFloat(box.style.height) - 210 * mm) < 1,
        `the box is ${box.style.height} tall, not the 210 mm of a sheet on its side`);

      const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
      const block = css.match(/\.paper-scroll\.real\.turned\s*\{[^}]*\}/)?.[0] ?? '';
      assert(/overflow:\s*auto/.test(block),
        `the foot of a turned sheet stays hidden: "${block}"`);
    } finally {
      $('zoomFit').click();
      await wait(150);
      undo();
    }
  });

await check('the instructions feed it in upright and turn it at the end',
  () => {
    const steps = [...$('instructions').children].map((e) => e.textContent);
    assert(/upright/i.test(steps[0]),
      `the first step is not to feed the paper in upright: "${steps[0]}"`);
    assert(!/sideways.{0,20}first|long edge/i.test(steps.join(' ')),
      'still telling somebody to feed the sheet in on its long edge');
    const last = steps[steps.length - 1];
    assert(/turn the finished sheet to the left/i.test(last),
      `the last step is not the quarter turn: "${last}"`);
    assert(/anticlockwise/i.test(last),
      `the turn is named but not explained: "${last}"`);
  });

await check('a right turn is the other quarter turn', async () => {
  await setOrientation('right');
  const last = [...$('instructions').children].pop().textContent;
  assert(/to the right/i.test(last) && /clockwise/i.test(last),
    `a right turn was not described: "${last}"`);
  const view = window.document.querySelector('.paper-view');
  assert(/rotate\(90deg\)/.test(view.style.transform),
    `the preview did not turn the other way: "${view.style.transform}"`);
});

await check('a small word stays sideways once sideways is chosen', async () => {
  /*
   * The switch used to say "if it helps", so a motif that fitted upright
   * quietly turned the paper back — the same settings gave different paper
   * depending on the word. It is a stated choice now, and only that.
   */
  await setOrientation('left');
  await typeWord('HI', 'oblique');
  assert(/turn the finished sheet to the left/i
    .test($('instructions').textContent),
    'sideways was chosen but the instructions do not say so');
});

await check('the choice is explained in millimetres, not in columns',
  async () => {
    /*
     * This hint used to sell landscape as extra room: "sideways would be 100
     * x 39" against an upright 66 x 60, as though the sheet had grown. It had
     * not. Same paper, same margins, same cells — they only stand the other
     * way up. The difference that is real is the width in millimetres, and a
     * cell count hides it because a turned cell is 4.23 mm wide against 2.54.
     */
    await setOrientation('upright');
    const upright = $('orientationHint').textContent;
    assert(/66 × 60/.test(upright), `the upright area is not given: "${upright}"`);
    assert(/168 mm/.test(upright) && /254 mm/.test(upright),
      `the two widths are not compared in millimetres: "${upright}"`);
    assert(/goes in upright/.test(upright),
      `it does not say the paper stays put: "${upright}"`);

    await setOrientation('left');
    const turned = $('orientationHint').textContent;
    assert(/60 × 66/.test(turned) && /254 mm/.test(turned),
      `nothing useful said while turned: "${turned}"`);
    assert(!/100/.test(turned),
      `still claiming the 100 columns a turned sheet never had: "${turned}"`);
  });

await check('the turn survives a reload, and so does an old one', async () => {
  const saved = JSON.parse(window.localStorage.getItem('typewriter-ascii'));
  assert(saved.orientation === 'left',
    `not saved: ${JSON.stringify(saved.orientation)}`);
  // Somebody whose last visit predates the correction asked for a sideways
  // read, which is still a thing you can ask for. Only the account of how it
  // gets typed has changed, so it is honoured rather than thrown away.
  assert([...$('orientation').options].some((o) => o.value === 'left'),
    'the select no longer offers a turn to migrate an old choice onto');
  await setOrientation('upright');
});

console.log('composing: one motif across several sheets');

const paste = async (cols, rows) => {
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'paste').click();
  await wait(300);
  $('pasted').value = Array.from({ length: rows }, () => 'x'.repeat(cols)).join('\n');
  $('pasted').dispatchEvent(new window.Event('input'));
  await wait(500);
};

const compose = async (across, down) => {
  $('paper').value = 'compose';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(350);
  [...$('matrix').querySelectorAll('.cell')]
    .find((el) => +el.dataset.a === across && +el.dataset.d === down).click();
  await wait(550);
};

const picks = () => [...$('sheetPick').querySelectorAll('.pick')];

await check('the block is opened from the sheet picker, not by a size', async () => {
  // The last entry in the list is not a paper size and must not read like
  // one: it leaves the sheet alone and opens the matrix, where the size
  // appears again as "of".
  await setOrientation('upright');
  await paste(120, 90);
  assert($('composeRow').hidden, 'the matrix was open on a single sheet');
  assert(/warn stop/.test($('warnings').innerHTML),
    `120 x 90 was not refused on one A4: ${$('warnings').textContent}`);

  $('paper').value = 'compose';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(400);
  assert(!$('composeRow').hidden, 'choosing compose did not open the matrix');
  assert($('composeUnit').value === 'a4',
    `the sheet size was lost: ${$('composeUnit').value}`);
  assert(/One sheet/.test($('composeHint').textContent),
    `an unpicked matrix is not one sheet: "${$('composeHint').textContent}"`);
  // Nothing has been composed yet, so nothing has changed about the paper.
  assert(/warn stop/.test($('warnings').innerHTML),
    'opening the block silently resized the paper');
});

await check('a matrix makes the motif fit, and says what it costs', async () => {
  await compose(2, 2);
  assert(!/warn stop/.test($('warnings').innerHTML),
    `120 x 90 was still refused on 2 x 2 A4: ${$('warnings').textContent}`);

  const hint = $('composeHint').textContent;
  assert(/4 sheets of A4/.test(hint), hint);
  assert(/420 × 594 mm/.test(hint), `no millimetres: "${hint}"`);
  assert(/164 × 140 cells/.test(hint), `no cells: "${hint}"`);
  // The number somebody laying the paper out cannot work out for themselves.
  assert(/1\.7 mm/.test(hint), `no overlap given: "${hint}"`);

  assert(/4 sheets/.test($('facts').textContent),
    `the facts do not mention the sheets: ${$('facts').textContent}`);
});

await check('the size on screen is the whole picture, not one sheet', async () => {
  // Everything above the fold describes the finished thing. Answering it
  // from the sheet currently in the machine would quietly quarter it.
  assert(/120 × 90/.test($('facts').textContent),
    `the facts shrank to one sheet: ${$('facts').textContent}`);
  // 120 x 90 of solid x, so every cell is a keystroke.
  assert(/10800/.test($('facts').textContent),
    `the keystrokes are one sheet's worth: ${$('facts').textContent}`);
});

await check('the preview draws the joins and marks the sheet you are on',
  async () => {
    const view = window.document.querySelector('.paper-view');
    assert(Math.abs(paperRatio(view) - 420 / 594) < 0.01,
      `the paper is not 2 x 2 A4: ${paperRatio(view).toFixed(3)}`);
    const seams = $('seams');
    assert(!seams.hidden, 'no joins drawn');
    assert(seams.querySelectorAll('.v').length === 1, 'wrong number of side joins');
    assert(seams.querySelectorAll('.h').length === 1, 'wrong number of top joins');
    assert(seams.querySelectorAll('.here').length === 1,
      'the sheet being typed is not marked');
  });

await check('the typing panel works one sheet at a time', async () => {
  /*
   * Not a convenience. On a composite two sheets wide a single row of the
   * motif is 120 columns and no line on the machine is: it is two lines, on
   * two pieces of paper, typed on two separate visits. So there is no
   * arrangement in which the whole picture is one list of lines.
   */
  assert(!$('sheetPickRow').hidden, 'no way to say which sheet');
  assert(picks().length === 4, `${picks().length} sheets offered, expected 4`);

  const lines = window.document.querySelectorAll('.sheet .ln').length;
  assert(lines === 45, `${lines} lines on screen, expected 45 of the 90`);
  assert(motifCols() === 60,
    `${motifCols()} columns on screen, expected 60 of the 120`);
});

await check('each sheet is set up for itself, and the joins line up', async () => {
  // The second sheet across starts at its own column 0 and the paper guide
  // carries the difference — which is what makes the two halves meet.
  const stop = () => [...$('instructions').children]
    .map((li) => li.querySelector('b').textContent)
    .find((t) => /Left margin stop/.test(t));

  picks()[0].click();
  await wait(400);
  const first = stop();
  picks()[1].click();
  await wait(400);
  const second = stop();
  assert(first && second && first !== second,
    `both sheets were given the same margin stop: ${first} / ${second}`);

  const heads = [...$('instructions').children]
    .map((li) => li.querySelector('b').textContent).join(' | ');
  assert(/Lay the sheets 2 across by 2 down/.test(heads), heads);
  assert(/Overlap 1\.7 mm/.test(heads), heads);
  assert(/Take sheet 2/.test(heads), heads);
});

await check('picking a sheet starts it at line one', async () => {
  // Each sheet is its own visit to the machine, so its lines are numbered
  // from one — the same numbering the PDF and the progress counter use.
  picks()[3].click();
  await wait(400);
  assert(/^0 \//.test($('count').textContent),
    `sheet 4 opened part-way through: ${$('count').textContent}`);
  assert(/4 of 4/.test($('sheetPickHint').textContent),
    `the panel does not say which sheet: ${$('sheetPickHint').textContent}`);
});

await check('a sheet the motif never reaches is offered and explains itself',
  async () => {
    // Top left, so a small motif lands wholly on the first sheet and the
    // other three are blank paper. They stay in the list: somebody laying
    // out four sheets needs to know the fourth is blank.
    $('align').value = 'topleft';
    $('align').dispatchEvent(new window.Event('change'));
    await paste(20, 8);
    await wait(400);

    const blanks = picks().filter((el) => el.classList.contains('blank'));
    assert(blanks.length === 3, `${blanks.length} blank sheets, expected 3`);

    blanks[0].click();
    await wait(400);
    const heads = [...$('instructions').children]
      .map((li) => li.querySelector('b').textContent).join(' | ');
    assert(/stays blank/.test(heads), `a blank sheet says nothing: ${heads}`);
    assert(window.document.querySelectorAll('.sheet .ln').length === 0,
      'a blank sheet offered lines to type');
  });

await check('centring on four sheets is called out, not corrected', async () => {
  // The centre of a two-by-two is the point where all four meet, so a small
  // motif asked for in the middle is cut across every join. Arithmetically
  // right, almost never wanted, and not something to silently override.
  $('align').value = 'centre';
  $('align').dispatchEvent(new window.Event('change'));
  await wait(450);
  const w = $('warnings').textContent;
  assert(/would fit on one sheet/.test(w), `nothing said about it: ${w}`);
  assert(!/warn stop/.test($('warnings').innerHTML),
    'a positioning choice was made a refusal');
});

await check('going back to one sheet puts everything away', async () => {
  $('paper').value = 'a4';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(450);
  assert($('composeRow').hidden, 'the matrix stayed open');
  assert($('sheetPickRow').hidden, 'the sheet chooser stayed open');
  assert($('seams').hidden, 'the joins were left drawn on a single sheet');
  const view = window.document.querySelector('.paper-view');
  assert(Math.abs(paperRatio(view) - 210 / 297) < 0.01,
    `the paper is still composed: ${paperRatio(view).toFixed(3)}`);
});

await check('composing survives a reload', async () => {
  await compose(3, 1);
  const saved = JSON.parse(window.localStorage.getItem('typewriter-ascii'));
  assert(saved.across === 3 && saved.down === 1,
    `not saved: ${JSON.stringify([saved.across, saved.down])}`);
  assert(saved.paper === 'a4',
    `the sheet size was saved as the composite: ${saved.paper}`);
  $('paper').value = 'a4';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(400);
});

await check('composing and turning are independent', async () => {
  // The tiling decides how much paper; the turn decides which way the
  // finished thing is read. Neither knows about the other.
  await paste(60, 40);
  await compose(2, 1);
  await setOrientation('left');
  const heads = [...$('instructions').children]
    .map((li) => li.querySelector('b').textContent).join(' | ');
  assert(/Lay the sheets 2 across/.test(heads), heads);
  assert(/When every sheet is done, turn the finished sheet to the left/
    .test(heads), `the turn is not described for a composite: ${heads}`);

  await setOrientation('upright');
  $('paper').value = 'a4';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(400);
});

console.log('lettering wraps to the sheet');

await check('a long sentence is broken instead of running off the paper',
  async () => {
    // Every word here fits the margins on its own; the sentence as one
    // line does not, so it has to break rather than overrun the preview.
    await setOrientation('upright');
    await typeWord('HALLO WELT WIE GEHT', 'oblique');

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
    // textArea rather than sheetGrid: wrapped to the margins a sentence
    // sits inside them and setUp() says nothing. A note on every sentence
    // trains people to ignore the one place the app warns them.
    assert($('warnings').textContent.trim() === '',
      `a warning survived wrapping: ${$('warnings').textContent}`);
  });

await check('planning sideways keeps the marks and gains the lines', async () => {
  /*
   * A turned cell is 4.23 mm wide against 2.54 upright, so laying fixed
   * letterforms down cell by cell stretched them 2.77 times over. The block
   * is given those lines back instead — repeated, never resampled — so the
   * proportions come right and every mark is still the one that was set.
   */
  await setOrientation('upright');
  // Short enough to be laid down whole. A block deep enough that 2.77 times
  // its lines would not fit the paper takes the other path, which is a
  // different promise and has its own check below.
  await typeWord('TYPE', 'oblique');
  const upright = motifCols();
  assert(upright > 0 && upright <= 66,
    `${upright} columns against upright margins of 66`);

  const marks = new Set($('mini').textContent.replace(/\s/g, ''));

  await setOrientation('left');
  const lines = window.document.querySelectorAll('.sheet .ln').length;
  assert(lines <= 70,
    `${lines} lines on an A4 that holds 70`);
  assert(motifCols() <= 82,
    `${motifCols()} columns typed, more than the sheet holds`);
  assert(!/warn stop/.test($('warnings').innerHTML),
    `refused although it was laid down to fit: ${$('warnings').textContent}`);

  /*
   * And the marks are the ones that were set, or the mark table's own answer
   * for them: an underscore turned is a bar up the edge of the cell, so it
   * is struck as `!`, which is turnRows() doing its documented job. Anything
   * *else* would mean the block had been matched against a grid of ink
   * rather than laid down — which is the fault this whole path exists to
   * undo, and nothing else on the page would have noticed it.
   */
  const { turnedMarks } = await import(
    pathToFileURL(path.join(ROOT, 'src/core/turn.js')).href);
  const twins = new Set(Object.entries(turnedMarks('left'))
    .filter(([from]) => marks.has(from)).map(([, to]) => to));
  const laid = new Set($('mini').textContent.replace(/\s/g, ''));
  const strangers = [...laid].filter((c) => !marks.has(c) && !twins.has(c));
  assert(strangers.length === 0,
    `characters the word was never set in: ${strangers.join('')}`);
  assert(laid.has([...marks].find((c) => /[A-Za-z0-9]/.test(c))),
    'the character the letters are filled with did not survive the turn');
  assert(/laid down|lines repeated/i.test($('letterStyleHint').textContent),
    `the hint does not say what was done: "${$('letterStyleHint').textContent}"`);
  await setOrientation('upright');
});

await check('a word too big to lay down is set as a picture, and says so',
  async () => {
    /*
     * The other promise. A block 2.77 times its own depth can outgrow the
     * paper, and squeezing it back would drop whole strokes — a hairline is
     * one cell wide and nearest neighbour cannot halve it. So it goes
     * through the picture path instead, which fits anything, and the hint
     * says the marks are the matcher's rather than the font's.
     */
    await setOrientation('upright');
    await typeWord('HALLO WELT WIE GEHT ES DIR', 'oblique');
    await setOrientation('left');

    assert(/as a picture/i.test($('letterStyleHint').textContent),
      `the swap was not admitted: "${$('letterStyleHint').textContent}"`);
    assert(motifCols() > 0, 'nothing was drawn');
    assert(window.document.querySelectorAll('.sheet .ln').length <= 70,
      'the picture path let it run off the bottom of the paper');
    await setOrientation('upright');
  });

await check('a word too wide to break is still refused, not mangled',
  async () => {
    // Wrapping can only break at spaces. Hyphenating would produce something
    // nobody can read and would hide the one message that tells the user
    // what to do about it.
    await typeWord('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD', 'oblique');
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
    // How the finished sheet gets read is a decision about the sheet, not
    // about where the motif came from. A photograph, a word and a block of
    // pasted art all end up on the same piece of paper, so it lives in "the
    // paper" and must not be hidden or cleared by a change of mode.
    await setOrientation('left');
    for (const tab of ['image', 'text', 'paste']) {
      [...window.document.querySelectorAll('.tab')]
        .find((t) => t.dataset.tab === tab).click();
      await wait(350);
      assert(whyHidden('orientation') === 'VISIBLE',
        `not reachable in the ${tab} tab: ${whyHidden('orientation')}`);
      assert($('orientation').value === 'left',
        `switching to the ${tab} tab reset the choice`);
    }
    // And it sits with the sheet size and the position, not in a tab panel.
    const fieldset = $('orientation').closest('fieldset');
    assert(fieldset && fieldset.contains($('paper')) && fieldset.contains($('align')),
      'the choice is not in the same block as the sheet size and position');
    await setOrientation('upright');
  });

await check('a word lies down, in proportion', async () => {
  /*
   * It used to lie down cell by cell, which kept the counts equal and
   * stretched the letterforms 2.77 times over — a quarter turn swaps the
   * cell's 2.54 mm width and its 4.23 mm height. Set as a picture, the
   * block is laid down and resampled, so what is asserted here is the
   * shape of the result, not a cell-for-cell identity.
   */
  await setOrientation('upright');
  await typeWord('LORENZ', 'oblique');
  const upright = motifCols();
  const uprightLines = window.document.querySelectorAll('.sheet .ln').length;
  assert(upright > uprightLines, 'a word should be wider than tall upright');

  await setOrientation('left');
  const lines = window.document.querySelectorAll('.sheet .ln').length;
  const cols = motifCols();
  assert(lines > cols,
    `laid down it should be taller than wide: ${cols} × ${lines}`);

  // As read, the proportions survive the trip. The bounds are loose —
  // blur and the blank threshold nibble at the preview's edges — but they
  // sit far inside the 2.77× stretch that laying the cells down produced.
  const drawn = (upright * 2.54) / (uprightLines * 4.23);
  const read = (lines * 4.23) / (cols * 2.54);
  assert(read > drawn * 0.55 && read < drawn * 1.8,
    `read ${read.toFixed(2)}:1 against drawn ${drawn.toFixed(2)}:1`);
  assert(/turn the finished sheet/i.test($('instructions').textContent),
    'no instruction to turn the finished sheet');
});

await check('pasted art lies down too', async () => {
  // Nothing about pasted art is special, which is the point: the choice
  // belongs to the sheet and applies wherever the motif came from. A block
  // 100 wide and 6 deep does not fit an 82-column A4; laid down it is 6
  // columns by 100 lines, which does not fit either — so this is about the
  // block turning, not about rescuing it.
  await setOrientation('upright');
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'paste').click();
  await wait(350);
  $('pasted').value = (`${'x'.repeat(40)}\n`).repeat(6).trim();
  $('pasted').dispatchEvent(new window.Event('input'));
  await wait(450);
  assert(motifCols() === 40, `pasted art came out ${motifCols()} wide`);

  await setOrientation('left');
  assert(motifCols() === 6,
    `${motifCols()} columns typed for a block six deep`);
  assert(window.document.querySelectorAll('.sheet .ln').length === 40,
    'the block did not lie down');
  assert(/turn the finished sheet/i.test($('instructions').textContent),
    'no instruction to turn the finished sheet');
  assert(/turned left/i.test($('facts').textContent),
    `the facts still call it upright: ${$('facts').textContent}`);
  await setOrientation('upright');
});

await check('a picture lies down, and the ceiling falls rather than rises',
  async () => {
    /*
     * The number that used to be the whole sales pitch, now the other way
     * round. "How wide" is how wide the picture is when you look at it, and
     * on a turned sheet that is counted down the paper: 70 cells of 4.23 mm
     * against 82 of 2.54. Fewer, wider cells — 297 mm of picture instead of
     * 208 — which is the trade, and it is worth being unable to hide it.
     */
    await setOrientation('upright');
    await loadPicture();
    assert(motifCols() > 0, 'the stub photograph produced no motif at all');
    const upright = +$('width').max;
    assert(upright === 82,
      `upright A4 offered ${upright} columns to the edge, expected 82`);

    await setOrientation('left');
    assert(+$('width').max === 70,
      `a turned A4 offered ${$('width').max} cells across, expected 70`);
    assert(/turn the finished sheet/i.test($('instructions').textContent),
      'no instruction to turn the finished sheet');
    assert(/turned left/i.test($('facts').textContent),
      `the facts still call it upright: ${$('facts').textContent}`);

    // And what is typed stays inside the sheet the machine actually holds.
    $('width').value = '70';
    $('width').dispatchEvent(new window.Event('change'));
    await wait(600);
    assert(motifCols() <= 82,
      `${motifCols()} columns typed on a sheet that holds 82`);
    assert(window.document.querySelectorAll('.sheet .ln').length <= 70,
      'the picture runs off the bottom of the paper');
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
  await typeWord('HI', 'oblique');
  const one = window.document.querySelectorAll('.sheet .ln').length;
  await typeWord('HI\nHO', 'oblique');
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
  await typeWord('HI', 'oblique');
  const art = [...window.document.querySelectorAll('.sheet .ln')]
    .map((e) => e.textContent).join('');
  const have = new Set([...$('charsetText').value || '']);
  assert(!/[#@*]/.test(art), `used a key the SM7 has not got: ${art}`);
  assert(art.replace(/\s/g, '').length > 0, 'nothing was drawn');
});

await check('the style hint names the keys it will strike', async () => {
  await typeWord('HI', 'oblique');
  const t = $('letterStyleHint').textContent;
  assert(/one character/i.test(t), `the face is not described: "${t}"`);
  // The projection's own marks are named too — the face insists on them.
  assert(/\//.test(t) && /_/.test(t),
    `the depth marks are not named: "${t}"`);
});

await check('two lines of a word are centred against each other', async () => {
  /*
   * The `Position` control said `Centred` and only the box was: every block
   * was laid flush left inside it, so a short second line hung left of
   * centre. Measured through the app rather than through letter(), because
   * the bug was that the two halves of "centred" disagreed and only the
   * whole path shows them agreeing.
   */
  $('align').value = 'centre';
  $('align').dispatchEvent(new window.Event('change'));
  await typeWord('MORGEN\nHI', 'oblique');

  const { left, right } = shortLineOffsets();
  assert(Math.abs(left - right) <= 1,
    `the short line sits ${left} from the left and ${right} from the right`);
  assert(left > 1, 'the short line was not moved at all');
});

await check('top left leaves them flush left', async () => {
  $('align').value = 'topleft';
  $('align').dispatchEvent(new window.Event('change'));
  await typeWord('MORGEN\nHI', 'oblique');

  assert(shortLineOffsets().left === 0,
    'the lines were centred although the word is set top left');

  $('align').value = 'centre';
  $('align').dispatchEvent(new window.Event('change'));
  await wait(300);
});

await check('the picker says which faces are too wide for the paper', async () => {
  /*
   * A word too wide cannot be wrapped — a break only ever happens at a space
   * — so it runs off the sheet and the preview clips it there. Four of the
   * faces on offer do that to `HELLO` on an upright A4, and the only way to
   * find out used to be to pick one and watch it get cut in half.
   */
  // Set the width explicitly: it is the cap the labels are measured
  // against, so a test that inherited whatever the last one left would be
  // measuring a moving target. MORGEN is 77 columns in the compact face
  // and 95 in the big one, against the 82 an A4 holds edge to edge.
  $('width').value = '82';
  $('width').dispatchEvent(new window.Event('change'));
  await typeWord('MORGEN', 'oblique');
  const labels = [...$('letterStyle').options].map((o) => o.textContent);
  const wide = labels.filter((t) => /too wide/.test(t));
  assert(wide.length > 0, 'no face is called out as too wide');
  assert(/\d+ of \d+ columns/.test(wide[0]),
    `the label does not give both numbers: "${wide[0]}"`);
  // And a face that does fit is named plainly, with no warning attached.
  assert(labels.some((t) => t === 'Three dimensional'),
    `the fitting face is not named plainly: ${labels.join(' | ')}`);
});

await check('and the ways out are offered as the buttons that take them',
  async () => {
    await typeWord('MORGEN', 'obliqueBig');
    const t = $('letterStyleHint').textContent;
    assert(/cut off at the edge/.test(t), `no warning in the hint: "${t}"`);
    assert(/\d+ of \d+ columns/.test(t), `both numbers are not given: "${t}"`);
    /*
     * And no advice in the prose, because the buttons carry it and the
     * prose used to get it wrong: it offered turning the sheet first, and
     * turning makes a motif narrower — 70 columns against 82 — since a
     * turn buys millimetres and spends columns.
     */
    assert(!/turn the sheet/.test(t),
      `still recommending the turn, which is narrower: "${t}"`);
    const fixes = [...window.document.querySelectorAll('#letterFit button')]
      .map((b) => b.textContent);
    assert(fixes.length > 0, 'a word that will not fit was offered no way out');
    assert(fixes.every((f) => /\d+ columns/.test(f)),
      `a way out does not say what it would give: ${fixes.join(' | ')}`);
    assert(!fixes.some((f) => /turn/i.test(f)),
      `the turn was offered as a fix: ${fixes.join(' | ')}`);
  });

await check('the width warning goes when the face fits', async () => {
  // Rather than staying on screen complaining about a choice that has
  // been changed.
  await typeWord('MORGEN', 'oblique');
  assert(!/cut off at the edge/.test($('letterStyleHint').textContent),
    'the width warning outlived the face that caused it');

  $('width').value = '60';
  $('width').dispatchEvent(new window.Event('change'));
  await wait(400);
});

console.log('walking the list of faces');

const usable = () =>
  [...$('letterStyle').options].filter((o) => !o.disabled).map((o) => o.value);

await check('the arrows step to the next face and back again', async () => {
  await typeWord('HI', 'oblique');
  const list = usable();
  const from = list.indexOf('oblique');

  $('styleNext').click();
  await wait(300);
  assert($('letterStyle').value === list[(from + 1) % list.length],
    `forward landed on ${$('letterStyle').value}, not ` +
    `${list[(from + 1) % list.length]}`);

  $('stylePrev').click();
  await wait(300);
  assert($('letterStyle').value === 'oblique',
    `back landed on ${$('letterStyle').value}, not where it started`);
});

await check('stepping redraws the sheet, it does not only move the list', async () => {
  // The whole point is watching the paper while you walk the list. A picker
  // that changed its own value and left the preview alone would be worse
  // than no button at all.
  await typeWord('HI', 'oblique');
  const before = $('mini').textContent;
  $('styleNext').click();
  await wait(300);
  assert($('mini').textContent !== before, 'the preview did not follow');
  assert($('mini').textContent.trim().length > 0, 'the preview went blank');
});

await check('the ends wrap round, so neither arrow is ever dead', async () => {
  const list = usable();
  await typeWord('HI', list[0]);
  $('stylePrev').click();
  await wait(300);
  assert($('letterStyle').value === list[list.length - 1],
    `back from the first face landed on ${$('letterStyle').value}`);

  $('styleNext').click();
  await wait(300);
  assert($('letterStyle').value === list[0],
    `forward from the last face landed on ${$('letterStyle').value}`);
});

await check('a face the machine cannot strike is never landed on', async () => {
  /*
   * The list greys out any face whose marks the keys cannot make, and
   * landing on one would select an option the picker itself refuses.
   *
   * Marked here by hand rather than by narrowing the character set, because
   * the character set cannot reach this state: standIns() reports a mark as
   * missing only when it can find no stand-in at all, and nearestChar()
   * always finds one while the machine has any keys left. With the drawn
   * list down to two faces, disabling one leaves nowhere to step — so the
   * stepper must stand still rather than land on the option the list
   * itself refuses.
   */
  await typeWord('HI', 'oblique');
  const other = [...$('letterStyle').options]
    .find((o) => o.value === 'obliqueBig');
  other.disabled = true;

  $('styleNext').click();
  await wait(300);
  assert($('letterStyle').value === 'oblique',
    `landed on ${$('letterStyle').value}, which the list refuses`);

  // The next redraw has already put the list back the way the machine says
  // it should be; this only makes that explicit for whatever runs after.
  other.disabled = false;
});

await check('the die never lands on the face already showing', async () => {
  // A die that can roll the number it is already on is a button that
  // sometimes does nothing, and that is indistinguishable from broken.
  await typeWord('HI', 'oblique');
  for (let i = 0; i < 12; i++) {
    const before = $('letterStyle').value;
    $('styleAny').click();
    await wait(60);
    assert($('letterStyle').value !== before,
      `the die stayed on ${before}`);
  }
});

await check('a three-dimensional word carries its projection marks', async () => {
  await typeWord('OO', 'oblique');
  const art = [...window.document.querySelectorAll('.sheet .ln')]
    .map((e) => e.textContent).join('');
  const used = new Set(art.replace(/\s/g, ''));
  assert(used.has('/') && used.has('_'),
    `missing the depth marks: ${[...used].join('')}`);
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

await check('Space, Enter and the arrows drive the line', async () => {
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
  // There used to be a reference table below the sheet, and it added the
  // paper feed: line one of a word centred on A4 was called line 32 there
  // and line 1 in the sheet, the progress counter and the typing sheet in
  // the PDF. Four places, two schemes, and the odd one out was the panel
  // headed "for looking things up". That panel is gone now, and the
  // numbering it disagreed with is the one still standing.
  //
  // Motif numbering is the checkable one: the paper feed happens once,
  // before typing, and afterwards nothing on the page or the machine says
  // which absolute line of the sheet you are on.
  await typeWord('HI', 'oblique');
  const lines = window.document.querySelectorAll('.sheet .ln').length;
  assert(lines > 0, 'nothing on the sheet to number');
  assert($('count').textContent.includes(`/ ${lines} lines`),
    `the counter says "${$('count').textContent}" for ${lines} lines`);
});

await check('the line you are on is not re-read from storage on every redraw',
  async () => {
    // draw() ended by reloading `at` from localStorage, which made a stored
    // number outrank the running one on any path that had not written to
    // storage yet. A resize is the plain case.
    await typeWord('HELLO', 'oblique');
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
  await typeWord('HELLO', 'oblique');
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
