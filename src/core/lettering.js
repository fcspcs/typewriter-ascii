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

/**
 * Draughted outline: each edge picks a character that matches its direction.
 *
 * Horizontal edges become `_`, vertical edges `!`, and corners `/`. The
 * exclamation mark as a vertical stroke is an old typewriter-art habit and
 * the reason this face works on machines with no pipe character.
 */
function drafted(rows) {
  const g = pad(scaleBy(rows, 2));
  const h = g.length;
  const w = g[0].length;
  const ink = (y, x) => y >= 0 && x >= 0 && y < h && x < w && g[y][x] === '#';

  return g.map((row, y) =>
    [...row].map((c, x) => {
      if (c !== '#') return '.';
      const up = !ink(y - 1, x);
      const down = !ink(y + 1, x);
      const left = !ink(y, x - 1);
      const right = !ink(y, x + 1);
      if (!up && !down && !left && !right) return '.';   // interior
      if ((up || down) && (left || right)) return '/';   // corner
      if (up || down) return '_';
      return '!';
    }).join(''));
}

/**
 * Rounded, bulb-like face: the outline drawn with brackets and underscores.
 *
 * Left edges take `(`, right edges `)`, horizontals `_`. Every one of those
 * exists on essentially any typewriter, which is the point.
 */
function bulb(rows) {
  const g = pad(scaleBy(rows, 2));
  const h = g.length;
  const w = g[0].length;
  const ink = (y, x) => y >= 0 && x >= 0 && y < h && x < w && g[y][x] === '#';

  return g.map((row, y) =>
    [...row].map((c, x) => {
      if (c !== '#') return '.';
      const up = !ink(y - 1, x);
      const down = !ink(y + 1, x);
      const left = !ink(y, x - 1);
      const right = !ink(y, x + 1);
      if (!up && !down && !left && !right) return '.';
      if (left && !right) return '(';
      if (right && !left) return ')';
      if (up || down) return '_';
      return '(';
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
  oblique:  { name: 'Three dimensional', face: 'block', fns: [extrude],
              uses: '/_' },
  obliqueBig:{ name: 'Three dimensional, big', face: 'big', fns: [extrude],
              uses: '/_' },
  drafted:  { name: 'Drafted',        face: 'block', fns: [drafted],
              uses: '/_!' },
  draftedBig:{ name: 'Drafted, big',  face: 'big',   fns: [drafted],
              uses: '/_!' },
  bulb:     { name: 'Rounded',        face: 'block', fns: [bulb],
              uses: '()_' },
  bulbBig:  { name: 'Rounded, big',   face: 'big',   fns: [bulb],
              uses: '()_' },
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
      // '#' and '+' are placeholders for the two inks. Anything else a
      // transform emitted is a literal character it chose deliberately -
      // the diagonals and brackets that make the drawn faces work - and
      // must pass through untouched. Mapping them to blanks silently
      // erased three whole styles.
      line += [...row]
        .map((c) => (c === '#' ? fill : c === '+' ? light : c === '.' ? ' ' : c))
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
