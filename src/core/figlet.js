/**
 * figlet.js — read a FIGlet font file and set type with it, exactly.
 *
 * The lettering faces in lettering.js are drawn from scratch, because the
 * FIGlet collection has a patchwork of licences and copying the glyph data
 * would push that problem onto everyone who forks this. But redrawn is not
 * identical, and sometimes identical is the point: you saw a face on the
 * TAAG site and you want *that face*, pixel for pixel, on your paper.
 *
 * So this module reads the `.flf` files themselves — from your own copy,
 * which stays on your disk the same way the audio recordings do. Nothing
 * here ships any font; it ships the ability to read one.
 *
 * Pixel-identical means implementing the real layout algorithm, not an
 * approximation. A FIGlet font names one of three horizontal layouts and
 * the renderer must honour it, because the layout is half the look:
 *
 *   full width   glyphs side by side, untouched
 *   kerning      slid together until any two visible characters would touch
 *   smushing     slid one further, the touching pair merged into one
 *                character — either by the six controlled rules below, or
 *                "universally", where the later glyph simply wins
 *
 * The rules are from the FIGfont standard (figfont.txt, figlet.org), and
 * they are what makes, say, two adjacent brackets collapse into a `|`.
 * Getting them wrong does not crash anything; it just quietly produces
 * letterforms that are not the ones the font's author drew, which in a
 * project about faithful typing is the worse failure.
 *
 * What comes out is rows of literal characters. Whether the machine in the
 * room can strike them is the stand-in engine's question, not this file's —
 * see standIns() in machine.js, and the callers who put the two together.
 */

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * The characters every FIGfont must define, in file order: printable ASCII,
 * then the seven "Deutsch" characters the standard requires — which this
 * project is unusually glad of, since the machine it was written for is a
 * German QWERTZ with all seven on real keys.
 */
const REQUIRED = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  'Ä', 'Ö', 'Ü', 'ä', 'ö', 'ü', 'ß',
];

/** A code-tag line: a bare number, decimal or hex, then optional comment. */
const CODE_TAG = /^\s*(-?(?:0[xX][0-9a-fA-F]+|\d+))(?:\s|$)/;

const parseCode = (tok) =>
  /^-?0[xX]/.test(tok) ? parseInt(tok, 16) : parseInt(tok, 10);

/**
 * Parse a `.flf` file.
 *
 * The format is line-oriented: a header, a comment block, then one glyph
 * after another, each `height` lines ending in an endmark character (`@` by
 * convention, doubled on a glyph's last line — but the standard allows any
 * character, so the endmark is read off each line rather than assumed).
 *
 * @param {string} text the font file
 * @param {string} [name] shown in pickers; usually the file name
 * @returns {{name, hardblank, height, baseline, layout, glyphs}}
 */
export function parseFlf(text, name = 'imported') {
  const lines = text.split(/\r?\n/);
  const head = lines[0]?.split(/\s+/) ?? [];
  if (!head[0]?.startsWith('flf2a')) {
    throw new Error(`${name}: not a FIGlet font (no flf2a signature)`);
  }

  const hardblank = head[0].slice(5, 6) || '$';
  const height = parseInt(head[1], 10);
  const baseline = parseInt(head[2], 10);
  const oldLayout = parseInt(head[4], 10);
  const comments = parseInt(head[5], 10);
  // Field seven is print direction, which this renderer does not honour —
  // every font anyone has asked for reads left to right.
  const fullLayout = head[7] !== undefined ? parseInt(head[7], 10) : null;
  if (!(height > 0) || Number.isNaN(comments)) {
    throw new Error(`${name}: malformed FIGlet header`);
  }

  let at = 1 + comments;

  // The endmark this font actually uses, learned from its first glyph
  // line. `@` is only a convention: Filter ends its lines with `#`.
  let endmark = null;

  /** Read one glyph: `height` lines, endmark stripped, padded square. */
  const readGlyph = () => {
    if (at >= lines.length || lines[at] === undefined) return null;
    const rows = [];
    for (let r = 0; r < height; r++) {
      let line = lines[at++];
      if (line === undefined) return null;
      line = line.replace(/[\r\s]+$/, (m) => m.replace(/\r/g, ''));
      const end = line[line.length - 1];
      if (end === undefined) { rows.push(''); continue; }
      if (endmark === null) endmark = end;
      rows.push(line.replace(new RegExp(`\\${end}+$`), ''));
    }
    const w = Math.max(0, ...rows.map((r) => r.length));
    return rows.map((r) => r.padEnd(w, ' '));
  };

  /*
   * Telling a code-tag line from a glyph row needs more than "starts with
   * a number": a glyph row can too. Filter's Ö begins `88888888 #` —
   * digits, a space, ink — and reading that as code tag 88888888 crashed
   * on a code point Unicode does not have. The reliable difference is the
   * endmark: a glyph row ends with it, a tag line does not.
   */
  const isCodeTag = (line) => line !== undefined && CODE_TAG.test(line) &&
    !(endmark !== null && line.replace(/\s+$/, '').endsWith(endmark));

  const glyphs = new Map();
  for (const ch of REQUIRED) {
    // Fonts that stop at the ASCII set exist, standard or no standard. A
    // code tag where a Deutsch glyph should be is the usual way they say so.
    if (ch.charCodeAt(0) > 126 && isCodeTag(lines[at])) break;
    const g = readGlyph();
    if (!g) break;
    glyphs.set(ch, g);
  }

  // Code-tagged glyphs: anything beyond the required set, one tag line each.
  while (at < lines.length && isCodeTag(lines[at])) {
    const code = parseCode(lines[at].match(CODE_TAG)[1]);
    // Junk that happens to open with a number is the end of the glyphs,
    // not a reason to throw halfway through a font that parsed fine.
    if (!Number.isFinite(code) || code > 0x10ffff) break;
    at++;
    const g = readGlyph();
    if (!g) break;
    if (code >= 32) glyphs.set(String.fromCodePoint(code), g);
  }

  if (!glyphs.has(' ')) throw new Error(`${name}: font defines no glyphs`);

  return {
    name,
    hardblank,
    height,
    baseline,
    layout: resolveLayout(oldLayout, fullLayout),
    glyphs,
  };
}

/**
 * Which layout the font asks for, from the two header fields.
 *
 * `fullLayout` is the newer field and wins where present: bit 64 is
 * kerning, bit 128 smushing, the low six bits the smushing rules — and
 * smushing with no rules set means *universal* smushing, which is a mode of
 * its own, not an absence. The older field can only express full width
 * (-1), kerning (0) or controlled smushing (a rule mask), which is exactly
 * how it is read when it is all there is.
 */
function resolveLayout(oldLayout, fullLayout) {
  if (fullLayout !== null && !Number.isNaN(fullLayout)) {
    if (fullLayout & 128) return { mode: 'smush', rules: fullLayout & 63 };
    if (fullLayout & 64) return { mode: 'kern', rules: 0 };
    return { mode: 'full', rules: 0 };
  }
  if (oldLayout === -1) return { mode: 'full', rules: 0 };
  if (oldLayout === 0) return { mode: 'kern', rules: 0 };
  return { mode: 'smush', rules: oldLayout & 63 };
}

/* ------------------------------------------------------------------ */
/* Smushing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Merge the two characters where a pair of glyphs touch, or return null for
 * "these two may not overlap".
 *
 * The six controlled rules, verbatim from the standard:
 *   1  equal characters merge into themselves (never the hardblank)
 *   2  an underscore gives way to a border character
 *   3  of two different border classes, the "later" (higher) one wins
 *   4  opposite brackets close into a `|`
 *   5  crossing diagonals: /\ → |,  \/ → Y,  >< → X
 *   6  two hardblanks survive as a hardblank
 *
 * Universal smushing has no rules to fail: the later character simply
 * paints over the earlier, except that nothing visible is painted over by
 * a space or a hardblank.
 */
const CLASSES = ['|', '/\\', '[]', '{}', '()', '<>'];
const classOf = (ch) => CLASSES.findIndex((c) => c.includes(ch));

function smushPair(a, b, rules, hardblank, universal) {
  if (universal) {
    if (b === ' ') return a;
    if (b === hardblank && a !== ' ') return a;
    return b;
  }
  if (rules & 1 && a === b && a !== hardblank) return a;
  if (rules & 2) {
    if (a === '_' && classOf(b) >= 0) return b;
    if (b === '_' && classOf(a) >= 0) return a;
  }
  if (rules & 4) {
    const ca = classOf(a);
    const cb = classOf(b);
    if (ca >= 0 && cb >= 0 && ca !== cb) return ca > cb ? a : b;
  }
  if (rules & 8) {
    const pair = a + b;
    if (['[]', '][', '{}', '}{', '()', ')('].includes(pair)) return '|';
  }
  if (rules & 16) {
    if (a === '/' && b === '\\') return '|';
    if (a === '\\' && b === '/') return 'Y';
    if (a === '>' && b === '<') return 'X';
  }
  if (rules & 32 && a === hardblank && b === hardblank) return hardblank;
  return null;
}

/**
 * How far the next glyph may slide left into what is already set.
 *
 * Per row: the spaces at the end of the line so far, plus the spaces at the
 * start of the incoming row, plus one more if the two visible characters
 * that would then touch are allowed to merge. The line's answer is the
 * smallest row's answer — one row that refuses stops the whole glyph, which
 * is what keeps an ascender from sliding through the counter of an `o`.
 */
function overlapOf(out, glyph, layout, hardblank) {
  if (layout.mode === 'full') return 0;
  const smushing = layout.mode === 'smush';
  const universal = smushing && layout.rules === 0;

  let amount = Infinity;
  for (let y = 0; y < out.length; y++) {
    const a = out[y];
    const b = glyph[y];
    const cs1 = a.length - a.replace(/ +$/, '').length;
    const cs2 = b.length - b.replace(/^ +/, '').length;
    let row = cs1 + cs2;
    if (smushing) {
      const edgeA = a[a.length - cs1 - 1];
      const edgeB = b[cs2];
      if (edgeA !== undefined && edgeB !== undefined &&
          smushPair(edgeA, edgeB, layout.rules, hardblank, universal) !== null) {
        row += 1;
      }
    }
    amount = Math.min(amount, row);
  }
  // Capped at the line so far, never at the glyph: a glyph may retreat no
  // further than the line's beginning, but a narrow glyph sliding deep into
  // a wide gap is exactly what kerning is for.
  return Math.max(0, Math.min(amount, out[0]?.length ?? 0));
}

/**
 * Lay one glyph onto the line so far, overlapping by `k` columns.
 *
 * Positional rather than slice-and-stitch, because `k` may exceed the
 * glyph's own width — a one-column letter kerned into a four-column gap
 * lands entirely inside the line it is joining.
 */
function addGlyph(out, glyph, k, layout, hardblank) {
  const universal = layout.mode === 'smush' && layout.rules === 0;
  return out.map((row, y) => {
    const b = glyph[y];
    const start = row.length - k;               // where the glyph begins
    const width = Math.max(row.length, start + b.length);
    let merged = '';
    for (let p = 0; p < width; p++) {
      const a = row[p] ?? ' ';
      const c = p >= start ? (b[p - start] ?? ' ') : ' ';
      merged += a === ' ' ? c
        : c === ' ' ? a
          : (smushPair(a, c, layout.rules, hardblank, universal) ?? a);
    }
    return merged;
  });
}

/* ------------------------------------------------------------------ */
/* Setting type                                                        */
/* ------------------------------------------------------------------ */

/**
 * Set one line of text in the font, exactly as figlet would.
 *
 * Characters the font does not define are set as spaces and named in
 * `unknown`, so the caller can say so instead of leaving the reader to
 * wonder where half the word went. The hardblank — the character the font
 * uses internally for "a space that must not be smushed away" — becomes a
 * real space at the very end, once it has done that job.
 *
 * @returns {{rows: string[], unknown: Set<string>}}
 */
export function flfRender(font, text) {
  const unknown = new Set();
  let out = Array.from({ length: font.height }, () => '');

  for (const ch of text) {
    let glyph = font.glyphs.get(ch);
    if (!glyph) {
      unknown.add(ch);
      glyph = font.glyphs.get(' ');
    }
    if (!glyph[0]?.length) continue;
    const k = out[0].length ? overlapOf(out, glyph, font.layout, font.hardblank)
      : 0;
    out = addGlyph(out, glyph, k, font.layout, font.hardblank);
  }

  const hb = new RegExp(`\\${font.hardblank}`, 'g');
  return {
    rows: out.map((r) => r.replace(hb, ' ').replace(/\s+$/, '')),
    unknown,
  };
}

/**
 * Set a whole piece: several lines, wrapped to the paper at spaces.
 *
 * The same shape as letter() in lettering.js so callers can treat the two
 * alike, with one deliberate difference: blocks stack with no leading
 * between them, because that is what figlet does and the goal here is what
 * figlet does. A blank input line still gives a font-height gap.
 *
 * A single word too wide to fit is left whole, for the same reason letter()
 * leaves it whole: setUp() refuses with a reason, which beats hyphenating a
 * letterform mid-stroke.
 *
 * @param {Object} font from parseFlf()
 * @param {string} text
 * @param {Object} [opt]
 * @param {number} [opt.maxCols] wrap to this many columns
 * @returns {{lines: string[], unknown: Set<string>}}
 */
export function flfLetter(font, text, opt = {}) {
  const { maxCols = 0 } = opt;
  const unknown = new Set();
  const width = (line) => {
    const r = flfRender(font, line);
    r.unknown.forEach((ch) => unknown.add(ch));
    return Math.max(0, ...r.rows.map((x) => x.length));
  };

  const wrap = (line) => {
    if (!(maxCols > 0)) return [line];
    const out = [];
    let cur = '';
    for (const word of line.split(' ')) {
      const cand = cur ? `${cur} ${word}` : word;
      if (!cur || width(cand) <= maxCols) {
        cur = cand;
        if (width(cur) > maxCols && cur === word) { out.push(cur); cur = ''; }
      } else {
        out.push(cur);
        cur = word;
        if (width(cur) > maxCols) { out.push(cur); cur = ''; }
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };

  const lines = [];
  for (const row of String(text).split('\n')) {
    for (const piece of (row.trim() ? wrap(row) : [''])) {
      if (!piece) {
        for (let i = 0; i < font.height; i++) lines.push('');
        continue;
      }
      const r = flfRender(font, piece);
      r.unknown.forEach((ch) => unknown.add(ch));
      lines.push(...r.rows);
    }
  }

  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return { lines, unknown };
}

/**
 * Every character the font might put on the paper.
 *
 * For the picker's hint: the union of every glyph's visible characters,
 * which is the honest worst case. The per-word answer comes out of
 * flfLetter() and is what the sheet actually uses — a font whose `Z` needs
 * a character your machine lacks should not colour the hint red while you
 * are typing `HALLO`.
 */
export function flfMarks(font) {
  const marks = new Set();
  for (const rows of font.glyphs.values()) {
    for (const row of rows) {
      for (const ch of row) {
        if (ch !== ' ' && ch !== font.hardblank) marks.add(ch);
      }
    }
  }
  return marks;
}
