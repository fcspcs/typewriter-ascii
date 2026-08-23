/**
 * lettering.js — words built out of characters.
 *
 * The letterforms here are drawn from scratch. They are *informed* by the
 * classic FIGlet faces — anyone who has seen `banner`, `big` or `slant`
 * will recognise the family resemblance, because there are only so many
 * ways to draw a capital A out of blocks — but no glyph data is copied.
 *
 * That matters practically, not just legally: the FIGlet collection has a
 * patchwork of licences, some of which forbid redistribution. Shipping them
 * would push that problem onto everyone who forks this.
 *
 * Two hand-drawn faces:
 *   BIG    seven rows, generous, for a sheet of A4
 *   BLOCK  five rows, compact, for a postcard or a long word
 *
 * Everything else is a transform of those, which is where most of the
 * variety comes from: hollowing, shearing, stencilling, doubling, shadows.
 *
 * Glyph data uses:
 *   #  ink
 *   .  paper
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
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

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

/** Keep only the ink that touches paper. */
function hollow(rows) {
  const g = pad(rows);
  const h = g.length;
  const w = g[0].length;
  const at = (y, x) => (y < 0 || x < 0 || y >= h || x >= w ? '.' : g[y][x]);
  return g.map((row, y) =>
    [...row].map((c, x) => {
      if (c !== '#') return '.';
      const open = at(y - 1, x) !== '#' || at(y + 1, x) !== '#' ||
                   at(y, x - 1) !== '#' || at(y, x + 1) !== '#';
      return open ? '#' : '.';
    }).join(''));
}

/**
 * Hollow letters need room to be hollow.
 *
 * The factor must be at least 3, and this is worth stating plainly because
 * getting it wrong is invisible: at 2× every cell of a stroke still touches
 * paper, so hollowing removes nothing and you get a larger *solid* letter
 * labelled "hollow" — measured density 0.46 against 0.44 for the solid face.
 * At 3× the middle of each stroke is enclosed and actually drops out.
 *
 * `test/core.test.mjs` compares density, not raw strokes, so a regression
 * here fails the suite rather than shipping quietly.
 */
function outlineOf(rows) {
  return hollow(scaleBy(rows, 3));
}

/** Lean the letter to the right, top rows furthest over. */
function slant(rows, lean = 1) {
  const g = pad(rows);
  const h = g.length;
  const shift = (y) => Math.round((h - 1 - y) * lean * 0.5);
  const most = shift(0);
  return g.map((row, y) => {
    const s = shift(y);
    return '.'.repeat(s) + row + '.'.repeat(most - s);
  });
}

/**
 * Cut horizontal breaks through the strokes, the way a stencil is bridged.
 *
 * Only meaningful on a face whose strokes are more than one cell thick. On a
 * thin face the break severs the letter instead of bridging it, which is why
 * there is no small stencil style.
 */
function stencil(rows) {
  const g = pad(rows);
  const h = g.length;
  // Break rows chosen to fall inside the letter, never on the first or last.
  const cuts = h >= 7 ? [2, 4] : [1, 3];
  return g.map((row, y) =>
    cuts.includes(y)
      ? [...row].map((c, x) => (c === '#' && x % 4 === 1 ? '.' : c)).join('')
      : row);
}

/** Twice as wide. Reads as heavier without adding height. */
function widen(rows) {
  return pad(rows).map((r) => [...r].map((c) => c + c).join(''));
}

/** Offset copy below-right, drawn with a second, lighter character. */
function shadow(rows, offset = 1) {
  const g = pad(rows);
  const h = g.length;
  const w = g[0].length;
  const out = Array.from({ length: h + offset },
    () => Array(w + offset).fill('.'));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y][x] === '#') out[y + offset][x + offset] = '+';
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (g[y][x] === '#') out[y][x] = '#';
  }
  return out.map((r) => r.join(''));
}

/** Rules above and below, like a nameplate. */
function slab(rows) {
  const g = pad(rows);
  const w = g[0].length;
  return ['#'.repeat(w), ...g, '#'.repeat(w)];
}

/**
 * Outline in the main character, interior filled with the lighter one.
 *
 * Two weights of ink read as a raised surface. Needs a stroke thick enough
 * to have an inside, hence the scaling — see outlineOf().
 */
function relief(rows) {
  const solid = pad(scaleBy(rows, 3));
  const edge = hollow(solid);
  return solid.map((row, y) =>
    [...row].map((c, x) => {
      if (c !== '#') return '.';
      return edge[y][x] === '#' ? '#' : '+';
    }).join(''));
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

/**
 * A style is a face plus a chain of transforms.
 * `two` marks styles that use a second, lighter character.
 */
export const STYLES = {
  big:      { name: 'Big',            face: 'big',   fns: [] },
  block:    { name: 'Block',          face: 'block', fns: [] },
  hollow:   { name: 'Hollow',         face: 'block', fns: [outlineOf] },
  hollowBig:{ name: 'Hollow, big',    face: 'big',   fns: [outlineOf] },
  slant:    { name: 'Slanted',        face: 'big',   fns: [slant] },
  slantBlock:{ name: 'Slanted, small', face: 'block', fns: [slant] },
  shadow:   { name: 'Shadowed',       face: 'block', fns: [shadow], two: true },
  shadowBig:{ name: 'Shadowed, big',  face: 'big',   fns: [shadow], two: true },
  relief:   { name: 'Raised',         face: 'block', fns: [relief], two: true },
  stencil:  { name: 'Stencil',        face: 'big',   fns: [stencil] },
  wide:     { name: 'Wide',           face: 'block', fns: [widen] },
  slab:     { name: 'Nameplate',      face: 'block', fns: [slab] },
  slantHollow: { name: 'Slanted hollow', face: 'block', fns: [outlineOf, slant] },
  reliefBig:{ name: 'Raised, big',    face: 'big',   fns: [relief], two: true },
  wideBig:  { name: 'Wide, big',      face: 'big',   fns: [widen] },
};

/**
 * Render a word.
 *
 * @param {string} word
 * @param {Object} [opt]
 * @param {keyof STYLES} [opt.style='big']
 * @param {string} [opt.fill='#']    character for the solid parts
 * @param {string} [opt.light='+']   character for shadows and relief
 * @param {number} [opt.spacing=1]   blank columns between letters
 * @returns {string[]} lines
 */
export function letter(word, opt = {}) {
  const {
    style = 'big',
    fill = '#',
    light = '+',
    spacing = 1,
  } = opt;

  const spec = STYLES[style] ?? STYLES.big;
  const face = FACES[spec.face];

  const chars = [...String(word).toUpperCase()];
  const glyphs = chars.map((ch) => {
    let rows = face[ch] ?? face[' '];
    for (const fn of spec.fns) rows = fn(rows);
    return pad(rows);
  });
  if (!glyphs.length) return [];

  const h = Math.max(...glyphs.map((g) => g.length));
  const gap = spacing * (spec.fns.includes(widen) ? 2 : 1);

  const lines = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    glyphs.forEach((g, i) => {
      const row = g[y] ?? '.'.repeat(g[0].length);
      line += [...row]
        .map((c) => (c === '#' ? fill : c === '+' ? light : ' '))
        .join('');
      if (i < glyphs.length - 1) line += ' '.repeat(gap);
    });
    lines.push(line.replace(/\s+$/, ''));
  }
  // Drop rows that ended up empty — punctuation-only words leave a lot.
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

/** Which characters a style needs, so the picker can warn. */
export function charsUsed(style, fill = '#', light = '+') {
  return STYLES[style]?.two ? [fill, light] : [fill];
}

/** Does this style use a second character? */
export function usesTwo(style) {
  return Boolean(STYLES[style]?.two);
}
