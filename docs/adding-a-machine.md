# Adding your machine

Profiles are plain data in [`src/profiles/index.js`](../src/profiles/index.js).
Copy the closest entry, change what differs, open a pull request. Nothing else
in the codebase needs to know your machine exists.

## Measuring it

You need four things. A ruler and a sheet of paper are enough.

### Characters per inch

Type ten characters. Measure from the left edge of the first to the left edge
of the eleventh.

| Measured | `cpi` | Name |
|---|---|---|
| 25.4 mm | `10` | pica |
| 21.2 mm | `12` | elite |

If it is neither, divide 254 by the measurement in millimetres.

### Lines per inch

Type ten lines, measure the same way. 42.3 mm means `6`, which almost every
machine uses.

### The scale

Read the numbers printed on the carriage scale. Then push each margin stop as
far as it will go and note where it lands.

```js
scale: { min: 0, max: 98, leftMin: 7, rightMax: 80 }
```

`leftMin` and `rightMax` are the stops' real limits, not the printed range.
They are usually narrower — that is why the app sometimes tells you to move
the paper instead of the stop.

### The keyboard

Type every key in order, unshifted, then shifted. Write each row as a string.

```js
rows:      ['123456789=ß´', 'qwertzuiopü', 'asdfghjklöä', 'yxcvbnm,.-'],
shiftRows: [';"/%&()_§+:`', 'QWERTZUIOPÜ', 'ASDFGHJKLÖÄ', 'YXCVBNM?!\''],
```

Both arrays must have the same number of rows, and the shifted string must
line up position by position with the unshifted one.

**Check for a zero key.** Many machines do not have one — you type a capital
`O`. Listing a zero that does not exist is the fastest way to produce art you
cannot type. Same for `@`, `#`, `$`, `*`, `[`, `]`, `<`, `>`, `|`, `\`.

If you would rather not think about any of this, open the **characters**
dialog in the app and use *learn from typing*: press every key your machine
has and it records what they produce. Then copy the result out of the text
field.

## The rest of the fields

```js
{
  id: 'maker-model',        // stable, lowercase, used in URLs
  name: 'Maker Model',      // shown in the picker
  maker: 'Company, town',   // optional
  years: '1962–1964',       // optional
  layout: 'QWERTZ (German)',// optional
  twoColour: true,          // black/red ribbon
  backspace: true,
  halfSpace: true,          // can you hold the space bar for half a step?
  notes: 'Anything a user should know before typing.',
}
```

`notes` is worth filling in. Missing characters, quirks of the ribbon
selector, whether the line space plunger keeps the grid — that is exactly the
knowledge that is otherwise locked in a manual nobody has.

## Checking your work

```sh
npm test
```

`test/core.test.mjs` validates every profile: required fields present, ids
unique, row counts matching, scale limits sane. It will tell you what is
wrong before anyone else sees it.

Then load the app, pick your machine, and convert something. If the setup
instructions make sense at the machine, the profile is right.
