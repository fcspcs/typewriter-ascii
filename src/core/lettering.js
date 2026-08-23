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
 *   #  ink        the heaviest character the machine has
 *   +  mid tone   a second, lighter character
 *   ~  faint      a third, lighter still
 *   .  paper
 *
 * Three placeholders rather than two because two is not enough to draw a
 * raised surface. A relief needs a lit edge, a body and a shaded edge; with
 * one tone for the whole outline the light has no direction and the letter
 * reads as a hollow box with a fill. See relief().
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
 * Raised surface: lit edge, body, shaded edge.
 *
 * The two-tone version drew the whole outline in one character and the
 * interior in another. That is a hollow letter with a fill, not a relief:
 * an edge lit from every side at once carries no light direction, so nothing
 * appears to stand up off the page.
 *
 * Three tones fix it for the price of one more character. The light comes
 * from the top left, as it does in every drawing that wants to look solid,
 * so the top and left edges take the heaviest character, the bottom and
 * right edges the faintest, and the body sits between them. On the SM7 that
 * is `B` / `2` / `-` and the letter genuinely lifts.
 *
 * Needs a stroke thick enough to have an inside, hence the scaling — see
 * outlineOf().
 */
function relief(rows) {
  const g = pad(scaleBy(rows, 3));
  const h = g.length;
  const w = g[0].length;
  const ink = (y, x) => y >= 0 && x >= 0 && y < h && x < w && g[y][x] === '#';

  return g.map((row, y) =>
    [...row].map((c, x) => {
      if (c !== '#') return '.';
      // Lit before shaded: a top-left corner is lit, not both at once.
      if (!ink(y - 1, x) || !ink(y, x - 1)) return '#';
      if (!ink(y + 1, x) || !ink(y, x + 1)) return '~';
      return '+';
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
 *
 * `tones` is how many weights of character the style draws with, and it is
 * the number the caller uses to ask the machine for a ramp. One means a
 * silhouette; two a face and a shadow behind it; three a lit edge, a body
 * and a shaded edge. `two` is kept as a derived convenience for the ribbon
 * schemes, which only ever ask "is there a second surface to colour".
 */
export const STYLES = {
  big:      { name: 'Big',            face: 'big',   fns: [], tones: 1 },
  block:    { name: 'Block',          face: 'block', fns: [], tones: 1 },
  hollow:   { name: 'Hollow',         face: 'block', fns: [outlineOf], tones: 1 },
  hollowBig:{ name: 'Hollow, big',    face: 'big',   fns: [outlineOf], tones: 1 },
  slant:    { name: 'Slanted',        face: 'big',   fns: [slant], tones: 1 },
  slantBlock:{ name: 'Slanted, small', face: 'block', fns: [slant], tones: 1 },
  shadow:   { name: 'Shadowed',       face: 'block', fns: [shadow], tones: 2 },
  shadowBig:{ name: 'Shadowed, big',  face: 'big',   fns: [shadow], tones: 2 },
  relief:   { name: 'Raised',         face: 'block', fns: [relief], tones: 3 },
  stencil:  { name: 'Stencil',        face: 'big',   fns: [stencil], tones: 1 },
  wide:     { name: 'Wide',           face: 'block', fns: [widen], tones: 1 },
  slab:     { name: 'Nameplate',      face: 'block', fns: [slab], tones: 1 },
  slantHollow: { name: 'Slanted hollow', face: 'block', fns: [outlineOf, slant],
              tones: 1 },
  reliefBig:{ name: 'Raised, big',    face: 'big',   fns: [relief], tones: 3 },
  oblique:  { name: 'Three dimensional', face: 'block', fns: [extrude],
              uses: '/_', tones: 1 },
  obliqueBig:{ name: 'Three dimensional, big', face: 'big', fns: [extrude],
              uses: '/_', tones: 1 },
  /*
   * Zero tones is not an oversight. These two draw every stroke with a
   * character chosen for its *direction* - `!` up, `_` across, `/` at a
   * corner, brackets for a curve - so there is no surface for a tone to
   * fill and the ramp is never consulted. Declaring 1 would make the
   * interface reserve a character the style then ignores, which is exactly
   * the class of quiet nothing this pass is here to remove.
   */
  drafted:  { name: 'Drafted',        face: 'block', fns: [drafted],
              uses: '/_!', tones: 0 },
  draftedBig:{ name: 'Drafted, big',  face: 'big',   fns: [drafted],
              uses: '/_!', tones: 0 },
  bulb:     { name: 'Rounded',        face: 'block', fns: [bulb],
              uses: '()_', tones: 0 },
  bulbBig:  { name: 'Rounded, big',   face: 'big',   fns: [bulb],
              uses: '()_', tones: 0 },
  wideBig:  { name: 'Wide, big',      face: 'big',   fns: [widen], tones: 1 },
};

/** How many weights of character a style draws with. */
export function tonesOf(style) {
  return STYLES[style]?.tones ?? 1;
}

/**
 * Blank rows between one line of lettering and the next.
 *
 * A quarter of the block height, at least one row. Set from the block rather
 * than fixed, because the faces differ and so do the transforms: BLOCK is
 * five rows and BIG seven, and relief scales its face by three. Measured on
 * the two plain faces this gives 1 blank row under BLOCK and 2 under BIG.
 * One row under BIG leaves the descender of one line crowding the cap of the
 * next; three under BLOCK reads as two separate motifs rather than two lines
 * of one.
 */
const leadingFor = (h) => Math.max(1, Math.round(h / 4));

/**
 * How wide each letter comes out, after the style's transforms.
 *
 * Measuring the *input* string is useless here: one `M` is 5 columns in
 * Block and 24 in Raised, big. Cached per call, because a transform chain
 * that scales by three and floods a background is not something to run once
 * per letter per candidate line.
 */
function glyphWidthsOf(spec, face) {
  const seen = new Map();
  return (ch) => {
    const key = ch.toUpperCase();
    if (!seen.has(key)) {
      let rows = face[key] ?? face[' '];
      for (const fn of spec.fns) rows = fn(rows);
      seen.set(key, width(pad(rows)));
    }
    return seen.get(key);
  };
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
 * '#', '+', '~' are the three inks; '.' is paper.
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
  const gap = spacing * (spec.fns.includes(widen) ? 2 : 1);

  const out = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    glyphs.forEach((g, i) => {
      line += g[y] ?? '.'.repeat(g[0].length);
      if (i < glyphs.length - 1) line += '.'.repeat(gap);
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
 * Tones may be given as `tones: ['B', '2', '-']`, heaviest first, which is
 * what a caller gets from toneRamp() in ink.js. `fill` and `light` remain as
 * the one- and two-tone shorthand, so existing callers keep working.
 *
 * `maxCols` wraps lines too wide for the paper, at spaces. Without it a
 * sentence simply runs off the sheet: measured on an SM7 at pica, "GUTEN
 * MORGEN LYON" in Block is 101 columns against the 82 an upright A4 holds,
 * and forty characters of input reach 239 columns — 291% of the sheet.
 *
 * @param {string} word
 * @param {Object} [opt]
 * @param {keyof STYLES} [opt.style='big']
 * @param {string[]} [opt.tones]     characters, heaviest first
 * @param {string} [opt.fill='#']    heaviest character
 * @param {string} [opt.light='+']   second character, for shadow and relief
 * @param {number} [opt.spacing=1]   blank columns between letters
 * @param {number} [opt.maxCols]     wrap to this many columns
 * @returns {string[]} lines
 */
export function letter(word, opt = {}) {
  const {
    style = 'big',
    fill = '#',
    light = '+',
    spacing = 1,
    maxCols = 0,
  } = opt;

  const spec = STYLES[style] ?? STYLES.big;
  const face = FACES[spec.face];

  /*
   * Three inks, and a short ramp has to degrade rather than fail.
   *
   * A machine with two usable characters cannot draw a three-tone relief, so
   * the faint tone falls back to the mid one and the style quietly becomes
   * its two-tone self. Falling back to `fill` instead would paint the shaded
   * edge in the same character as the lit edge, which is not a degraded
   * relief — it is a solid blob.
   */
  const ramp = Array.isArray(opt.tones) && opt.tones.length
    ? opt.tones : [fill, light];
  const heavy = ramp[0] ?? fill;
  const mid = ramp[1] ?? heavy;
  const faint = ramp[2] ?? mid;

  /*
   * Wrap first, then render. The break has to be decided on how wide the
   * letters actually come out - one `M` is 5 columns in Block and 24 in
   * Raised, big - so it cannot be done on the input string, and it cannot
   * be done after rendering either, because by then the words have been
   * flattened into rows of characters with no word boundaries left.
   */
  const gap = spacing * (spec.fns.includes(widen) ? 2 : 1);
  const widthOf = glyphWidthsOf(spec, face);
  const rowsIn = String(word).split('\n');
  const wrapped = maxCols > 0
    ? rowsIn.flatMap((row) =>
        (row.trim() ? wrapToWidth(row, maxCols, widthOf, gap) : ['']))
    : rowsIn;

  const blocks = wrapped.map((row) => renderRow(row, spec, face, spacing));

  // Height of a rendered block, for the leading and for blank lines. Taken
  // from a block that has one rather than from the face itself, because the
  // transforms change it: relief scales by three, extrude adds its depth.
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
    // '#', '+' and '~' are placeholders for the three inks. Anything else a
    // transform emitted is a literal character it chose deliberately - the
    // diagonals and brackets that make the drawn faces work - and must pass
    // through untouched. Mapping them to blanks silently erased three whole
    // styles.
    [...row].map((c) => (
      c === '#' ? heavy
        : c === '+' ? mid
          : c === '~' ? faint
            : c === '.' ? ' ' : c)).join('').replace(/\s+$/, ''));

  // Drop rows that ended up empty — punctuation-only words leave a lot.
  // Only at the ends: a blank row in the middle is either the leading or a
  // blank line the user asked for, and both are meant to be there.
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

/**
 * Every character a style will actually strike, so the picker can warn.
 *
 * Both halves matter: the tones it takes from the machine, and the fixed
 * marks a drawn face insists on. A style can have no tones at all and still
 * need three specific keys - see `drafted`.
 */
export function charsUsed(style, tones = ['#', '+', '~']) {
  return [...new Set([
    ...tones.slice(0, tonesOf(style)),
    ...(STYLES[style]?.uses ?? ''),
  ])];
}

/** Does this style use a second, lighter character? */
export function usesTwo(style) {
  return tonesOf(style) > 1;
}
