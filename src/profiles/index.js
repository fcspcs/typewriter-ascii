/**
 * Machine profiles.
 *
 * Adding your own is the point of this file — copy the closest entry, change
 * what differs, open a pull request. No code anywhere else needs to know.
 *
 * How to measure your own machine:
 *
 *   cpi   Use the measuring panel in the app — it walks you through it and
 *         works the number out. By hand: type forty capital M, measure from
 *         the left edge of the first to the left edge of the fortieth, and
 *         divide 39 × 25.4 by what you read. 99.1 mm → 10 (pica),
 *         82.6 mm → 12 (elite).
 *   lpi   Same idea downwards: forty lines of capital M, top of the first to
 *         the top of the fortieth — thirty-nine steps of paper feed.
 *         165.1 mm → 6 lines per inch.
 *
 *         Top to *top*, not top to bottom. Measuring to the bottom of the
 *         last line adds one capital's height, and a typewriter capital is
 *         very nearly a whole line tall: ten lines measured that way read
 *         about 42 mm where nine steps of feed is 38.1, which works out at
 *         5.4 lines per inch and is not a spacing anyone ever built.
 *   scale Read the numbers printed on the carriage scale. Push each margin
 *         stop as far as it will go and note where it stops.
 *   rows  Type every key in order, unshifted, then shifted.
 */

/** @type {import('../core/machine.js').Machine[]} */
export const PROFILES = [
  {
    id: 'olympia-sm7',
    name: 'Olympia SM7 de Luxe',
    maker: 'Olympia Werke AG, Wilhelmshaven',
    years: '1962–1964',
    layout: 'QWERTZ (German)',
    // Measured, not assumed. Olympia built the SM7 in both pitches and the
    // manual does not say which one any given machine left the factory with,
    // so this was settled with a ruler: forty capital M spanned 104 mm, which
    // is 9.8 characters per inch. Elite would have measured about 85 mm — two
    // centimetres away, far outside anything a ruler could confuse.
    cpi: 10,
    lpi: 6,
    pitchMeasured: true,
    // Read off the keyboard itself. Note there is no zero and no 'at' sign:
    // digits stop at 9, and a capital O stands in for zero. Getting this
    // wrong is the fastest way to produce art that cannot be typed.
    rows: [
      '123456789=ß´',
      'qwertzuiopü',
      'asdfghjklöä',
      'yxcvbnm,.-',
    ],
    shiftRows: [
      ';"/%&()_§+:`',
      'QWERTZUIOPÜ',
      'ASDFGHJKLÖÄ',
      'YXCVBNM?!\'',
    ],
    scale: { min: 0, max: 98, leftMin: 7, rightMax: 80 },
    twoColour: true,
    backspace: true,
    halfSpace: true,
    notes:
      'No zero key — type a capital O. Also absent: @ # $ * ^ ~ | \\ [ ] ' +
      '{ } < >. Half spacing is done by holding the space bar down while ' +
      'striking. The line space plunger shifts the baseline while keeping ' +
      'the line grid, which is what you want for overstrike work.',
  },

  {
    id: 'generic-pica-qwerty',
    name: 'Generic pica (QWERTY)',
    maker: '—',
    layout: 'QWERTY',
    cpi: 10,
    lpi: 6,
    rows: [
      '1234567890-=',
      'qwertyuiop',
      'asdfghjkl;\'',
      'zxcvbnm,./',
    ],
    shiftRows: [
      '!"#$%&()*+',
      'QWERTYUIOP',
      'ASDFGHJKL:"',
      'ZXCVBNM<>?',
    ],
    scale: { min: 0, max: 100, leftMin: 0, rightMax: 100 },
    twoColour: true,
    backspace: true,
    halfSpace: false,
    notes: 'A neutral starting point when you do not know your machine yet.',
  },

  {
    id: 'generic-elite-qwerty',
    name: 'Generic elite (QWERTY)',
    maker: '—',
    layout: 'QWERTY',
    cpi: 12,
    lpi: 6,
    rows: [
      '1234567890-=',
      'qwertyuiop',
      'asdfghjkl;\'',
      'zxcvbnm,./',
    ],
    shiftRows: [
      '!"#$%&()*+',
      'QWERTYUIOP',
      'ASDFGHJKL:"',
      'ZXCVBNM<>?',
    ],
    scale: { min: 0, max: 120, leftMin: 0, rightMax: 120 },
    twoColour: true,
    backspace: true,
    halfSpace: false,
    notes: 'Elite spacing fits about a fifth more characters per line.',
  },
];

export function profileById(id) {
  return PROFILES.find((p) => p.id === id) ?? PROFILES[0];
}
