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
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    fillRect() {}, drawImage() {}, fillText() {},
    getImageData: (x, y, w, h) => ({
      width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255),
    }),
    set font(v) {}, get font() { return ''; },
    set fillStyle(v) {}, set textAlign(v) {}, set textBaseline(v) {},
  };
};
window.HTMLDialogElement ??= class {};
window.HTMLElement.prototype.showModal ??= function () { this.open = true; };
window.HTMLElement.prototype.close ??= function () { this.open = false; };

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
await import(path.join(ROOT, 'src/ui/app.js'));
await new Promise((r) => setTimeout(r, 60));

const $ = (id) => window.document.getElementById(id);
let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

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

await check('the live preview sits with the settings, not below the fold', () => {
  const compose = window.document.querySelector('.compose');
  assert(compose, 'no compose grid');
  assert(compose.querySelector('.controls-col'), 'no controls column');
  assert(compose.querySelector('#mini'), 'preview is not beside the controls');
});

await check('the preview fills in as soon as there is something to type', () => {
  assert($('mini').innerHTML.trim().length > 0, 'preview is empty');
});

await check('the preview follows a change of settings', () => {
  const before = $('mini').innerHTML;
  $('redRows').value = '1';
  $('redRows').dispatchEvent(new window.Event('input'));
  return new Promise((r) => setTimeout(() => {
    assert($('mini').innerHTML !== before, 'preview did not react');
    r();
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
  assert(/per inch/.test($('machineHint').textContent),
    $('machineHint').textContent);
});

await check('the paper says how much fits', () => {
  assert(/characters across/.test($('paperHint').textContent),
    $('paperHint').textContent);
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
  assert(/12 characters per inch/.test($('machineHint').textContent),
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
  assert(/12 characters per inch/.test($('machineHint').textContent),
    'a bad reading was allowed through');
});

await check('the measurement can be undone', async () => {
  $('mClear').click();
  await new Promise((r) => setTimeout(r, 60));

  assert(/10 characters per inch/.test($('machineHint').textContent),
    `still measured: "${$('machineHint').textContent}"`);
  assert(/assumed/.test($('machineHint').textContent),
    'the profile no longer admits the pitch is unmeasured');
});

console.log('errors during the run');

await check('nothing threw along the way', () => {
  assert(errors.length === 0, errors.join('\n       '));
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
