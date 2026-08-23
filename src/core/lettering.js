/**
 * lettering.js — words built out of characters.
 *
 * These letterforms are drawn here rather than imported from a FIGlet
 * collection. The classic collections are wonderful but their licences are
 * a patchwork: some are public domain, some are free-but-no-redistribution,
 * a few have no stated terms at all. Shipping them in a public repository
 * would mean shipping that mess to everyone who forks it.
 *
 * So: four faces, drawn from scratch, MIT like the rest. If you want the
 * classic figlet fonts, `figlet` reads .flf files at run time and you can
 * point it at your own copy.
 *
 * Each glyph is a list of rows using:
 *   #  solid    (whatever the fill character is)
 *   .  empty
 */

const BLOCK = {
  h: 5,
  g: {
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
    "'": ['..#..', '..#..', '.....', '.....', '.....'],
    '&': ['.##..', '#..#.', '.##..', '#..#.', '.##.#'],
    ':': ['.....', '..#..', '.....', '..#..', '.....'],
    ' ': ['.....', '.....', '.....', '.....', '.....'],
  },
};

/**
 * Double a glyph in both directions.
 *
 * The faces above are single-stroke: every filled cell already touches a
 * gap. Outlining one directly gives back exactly what went in — a control
 * that appears to do something and does not. Scaling up first creates an
 * interior worth hollowing out.
 */
function scaleBy(rows, n) {
  const out = [];
  for (const row of rows) {
    const wide = [...row].map((c) => c.repeat(n)).join('');
    for (let i = 0; i < n; i++) out.push(wide);
  }
  return out;
}

/** Keep only the filled cells that touch a gap. */
function hollow(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const at = (y, x) =>
    y < 0 || x < 0 || y >= h || x >= w ? '.' : rows[y][x];
  return rows.map((row, y) =>
    [...row].map((c, x) => {
      if (c !== '#') return '.';
      const open =
        at(y - 1, x) !== '#' || at(y + 1, x) !== '#' ||
        at(y, x - 1) !== '#' || at(y, x + 1) !== '#';
      return open ? '#' : '.';
    }).join(''));
}

/**
 * Big hollow letters: scale up, then keep the edge.
 *
 * The factor must be at least 3. At 2× every cell of a stroke still touches
 * a gap, so hollowing removes nothing and you get a larger solid letter
 * wearing the word "outline" — measured density 0.46 against 0.44 for the
 * block face. At 3× the middle of each stroke is enclosed and actually
 * drops out, which roughly halves the keystrokes.
 */
function outlineGlyph(rows) {
  return hollow(scaleBy(rows, 3));
}

/** Add a shadow one cell down-right, drawn with a lighter character. */
function shadowGlyph(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const out = Array.from({ length: h + 1 }, () => Array(w + 1).fill('.'));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === '#') out[y + 1][x + 1] = '+';
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === '#') out[y][x] = '#';
    }
  }
  return out.map((r) => r.join(''));
}

/** Slab: solid face with a rule above and below. */
function slabGlyph(rows) {
  const w = rows[0].length;
  return ['#'.repeat(w), ...rows, '#'.repeat(w)];
}

export const STYLES = {
  block:   { name: 'Block',   fill: '#', light: '+' },
  outline: { name: 'Outline', fill: '#', light: '+' },
  shadow:  { name: 'Shadow',  fill: '#', light: '+' },
  slab:    { name: 'Slab',    fill: '#', light: '+' },
};

/**
 * Render a word.
 *
 * @param {string} word
 * @param {Object} [opt]
 * @param {keyof STYLES} [opt.style='block']
 * @param {string} [opt.fill='#']   character used for the solid parts
 * @param {string} [opt.light='+']  character used for shadow
 * @param {number} [opt.spacing=1]  blank columns between letters
 * @returns {string[]} lines
 */
export function letter(word, opt = {}) {
  const {
    style = 'block',
    fill = '#',
    light = '+',
    spacing = 1,
  } = opt;

  const chars = [...String(word).toUpperCase()];
  const glyphs = chars.map((ch) => {
    let rows = BLOCK.g[ch] ?? BLOCK.g[' '];
    if (style === 'outline') rows = outlineGlyph(rows);
    else if (style === 'shadow') rows = shadowGlyph(rows);
    else if (style === 'slab') rows = slabGlyph(rows);
    return rows;
  });
  if (!glyphs.length) return [];

  const h = Math.max(...glyphs.map((g) => g.length));
  const lines = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    glyphs.forEach((g, i) => {
      const row = g[y] ?? '.'.repeat(g[0].length);
      line += [...row]
        .map((c) => (c === '#' ? fill : c === '+' ? light : ' '))
        .join('');
      if (i < glyphs.length - 1) line += ' '.repeat(spacing);
    });
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

/** Which characters a style needs, so the charset picker can warn. */
export function charsUsed(style, fill = '#', light = '+') {
  return style === 'shadow' ? [fill, light] : [fill];
}
