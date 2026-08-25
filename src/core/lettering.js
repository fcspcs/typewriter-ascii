/**
 * lettering.js — words built out of characters.
 *
 * This file used to hold forty-one drawn faces. It holds one now, in two
 * sizes: the three-dimensional face, which exists because no FIGlet font
 * can do what it does — the classic isometric faces all need a backslash,
 * and a great many typewriters (the Olympia SM7 among them) simply do not
 * have one. Everything else the drawn faces attempted, the real FIGlet
 * fonts in fonts/ do better, and they are what the picker offers first —
 * see figlet.js, and fonts/README.md for whose they are.
 *
 * Two hand-drawn alphabets feed it:
 *   BIG     seven rows, generous, for a sheet of A4
 *   BLOCK   five rows, compact, for a postcard or a long word
 *
 * They are drawn from scratch — informed by `banner` and `big` the way any
 * blocky capital A is, but no glyph data is copied.
 *
 * Glyph data uses:
 *   #  ink        the heaviest character the machine has
 *   .  paper
 *
 * The transform emits `/` and `_` as literal marks; whether the machine in
 * the room can strike them is the stand-in engine's question — see
 * marksOf() below and standIns() in machine.js.
 */

/* ------------------------------------------------------------------ */
/* BIG — seven rows                                                    */
/* ------------------------------------------------------------------ */

const BIG = {
  A: ['.####.', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
  B: ['#####.', '##..##', '##..##', '#####.', '##..##', '##..##', '#####.'],
  C: ['.####.', '##..##', '##....', '##....', '##....', '##..##', '.####.'],
  D: ['#####.', '##..##', '##..##', '##..##', '##..##', '##..##', '#####.'],
  E: ['######', '##....', '##....', '#####.', '##....', '##....', '######'],
  F: ['######', '##....', '##....', '#####.', '##....', '##....', '##....'],
  G: ['.####.', '##..##', '##....', '##.###', '##..##', '##..##', '.####.'],
  H: ['##..##', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
  I: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '######'],
  J: ['..####', '....##', '....##', '....##', '....##', '##..##', '.####.'],
  K: ['##..##', '##.##.', '####..', '###...', '####..', '##.##.', '##..##'],
  L: ['##....', '##....', '##....', '##....', '##....', '##....', '######'],
  M: ['##....##', '###..###', '########', '##.##.##', '##....##',
      '##....##', '##....##'],
  N: ['##...##', '###..##', '####.##', '##.####', '##..###', '##...##',
      '##...##'],
  O: ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  P: ['#####.', '##..##', '##..##', '#####.', '##....', '##....', '##....'],
  Q: ['.####.', '##..##', '##..##', '##..##', '##.###', '##..##', '.#####'],
  R: ['#####.', '##..##', '##..##', '#####.', '####..', '##.##.', '##..##'],
  S: ['.#####', '##....', '##....', '.####.', '....##', '....##', '#####.'],
  T: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
  U: ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  V: ['##..##', '##..##', '##..##', '##..##', '##..##', '.####.', '..##..'],
  W: ['##....##', '##....##', '##....##', '##.##.##', '########',
      '###..###', '##....##'],
  X: ['##..##', '##..##', '.####.', '..##..', '.####.', '##..##', '##..##'],
  Y: ['##..##', '##..##', '.####.', '..##..', '..##..', '..##..', '..##..'],
  Z: ['######', '....##', '...##.', '..##..', '.##...', '##....', '######'],

  0: ['.####.', '##..##', '##.###', '######', '###.##', '##..##', '.####.'],
  1: ['..##..', '.###..', '..##..', '..##..', '..##..', '..##..', '######'],
  2: ['.####.', '##..##', '....##', '...##.', '..##..', '.##...', '######'],
  3: ['.####.', '##..##', '....##', '..###.', '....##', '##..##', '.####.'],
  4: ['...##.', '..###.', '.####.', '##..##', '######', '....##', '....##'],
  5: ['######', '##....', '##....', '#####.', '....##', '##..##', '.####.'],
  6: ['.####.', '##..##', '##....', '#####.', '##..##', '##..##', '.####.'],
  7: ['######', '....##', '...##.', '..##..', '.##...', '.##...', '.##...'],
  8: ['.####.', '##..##', '##..##', '.####.', '##..##', '##..##', '.####.'],
  9: ['.####.', '##..##', '##..##', '.#####', '....##', '##..##', '.####.'],

  '!': ['..##..', '..##..', '..##..', '..##..', '..##..', '......', '..##..'],
  '?': ['.####.', '##..##', '....##', '...##.', '..##..', '......', '..##..'],
  '.': ['......', '......', '......', '......', '......', '..##..', '..##..'],
  ',': ['......', '......', '......', '......', '......', '..##..', '.##...'],
  '-': ['......', '......', '......', '######', '......', '......', '......'],
  ':': ['......', '..##..', '..##..', '......', '..##..', '..##..', '......'],
  "'": ['..##..', '..##..', '......', '......', '......', '......', '......'],
  '&': ['.###..', '##.##.', '.###..', '##.##.', '##..##', '##.###', '.####.'],
  '/': ['....##', '....##', '...##.', '..##..', '.##...', '##....', '##....'],
  '+': ['......', '..##..', '..##..', '######', '..##..', '..##..', '......'],
  '=': ['......', '......', '######', '......', '######', '......', '......'],
  '(': ['...##.', '..##..', '.##...', '.##...', '.##...', '..##..', '...##.'],
  ')': ['.##...', '..##..', '...##.', '...##.', '...##.', '..##..', '.##...'],
  ' ': ['......', '......', '......', '......', '......', '......', '......'],
};

/* ------------------------------------------------------------------ */
/* BLOCK — five rows                                                   */
/* ------------------------------------------------------------------ */

const BLOCK = {
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  F: ['#####', '#....', '####.', '#....', '#....'],
  G: ['.####', '#....', '#..##', '#...#', '.####'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  J: ['####.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '####.', '#....', '#....'],
  Q: ['.###.', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  Z: ['#####', '...#.', '..#..', '.#...', '#####'],

  0: ['.###.', '#..##', '#.#.#', '##..#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '..##.', '.#...', '#####'],
  3: ['####.', '....#', '.###.', '....#', '####.'],
  4: ['#..#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '####.'],
  6: ['.###.', '#....', '####.', '#...#', '.###.'],
  7: ['#####', '...#.', '..#..', '.#...', '.#...'],
  8: ['.###.', '#...#', '.###.', '#...#', '.###.'],
  9: ['.###.', '#...#', '.####', '....#', '.###.'],

  '!': ['..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '..##.', '.....', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '..#..'],
  ',': ['.....', '.....', '.....', '..#..', '.#...'],
  '-': ['.....', '.....', '#####', '.....', '.....'],
  ':': ['.....', '..#..', '.....', '..#..', '.....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....'],
  '&': ['.##..', '#..#.', '.##..', '#..#.', '.##.#'],
  '/': ['...#.', '...#.', '..#..', '.#...', '.#...'],
  '+': ['.....', '..#..', '#####', '..#..', '.....'],
  '=': ['.....', '#####', '.....', '#####', '.....'],
  '(': ['..##.', '.#...', '.#...', '.#...', '..##.'],
  ')': ['.##..', '...#.', '...#.', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....'],
};

const FACES = { big: BIG, block: BLOCK };

/* ------------------------------------------------------------------ */
/* The transform                                                       */
/* ------------------------------------------------------------------ */

/**
 * Placeholders for the machine's tones, heaviest first.
 *
 * Only `#` is drawn these days, but the ramp mechanism stays: the heaviest
 * character is *chosen* from what the machine has, never assumed. A face may
 * not draw a literal ramp character — the moment it does, a tone prints
 * where the face wanted that mark.
 */
const INKS = '#+~%*';

const width = (rows) => Math.max(...rows.map((r) => r.length));
const pad = (rows) => {
  const w = width(rows);
  return rows.map((r) => r.padEnd(w, '.'));
};

/** Scale up in both directions. */
function scaleBy(rows, n) {
  const out = [];
  for (const row of rows) {
    const wide = [...row].map((c) => c.repeat(n)).join('');
    for (let i = 0; i < n; i++) out.push(wide);
  }
  return out;
}

/**
 * Oblique projection — depth without a backslash.
 *
 * Isometric faces need both diagonals, `/` and `\\`. Most typewriters have
 * no backslash at all (the Olympia SM7 certainly does not), which makes the
 * classic isometric look literally untypeable.
 *
 * Oblique projection solves it honestly rather than by substitution: it is a
 * real drafting projection in which every depth line runs at the *same*
 * angle. One diagonal, no mirror needed. Draughtsmen used it for exactly the
 * same reason — it is easier to draw.
 *
 * Each cell on the upper-right silhouette gets a trail of `/` running up and
 * to the right, capped with `_` to close the top face.
 */
function extrude(rows, depth = 2) {
  const g = pad(scaleBy(rows, 2));
  const h = g.length;
  const w = g[0].length;
  const H = h + depth;
  const W = w + depth;
  const out = Array.from({ length: H }, () => Array(W).fill('.'));
  const ink = (y, x) => y >= 0 && x >= 0 && y < h && x < w && g[y][x] === '#';

  /*
   * Only the OUTER silhouette casts depth.
   *
   * Casting from every up- or right-facing edge fills the counter of an O
   * with diagonals, because the inside of the bowl faces up and right too,
   * and the letter stops reading. So flood the background inwards from the
   * border to find what is genuinely outside.
   */
  const outside = Array.from({ length: h }, () => Array(w).fill(false));
  const queue = [];
  for (let x = 0; x < w; x++) queue.push([0, x], [h - 1, x]);
  for (let y = 0; y < h; y++) queue.push([y, 0], [y, w - 1]);
  while (queue.length) {
    const [y, x] = queue.pop();
    if (y < 0 || x < 0 || y >= h || x >= w) continue;
    if (outside[y][x] || ink(y, x)) continue;
    outside[y][x] = true;
    queue.push([y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]);
  }
  const open = (y, x) => y < 0 || x < 0 || y >= h || x >= w || outside[y][x];

  /*
   * The solid is drawn as three surfaces, in the order a draughtsman would:
   *
   *   top    a rule along every upward-facing edge, offset by the depth
   *   side   a diagonal along every right-facing edge
   *   front  the letter itself, drawn last so it always wins
   *
   * Depth runs up and to the right at 45 degrees, which is why one `/`
   * suffices. Isometric faces need `\\` as well, and most typewriters -
   * the Olympia SM7 included - simply do not have it.
   */
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink(y, x) || !open(y - 1, x)) continue;
      for (let k = 1; k <= depth; k++) {
        const ty = y + depth - k;
        const tx = x + k;
        if (ty >= 0 && ty < H && tx < W && out[ty][tx] === '.') {
          out[ty][tx] = k === depth ? '_' : '/';
        }
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink(y, x) || !open(y, x + 1)) continue;
      for (let k = 1; k <= depth; k++) {
        const ty = y + depth - k;
        const tx = x + k;
        if (ty >= 0 && ty < H && tx < W && out[ty][tx] === '.') out[ty][tx] = '/';
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (ink(y, x)) out[y + depth][x] = '#';
  }
  return out.map((r) => r.join(''));
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

/**
 * A style is a face plus a chain of transforms.
 *
 * `tones` is how many weights of character the style draws with — one, here:
 * a silhouette, filled with the heaviest character the machine has. `uses`
 * is the fixed marks the projection insists on, and the picker warns if the
 * machine has no stand-in for one.
 *
 * The real FIGlet fonts are not in this table on purpose: they are files,
 * not data baked into the program, and figlet.js reads them as such. This
 * table is only for what no font file can be — see the head of this file.
 */
export const STYLES = {
  oblique:  { name: 'Three dimensional', face: 'block', fns: [extrude],
              uses: '/_', tones: 1 },
  obliqueBig:{ name: 'Three dimensional, big', face: 'big', fns: [extrude],
              uses: '/_', tones: 1 },
};

/** How many weights of character a style draws with. */
export function tonesOf(style) {
  return STYLES[style]?.tones ?? 1;
}

/**
 * Blank rows between one line of lettering and the next.
 *
 * A quarter of the block height, at least one row. Set from the block rather
 * than fixed, because the two sizes differ and the transform changes them
 * again: extrude doubles its face and adds the depth on top.
 */
const leadingFor = (h) => Math.max(1, Math.round(h / 4));

/**
 * How wide each letter comes out, after the style's transforms.
 *
 * Measuring the *input* string is useless here: extrude doubles the face
 * and adds its depth, so one `M` is 5 columns in BLOCK and 12 on the sheet.
 *
 * The cache outlives the call, and it is safe for it to: the faces are
 * constant data at the top of this file and every transform is a pure
 * function of its rows, so the width of `M` in a style is a fact about the
 * program rather than about this render. The picker asks how wide a word
 * comes out on every redraw; measured once, the answer is free from the
 * second redraw on.
 */
const GLYPH_W = new Map();

function glyphWidthsOf(style, spec, face) {
  return (ch) => {
    const up = ch.toUpperCase();
    const key = `${style} ${up}`;
    let w = GLYPH_W.get(key);
    if (w === undefined) {
      let rows = face[up] ?? face[' '];
      for (const fn of spec.fns) rows = fn(rows);
      w = width(pad(rows));
      GLYPH_W.set(key, w);
    }
    return w;
  };
}

/**
 * How wide the widest unbreakable word comes out, without rendering it.
 *
 * The one number that decides whether a face can be made to fit. Wrapping
 * breaks lines at spaces and nowhere else — a word split mid-letter is
 * unreadable, so letter() refuses to do it — which means a single word wider
 * than the paper cannot be rescued by a narrower column, a bigger margin or
 * a longer sentence. It is the face that has to change, or the paper.
 *
 * An upper bound, never an under-estimate, and it can sit one column high.
 * letter() trims the blank columns every line shares, which is a property of
 * the finished block rather than of any one glyph, so the only way to know
 * it exactly is to render — which is the cost this function exists to avoid.
 * Erring high is the right way round for the one thing it is used for:
 * warning that a face will not fit.
 *
 * @param {string} text
 * @param {keyof STYLES} style
 * @param {number} [spacing=1]
 * @returns {number} columns, an upper bound
 */
export function widestWord(text, style, spacing = 1) {
  const spec = STYLES[style] ?? STYLES.oblique;
  const face = FACES[spec.face];
  const widthOf = glyphWidthsOf(style, spec, face);

  let most = 0;
  for (const word of String(text).toUpperCase().split(/[\s\n]+/)) {
    const chars = [...word];
    if (!chars.length) continue;
    most = Math.max(most,
      chars.reduce((n, ch) => n + widthOf(ch), 0) + spacing * (chars.length - 1));
  }
  return most;
}

/**
 * Break a line of words to a column limit, at spaces.
 *
 * The measurement has to match renderRow() exactly, which lays glyphs side
 * by side with `gap` blank columns between them: total = sum of the glyph
 * widths + gap x (letters - 1). The space between two words is itself a
 * glyph with a width, so measuring the whole candidate string is exact
 * rather than approximate.
 *
 * A single word too wide to fit is left alone rather than split. Breaking a
 * word mid-letter would produce something nobody can read and, worse, would
 * hide the problem: setUp() already refuses a motif wider than the sheet and
 * says what to change - a smaller style, a shorter word, a larger sheet.
 * Silently hyphenating would turn that clear refusal into a mess.
 */
function wrapToWidth(text, maxCols, widthOf, gap) {
  const measure = (s) => {
    const chars = [...s];
    if (!chars.length) return 0;
    return chars.reduce((n, ch) => n + widthOf(ch), 0) + gap * (chars.length - 1);
  };

  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measure(candidate) <= maxCols) {
      line = candidate;
      // A first word that is already too wide still starts the line: it
      // cannot be broken, and it must not drag the next word along with it.
      if (measure(line) > maxCols && line === word) { out.push(line); line = ''; }
    } else {
      out.push(line);
      line = word;
      if (measure(line) > maxCols) { out.push(line); line = ''; }
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/**
 * Render one line of a word into placeholder rows.
 * '#' is the ink; '.' is paper.
 */
function renderRow(word, spec, face, spacing) {
  const chars = [...String(word).toUpperCase()];
  const glyphs = chars.map((ch) => {
    let rows = face[ch] ?? face[' '];
    for (const fn of spec.fns) rows = fn(rows);
    return pad(rows);
  });
  if (!glyphs.length) return [];

  const h = Math.max(...glyphs.map((g) => g.length));

  const out = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    glyphs.forEach((g, i) => {
      line += g[y] ?? '.'.repeat(g[0].length);
      if (i < glyphs.length - 1) line += '.'.repeat(spacing);
    });
    out.push(line);
  }
  return out;
}

/**
 * Render a word, or several lines of one.
 *
 * A newline in `word` starts a new line of lettering. The blocks are stacked
 * with a blank gap between them (see leadingFor), and an empty input line
 * gives a whole blank block, so a blank line works as deliberate spacing
 * rather than collapsing away.
 *
 * Tones may be given as `tones: ['B']`, heaviest first, which is what a
 * caller gets from toneRamp() in ink.js. `fill` and `light` remain as the
 * one- and two-tone shorthand, so existing callers keep working.
 *
 * `maxCols` wraps lines too wide for the paper, at spaces. Without it a
 * sentence simply runs off the sheet.
 *
 * @param {string} word
 * @param {Object} [opt]
 * @param {keyof STYLES} [opt.style='oblique']
 * @param {string[]} [opt.tones]     characters, heaviest first
 * @param {string} [opt.fill='#']    heaviest character
 * @param {string} [opt.light='+']   second character, kept for callers
 * @param {number} [opt.spacing=1]   blank columns between letters
 * @param {number} [opt.maxCols]     wrap to this many columns
 * @param {'centre'|'left'} [opt.align='centre'] how lines of one word line
 *   up against each other — not where the word goes on the paper
 * @param {Map<string,string>} [opt.substitutes] stand-ins for marks the
 *   machine has not got, from standIns() in machine.js
 * @returns {string[]} lines
 */
export function letter(word, opt = {}) {
  const {
    style = 'oblique',
    fill = '#',
    light = '+',
    spacing = 1,
    maxCols = 0,
    align = 'centre',
  } = opt;

  const spec = STYLES[style] ?? STYLES.oblique;
  const face = FACES[spec.face];

  // A ramp shorter than the style asks for degrades to its last character
  // rather than failing.
  const ramp = Array.isArray(opt.tones) && opt.tones.length
    ? opt.tones : [fill, light];
  const inkAt = (i) => ramp[Math.min(i, ramp.length - 1)] ?? fill;
  const swaps = opt.substitutes instanceof Map ? opt.substitutes : null;

  /*
   * Wrap first, then render. The break has to be decided on how wide the
   * letters actually come out - extrude doubles the face and adds depth -
   * so it cannot be done on the input string, and it cannot be done after
   * rendering either, because by then the words have been flattened into
   * rows of characters with no word boundaries left.
   */
  const widthOf = glyphWidthsOf(style, spec, face);
  const rowsIn = String(word).split('\n');
  const wrapped = maxCols > 0
    ? rowsIn.flatMap((row) =>
        (row.trim() ? wrapToWidth(row, maxCols, widthOf, spacing) : ['']))
    : rowsIn;

  const blocks = wrapped.map((row) => renderRow(row, spec, face, spacing));

  /*
   * The lines of one word are set against each other, not only against the
   * paper. Which way they line up follows the caller's alignment, because
   * that is the setting which says what centring is supposed to mean here.
   * Nothing grows: the widest block keeps its place and only the narrower
   * ones move, so a word wrapped exactly to `maxCols` still ends exactly at
   * `maxCols`.
   */
  if (align !== 'left') {
    const wide = Math.max(0, ...blocks.map((b) => b[0]?.length ?? 0));
    blocks.forEach((b, i) => {
      const lead = Math.floor((wide - (b[0]?.length ?? 0)) / 2);
      if (lead > 0) blocks[i] = b.map((r) => '.'.repeat(lead) + r);
    });
  }

  // Height of a rendered block, for the leading and for blank lines. Taken
  // from a block that has one rather than from the face itself, because the
  // transform changes it: extrude doubles the face and adds its depth.
  const blockH = Math.max(1, ...blocks.map((b) => b.length));
  const gapRows = leadingFor(blockH);

  const rows = [];
  blocks.forEach((block, i) => {
    if (i) for (let k = 0; k < gapRows; k++) rows.push('');
    // An empty input line is a blank block, not nothing: it is how somebody
    // puts air between two lines on purpose.
    if (!block.length) for (let k = 0; k < blockH; k++) rows.push('');
    else rows.push(...block);
  });

  const lines = rows.map((row) =>
    // '#' is a placeholder for the ink. Anything else the transform emitted
    // is a literal character it chose deliberately - the diagonals and
    // rules that make the projection work - and must pass through
    // untouched.
    [...row].map((c) => {
      const tone = INKS.indexOf(c);
      if (tone >= 0) return inkAt(tone);
      if (c === '.') return ' ';
      // A mark the machine has not got, typed as whatever stands in for it.
      // Applied here, at the very end, so the face never has to know which
      // machine it is being typed on — and so what comes out of this
      // function is what goes on the paper, marks included.
      return swaps?.get(c) ?? c;
    }).join('').replace(/\s+$/, ''));

  // Drop rows that ended up empty — punctuation-only words leave a lot.
  // Only at the ends: a blank row in the middle is either the leading or a
  // blank line the user asked for, and both are meant to be there.
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  /*
   * And the blank columns down the left, which are not part of the word
   * either. Any block that opens with empty cells would report them as
   * motif, so setUp() would centre a box wider than the ink — and they cost
   * keystrokes: the margin stop is set to the motif's left edge, so a blank
   * column at the front of every line is a spacebar press on every line.
   *
   * Only what every line shares. A blank column at the front of *one* line
   * is that line's own indent — the centring above puts it there on purpose
   * — and moving it would undo the alignment this function just made.
   */
  const inked = lines.filter((l) => l.trim());
  if (!inked.length) return lines;
  const indent = Math.min(...inked.map((l) => l.length - l.trimStart().length));
  return indent > 0 ? lines.map((l) => l.slice(indent)) : lines;
}

/**
 * Every character a style will actually strike, so the picker can warn.
 *
 * Both halves matter: the tones it takes from the machine, and the fixed
 * marks the face insists on — for the three-dimensional face, the `/` and
 * `_` its projection is drawn with.
 */
export function charsUsed(style, tones = ['#', '+', '~']) {
  return [...new Set([
    ...tones.slice(0, tonesOf(style)),
    ...(STYLES[style]?.uses ?? ''),
  ])];
}

/**
 * The fixed marks this face insists on, whatever machine is in the room.
 *
 * Tones are not among them and must not be: those are *chosen* from what the
 * machine has, so they are available by construction. These are the other
 * half — the marks that carry the shape rather than the weight, and the ones
 * a machine might not have. Whether this machine can strike them is not a
 * question this file is in a position to answer.
 *
 * So it does not try. Hand the result to standIns() in machine.js with the
 * machine's keys, get back what to type instead, and pass that to letter()
 * as `substitutes`. Faces stay written in the marks they were designed in,
 * and a machine that has an underscore gets an underscore.
 *
 * @param {keyof STYLES} style
 * @returns {string[]}
 */
export function marksOf(style) {
  return [...(STYLES[style]?.uses ?? '')];
}

/** Does this style use a second, lighter character? */
export function usesTwo(style) {
  return tonesOf(style) > 1;
}
