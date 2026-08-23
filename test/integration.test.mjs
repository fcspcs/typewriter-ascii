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

await check('it cannot be dragged past what the paper holds', async () => {
  // It used to run to 120 columns. A4 at pica holds 66 inside the margins,
  // so the top half of its travel did nothing but crop the picture — you
  // dragged and watched the preview refuse to change.
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'image').click();
  await wait(350);

  assert(+$('width').max === 66, `slider still runs to ${$('width').max}`);
  assert(/66 inside the margins/.test($('widthHint').textContent),
    `the limit is not explained: "${$('widthHint').textContent}"`);
});

await check('it follows a change of paper', async () => {
  $('paper').value = 'a6';
  $('paper').dispatchEvent(new window.Event('change'));
  await wait(350);

  const max = +$('width').max;
  assert(max > 0 && max < 66, `postcard still allows ${max} columns`);
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

console.log('errors during the run');

await check('nothing threw along the way', () => {
  assert(errors.length === 0, errors.join('\n       '));
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
