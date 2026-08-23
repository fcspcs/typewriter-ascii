/**
 * Machine profiles.
 *
 * Adding your own is the point of this file — copy the closest entry, change
 * what differs, open a pull request. No code anywhere else needs to know.
 *
 * How to measure your own machine:
 *
 *   cpi   Type ten characters, measure the line. 25.4 mm → 10 (pica),
 *         21.2 mm → 12 (elite).
 *   lpi   Type ten lines, measure. 42.3 mm → 6 lines per inch.
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
    cpi: 10,
    lpi: 6,
    rows: [
      '1234567890ß´',
      'qwertzuiopü+',
      'asdfghjklöä',
      'yxcvbnm,.-',
    ],
    shiftRows: [
      ';"/%&()_§=:`',
      'QWERTZUIOPÜ*',
      'ASDFGHJKLÖÄ',
      'YXCVBNM?!\'',
    ],
    scale: { min: 0, max: 98, leftMin: 7, rightMax: 80 },
    twoColour: true,
    backspace: true,
    halfSpace: true,
    notes:
      'No zero key — type a capital O. Half spacing is done by holding the ' +
      'space bar down while striking. The line space plunger shifts the ' +
      'baseline while keeping the line grid, which is what you want for ' +
      'overstrike work.',
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
