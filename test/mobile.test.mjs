/**
 * The page on a telephone.
 *
 * Two kinds of check live here, and it is worth being plain about which is
 * which, because jsdom does no layout at all: there are no boxes to measure,
 * `getBoundingClientRect` answers zero for everything, and no media query is
 * ever evaluated.
 *
 * So the sizing half reads the *declarations* out of styles.css and asserts
 * what the page promises a coarse pointer — that a target is at least 44 px,
 * that a field is at least 16 px, that the gutters make room for a notch.
 * That is weaker than measuring a rendered phone and stronger than nothing:
 * every one of these was wrong in a way a person could feel, and each is
 * wrong again the moment somebody edits the number back.
 *
 * The behaviour half is real. The app is loaded with `matchMedia` answering
 * as a touchscreen, so the paths that ask about the pointer actually run.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/*
 * The stylesheet with its comments taken out.
 *
 * Half the rules here are explained in prose that quotes the very values
 * being asserted about — a paragraph saying why `72vh` was wrong sits three
 * lines above the `72dvh` that replaced it. Scanning the file with the
 * comments in finds the explanation and reports the fault as though it were
 * still there.
 */
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/* ── reading the stylesheet ──────────────────────────────────── */

/**
 * Everything written for an `@media` condition, however many blocks it took.
 *
 * All of them, joined, rather than the first: a condition may reasonably be
 * answered in more than one place — the dialog's small-screen rules sit with
 * the dialog and the page's sit with the page — and taking only the first
 * reports the other one's rules as missing.
 *
 * Brace-counted rather than matched with a regular expression, because the
 * blocks contain nested rules and a lazy `[^}]*` would stop at the first
 * inner brace and quietly return a fragment, which then passes every
 * assertion made about it by containing nothing to disagree with.
 */
function mediaBlock(condition) {
  const found = [];
  const needle = `@media ${condition}`;
  for (let at = CSS.indexOf(needle); at >= 0; at = CSS.indexOf(needle, at + 1)) {
    const open = CSS.indexOf('{', at);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}' && --depth === 0) {
        found.push(CSS.slice(open + 1, i));
        break;
      }
    }
  }
  return found.length ? found.join('\n') : null;
}

/** Every rule in a chunk of CSS, as `{ selector, body }`. */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}

/**
 * What a property resolves to for a selector, within one chunk of CSS.
 *
 * Last declaration wins, which is the cascade for rules of equal weight and
 * is all that is needed here: these blocks are short and nothing in them is
 * fighting anything else.
 */
function declared(css, selectorPart, prop, { pseudo = false } = {}) {
  let found = null;
  for (const r of rules(css)) {
    if (!r.selector.includes(selectorPart)) continue;
    /*
     * Pseudo-element rules are skipped unless they were asked for, because
     * a selector match is a substring match: `input[type=range]` is inside
     * `input[type=range]::-webkit-slider-thumb`, so asking how tall the
     * slider is used to return the height of its thumb.
     */
    if (!pseudo && r.selector.includes('::')) continue;
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g');
    let m;
    while ((m = re.exec(r.body))) found = m[1].trim();
  }
  return found;
}

/** A CSS length in pixels. `rem` is the root size, which this page leaves at 16. */
const len = (v) => {
  if (v == null) return NaN;
  const n = parseFloat(v);
  return /rem\s*$/.test(v) ? n * 16 : n;
};

/* ── the page, told it is being touched ──────────────────────── */

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message ?? e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(HTML, {
  url: 'https://example.test/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

/*
 * A phone, and a `matchMedia` that answers as one.
 *
 * The integration harness stubs this to `matches: false` for everything,
 * which is the right answer for a desktop and the wrong one here — the
 * whole point of this file is to run the branches that only a touchscreen
 * reaches. Reduced motion is left off so the ordinary path is exercised;
 * the one check that wants it asks for it directly.
 */
Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 780, configurable: true });
window.matchMedia = (q) => {
  // Enough of a media engine for the two questions the app asks: what kind
  // of pointer, and how wide. Width is answered against the window set
  // above, so a check can move the viewport and get a different answer.
  const max = q.match(/max-width:\s*(\d+)px/);
  const matches = /pointer:\s*coarse/.test(q)
    || (max ? window.innerWidth <= +max[1] : false);
  return {
    media: q, matches,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  };
};

window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.scrollTo = () => {};

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
/*
 * jsdom has an HTMLDialogElement but neither showModal() nor close(), so
 * both are stubbed — and close() fires the event, which is the whole point
 * of the test below it. Without that the app's `onclose` never runs and a
 * dialog that commits on dismissal passes as though it cancelled.
 */
window.HTMLElement.prototype.showModal ??= function () { this.open = true; };
window.HTMLElement.prototype.close ??= function (value) {
  if (value !== undefined) this.returnValue = value;
  this.open = false;
  this.dispatchEvent(new window.Event('close'));
};
window.URL.createObjectURL = () => 'blob:test';
window.URL.revokeObjectURL = () => {};
window.Image = class {
  constructor() { this.width = 1200; this.height = 300; }
  set src(v) { setTimeout(() => this.onload?.(), 0); }
  get src() { return 'blob:test'; }
};

for (const k of ['document', 'navigator', 'location', 'localStorage',
                 'requestAnimationFrame', 'cancelAnimationFrame',
                 'performance', 'Image', 'HTMLElement', 'URL', 'Blob',
                 'getComputedStyle']) {
  try {
    Object.defineProperty(globalThis, k, {
      value: window[k], writable: true, configurable: true,
    });
  } catch { /* some globals are read-only in newer node */ }
}
Object.defineProperty(globalThis, 'window', {
  value: window, writable: true, configurable: true,
});

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

const COARSE = mediaBlock('(pointer: coarse)');

console.log('the page arrives fit for a small screen');

await check('nothing threw while loading as a touchscreen', () => {
  assert(errors.length === 0, errors.join('\n       '));
});

await check('the viewport is the device, and reaches into the corners', () => {
  const meta = window.document.querySelector('meta[name=viewport]')
    ?.getAttribute('content') ?? '';
  assert(/width=device-width/.test(meta), `viewport reads "${meta}"`);
  assert(/viewport-fit=cover/.test(meta),
    `without viewport-fit=cover the page is letterboxed: "${meta}"`);
  // A page that cannot be pinched is a page somebody cannot read.
  assert(!/user-scalable\s*=\s*no|maximum-scale/.test(meta),
    `zooming is disabled, which locks out anyone who needs it: "${meta}"`);
});

await check('the address bar is given the colour of the paper', () => {
  const metas = [...window.document.querySelectorAll('meta[name=theme-color]')];
  assert(metas.length === 2, `${metas.length} theme-colors, expected light and dark`);

  // The meta tag cannot read a custom property, so the value is written out
  // twice. This is the check that keeps the copy honest.
  const paper = (block) => block.match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1];
  const dark = mediaBlock('(prefers-color-scheme: dark)');
  const want = {
    light: paper(CSS.slice(0, CSS.indexOf('@media'))),
    dark: paper(dark ?? ''),
  };
  for (const m of metas) {
    const scheme = /dark/.test(m.getAttribute('media') ?? '') ? 'dark' : 'light';
    assert(m.getAttribute('content')?.toLowerCase() === want[scheme],
      `${scheme} theme-color is ${m.getAttribute('content')}, ` +
      `but --paper is ${want[scheme]}`);
  }
});

await check('the notch and the home indicator are paid for', () => {
  /*
   * `viewport-fit=cover` asks for the whole display and then it is the
   * page's job to keep its content out of the parts that are not
   * rectangular. Asking without paying is worse than not asking: the
   * left-hand column of the sheet ends up under the notch in landscape.
   */
  assert(/env\(\s*safe-area-inset-left/.test(CSS)
    && /env\(\s*safe-area-inset-right/.test(CSS),
    'no safe-area inset is read anywhere, but viewport-fit=cover is set');
  assert(/env\(\s*safe-area-inset-bottom/.test(CSS),
    'nothing clears the home indicator at the foot of the page');
  for (const sel of ['main', '.bar', 'footer']) {
    const pad = declared(CSS, sel, 'padding-left');
    assert(pad && /gut-left|safe-area-inset-left/.test(pad),
      `${sel} does not make room for the left inset: padding-left is ${pad}`);
  }
});

await check('screen heights are the ones actually on show', () => {
  /*
   * `vh` is the *large* viewport — the height the page would have if the
   * address bar were collapsed — so a box sized in vh hangs off the bottom
   * of the screen for as long as the bar is showing, which is most of the
   * time. `dvh` is whatever is visible at this moment.
   */
  const bare = CSS.match(/[\d.]+(?<![ds])vh\b/g) ?? [];
  assert(bare.length === 0,
    `${bare.join(', ')} should be dvh: vh is the height without the address bar`);
  assert(/dvh/.test(CSS), 'nothing is sized to the visible viewport at all');
});

console.log('targets a finger can hit');

await check('there is a block of rules for the pointer rather than the width', () => {
  /*
   * The distinction this file is built on. A phone held sideways is 900 px
   * wide and still a phone; a touchscreen laptop is 1400 px wide and still
   * wants a target it can hit. Sizing a tap by the window gets both wrong.
   */
  assert(COARSE, 'no @media (pointer: coarse) block in styles.css');
});

await check('boxed controls are at least 44 px tall', () => {
  const min = len(declared(COARSE, 'button', 'min-height'));
  assert(min >= 44, `buttons and fields declare min-height ${min}px`);
  for (const sel of ['select', 'summary', 'input[type=text]']) {
    const r = rules(COARSE).find((x) => x.selector.includes(sel)
      && /min-height/.test(x.body));
    assert(r, `${sel} has no min-height on a touchscreen`);
  }
});

await check('the word-sized buttons grow a hit area instead of a box', () => {
  /*
   * `fit`, `original`, `pdf`, `−1` and the `?` are words inside sentences
   * and headings. Boxing them up to 44 px would turn every heading into a
   * toolbar, so the area that answers a tap grows while the ink stays put.
   */
  for (const sel of ['button.link', 'button.why']) {
    const r = rules(COARSE).find((x) => x.selector.includes(`${sel}::after`));
    assert(r, `${sel} has no expanded hit area`);
    const opts = { pseudo: true };
    assert(len(declared(COARSE, `${sel}::after`, 'min-width', opts)) >= 44
      && len(declared(COARSE, `${sel}::after`, 'min-height', opts)) >= 44,
      `${sel}'s hit area is under 44 px`);
  }
  // And they must not have been boxed up by the general rule as well.
  const general = rules(COARSE).find((x) => /min-height/.test(x.body)
    && x.selector.startsWith('button') && !x.selector.includes('::'));
  assert(/:not\(\.link\)/.test(general.selector)
    && /:not\(\.why\)/.test(general.selector),
    `the 44px box also catches the inline buttons: "${general.selector}"`);
});

await check('the sliders are something a thumb can land on', () => {
  /*
   * The track is one pixel tall — a line to look at, and nothing to grab.
   * The line stays one pixel; it is painted as a background so the box
   * around it can be a finger tall without the rule getting fatter.
   */
  const h = len(declared(COARSE, 'input[type=range]', 'height'));
  assert(h >= 44, `the slider's hit box is ${h}px tall`);
  const bg = declared(COARSE, 'input[type=range]', 'background') ?? '';
  assert(/1px/.test(bg),
    `the track should still be drawn as a hairline, got "${bg}"`);
});

await check('the grids of small squares grow rather than overlap', () => {
  /*
   * These sit shoulder to shoulder with a two or three pixel gap, so the
   * pseudo-element trick would have each one stealing its neighbour's
   * taps. They take real width instead.
   */
  assert(len(declared(COARSE, '.matrix .cell', 'width')) >= 44
    && len(declared(COARSE, '.matrix .cell', 'height')) >= 44,
    'the compose matrix cells are still mouse-sized');
  assert(len(declared(COARSE, '.key', 'width')) >= 44
    && len(declared(COARSE, '.key', 'height')) >= 44,
    'the character keyboard keys are still mouse-sized');
  assert(len(declared(COARSE, '.sheet-pick .pick', 'height')) >= 44,
    `the sheet picks are ${declared(COARSE, '.sheet-pick .pick', 'height')} tall`);
});

await check('a tap that missed looks different from one that landed', () => {
  /*
   * The page turns the platform's tap flash off, which is right where a
   * button changes something you can see from where you tapped and wrong
   * where it does not — `next`, `−1` and `apply` all change something
   * further down the page.
   */
  const flash = declared(COARSE, 'button', '-webkit-tap-highlight-color');
  assert(flash && !/transparent/.test(flash),
    `no tap feedback on a touchscreen: ${flash}`);
});

console.log('fields that do not throw the page about');

await check('nothing a finger focuses is under 16 px', () => {
  /*
   * Safari zooms the whole page in when a field under 16 px takes focus,
   * and it does not zoom back out — so naming a sheet leaves the typist
   * pinching the page back into shape afterwards. This is the one number
   * on the page that is a browser rule rather than a matter of taste.
   */
  const size = declared(COARSE, 'input', 'font-size');
  assert(len(size) >= 16, `controls are ${size} on a touchscreen`);
  const r = rules(COARSE).find((x) => /font-size/.test(x.body)
    && x.selector.includes('input'));
  for (const want of ['button', 'select', 'textarea']) {
    assert(r.selector.includes(want), `${want} is not raised with the rest`);
  }
});

await check('the small-screen block does not shrink them again', () => {
  // It used to: the keyboard's keys got *smaller* below 640 px, which is
  // the opposite of what a smaller screen wants.
  const narrow = mediaBlock('(max-width: 640px)');
  assert(narrow, 'no narrow-screen block');
  assert(!/\.key\s*\{/.test(narrow),
    'the narrow block resizes the keys, undoing the touch sizing');
});

console.log('what fits across the screen');

await check('the headings wrap rather than pushing the page sideways', () => {
  /*
   * Both headings sit within about fifteen pixels of the edge of a 360 px
   * screen, and two ordinary state changes push them over: `full screen`
   * becomes `exit full screen`, and `turned` becomes `as typed`. The page
   * then scrolls sideways as a whole, which is the one kind of scrolling
   * that reads as broken, because the thing that moved is everything.
   */
  assert(declared(CSS, 'h2', 'flex-wrap') === 'wrap', 'h2 does not wrap');
  assert(declared(CSS, 'h2 .tools', 'flex-wrap') === 'wrap',
    'the tool buttons in a heading do not wrap');
});

await check('the paired settings go one under another', () => {
  const narrow = mediaBlock('(max-width: 640px)');
  assert(/\.two\s*\{[^}]*grid-template-columns:\s*1fr/.test(narrow),
    'the two-column settings stay side by side on a phone, ' +
    'where half of 328px shows about eight characters of an option');
});

await check('the scale travels with the sheet it names', () => {
  /*
   * The one that was actually broken rather than merely tight. The scale
   * used to be a sibling of the sheet with `overflow: hidden` of its own
   * while the sheet scrolled separately, so on any motif wider than the
   * window the ticks stayed put while the characters slid out from under
   * them — and the right margin stop, drawn at the last column, could not
   * be reached at all, because a clipped box has no scrollbar.
   */
  assert(declared(CSS, '.typing-main', 'overflow-x') === 'auto',
    'the box holding both does not scroll');
  assert(declared(CSS, '.scale', 'overflow') == null,
    'the scale still clips independently of the sheet');
  assert(declared(CSS, '.sheet', 'overflow-x') == null,
    'the sheet still scrolls independently of the scale');
  const wide = declared(CSS, '.scale, .sheet', 'width');
  assert(wide === 'max-content',
    `both must be as wide as their characters, got "${wide}"`);
  assert(declared(CSS, '.ln', 'min-width') === '100%',
    'the open line’s ground stops at the fold instead of running the width');
});

await check('the scale still agrees with the sheet in full screen', () => {
  /*
   * `.sheet` switches to --sheet-full in full screen; `.scale` did not, so a
   * tick sat at the column width --sheet-size names while the characters
   * beneath it sat at the column width --sheet-full names — two different
   * widths for the same grid the moment the two stopped matching, which is
   * exactly what happens once --sheet-full is free to shrink past the
   * fitted floor.
   */
  assert(declared(CSS, 'body.full .scale', 'font-size') === 'var(--sheet-full, 15px)',
    'the scale keeps --sheet-size in full screen and drifts off the columns it names');
});

console.log('the app, told it is being touched');

await check('the sheet stops shrinking while it is still legible', async () => {
  /*
   * Eight pixels of monospace is a readable sheet at arm's length on a desk
   * and a grey smear held at reading distance — and the cells are also what
   * you tap to say where you are, which at that size is about five pixels
   * across. On a touchscreen it stops sooner and lets the sheet run off the
   * side instead, which now costs nothing: the scale goes with it.
   */
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === 'text').click();
  $('letterText').value = 'HELLO';
  $('letterText').dispatchEvent(new window.Event('input'));
  await wait(400);

  const size = parseFloat(window.document.documentElement.style
    .getPropertyValue('--sheet-size'));
  assert(size >= 11,
    `the sheet is set at ${size}px on a phone, which is not a readable cell`);
});

await check('full screen shrinks past that floor instead of scrolling', () => {
  /*
   * Full screen has nothing left on the page to protect and no reason to be
   * open except to see the whole sheet at once, so it gives up the floor
   * that keeps the fitted view's cells tappable and shrinks to the width
   * instead — the same wide motif that stops at 11px in the fitted view
   * (previous check) has to go smaller here rather than run off the screen.
   */
  const ch = Math.max(...[...window.document.querySelectorAll('.ln')]
    .map((ln) => ln.querySelectorAll('.c').length));
  assert(ch > 45, `test motif is only ${ch} cells wide, too narrow to prove ` +
    'the fitted floor would have forced a scrollbar');

  const full = parseFloat(window.document.documentElement.style
    .getPropertyValue('--sheet-full'));
  assert(full * ch / 1.7 <= window.innerWidth - 40 + 1,
    `--sheet-full is ${full}px for a ${ch}-cell line, which still runs off ` +
    'a 360px screen');
});

await check('actual size is not offered on a screen too small to hold one',
  async () => {
    /*
     * "Actual size" means the sheet and every character at the size they
     * come out of the machine — something you hold up against paper. An A4
     * is 210 mm across and a phone is about 65 mm of glass, so on a phone
     * it is not that any more: it is the fitted view with two thirds of it
     * off the side.
     *
     * The stored setting matters more than the button. `zoom` is kept
     * between visits, so a phone opened after a desktop session would have
     * restored a view with nothing on screen offering a way out of it.
     */
    assert($('zoomReal').hidden, 'actual size is still offered on a phone');
    assert(!$('zoomFit').hidden, 'the fitted view went with it');

    // Ask for it anyway, the way restored state does.
    $('zoomReal').click();
    await wait(200);
    assert(!$('zoomReal').classList.contains('on'),
      'the app entered a view its own controls cannot leave');
    assert($('zoomFit').classList.contains('on'),
      'no view is selected at all');
  });

await check('the compose hint names an action a touchscreen has', () => {
  // "Point at a shape" is a sentence about a mouse. On a touchscreen the
  // first thing a finger does is choose.
  const t = $('composeHint').textContent;
  assert(/tap/i.test(t) && !/point at/i.test(t),
    `the hint still asks for a mouse: "${t}"`);
});

await check('the reasons are on the page, not inside a tooltip', async () => {
  /*
   * A `title` is a hover, and a hover is a mouse. These two carry the
   * explanation of the single measurement the whole page's geometry hangs
   * off, and on a phone they could not be reached at all.
   */
  const whys = [...window.document.querySelectorAll('button.why')];
  assert(whys.length >= 2, `${whys.length} why-buttons found`);

  for (const b of whys) {
    const note = $(b.getAttribute('aria-controls'));
    assert(note, `${b.getAttribute('aria-label')} opens nothing`);
    assert(note.textContent.trim().length > 40,
      'the note is too short to be the explanation it replaced');
    assert(b.getAttribute('aria-label'), 'the ? has no name to announce');

    assert(note.hidden && b.getAttribute('aria-expanded') === 'false',
      'the note starts open');
    b.click();
    assert(!note.hidden && b.getAttribute('aria-expanded') === 'true',
      'tapping the ? did not open the note');
    b.click();
    assert(note.hidden && b.getAttribute('aria-expanded') === 'false',
      'tapping it again did not close the note');
  }

  // And the content must not still be duplicated in a tooltip, or the two
  // copies will disagree the first time one of them is edited.
  assert(!/class="why"[^>]*title=/.test(HTML),
    'a why-button still carries its text in a title attribute');
});

await check('the tabs say which of them is chosen', async () => {
  /*
   * `role="tablist"` and `role="tab"` were in the markup and nothing else
   * was, so a screen reader met three tabs with none selected and none
   * controlling anything — a promise of a relationship the page then did
   * not state.
   */
  const tabs = [...window.document.querySelectorAll('.tab')];
  const on = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
  assert(on.length === 1, `${on.length} tabs claim to be selected`);
  assert(on[0].classList.contains('on'),
    'the selected tab is not the one drawn as selected');

  for (const t of tabs) {
    const panel = $(t.getAttribute('aria-controls'));
    assert(panel, `${t.textContent} controls nothing`);
    assert(panel.getAttribute('role') === 'tabpanel',
      `${t.textContent}'s panel is not a tabpanel`);
    assert(panel.getAttribute('aria-labelledby') === t.id,
      `${t.textContent}'s panel is not named by its tab`);
  }

  // One stop on the way through the page, with the arrows moving inside it.
  assert(tabs.filter((t) => t.tabIndex === 0).length === 1,
    'the tab strip is not a single stop for the keyboard');

  const first = tabs[0];
  first.click();
  await wait(200);
  first.dispatchEvent(new window.KeyboardEvent('keydown',
    { key: 'ArrowRight', bubbles: true }));
  await wait(200);
  assert(tabs[1].getAttribute('aria-selected') === 'true',
    'the right arrow does not move along the strip');
});

await check('backing out of the characters dialog changes nothing', async () => {
  /*
   * Escape, the Android back gesture and a tap on the backdrop all close a
   * modal dialog with `returnValue` left at `''`. That used to count as
   * agreement — the atlas was rebuilt and the motif re-converted against a
   * character set nobody had accepted. Backing out is the one gesture that
   * unambiguously means "leave things as they were".
   */
  const dlg = $('charsetDialog');
  $('editCharset').click();
  await wait(200);

  const before = $('charsetText').value;
  assert(before.length > 0, 'the dialog opened with no characters listed');

  $('charsetText').value = before.slice(0, 5);
  $('charsetText').dispatchEvent(new window.Event('input'));
  await wait(60);

  // Dismissed, not answered: exactly what a back gesture leaves behind.
  dlg.returnValue = '';
  dlg.close();
  await wait(200);

  $('editCharset').click();
  await wait(200);
  assert($('charsetText').value === before,
    `dismissing the dialog kept the change: ` +
    `${$('charsetText').value.length} characters instead of ${before.length}`);
  dlg.returnValue = '';
  dlg.close();
  await wait(100);
});

console.log('what the page does not take for granted');

await check('hidden means hidden, whatever else an element was given', () => {
  /*
   * The browser's own `[hidden] { display: none }` sits in the user-agent
   * origin, so any author `display` beats it however weak the selector.
   * `#preview { display: block }` was showing an empty canvas in the drop
   * area before a picture had been chosen, and half the panels on this page
   * are shown and hidden by setting `hidden` from JavaScript.
   */
  assert(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(CSS),
    'nothing guarantees a hidden element is hidden');
});

await check('a light that flashes is not shown to someone who said no', () => {
  /*
   * The lamp blinks once per strike — about five times a second, for as
   * long as a sheet takes. Gating the CSS transition is not enough, because
   * what flashes is the class going on and off, so the app asks as well.
   */
  const block = mediaBlock('(prefers-reduced-motion: reduce)');
  assert(block, 'no reduced-motion block at all');
  assert(/animation-duration|transition-duration/.test(block),
    'the reduced-motion block gates nothing');

  const src = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');
  assert(/prefers-reduced-motion/.test(src),
    'the strike lamp flashes regardless of what was asked for');
});

await check('meaning survives having the colours taken away', () => {
  /*
   * In forced colours the author's backgrounds are discarded, and on this
   * page several of them are the whole message: which cells are spaces to
   * be crossed, and where the count thinks you are.
   */
  const block = mediaBlock('(forced-colors: active)');
  assert(block, 'no forced-colors block');
  assert(/\.run\.gap/.test(block),
    'the space markers are drawn only as a background, which is thrown away');
  assert(/\.c\.hit/.test(block),
    'the typing cursor is drawn only as a background');
});

await check('the sheet is not rebuilt for every pixel the address bar moves', () => {
  /*
   * `draw()` rebuilds every line, re-attaches a handler to each and rewrites
   * four panels. On a phone the address bar sliding away fires `resize`
   * continuously while the page is being flicked — a full DOM rebuild
   * several times a second, during the one gesture that most needs to stay
   * smooth. The sheet is fitted to the width alone, so a change of height
   * has nothing to redraw for.
   */
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');
  const at = src.indexOf("addEventListener('resize'");
  assert(at > 0, 'nothing listens for resize');
  const body = src.slice(at, at + 400);
  assert(/requestAnimationFrame/.test(body),
    'resize redraws immediately rather than once a frame');
  assert(/innerWidth/.test(body),
    'resize redraws for a height change, which cannot alter the layout');
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
